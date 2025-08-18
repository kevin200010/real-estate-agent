from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from langgraph_app import app_graph
from property_chatbot import SonicClient
# Import the appointments router using an absolute import so the module can be
# executed directly without relying on package-relative imports. This avoids
# "attempted relative import" errors when `web_app` is run as a top-level
# module (e.g., via ``uvicorn web_app:app``).
from appointments import router as appointments_router

logging.basicConfig(level=logging.INFO)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

templates = Jinja2Templates(directory="templates")


# Instantiate shared clients
_sonic = SonicClient()
app.include_router(appointments_router)


@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/chat")
async def chat(request: Request):
    """Handle text chat requests.

    The frontend may send either JSON or form-encoded data. FastAPI's
    automatic validation would previously reject form posts with a 422
    error because the `ChatRequest` pydantic model only accepted JSON.
    To support both payload types we manually parse the request body.
    """
    text: str | None = None

    # Try JSON payload first
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            payload = await request.json()
            if isinstance(payload, dict):
                text = payload.get("text")
        except Exception:
            text = None

    # Fall back to form data
    if text is None:
        try:
            form = await request.form()
            text = form.get("text") if form else None
        except Exception:
            text = None

    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    initial_state = {"user_input": text}
    return await app_graph.ainvoke(initial_state)


@app.post("/voice")
async def voice(file: UploadFile = File(...)):
    audio_bytes = await file.read()
    transcript = await asyncio.to_thread(_sonic.transcribe, audio_bytes)
    result = await app_graph.ainvoke({"user_input": transcript})
    return {**result, "transcript": transcript}
