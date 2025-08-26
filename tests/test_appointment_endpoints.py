import os
import sys

from fastapi.testclient import TestClient

# Ensure repository root on path so ``backend`` package is importable
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from backend.langgraph_app import app
from backend.appointments import _calendar


def test_appointment_routes():
    client = TestClient(app)
    # Should return an empty list when no events have been created
    resp = client.get("/appointments")
    assert resp.status_code == 200
    assert resp.json() == []

    # Booking an appointment should succeed and return an event id
    payload = {
        "name": "Alice",
        "phone": "123-456-7890",
        "email": "alice@example.com",
        "date": "2024-01-01",
        "time": "9:00 AM",
    }
    resp = client.post("/appointments", json=payload)
    assert resp.status_code == 200
    assert "event" in resp.json()
    # Attendee email should be recorded on the event
    assert _calendar._local_events[0]["attendees"] == [payload["email"]]


def test_appointment_creates_user_event(monkeypatch):
    client = TestClient(app)
    from backend import web_app

    web_app._google_tokens["default"] = "token123"

    captured = {}

    class DummyCreds:
        def __init__(self, token):
            captured["token"] = token

    class DummyEvents:
        def insert(self, calendarId, body, sendUpdates):
            captured["calendarId"] = calendarId
            captured["body"] = body
            captured["sendUpdates"] = sendUpdates

            class Exec:
                def execute(self):
                    return {}

            return Exec()

    class DummyService:
        def events(self):
            return DummyEvents()

    def fake_build(api, ver, credentials):
        captured["api"] = api
        return DummyService()

    monkeypatch.setattr("backend.appointments.Credentials", DummyCreds)
    monkeypatch.setattr("backend.appointments.build", fake_build)

    payload = {
        "name": "Bob",
        "phone": "555",
        "email": "bob@example.com",
        "date": "2024-01-02",
        "time": "10:00 AM",
    }
    resp = client.post("/appointments", json=payload)
    assert resp.status_code == 200
    assert captured["token"] == "token123"
    assert captured["calendarId"] == "primary"
    assert captured["sendUpdates"] == "all"
    assert captured["body"]["attendees"][0]["email"] == payload["email"]
