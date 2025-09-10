import os
import sys
import types

from fastapi.testclient import TestClient

# Provide minimal jinja2 and multipart stubs so ``web_app`` can be imported
class _DummyLoader:
    def __init__(self, *args, **kwargs):
        pass


class _DummyEnv:
    def __init__(self, *args, **kwargs):
        self.globals = {}


sys.modules.setdefault(
    "jinja2",
    types.SimpleNamespace(
        Environment=_DummyEnv,
        FileSystemLoader=_DummyLoader,
        contextfunction=lambda f: f,
    ),
)

multipart_stub = types.SimpleNamespace(__version__="0")
sys.modules.setdefault("multipart", multipart_stub)
sys.modules.setdefault("multipart.multipart", types.SimpleNamespace(parse_options_header=lambda *a, **k: None))

# Allow importing backend modules as top-level modules
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))
import web_app  # type: ignore

client = TestClient(web_app.app)


def _assert_messages(resp):
    assert resp.status_code == 200
    data = resp.json()
    assert "messages" in data
    assert isinstance(data["messages"], list)


def test_gmail_endpoint_returns_list():
    _assert_messages(client.get("/emails/gmail"))


def test_outlook_endpoint_returns_list():
    _assert_messages(client.get("/emails/outlook"))


def test_gmail_sync_endpoint_returns_list(monkeypatch):
    from emails import GmailProvider, EmailMessage

    def fake_list_messages(self, max_results: int = 10):  # pragma: no cover - simple stub
        return [EmailMessage(id="1", subject="Test", sender="sender@example.com")]

    monkeypatch.setattr(GmailProvider, "list_messages", fake_list_messages)

    resp = client.post(
        "/emails/gmail/sync", json={"username": "user@gmail.com", "password": "secret"}
    )
    _assert_messages(resp)


def test_outlook_sync_endpoint_returns_list(monkeypatch):
    from emails import OutlookProvider, EmailMessage

    def fake_list_messages(self, max_results: int = 10):  # pragma: no cover - simple stub
        return [EmailMessage(id="1", subject="Test", sender="sender@example.com")]

    monkeypatch.setattr(OutlookProvider, "list_messages", fake_list_messages)

    resp = client.post(
        "/emails/outlook/sync", json={"username": "user@outlook.com", "password": "secret"}
    )
    _assert_messages(resp)


def test_send_email(monkeypatch):
    from emails import GmailProvider

    def fake_send(self, to_addr: str, subject: str, body: str):  # pragma: no cover
        return True

    monkeypatch.setattr(GmailProvider, "send_message", fake_send)

    resp = client.post(
        "/emails/gmail/send",
        json={
            "username": "user@gmail.com",
            "password": "secret",
            "to": "rcpt@example.com",
            "subject": "Hi",
            "body": "Test",
        },
    )
    assert resp.status_code == 200
    assert resp.json().get("status") == "sent"
