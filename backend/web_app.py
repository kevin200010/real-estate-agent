from __future__ import annotations

import base64
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel

from property_chatbot import (
    PropertyRetriever,
    LLMClient,
    SonicClient,
    PropertyChatbot,
)


app = FastAPI()

# Instantiate core components once at startup
_data_path = Path(__file__).with_name("properties.json")
_retriever = PropertyRetriever(_data_path)
_llm = LLMClient()
_sonic = SonicClient()
_bot = PropertyChatbot(_retriever, _llm, _sonic)


class ChatRequest(BaseModel):
    text: str


@app.post("/chat")
async def chat(req: ChatRequest):
    if not req.text:
        raise HTTPException(status_code=400, detail="text is required")
    answer = _bot.ask_text(req.text)
    return {"answer": answer}


@app.post("/voice")
async def voice(file: UploadFile = File(...)):
    audio_bytes = await file.read()
    result = _bot.ask_audio(audio_bytes)
    audio_b64 = base64.b64encode(result["audio"]).decode("utf-8")
    return {
        "transcript": result["transcript"],
        "answer": result["answer"],
        "audio": audio_b64,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
