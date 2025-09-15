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
import gmail_accounts  # type: ignore
import auth  # type: ignore

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


def test_gmail_sync_persists_credentials(monkeypatch, tmp_path):
    from emails import GmailProvider, EmailMessage

    original_db = gmail_accounts.DATABASE_URL
    gmail_accounts.configure_database(f"sqlite:///{tmp_path}/gmail.db")

    original_auth = auth.AUTH_ENABLED
    auth.AUTH_ENABLED = True
    user = {"sub": "user-credentials", "email": "user@example.com"}
    web_app.app.dependency_overrides[auth.get_current_user] = lambda: user

    try:
        def sync_stub(self, max_results: int = 10):  # pragma: no cover - stub for sync
            return [EmailMessage(id="1", subject="Test", sender="sender@example.com")]

        monkeypatch.setattr(GmailProvider, "list_messages", sync_stub)

        resp = client.post(
            "/emails/gmail/sync",
            json={"username": "linked@gmail.com", "password": "app-password"},
        )
        _assert_messages(resp)

        record = gmail_accounts.get_account("gmail", user["sub"])
        assert record is not None
        assert record.get("imap_username") == "linked@gmail.com"
        assert record.get("imap_password") == "app-password"

        # Clear the in-memory cache to ensure credentials are restored from the DB
        web_app._email_credentials["gmail"].pop(user["sub"], None)

        def list_stub(self, max_results: int = 10):  # pragma: no cover - ensure cached creds
            assert self.username == "linked@gmail.com"
            assert self.password == "app-password"
            return [EmailMessage(id="2", subject="Persisted", sender="sender@example.com")]

        monkeypatch.setattr(GmailProvider, "list_messages", list_stub)

        resp = client.get("/emails/gmail")
        _assert_messages(resp)
    finally:
        gmail_accounts.configure_database(original_db)
        auth.AUTH_ENABLED = original_auth
        web_app.app.dependency_overrides.pop(auth.get_current_user, None)
        web_app._email_credentials["gmail"].pop(user["sub"], None)


def test_outlook_sync_endpoint_returns_list(monkeypatch):
    from emails import OutlookProvider, EmailMessage

    def fake_list_messages(self, max_results: int = 10):  # pragma: no cover - simple stub
        return [EmailMessage(id="1", subject="Test", sender="sender@example.com")]

    monkeypatch.setattr(OutlookProvider, "list_messages", fake_list_messages)

    resp = client.post(
        "/emails/outlook/sync", json={"username": "user@outlook.com", "password": "secret"}
    )
    _assert_messages(resp)




def test_clean_sync_endpoint():
    resp = client.post("/emails/gmail/clean-sync")
    assert resp.status_code == 200
    data = resp.json()
    assert 'status' in data
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


def test_gmail_token_persistence(tmp_path):
    original_db = gmail_accounts.DATABASE_URL
    gmail_accounts.configure_database(f"sqlite:///{tmp_path}/gmail.db")
    original_auth = auth.AUTH_ENABLED
    auth.AUTH_ENABLED = True
    client = TestClient(web_app.app)
    web_app.app.dependency_overrides[auth.get_current_user] = lambda: {
        "sub": "user-1",
        "email": "user1@example.com",
    }
    try:
        resp = client.get("/emails/gmail/token")
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_token"] is None
        assert data["email"] is None

        resp = client.post(
            "/emails/gmail/token",
            json={
                "access_token": "abc",
                "scope": "scope1",
                "token_type": "Bearer",
                "expires_at": "2030-01-01T00:00:00Z",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_token"] == "abc"
        assert data["scope"] == "scope1"

        resp = client.post(
            "/emails/gmail/token",
            json={"email": "linked@example.com"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "linked@example.com"

        resp = client.get("/emails/gmail/token")
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_token"] == "abc"
        assert data["email"] == "linked@example.com"

        resp = client.delete("/emails/gmail/token")
        assert resp.status_code == 200
        resp = client.get("/emails/gmail/token")
        data = resp.json()
        assert data["access_token"] is None
        assert data["email"] is None
    finally:
        gmail_accounts.configure_database(original_db)
        auth.AUTH_ENABLED = original_auth
        web_app.app.dependency_overrides.pop(auth.get_current_user, None)
