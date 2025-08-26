import os
import sys
from datetime import datetime

# Ensure the repository root is on the Python path so ``backend`` can be imported
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from backend.appointments import GoogleCalendarClient


def test_fallback_creates_local_event(monkeypatch):
    """When Google Calendar is not configured, events are stored locally."""

    # Ensure no environment variables are set so the client runs in fallback mode
    monkeypatch.delenv("GOOGLE_CREDENTIALS_FILE", raising=False)
    monkeypatch.delenv("GOOGLE_CALENDAR_ID", raising=False)

    client = GoogleCalendarClient()

    # Initially there should be no events
    assert client.list_events() == []

    start = datetime(2024, 1, 1, 10, 0)
    end = datetime(2024, 1, 1, 11, 0)

    event = client.create_event("Test", start, end, "desc", attendees=["a@example.com"])
    assert "id" in event

    events = client.list_events()
    assert len(events) == 1
    assert events[0]["summary"] == "Test"
    assert events[0]["attendees"] == ["a@example.com"]
