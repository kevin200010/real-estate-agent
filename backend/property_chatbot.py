from __future__ import annotations

import argparse
import base64
import json
import os
import uuid
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import boto3
import requests
from botocore.exceptions import NoCredentialsError, ClientError
from dotenv import load_dotenv

# Load environment variables from a .env file at the project root so boto3
# can pick up AWS credentials during local development.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


_STATE_ABBREVIATIONS = {
    "AL": "Alabama",
    "AK": "Alaska",
    "AZ": "Arizona",
    "AR": "Arkansas",
    "CA": "California",
    "CO": "Colorado",
    "CT": "Connecticut",
    "DE": "Delaware",
    "FL": "Florida",
    "GA": "Georgia",
    "HI": "Hawaii",
    "ID": "Idaho",
    "IL": "Illinois",
    "IN": "Indiana",
    "IA": "Iowa",
    "KS": "Kansas",
    "KY": "Kentucky",
    "LA": "Louisiana",
    "ME": "Maine",
    "MD": "Maryland",
    "MA": "Massachusetts",
    "MI": "Michigan",
    "MN": "Minnesota",
    "MS": "Mississippi",
    "MO": "Missouri",
    "MT": "Montana",
    "NE": "Nebraska",
    "NV": "Nevada",
    "NH": "New Hampshire",
    "NJ": "New Jersey",
    "NM": "New Mexico",
    "NY": "New York",
    "NC": "North Carolina",
    "ND": "North Dakota",
    "OH": "Ohio",
    "OK": "Oklahoma",
    "OR": "Oregon",
    "PA": "Pennsylvania",
    "RI": "Rhode Island",
    "SC": "South Carolina",
    "SD": "South Dakota",
    "TN": "Tennessee",
    "TX": "Texas",
    "UT": "Utah",
    "VT": "Vermont",
    "VA": "Virginia",
    "WA": "Washington",
    "WV": "West Virginia",
    "WI": "Wisconsin",
    "WY": "Wyoming",
    "DC": "District of Columbia",
}


def normalize_listing(p: Dict[str, object]) -> Dict[str, object]:
    """Map a raw property dict to a common schema."""
    return {
        **p,
        "location": p.get("location") or p.get("address", "Unknown location"),
        "bedrooms": p.get("bedrooms") or p.get("sqft") or "N/A",
    }


