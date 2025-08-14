import os
import sys

from fastapi.testclient import TestClient

# Ensure repository root on path so ``backend`` package is importable
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from backend.langgraph_app import app


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
