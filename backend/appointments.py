from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Dict, List

try:  # Optional dependency; module may be absent in test environments
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
except Exception:  # pragma: no cover - handled gracefully when unavailable
    service_account = None  # type: ignore
    build = None  # type: ignore


class GoogleCalendarClient:
    """Helper for interacting with the realtor's Google Calendar.

    The client expects two environment variables:

    - ``GOOGLE_CREDENTIALS_FILE``: path to a service account JSON key file.
    - ``GOOGLE_CALENDAR_ID``: ID of the calendar to manage.

    If these variables are absent the client becomes a no-op, allowing the
    application to run without Google credentials (e.g., during tests).
    """

    def __init__(self) -> None:
        creds_file = os.getenv("GOOGLE_CREDENTIALS_FILE")
        self.calendar_id = os.getenv("GOOGLE_CALENDAR_ID")
        self.service = None
        if creds_file and self.calendar_id and service_account and build:
            creds = service_account.Credentials.from_service_account_file(
                creds_file,
                scopes=["https://www.googleapis.com/auth/calendar"],
            )
            self.service = build("calendar", "v3", credentials=creds)

    def list_events(self) -> List[Dict[str, Any]]:
        """Return upcoming events from the realtor's calendar."""
        if not self.service:
            return []
        now = datetime.utcnow().isoformat() + "Z"
        events_result = (
            self.service.events()
            .list(
                calendarId=self.calendar_id,
                timeMin=now,
                singleEvents=True,
                orderBy="startTime",
            )
            .execute()
        )
        events = events_result.get("items", [])
        out: List[Dict[str, Any]] = []
        for ev in events:
            out.append(
                {
                    "id": ev.get("id"),
                    "start": ev["start"].get("dateTime", ev["start"].get("date")),
                    "end": ev["end"].get("dateTime", ev["end"].get("date")),
                    "summary": ev.get("summary"),
                }
            )
        return out

    def create_event(
        self, summary: str, start: datetime, end: datetime, description: str = ""
    ) -> Dict[str, Any]:
        """Create a calendar event.

        Raises ``RuntimeError`` if the calendar is not configured.
        """
        if not self.service:
            raise RuntimeError("Google Calendar not configured")

        event_body = {
            "summary": summary,
            "start": {"dateTime": start.isoformat(), "timeZone": "UTC"},
            "end": {"dateTime": end.isoformat(), "timeZone": "UTC"},
            "description": description,
        }
        event = (
            self.service.events()
            .insert(calendarId=self.calendar_id, body=event_body)
            .execute()
        )
        return {"id": event.get("id")}
