import os
import sys
import importlib

from fastapi.testclient import TestClient

# Ensure repository root on path
sys.path.append(os.path.dirname(os.path.dirname(__file__)))


def override_user(user_id):
    def _user():
        return {"sub": user_id}
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
    from backend import auth
    app.dependency_overrides[auth.get_current_user] = override_user("user1")
    return app


def test_leads_are_scoped_to_user(tmp_path):
    app = create_app(tmp_path)
    client = TestClient(app)

    # Create lead for user1
    resp = client.post("/leads", json={"name": "Alice", "stage": "New"})
    assert resp.status_code == 200
    lead_id = resp.json()["id"]

    # Verify user1 sees their lead
    resp = client.get("/leads")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Alice"

    # Switch to user2 and create lead
    from backend import auth
    app.dependency_overrides[auth.get_current_user] = override_user("user2")
    resp = client.post("/leads", json={"name": "Bob", "stage": "Qualified"})
    assert resp.status_code == 200

    # User2 should only see their lead
    resp = client.get("/leads")
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "Bob"

    # Switch back to user1 and update stage
    app.dependency_overrides[auth.get_current_user] = override_user("user1")
    resp = client.put(f"/leads/{lead_id}", json={"stage": "Contacted"})
    assert resp.status_code == 200

    resp = client.get("/leads")
    data = resp.json()
    assert data[0]["stage"] == "Contacted"


def test_leads_require_authentication(tmp_path):
    app = create_app(tmp_path)
    client = TestClient(app)
    from backend import auth
    app.dependency_overrides[auth.get_current_user] = lambda: None
    resp = client.get("/leads")
    assert resp.status_code == 401
