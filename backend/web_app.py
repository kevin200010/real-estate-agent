from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from langgraph_app import app_graph
from property_chatbot import SonicClient
from auth import AUTH_ENABLED, get_current_user
from appointments import router as appointments_router
from leads import router as leads_router
from emails import get_provider
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
app.include_router(leads_router)

# In-memory store for per-user email credentials gathered during the sync flow.
# Keys are provider names (``gmail`` or ``outlook``) and map to dictionaries of
# user IDs to credential dicts. A production system should persist these
# securely instead of keeping them in a process-level dictionary.
_email_credentials: dict[str, dict[str, dict[str, str]]] = {"gmail": {}, "outlook": {}}


_mailbox_sync_lock = asyncio.Lock()
_mailbox_sync_state: dict[str, str | None] = {"status": "idle", "last_run": None}


async def _run_mailbox_sync() -> None:
    async with _mailbox_sync_lock:
        try:
            await asyncio.sleep(0)
        finally:
            _mailbox_sync_state['status'] = 'idle'
            _mailbox_sync_state['last_run'] = datetime.now(timezone.utc).isoformat()


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


@app.post("/emails/gmail/clean-sync")
async def trigger_mailbox_sync(user: dict | None = Depends(get_current_user)):
    if _mailbox_sync_state.get('status') == 'syncing':
        return {"status": 'syncing', "last_run": _mailbox_sync_state.get('last_run')}
    _mailbox_sync_state['status'] = 'syncing'
    asyncio.get_running_loop().create_task(_run_mailbox_sync())
    return {"status": 'queued', "last_run": _mailbox_sync_state.get('last_run')}


@app.post("/emails/{provider}/sync")
async def sync_email(
    provider: str, payload: dict, user: dict | None = Depends(get_current_user)
):
    """Store credentials for the given provider and return recent messages."""

    username = payload.get("username")
    password = payload.get("password")
    if not username or not password:
        raise HTTPException(status_code=400, detail="username and password required")

    provider = provider.lower()
    if provider not in _email_credentials:
        raise HTTPException(status_code=404, detail="unknown provider")

    key = user["sub"] if user else "default"
    _email_credentials[provider][key] = {"username": username, "password": password}

    service = get_provider(provider, username=username, password=password)
    messages = service.list_messages()
    return {"messages": [m.__dict__ for m in messages]}


@app.get("/emails/{provider}")
async def list_emails(
    provider: str, user: dict | None = Depends(get_current_user)
):
    """Return recent emails for the given provider.

    When the appropriate credentials are not configured, an empty list is
    returned instead of an error.
    """

    provider = provider.lower()
    key = user["sub"] if user else "default"
    creds = _email_credentials.get(provider, {}).get(key)
    if creds:
        service = get_provider(provider, creds.get("username"), creds.get("password"))
    else:
        service = get_provider(provider)

    if service is None:
        raise HTTPException(status_code=404, detail="unknown provider")
    messages = service.list_messages()
    return {"messages": [m.__dict__ for m in messages]}


@app.post("/emails/{provider}/send")
async def send_email(
    provider: str, payload: dict, user: dict | None = Depends(get_current_user)
):
    """Send an email through the specified provider."""

    provider = provider.lower()
    to_addr = payload.get("to")
    subject = payload.get("subject", "")
    body = payload.get("body", "")
    username = payload.get("username")
    password = payload.get("password")

    key = user["sub"] if user else "default"
    if not username or not password:
        creds = _email_credentials.get(provider, {}).get(key)
        if creds:
            username = username or creds.get("username")
            password = password or creds.get("password")

    if not to_addr or not username or not password:
        raise HTTPException(status_code=400, detail="missing required fields")

    service = get_provider(provider, username=username, password=password)
    if service is None:
        raise HTTPException(status_code=404, detail="unknown provider")

    success = service.send_message(to_addr, subject, body)
    if not success:
        raise HTTPException(status_code=500, detail="failed to send email")
    return {"status": "sent"}


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
    """Save an OAuth access token for the authenticated user.

    When authentication is disabled (e.g. local development) the token is
    stored under a shared key instead of being associated with a user.
    """
    if AUTH_ENABLED and not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = payload.get("access_token")
    if not token:
        raise HTTPException(status_code=400, detail="access_token required")
    key = user["sub"] if user else "default"
    _google_tokens[key] = token
    try:
        _TOKENS_FILE.write_text(json.dumps(_google_tokens))
    except Exception:
        logging.exception("Failed to persist Google token")
    return {"status": "ok"}


@app.get("/google-token")
async def get_google_token(user: dict | None = Depends(get_current_user)):
    """Return the stored Google OAuth token for the authenticated user.

    If no token has been saved yet, ``access_token`` will be ``null`` instead of
    returning a 404. This avoids noisy errors in the frontend when a user has not
    granted access to their Google Calendar.
    """
    if AUTH_ENABLED and not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    key = user["sub"] if user else "default"
    token = _google_tokens.get(key)
    return {"access_token": token}


@app.delete("/google-token")
async def delete_google_token(user: dict | None = Depends(get_current_user)):
    """Remove the stored Google OAuth token for the authenticated user."""
    if AUTH_ENABLED and not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    key = user["sub"] if user else "default"
    _google_tokens.pop(key, None)
    try:
        _TOKENS_FILE.write_text(json.dumps(_google_tokens))
    except Exception:
        logging.exception("Failed to persist Google token")
    return {"status": "deleted"}
