from __future__ import annotations

import asyncio
import logging

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from langgraph_app import app_graph
from property_chatbot import SonicClient
from auth import get_current_user
from appointments import router as appointments_router
import json
from pathlib import Path

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
async def chat(request: Request, user: dict | None = Depends(get_current_user)):
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
async def voice(
    file: UploadFile = File(...),
    user: dict | None = Depends(get_current_user),
):
    audio_bytes = await file.read()
    transcript = await asyncio.to_thread(_sonic.transcribe, audio_bytes)
    result = await app_graph.ainvoke({"user_input": transcript})
    return {**result, "transcript": transcript}


import json
from pathlib import Path

# Persistent storage for per-user Google Calendar access tokens. Tokens are
# stored in ``google_tokens.json`` alongside this module so they survive server
# restarts. In a production system this would be replaced with a proper
# database.
_TOKENS_FILE = Path(__file__).with_name("google_tokens.json")
try:
    _google_tokens: dict[str, str] = json.loads(_TOKENS_FILE.read_text())
except Exception:
    _google_tokens = {}


@app.post("/google-token")
async def save_google_token(
    payload: dict, user: dict | None = Depends(get_current_user)
):
    """Save an OAuth access token for the authenticated user."""
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = payload.get("access_token")
    if not token:
        raise HTTPException(status_code=400, detail="access_token required")
    _google_tokens[user["sub"]] = token
    try:
        _TOKENS_FILE.write_text(json.dumps(_google_tokens))
    except Exception:
        logging.exception("Failed to persist Google token")
    return {"status": "ok"}


@app.get("/google-token")
async def get_google_token(user: dict | None = Depends(get_current_user)):
    """Return the stored Google OAuth token for the authenticated user."""
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = _google_tokens.get(user["sub"])
    if not token:
        raise HTTPException(status_code=404, detail="Not found")
    return {"access_token": token}
