"""Relay mode (RELAY_URL + RELAY_SECRET): Neo4j, Muse and Resend go through the relay (mocked)."""
import base64
import io
import json
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
import httpx  # noqa: E402
from PIL import Image  # noqa: E402

from src.shared import relay  # noqa: E402



def _png_b64():
    buf = io.BytesIO(); Image.new("RGB", (8, 8), "blue").save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _relay_env(monkeypatch):
    monkeypatch.setenv("RELAY_URL", "https://relay.example.vercel.app")
    monkeypatch.setenv("RELAY_SECRET", "test-secret")
    for k in ("MODEL_API_KEY", "RESEND_API_KEY", "NEO4J_URI"):
        monkeypatch.delenv(k, raising=False)


def test_neo4j_via_relay(monkeypatch):
    _relay_env(monkeypatch)
    seen = []

    def handler(req):
        seen.append(req)
        assert req.headers["x-relay-secret"] == "test-secret" and "authorization" not in req.headers
        return httpx.Response(200, json={"data": {"fields": ["ok"], "values": [[1]]}})

    real = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    from src.data.store import get_store
    st = get_store()
    assert st.kind == "neo4j (relay)"
    assert str(seen[0].url) == "https://relay.example.vercel.app/api/neo4j"
    assert json.loads(seen[0].content)["statement"] == "RETURN 1 AS ok"


def test_muse_via_relay_generations_and_edits(monkeypatch):
    _relay_env(monkeypatch)
    calls = []

    def fake_post(path, json=None, timeout=60, client=None):
        calls.append((path, json))
        return httpx.Response(200, json={"data": [{"b64_json": _png_b64()}]})

    monkeypatch.setattr(relay, "post", fake_post)
    from src.features.imagegen import providers
    assert providers.get_provider().name == "muse"
    out = providers.generate({"business_name": "Acme", "direction": "minimal"}, [], 1)
    assert out[0].startswith("/media/") and calls[-1][0] == "/api/muse?op=generations"
    ref = os.path.join(tempfile.mkdtemp(), "big.jpg")
    Image.new("RGB", (3000, 3000), "red").save(ref, "JPEG")
    providers.generate({"business_name": "Acme"}, [ref], 1)
    path, body = calls[-1]
    assert path == "/api/muse?op=edits" and len(body["images"]) == 1
    assert len(body["images"][0]["image_url"]) < 1_000_000  # downscaled for the 4.5 MB limit


def test_resend_via_relay(monkeypatch):
    _relay_env(monkeypatch)
    sent = []

    def fake_post(path, json=None, timeout=60, client=None):
        sent.append((path, json))
        return httpx.Response(200, json={"id": "email_123"})

    monkeypatch.setattr(relay, "post", fake_post)
    from src.features.staff import email
    s = {"fields": {"business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.co"}}
    m = email.send("approve", s, [], None, None)
    assert sent[0][0] == "/api/resend" and sent[0][1]["to"] == ["willhanjg01@gmail.com"]
    assert m["status"] == "Sent" and m["provider"] == "resend (relay)" and m["id"] == "email_123"


def test_relay_failure_falls_back(monkeypatch):
    _relay_env(monkeypatch)
    monkeypatch.setattr(relay, "post", lambda *a, **k: httpx.Response(401, json={"error": "unauthorised"}))
    from src.features.imagegen import providers
    from src.features.staff import email
    assert providers.generate({"business_name": "Acme"}, [], 1)[0].startswith("/media/")  # placeholder
    m = email.send("approve", {"fields": {"business_name": "A"}}, [], None, None)
    assert m["status"].startswith("Sent (demo)") and m["provider"] == "outbox"
