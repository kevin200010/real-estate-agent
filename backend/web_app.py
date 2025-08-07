from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from agents.base import AgentRegistry
from agents.router import QueryRouterAgent
from agents.search import PropertySearchAgent
from agents.info import RealEstateInfoAgent
from property_chatbot import SonicClient

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

templates = Jinja2Templates(directory="templates")


# Instantiate agents once at startup
_registry = AgentRegistry()
_data_path = Path(__file__).with_name("rag_data.json")
_search_agent = PropertySearchAgent(_data_path, registry=_registry)
_registry.register(_search_agent)
_info_agent = RealEstateInfoAgent(registry=_registry)
_registry.register(_info_agent)
_router_agent = QueryRouterAgent(registry=_registry)
_registry.register(_router_agent)
_sonic = SonicClient()


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

    return await _router_agent.handle(query=text)


@app.post("/voice")
async def voice(file: UploadFile = File(...)):
    audio_bytes = await file.read()
    transcript = await asyncio.to_thread(_sonic.transcribe, audio_bytes)
    result = await _router_agent.handle(query=transcript)
    return {**result, "transcript": transcript}
