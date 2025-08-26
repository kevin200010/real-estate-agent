import os
import sys
import types

from fastapi.testclient import TestClient

# Provide a minimal jinja2 stub so ``web_app`` can be imported without the
# real dependency installed.
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

# FastAPI's UploadFile dependency requires the ``python-multipart`` package.
# Stub out the minimal pieces used during app startup so tests can run without
# the real dependency.
multipart_stub = types.SimpleNamespace(__version__="0")
sys.modules.setdefault("multipart", multipart_stub)
sys.modules.setdefault("multipart.multipart", types.SimpleNamespace(parse_options_header=lambda *a, **k: None))

# Make backend modules importable as top-level to mirror the runtime server setup
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "backend"))
import web_app  # type: ignore


def test_google_token_roundtrip(tmp_path):
    # use temporary token storage to avoid persisting to repo
    web_app._TOKENS_FILE = tmp_path / "google_tokens.json"
    web_app._google_tokens.clear()
    client = TestClient(web_app.app)

    # getting before a token is stored should succeed with null token
    resp = client.get("/google-token")
    assert resp.status_code == 200
    assert resp.json() == {"access_token": None}

    # save and retrieve a token
    resp = client.post("/google-token", json={"access_token": "abc"})
    assert resp.status_code == 200

    resp = client.get("/google-token")
    assert resp.status_code == 200
    assert resp.json()["access_token"] == "abc"
