from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from langgraph_app import app_graph
from property_chatbot import SonicClient
import auth
from auth import get_current_user
from appointments import router as appointments_router
from leads import router as leads_router
from properties import router as properties_router
from emails import EmailMessage, get_provider
from gmail_accounts import (
    delete_account as delete_gmail_account,
    delete_linked_email_account,
    get_account as get_gmail_account,
    get_linked_email_account,
    save_account as save_gmail_account,
    save_linked_email_account,
)
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
app.include_router(properties_router)

# In-memory cache for per-user email credentials gathered during the sync flow.
# Keys are provider names (``gmail`` or ``outlook``) and map to dictionaries of
# user IDs to credential dicts. Gmail credentials are also persisted in
# ``gmail_accounts`` so they survive restarts and remain isolated per user. A
# production system should persist passwords securely instead of keeping them in
# plaintext.
_email_credentials: dict[str, dict[str, dict[str, str]]] = {"gmail": {}, "outlook": {}}


class EmailAccessError(Exception):
    """Base class for email retrieval errors."""


class EmailAuthenticationRequired(EmailAccessError):
    """Raised when a request requires a signed-in user."""


class UnknownEmailProviderError(EmailAccessError):
    """Raised when an unsupported email provider is requested."""


def _user_key(user: dict | None) -> str:
    """Return the storage key for the current user."""

    return user["sub"] if user else "default"


def get_user_email_messages(provider: str, user: dict | None) -> list[EmailMessage]:
    """Return recent messages for ``provider`` scoped to ``user``.

    The helper centralises the logic used by the API layer so other modules
    (such as background agents) can read a user's inbox without duplicating the
    credential resolution rules. Gmail requires an authenticated user when the
    authentication system is enabled; when credentials are incomplete the
    function returns an empty list instead of raising.
    """

    provider = provider.lower()
    if provider not in _email_credentials:
        raise UnknownEmailProviderError(provider)

    key = _user_key(user)
    store = _email_credentials.setdefault(provider, {})
    creds = store.get(key)
    record: dict | None = None
    linked_record: dict | None = None

    if provider == _GMAIL_PROVIDER:
        if auth.AUTH_ENABLED and not user:
            raise EmailAuthenticationRequired("Not authenticated")
        linked_record = get_linked_email_account(_GMAIL_PROVIDER, key)
        record = get_gmail_account(_GMAIL_PROVIDER, key)
        if not creds and record:
            imap_username = record.get("imap_username") or record.get("email")
            imap_password = record.get("imap_password")
            if imap_username and imap_password:
                creds = {"username": imap_username, "password": imap_password}
                store[key] = creds
        if auth.AUTH_ENABLED and user and (
            not linked_record
            or not record
            or not creds
            or not creds.get("username")
            or not creds.get("password")
        ):
            return []

    if creds and creds.get("username") and creds.get("password"):
        service = get_provider(provider, creds.get("username"), creds.get("password"))
    else:
        service = get_provider(provider)

    if service is None:
        raise UnknownEmailProviderError(provider)

    return service.list_messages()


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

    key = _user_key(user)

    if provider == _GMAIL_PROVIDER and auth.AUTH_ENABLED and not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    creds = {"username": username, "password": password}
    _email_credentials[provider][key] = creds

    if provider == _GMAIL_PROVIDER:
        try:
            save_gmail_account(
                _GMAIL_PROVIDER,
                key,
                email=username,
                imap_username=username,
                imap_password=password,
            )
            save_linked_email_account(_GMAIL_PROVIDER, key, username)
        except Exception:
            logging.exception("Failed to persist Gmail credentials")

    service = get_provider(provider, username=username, password=password)
    messages = service.list_messages()
    return {"messages": [m.__dict__ for m in messages]}


@app.delete("/emails/{provider}/sync")
async def disconnect_email_provider(
    provider: str, user: dict | None = Depends(get_current_user)
):
    """Disconnect the stored credentials for ``provider`` for the user."""

    provider = provider.lower()
    if provider not in _email_credentials:
        raise HTTPException(status_code=404, detail="unknown provider")

    key = _user_key(user)

    if provider == _GMAIL_PROVIDER and auth.AUTH_ENABLED and not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    _email_credentials.setdefault(provider, {}).pop(key, None)

    if provider == _GMAIL_PROVIDER:
        delete_gmail_account(_GMAIL_PROVIDER, key)
        delete_linked_email_account(_GMAIL_PROVIDER, key)

    return {"status": "disconnected"}