class PropertyRetriever:
    """Naive retrieval over local property listing data."""

    def __init__(self, data_file: Path | str):
        """Load property data from ``data_file`` if it exists.

        The path is resolved to an absolute ``Path`` to avoid issues with
        relative imports or different working directories. If the file is
        missing the chatbot will still start, but with an empty dataset so the
        front end can continue to function.
        """

        path = Path(data_file).resolve()
        try:
            if path.suffix.lower() == ".csv":
                import csv

                with path.open("r", encoding="utf-8", newline="") as f:
                    reader = csv.DictReader(f)
                    self.properties = []
                    for row in reader:
                        cleaned = {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
                        state_abbr = cleaned.get("State", "").upper()
                        state_full = _STATE_ABBREVIATIONS.get(state_abbr, state_abbr)
                        location = f"{cleaned.get('City', '')}, {state_full}".strip(", ")
                        price_str = cleaned.get("List Price", "").replace("$", "").replace(",", "")
                        try:
                            price = int(float(price_str)) if price_str else None
                        except ValueError:
                            price = None
                        self.properties.append(
                            {
                                "id": cleaned.get("Listing Number"),
                                "address": cleaned.get("Address"),
                                "location": location,
                                "price": price,
                                "type": cleaned.get("Property Type"),
                                "description": cleaned.get("Property Subtype"),
                            }
                        )
            else:
                with path.open("r", encoding="utf-8") as f:
                    self.properties = json.load(f)
        except FileNotFoundError:
            # Gracefully handle missing data file so the server can still run.
            self.properties = []
            print(f"Property data file not found: {path}. Using empty dataset.")

    def search(self, query: str, limit: int = 3) -> List[Dict[str, object]]:
        q_words = query.lower().split()
        scored: List[Tuple[int, Dict[str, object]]] = []
        for p in self.properties:
            # Some datasets use "address" instead of "location". Use ``get`` to
            # avoid ``KeyError`` and to support both schemas so the same
            # retriever can work with residential ``properties.json`` and the
            # commercial ``rag_data.json``.
            location = p.get("location") or p.get("address", "")
            description = p.get("description", "")
            category = p.get("type", "")
            text = f"{location} {description} {category}".lower()
            score = sum(word in text for word in q_words)
            if score:
                scored.append((score, p))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [p for _, p in scored[:limit]]


class RAGRetriever:
    """Retrieve property listings from an external RAG service."""

    def __init__(self, endpoint: str, fallback: Optional[PropertyRetriever] = None):
        self.endpoint = endpoint
        self.fallback = fallback

    def search(self, query: str, limit: int = 3) -> List[Dict[str, object]]:
        payload = {"query": query, "k": limit}
        try:
            resp = requests.post(self.endpoint, json=payload, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict):
                results = data.get("results", [])
            else:
                results = data
            if results:
                return results
        except Exception as exc:  # broad catch to keep chat running
            print("RAG retrieval failed:", exc)

        # If the remote call fails or returns no results, fall back to the
        # local retriever when available so users still see listings.
        if self.fallback:
            return self.fallback.search(query, limit)
        return []


class LLMClient:
    """Wrapper around a core Nova language model."""

    def __init__(self, model_id: str = "amazon.nova-lite-v1:0", region: str = "us-east-1"):
        self.client = boto3.client("bedrock-runtime", region_name=region)
        self.model_id = model_id

    def answer(self, question: str, listings: List[Dict[str, object]]) -> str:
        """Generate an answer about property listings using valid Claude-compatible prompt."""
        context_lines: List[str] = []
        for p in listings:
            location = p.get("location") or p.get("address", "Unknown location")
            bedrooms = p.get("bedrooms") or p.get("sqft") or "N/A"
            price = p.get("price", "N/A")
            description = p.get("description", "")
            context_lines.append(
                f"- {p.get('id', 'N/A')}: {location} ${price} {bedrooms} bedrooms. {description}"
            )
        context = "\n".join(context_lines) or "No listings matched."

        merged_prompt = (
            "You are a helpful real-estate assistant. Always answer clearly and concisely "
            "based only on the listings provided.\n\n"
            f"Listings:\n{context}\n\nQuestion: {question}"
        )

        body = json.dumps(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": [{"text": merged_prompt}],
                    }
                ],
                # Nova models require an explicit inference configuration. Without at
                # least ``maxTokens`` the Bedrock service responds with a
                # ``ValidationException`` which surfaces to the frontend as
                # "Failed to generate an answer." Supplying a conservative
                # ``maxTokens`` and temperature ensures the request is valid and
                # prevents the chat from failing for simple greetings like "Hi".
                "inferenceConfig": {"maxTokens": 256, "temperature": 0.7},
            }
        )

        try:
            response = self.client.invoke_model(
                modelId=self.model_id,
                body=body,
                contentType="application/json",
                accept="application/json",
            )
            payload = json.loads(response["body"].read())
            print("Full Bedrock Response:", json.dumps(payload, indent=2))  # Debugging output

            # return payload.get("content") or payload.get("output", {}).get("text", "")
            try:
                return payload["output"]["message"]["content"][0]["text"]
            except (KeyError, IndexError):
                return "No answer found."
        except NoCredentialsError:
            return (
                "AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY "
                "to enable Bedrock access."
            )
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code == "InvalidSignatureException":
                return (
                    "Invalid AWS signature. Ensure your access key, secret key, and system clock are correct."
                )
            print("LLM invocation failed:", exc)
            return "Failed to generate an answer."

    def answer_general(self, question: str) -> str:
        """Generate a general real-estate answer without listing context."""
        prompt = (
            "You are a knowledgeable real-estate assistant. Answer the question "
            "clearly and concisely.\n\nQuestion: "
            f"{question}"
        )

        body = json.dumps(
            {
                "messages": [{"role": "user", "content": [{"text": prompt}]}],
                "inferenceConfig": {"maxTokens": 256, "temperature": 0.7},
            }
        )

        try:
            response = self.client.invoke_model(
                modelId=self.model_id,
                body=body,
                contentType="application/json",
                accept="application/json",
            )
            payload = json.loads(response["body"].read())
            try:
                return payload["output"]["message"]["content"][0]["text"]
            except (KeyError, IndexError):
                return "No answer found."
        except NoCredentialsError:
            return (
                "AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY "
                "to enable Bedrock access."
            )
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code == "InvalidSignatureException":
                return (
                    "Invalid AWS signature. Ensure your access key, secret key, and system clock are correct."
                )
            print("LLM invocation failed:", exc)
            return "Failed to generate an answer."


class SonicClient:
    """Minimal Nova Sonic client for non-streaming STT/TTS."""

    def __init__(self, model_id: str = "amazon.nova-sonic-v1:0", region: str = "us-east-1"):
        self.client = boto3.client("bedrock-runtime", region_name=region)
        self.model_id = model_id

    def transcribe(self, audio_bytes: bytes) -> str:
        """Convert audio bytes (wav/pcm16) to text."""
        try:
            response = self.client.invoke_model(
                modelId=self.model_id,
                body=audio_bytes,
                contentType="audio/wav",
                accept="application/json",
            )
        except NoCredentialsError as exc:
            raise RuntimeError(
                "AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
            ) from exc
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code == "InvalidSignatureException":
                raise RuntimeError(
                    "Invalid AWS signature. Ensure your access key, secret key, and system clock are correct."
                ) from exc
            raise
        payload = json.loads(response["body"].read())
        return payload.get("text", "")

    def synthesize(self, text: str) -> bytes:
        """Convert text to spoken audio (pcm)."""
        body = json.dumps(
            {
                "inputText": text,
                "audioFormat": {"codec": "pcm", "sampleRateHertz": 24000},
            }
        )
        try:
            response = self.client.invoke_model(
                modelId=self.model_id,
                body=body,
                contentType="application/json",
                accept="audio/pcm",
            )
        except NoCredentialsError as exc:
            raise RuntimeError(
                "AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
            ) from exc
        except ClientError as exc:
            error_code = exc.response.get("Error", {}).get("Code", "")
            if error_code == "InvalidSignatureException":
                raise RuntimeError(
                    "Invalid AWS signature. Ensure your access key, secret key, and system clock are correct."
                ) from exc
            raise
        return response["body"].read()


