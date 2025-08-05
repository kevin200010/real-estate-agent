"""Sample property listing chatbot combining Nova core models and Nova Sonic.

This module demonstrates a simplified architecture:
- Central orchestrator that routes text and voice inputs
- Retrieval layer backed by a small property listing dataset
- Core Nova model for reasoning over retrieved listings
- Nova Sonic for optional speech-to-text and text-to-speech

The code is intentionally lightweight and focuses on illustrating how the
components connect. Real deployments should handle authentication,
error handling, streaming audio, and secure storage of user data.
"""

from __future__ import annotations

import argparse
import base64
import json
import uuid
from pathlib import Path
from typing import List, Dict, Optional

import boto3


class PropertyRetriever:
    """Naive retrieval over local property listing data."""

    def __init__(self, data_file: Path):
        with open(data_file, "r", encoding="utf-8") as f:
            self.properties: List[Dict[str, object]] = json.load(f)

    def search(self, query: str, limit: int = 3) -> List[Dict[str, object]]:
        """Return listings whose text matches the query."""
        q = query.lower()
        results = []
        for p in self.properties:
            text = f"{p['location']} {p['description']}".lower()
            if q in text:
                results.append(p)
        return results[:limit]


class LLMClient:
    """Wrapper around a core Nova language model."""

    def __init__(self, model_id: str = "amazon.nova-lite-v1:0", region: str = "us-east-1"):
        self.client = boto3.client("bedrock-runtime", region_name=region)
        self.model_id = model_id

    def answer(self, question: str, listings: List[Dict[str, object]]) -> str:
        """Generate an answer about property listings."""
        context_lines = [
            f"- {p['id']}: {p['location']} ${p['price']} {p['bedrooms']} bedrooms. {p['description']}"
            for p in listings
        ]
        context = "\n".join(context_lines) or "No listings matched."
        prompt = (
            "You are a real-estate assistant. Use the provided property listings to answer the user's question.\n"
            f"Listings:\n{context}\n\nQuestion: {question}\nAnswer:"
        )
        body = json.dumps({"inputText": prompt})
        response = self.client.invoke_model(
            modelId=self.model_id,
            body=body,
            contentType="application/json",
            accept="application/json",
        )
        payload = json.loads(response["body"].read())
        return payload.get("outputText", "")


class SonicClient:
    """Minimal Nova Sonic client for non-streaming STT/TTS."""

    def __init__(self, model_id: str = "amazon.nova-sonic-v1:0", region: str = "us-east-1"):
        self.client = boto3.client("bedrock-runtime", region_name=region)
        self.model_id = model_id

    def transcribe(self, audio_bytes: bytes) -> str:
        """Convert audio bytes (wav/pcm16) to text."""
        response = self.client.invoke_model(
            modelId=self.model_id,
            body=audio_bytes,
            contentType="audio/wav",
            accept="application/json",
        )
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
        response = self.client.invoke_model(
            modelId=self.model_id,
            body=body,
            contentType="application/json",
            accept="audio/pcm",
        )
        return response["body"].read()


class PropertyChatbot:
    """Central orchestrator routing text and voice inputs."""

    def __init__(self, retriever: PropertyRetriever, llm: LLMClient, sonic: Optional[SonicClient] = None):
        self.retriever = retriever
        self.llm = llm
        self.sonic = sonic
        self.session_id = str(uuid.uuid4())

    def ask_text(self, query: str) -> str:
        listings = self.retriever.search(query)
        return self.llm.answer(query, listings)

    def ask_audio(self, audio_bytes: bytes) -> Dict[str, object]:
        if not self.sonic:
            raise RuntimeError("Sonic client required for audio processing")
        transcript = self.sonic.transcribe(audio_bytes)
        answer = self.ask_text(transcript)
        spoken = self.sonic.synthesize(answer)
        return {"transcript": transcript, "answer": answer, "audio": spoken}


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