@app.get("/emails/{provider}")
async def list_emails(
    provider: str, user: dict | None = Depends(get_current_user)
):
    """Return recent emails for the given provider.

    When the appropriate credentials are not configured, an empty list is
    returned instead of an error.
    """

    provider = provider.lower()
    try:
        messages = get_user_email_messages(provider, user)
    except EmailAuthenticationRequired:
        raise HTTPException(status_code=401, detail="Not authenticated")
    except UnknownEmailProviderError:
        raise HTTPException(status_code=404, detail="unknown provider")
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

    key = _user_key(user)
    if not username or not password:
        creds = _email_credentials.get(provider, {}).get(key)
        if creds:
            username = username or creds.get("username")
            password = password or creds.get("password")
        if provider == _GMAIL_PROVIDER and (not username or not password):
            record = get_gmail_account(_GMAIL_PROVIDER, key)
            if record:
                username = username or record.get("imap_username") or record.get("email")
                password = password or record.get("imap_password")
                if username:
                    try:
                        save_linked_email_account(_GMAIL_PROVIDER, key, username)
                    except Exception:
                        logging.exception("Failed to persist linked Gmail account during send")
                if username and password:
                    _email_credentials.setdefault(provider, {})[key] = {
                        "username": username,
                        "password": password,
                    }

    if provider == _GMAIL_PROVIDER and auth.AUTH_ENABLED and user:
        linked_record = get_linked_email_account(_GMAIL_PROVIDER, key)
        if not linked_record:
            raise HTTPException(status_code=400, detail="No linked Gmail account")

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


_GMAIL_PROVIDER = "gmail"


@app.post("/google-token")
async def save_google_token(
    payload: dict, user: dict | None = Depends(get_current_user)
):
    """Save an OAuth access token for the authenticated user.

    When authentication is disabled (e.g. local development) the token is
    stored under a shared key instead of being associated with a user.
    """
    if auth.AUTH_ENABLED and not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = payload.get("access_token")
    if not token:
        raise HTTPException(status_code=400, detail="access_token required")
    key = _user_key(user)
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
    if auth.AUTH_ENABLED and not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    key = _user_key(user)
    token = _google_tokens.get(key)
    return {"access_token": token}


@app.delete("/google-token")
async def delete_google_token(user: dict | None = Depends(get_current_user)):
    """Remove the stored Google OAuth token for the authenticated user."""
    if auth.AUTH_ENABLED and not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    key = _user_key(user)
    _google_tokens.pop(key, None)
    try:
        _TOKENS_FILE.write_text(json.dumps(_google_tokens))
    except Exception:
        logging.exception("Failed to persist Google token")
    return {"status": "deleted"}


def _gmail_account_response(record: dict | None) -> dict:
    return {
        "provider": (record or {}).get("provider", _GMAIL_PROVIDER),
        "email": (record or {}).get("email"),
        "access_token": (record or {}).get("access_token"),
        "token_type": (record or {}).get("token_type"),
        "scope": (record or {}).get("scope"),
        "expires_at": (record or {}).get("expires_at"),
        "updated_at": (record or {}).get("updated_at"),
    }


@app.get("/emails/gmail/token")
async def get_gmail_token(user: dict | None = Depends(get_current_user)):
    if auth.AUTH_ENABLED and not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    key = _user_key(user)
    record = get_gmail_account(_GMAIL_PROVIDER, key)
    return _gmail_account_response(record)


@app.post("/emails/gmail/token")
async def store_gmail_token(payload: dict, user: dict | None = Depends(get_current_user)):
    if auth.AUTH_ENABLED and not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    key = _user_key(user)
    access_token = payload.get("access_token")
    email = payload.get("email")
    token_type = payload.get("token_type")
    scope = payload.get("scope")
    expires_at = payload.get("expires_at")
    expires_in = payload.get("expires_in")
    if expires_at is None and expires_in is not None:
        try:
            seconds = float(expires_in)
        except (TypeError, ValueError):
            seconds = None
        if seconds is not None:
            expires_at = (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()

    updates = {
        "email": email,
        "access_token": access_token,
        "token_type": token_type,
        "scope": scope,
        "expires_at": expires_at,
    }

    if not any(value is not None for value in updates.values()):
        raise HTTPException(status_code=400, detail="No account details provided")

    record = save_gmail_account(
        _GMAIL_PROVIDER,
        key,
        **{k: v for k, v in updates.items() if v is not None},
    )
    linked_email = record.get("email") if record else None
    if linked_email:
        try:
            save_linked_email_account(_GMAIL_PROVIDER, key, linked_email)
        except Exception:
            logging.exception("Failed to persist linked Gmail email during token save")
    return _gmail_account_response(record)


@app.delete("/emails/gmail/token")
async def delete_gmail_token(user: dict | None = Depends(get_current_user)):
    if auth.AUTH_ENABLED and not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    key = _user_key(user)
    delete_gmail_account(_GMAIL_PROVIDER, key)
    _email_credentials.setdefault(_GMAIL_PROVIDER, {}).pop(key, None)
    delete_linked_email_account(_GMAIL_PROVIDER, key)
    return {"status": "deleted"}
