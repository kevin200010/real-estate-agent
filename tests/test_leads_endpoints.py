import os
import sys
import importlib

from fastapi.testclient import TestClient

# Ensure repository root on path
sys.path.append(os.path.dirname(os.path.dirname(__file__)))


def override_user(user_id, email):
    def _user():
        return {"sub": user_id, "email": email}
    return _user


def create_app(tmp_path):
    db_url = f"sqlite:///{tmp_path}/test_leads.db"
    os.environ["DATABASE_URL"] = db_url
    # Reload leads module with new DATABASE_URL
    import backend.leads as leads
    importlib.reload(leads)
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(leads.router)
    return app


def test_leads_are_scoped_to_user(tmp_path):
    app = create_app(tmp_path)
    client = TestClient(app)
    from backend import auth

    auth.AUTH_ENABLED = True
    app.dependency_overrides[auth.get_current_user] = override_user(
        "user1", "user1@example.com"
    )

    resp = client.post("/leads", json={"name": "Alice", "stage": "New"})
    assert resp.status_code == 200
    lead_id = resp.json()["id"]

    resp = client.get("/leads")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Alice"

    app.dependency_overrides[auth.get_current_user] = override_user(
        "user2", "user2@example.com"
    )
    resp = client.post("/leads", json={"name": "Bob", "stage": "Qualified"})
    assert resp.status_code == 200

    resp = client.get("/leads")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Bob"

    app.dependency_overrides[auth.get_current_user] = override_user(
        "user1", "user1@example.com"
    )
    resp = client.put(f"/leads/{lead_id}", json={"stage": "Contacted"})
    assert resp.status_code == 200

    resp = client.get("/leads")
    data = resp.json()
    assert data[0]["stage"] == "Contacted"

def test_leads_require_authentication(tmp_path):
    app = create_app(tmp_path)
    client = TestClient(app)
    from backend import auth

    auth.AUTH_ENABLED = True
    app.dependency_overrides[auth.get_current_user] = lambda: None

    resp = client.get("/leads")
    assert resp.status_code == 401

    resp = client.post("/leads", json={"name": "Guest", "stage": "New"})
    assert resp.status_code == 401


def test_leads_require_auth_even_when_auth_disabled(tmp_path):
    app = create_app(tmp_path)
    client = TestClient(app)
    from backend import auth

    auth.AUTH_ENABLED = False
    app.dependency_overrides[auth.get_current_user] = lambda: None

    resp = client.post("/leads", json={"name": "Guest", "stage": "New"})
    assert resp.status_code == 401

    resp = client.get("/leads")
    assert resp.status_code == 401


def test_leads_scope_honors_user_when_auth_disabled(tmp_path):
    """Even with authentication disabled, provided user info should scope leads."""
    app = create_app(tmp_path)
    client = TestClient(app)
    from backend import auth

    auth.AUTH_ENABLED = False

    # Create a lead as user1
    app.dependency_overrides[auth.get_current_user] = override_user(
        "user1", "user1@example.com"
    )
    resp = client.post("/leads", json={"name": "Alice", "stage": "New"})
    assert resp.status_code == 200

    # Switch to user2 and create a lead
    app.dependency_overrides[auth.get_current_user] = override_user(
        "user2", "user2@example.com"
    )
    resp = client.post("/leads", json={"name": "Bob", "stage": "Qualified"})
    assert resp.status_code == 200

    # Ensure user2 only sees their own lead
    resp = client.get("/leads")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Bob"

    # Switch back to user1 and verify only Alice's lead is returned
    app.dependency_overrides[auth.get_current_user] = override_user(
        "user1", "user1@example.com"
    )
    resp = client.get("/leads")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Alice"