class PropertyChatbot:
    """Central orchestrator routing text and voice inputs."""

    def __init__(self, retriever: PropertyRetriever, llm: LLMClient, sonic: Optional[SonicClient] = None):
        self.retriever = retriever
        self.llm = llm
        self.sonic = sonic
        self.session_id = str(uuid.uuid4())

    _LISTING_KEYWORDS = {
        "listing",
        "listings",
        "property",
        "properties",
        "home",
        "house",
        "apartment",
        "condo",
        "office",
        "industrial",
        "commercial",
    }

    @classmethod
    def _wants_listings(cls, query: str) -> bool:
        q = query.lower()
        return any(word in q for word in cls._LISTING_KEYWORDS)

    def ask_text(self, query: str) -> Tuple[str, List[Dict[str, object]]]:
        """Return LLM answer and any listings used for context."""
        listings = self.retriever.search(query) if self._wants_listings(query) else []
        normalized = [normalize_listing(p) for p in listings]
        print("listing = " , listings)
        print(normalized)
        print("Query:", query)
        print("Matched Listings:", normalized)
        result = self.llm.answer(query, normalized)
        print("LLM Response:", result)
        return result, normalized

    def ask_audio(self, audio_bytes: bytes) -> Dict[str, object]:
        if not self.sonic:
            raise RuntimeError("Sonic client required for audio processing")
        transcript = self.sonic.transcribe(audio_bytes)
        answer, listings = self.ask_text(transcript)
        spoken = self.sonic.synthesize(answer)
        return {"transcript": transcript, "answer": answer, "listings": listings, "audio": spoken}


def main() -> None:
    parser = argparse.ArgumentParser(description="Property listing assistant")
    parser.add_argument("--text", help="Text query")
    parser.add_argument("--audio", help="Path to wav file containing spoken question")
    args = parser.parse_args()

    data_path = Path(__file__).resolve().parents[1] / "frontend" / "data" / "listings.csv"
    retriever = PropertyRetriever(data_path)
    llm = LLMClient()
    sonic = SonicClient()
    bot = PropertyChatbot(retriever, llm, sonic)

    if args.text:
        print(bot.ask_text(args.text))
    elif args.audio:
        audio_bytes = Path(args.audio).read_bytes()
        result = bot.ask_audio(audio_bytes)
        print("Transcript:", result["transcript"])
        print("Answer:", result["answer"])
        Path("response_audio.pcm").write_bytes(result["audio"])
        print("Audio response written to response_audio.pcm")
    else:
        parser.print_help()



if __name__ == "__main__":
    main()


# Global chatbot instance reused by the web API
# Prefer an external RAG service if configured; otherwise fall back to the
# bundled commercial listing data. The local data is also used as a fallback if
# the remote service is unavailable.
_rag_url = os.getenv("RAG_SERVER_URL")
_data_path = (
    Path(__file__).resolve().parents[1]
    / "frontend"
    / "data"
    / "listings.csv"
)
_local_retriever = PropertyRetriever(_data_path)
if _rag_url:
    _retriever = RAGRetriever(_rag_url, fallback=_local_retriever)
else:
    _retriever = _local_retriever

_llm = LLMClient()
_sonic = SonicClient()
_bot = PropertyChatbot(_retriever, _llm, _sonic)


async def process_user_query(query: str):
    """Handle a user text query and return answer plus property cards."""
    answer, listings = _bot.ask_text(query)
    cards = [
        {
            "image": p.get("image", "https://placehold.co/400x300"),
            "address": p.get("address") or p.get("location"),
            "price": f"${p.get('price'):,}",
            "description": p.get("description", "")
        }
        for p in listings
    ]
    return {"reply": answer, "properties": cards}


async def process_user_audio(audio_bytes: bytes):
    """Handle a user audio query returning transcript, answer, and audio."""
    result = _bot.ask_audio(audio_bytes)
    cards = [
        {
            "image": p.get("image", "https://placehold.co/400x300"),
            "address": p.get("address") or p.get("location"),
            "price": f"${p.get('price'):,}",
            "description": p.get("description", ""),
        }
        for p in result["listings"]
    ]
    audio_b64 = base64.b64encode(result["audio"]).decode("utf-8")
    return {
        "transcript": result["transcript"],
        "reply": result["answer"],
        "audio": audio_b64,
        "properties": cards,
    }

