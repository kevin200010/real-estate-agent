from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI, HTTPException, Request
try:  # pragma: no cover - optional dependency
    import multipart  # type: ignore
    from fastapi import UploadFile, File
    _multipart = True
except Exception:  # pragma: no cover
    UploadFile = File = None  # type: ignore
    _multipart = False
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
try:  # pragma: no cover - optional dependency
    from fastapi.templating import Jinja2Templates as _Jinja2Templates
    templates = _Jinja2Templates(directory="templates")
except Exception:  # pragma: no cover - jinja2 missing
    templates = None
from pydantic import BaseModel

from .langgraph_app import app_graph
from .property_chatbot import SonicClient

logging.basicConfig(level=logging.INFO)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Instantiate shared clients
_sonic = SonicClient()


@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request) -> HTMLResponse:
    if not templates:
        return HTMLResponse("real-estate-agent")
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


if _multipart:  # pragma: no cover - optional when python-multipart absent
    @app.post("/voice")
    async def voice(file: UploadFile = File(...)):
        audio_bytes = await file.read()
        transcript = await asyncio.to_thread(_sonic.transcribe, audio_bytes)
        result = await app_graph.ainvoke({"user_input": transcript})
        return {**result, "transcript": transcript}


# ---------------------------------------------------------------------------
# Simple in-memory data stores for demo customer/admin portals
# ---------------------------------------------------------------------------


class Credentials(BaseModel):
    username: str
    password: str


class Appointment(BaseModel):
    property_id: str | None = None
    slot: str
    user: str


class Availability(BaseModel):
    slots: list[str]


_USERS = {
    "customer": {"password": "customer", "role": "customer"},
    "admin": {"password": "admin", "role": "admin"},
}
_APPOINTMENTS: list[Appointment] = []
_AVAILABILITY: Availability = Availability(slots=[])


@app.post("/login")
async def login(creds: Credentials):
    user = _USERS.get(creds.username)
    if not user or user["password"] != creds.password:
        raise HTTPException(status_code=401, detail="invalid credentials")
    return {"username": creds.username, "role": user["role"]}


@app.get("/properties")
async def list_properties():
    import json
    from pathlib import Path

    data_path = Path(__file__).resolve().parent / "properties.json"
    with data_path.open("r", encoding="utf-8") as f:
        return json.load(f)


@app.post("/appointments")
async def book_appointment(appt: Appointment):
    _APPOINTMENTS.append(appt)
    return appt


@app.get("/appointments")
async def get_appointments():
    return _APPOINTMENTS


@app.post("/availability")
async def set_availability(avail: Availability):
    _AVAILABILITY.slots = avail.slots
    return _AVAILABILITY


@app.get("/availability")
async def get_availability():
    return _AVAILABILITY
