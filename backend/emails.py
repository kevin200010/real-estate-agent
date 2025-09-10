from __future__ import annotations

"""Helpers for fetching email from popular providers.

These utilities use IMAP with credentials supplied via environment variables.
The goal is to offer a simple way for the application to display a user's
emails inside the real‑estate assistant. When credentials are missing or the
connection fails, the helpers return an empty list instead of raising
exceptions so the rest of the application can continue to function.
"""

from dataclasses import dataclass
from typing import List, Optional
import email
import imaplib
import os
import smtplib
from email.message import EmailMessage as _EmailMessage


@dataclass
class EmailMessage:
    """Minimal representation of an email message."""

    id: str
    subject: str
    sender: str
    snippet: str = ""


class BaseEmailProvider:
    """Common interface for email providers."""

    def list_messages(self, max_results: int = 10) -> List[EmailMessage]:
        raise NotImplementedError

    def send_message(self, to_addr: str, subject: str, body: str) -> bool:
        raise NotImplementedError


class GmailProvider(BaseEmailProvider):
    """Fetch messages from a Gmail inbox via IMAP."""

    SERVER = "imap.gmail.com"
    SMTP_SERVER = "smtp.gmail.com"

    def __init__(self, username: Optional[str] = None, password: Optional[str] = None) -> None:
        self.username = username or os.getenv("GMAIL_USERNAME")
        self.password = password or os.getenv("GMAIL_PASSWORD")

    def list_messages(self, max_results: int = 10) -> List[EmailMessage]:
        if not self.username or not self.password:
            return []
        try:
            with imaplib.IMAP4_SSL(self.SERVER) as imap:
                imap.login(self.username, self.password)
                imap.select("inbox")
                _typ, data = imap.search(None, "ALL")
                ids = data[0].split()[-max_results:]
                messages: List[EmailMessage] = []
                for num in ids:
                    _typ, msg_data = imap.fetch(num, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)])")
                    raw = msg_data[0][1]
                    msg = email.message_from_bytes(raw)
                    messages.append(
                        EmailMessage(
                            id=num.decode(),
                            subject=msg.get("Subject", ""),
                            sender=msg.get("From", ""),
                        )
                    )
                return messages
        except Exception:
            return []

    def send_message(self, to_addr: str, subject: str, body: str) -> bool:
        if not self.username or not self.password:
            return False
        try:
            msg = _EmailMessage()
            msg["Subject"] = subject
            msg["From"] = self.username
            msg["To"] = to_addr
            msg.set_content(body)
            with smtplib.SMTP_SSL(self.SMTP_SERVER, 465) as smtp:
                smtp.login(self.username, self.password)
                smtp.send_message(msg)
            return True
        except Exception:
            return False


class OutlookProvider(BaseEmailProvider):
    """Fetch messages from an Outlook inbox via IMAP."""

    SERVER = "imap-mail.outlook.com"
    SMTP_SERVER = "smtp-mail.outlook.com"

    def __init__(self, username: Optional[str] = None, password: Optional[str] = None) -> None:
        self.username = username or os.getenv("OUTLOOK_USERNAME")
        self.password = password or os.getenv("OUTLOOK_PASSWORD")

    def list_messages(self, max_results: int = 10) -> List[EmailMessage]:
        if not self.username or not self.password:
            return []
        try:
            with imaplib.IMAP4_SSL(self.SERVER) as imap:
                imap.login(self.username, self.password)
                imap.select("inbox")
                _typ, data = imap.search(None, "ALL")
                ids = data[0].split()[-max_results:]
                messages: List[EmailMessage] = []
                for num in ids:
                    _typ, msg_data = imap.fetch(num, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM)])")
                    raw = msg_data[0][1]
                    msg = email.message_from_bytes(raw)
                    messages.append(
                        EmailMessage(
                            id=num.decode(),
                            subject=msg.get("Subject", ""),
                            sender=msg.get("From", ""),
                        )
                    )
                return messages
        except Exception:
            return []

    def send_message(self, to_addr: str, subject: str, body: str) -> bool:
        if not self.username or not self.password:
            return False
        try:
            msg = _EmailMessage()
            msg["Subject"] = subject
            msg["From"] = self.username
            msg["To"] = to_addr
            msg.set_content(body)
            with smtplib.SMTP_SSL(self.SMTP_SERVER, 465) as smtp:
                smtp.login(self.username, self.password)
                smtp.send_message(msg)
            return True
        except Exception:
            return False


def get_provider(
    name: str, username: Optional[str] = None, password: Optional[str] = None
) -> Optional[BaseEmailProvider]:
    """Return an email provider by name.

    Optional ``username`` and ``password`` parameters allow callers to supply
    credentials dynamically instead of relying on environment variables.
    """

    name = name.lower()
    if name == "gmail":
        return GmailProvider(username=username, password=password)
    if name == "outlook":
        return OutlookProvider(username=username, password=password)
    return None
