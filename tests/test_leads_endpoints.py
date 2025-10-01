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


def test_leads_are_filtered_by_email(tmp_path):
    """Users sharing an ID should still only see their own leads."""

    app = create_app(tmp_path)
    client = TestClient(app)
    from backend import auth

    auth.AUTH_ENABLED = True

    # Both users share the same ID but have different emails
    app.dependency_overrides[auth.get_current_user] = override_user(
        "same", "user1@example.com"
    )
    resp = client.post("/leads", json={"name": "Alice", "stage": "New"})
    assert resp.status_code == 200

    app.dependency_overrides[auth.get_current_user] = override_user(
        "same", "user2@example.com"
    )
    resp = client.post("/leads", json={"name": "Bob", "stage": "Qualified"})
    assert resp.status_code == 200

    resp = client.get("/leads")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Bob"

    app.dependency_overrides[auth.get_current_user] = override_user(
        "same", "user1@example.com"
    )
    resp = client.get("/leads")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Alice"


def test_leads_are_filtered_by_id(tmp_path):
    """Users sharing an email should still only see their own leads."""

    app = create_app(tmp_path)
    client = TestClient(app)
    from backend import auth

    auth.AUTH_ENABLED = True

    # Both users share the same email but have different IDs
    app.dependency_overrides[auth.get_current_user] = override_user(
        "user1", "shared@example.com"
    )
    resp = client.post("/leads", json={"name": "Alice", "stage": "New"})
    assert resp.status_code == 200

    app.dependency_overrides[auth.get_current_user] = override_user(
        "user2", "shared@example.com"
    )
    resp = client.post("/leads", json={"name": "Bob", "stage": "Qualified"})
    assert resp.status_code == 200

    # user2 should only see Bob
    resp = client.get("/leads")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Bob"

    # user1 should only see Alice
    app.dependency_overrides[auth.get_current_user] = override_user(
        "user1", "shared@example.com"
    )
    resp = client.get("/leads")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Alice"


def test_get_leads_for_user_returns_scoped_results(tmp_path):
    app = create_app(tmp_path)
    client = TestClient(app)
    from backend import auth
    import backend.leads as leads

    auth.AUTH_ENABLED = True

    app.dependency_overrides[auth.get_current_user] = override_user(
        "user-a", "usera@example.com"
    )
    resp = client.post("/leads", json={"name": "Alice", "stage": "New"})
    assert resp.status_code == 200

    app.dependency_overrides[auth.get_current_user] = override_user(
        "user-b", "userb@example.com"
    )
    resp = client.post("/leads", json={"name": "Bob", "stage": "Qualified"})
    assert resp.status_code == 200

    leads_for_a = leads.get_leads_for_user("user-a", "usera@example.com")
    assert len(leads_for_a) == 1
    assert leads_for_a[0]["name"] == "Alice"

    leads_for_b = leads.get_leads_for_user("user-b", "userb@example.com")
    assert len(leads_for_b) == 1
    assert leads_for_b[0]["name"] == "Bob"


def test_delete_lead_is_scoped_to_user(tmp_path):
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

    # another user cannot delete it
    app.dependency_overrides[auth.get_current_user] = override_user(
        "user2", "user2@example.com"
    )
    resp = client.delete(f"/leads/{lead_id}")
    assert resp.status_code == 404

    # original user can delete
    app.dependency_overrides[auth.get_current_user] = override_user(
        "user1", "user1@example.com"
    )
    resp = client.delete(f"/leads/{lead_id}")
    assert resp.status_code == 200

    resp = client.get("/leads")
    assert resp.status_code == 200
    assert resp.json() == []
