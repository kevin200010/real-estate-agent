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
from botocore.exceptions import NoCredentialsError


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
            with path.open("r", encoding="utf-8") as f:
                self.properties: List[Dict[str, object]] = json.load(f)
        except FileNotFoundError:
            # Gracefully handle missing data file so the server can still run.
            self.properties = []
            print(f"Property data file not found: {path}. Using empty dataset.")

    def search(self, query: str, limit: int = 3) -> List[Dict[str, object]]:
        q_words = query.lower().split()
        results = []
        for p in self.properties:
            text = f"{p['location']} {p['description']}".lower()
            if all(word in text for word in q_words):  # partial AND match
                results.append(p)
        return results[:limit]


class RAGRetriever:
    """Retrieve property listings from an external RAG service."""

    def __init__(self, endpoint: str):
        self.endpoint = endpoint

    def search(self, query: str, limit: int = 3) -> List[Dict[str, object]]:
        payload = {"query": query, "k": limit}
        try:
            resp = requests.post(self.endpoint, json=payload, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict):
                return data.get("results", [])
            return data
        except Exception as exc:  # broad catch to keep chat running
            print("RAG retrieval failed:", exc)
            return []


class LLMClient:
    """Wrapper around a core Nova language model."""

    def __init__(self, model_id: str = "amazon.nova-lite-v1:0", region: str = "us-east-1"):
        self.client = boto3.client("bedrock-runtime", region_name=region)
        self.model_id = model_id

    def answer(self, question: str, listings: List[Dict[str, object]]) -> str:
        """Generate an answer about property listings using valid Claude-compatible prompt."""
        context_lines = [
            f"- {p['id']}: {p['location']} ${p['price']} {p['bedrooms']} bedrooms. {p['description']}"
            for p in listings
        ]
        context = "\n".join(context_lines) or "No listings matched."

        merged_prompt = (
            "You are a helpful real-estate assistant. Always answer clearly and concisely "
            "based only on the listings provided.\n\n"
            f"Listings:\n{context}\n\nQuestion: {question}"
        )

        body = json.dumps({
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": merged_prompt}]
                }
            ]
        })

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
        except Exception as exc:
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
        return response["body"].read()


class PropertyChatbot:
    """Central orchestrator routing text and voice inputs."""

    def __init__(self, retriever: PropertyRetriever, llm: LLMClient, sonic: Optional[SonicClient] = None):
        self.retriever = retriever
        self.llm = llm
        self.sonic = sonic
        self.session_id = str(uuid.uuid4())

    def ask_text(self, query: str) -> Tuple[str, List[Dict[str, object]]]:
        """Return LLM answer and the listings used for context."""
        listings = self.retriever.search(query)
        print("Query:", query)
        print("Matched Listings:", listings)
        result = self.llm.answer(query, listings)
        print("LLM Response:", result)
        return result, listings

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

    data_path = Path(__file__).with_name("properties.json")
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
# Prefer an external RAG service if configured; otherwise fall back to local data
_rag_url = os.getenv("RAG_SERVER_URL")
if _rag_url:
    _retriever = RAGRetriever(_rag_url)
else:
    # Resolve the path to ensure the JSON file is located correctly even when
    # the working directory differs (e.g. when launched via uvicorn).
    _data_path = Path(__file__).resolve().with_name("properties.json")
    _retriever = PropertyRetriever(_data_path)

_llm = LLMClient()
_bot = PropertyChatbot(_retriever, _llm)


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
