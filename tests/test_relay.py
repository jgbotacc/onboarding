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



def _png_b64(size=(8, 8)):
    buf = io.BytesIO(); Image.new("RGB", size, "blue").save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _relay_env(monkeypatch):
    monkeypatch.setenv("RELAY_URL", "https://relay.example.vercel.app")
    monkeypatch.setenv("RELAY_SECRET", "test-secret")
    for k in ("MODEL_API_KEY", "BASETEN_API_KEY", "RESEND_API_KEY", "NEO4J_URI"):
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
    s = {"fields": {"business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.example"}}
    m = email.send("approve", s, [], None, None)
    assert sent[0][0] == "/api/resend" and sent[0][1]["to"] == ["ops@example.com"]
    assert m["status"] == "Sent" and m["provider"] == "resend (relay)" and m["id"] == "email_123"


def test_relay_failure_falls_back(monkeypatch):
    _relay_env(monkeypatch)
    monkeypatch.setattr(relay, "post", lambda *a, **k: httpx.Response(401, json={"error": "unauthorised"}))
    from src.features.imagegen import providers
    from src.features.staff import email
    assert providers.generate({"business_name": "Acme"}, [], 1)[0].startswith("/media/")  # placeholder
    m = email.send("approve", {"fields": {"business_name": "A"}}, [], None, None)
    assert m["status"].startswith("Sent (demo)") and m["provider"] == "outbox"


def _media_size(url):
    from src.shared.config import MEDIA_DIR
    return Image.open(MEDIA_DIR / url.rsplit("/", 1)[-1]).size


def test_posts_are_exactly_1080_relay_and_direct(monkeypatch):
    from src.features.imagegen import providers
    big = httpx.Response(200, json={"data": [{"b64_json": _png_b64((1600, 1600))}]})
    _relay_env(monkeypatch)  # relay mode
    monkeypatch.setattr(relay, "post", lambda *a, **k: big)
    assert _media_size(providers.generate({"business_name": "Acme"}, [], 1)[0]) == (1080, 1080)
    monkeypatch.delenv("RELAY_URL")  # direct mode
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: big)
    assert providers.get_provider().name == "muse"
    assert _media_size(providers.generate({"business_name": "Acme"}, [], 1)[0]) == (1080, 1080)
    monkeypatch.delenv("MODEL_API_KEY")  # placeholder
    assert _media_size(providers.generate({"business_name": "Acme"}, [], 1)[0]) == (1080, 1080)


def test_no_notify_email_skips_send(monkeypatch):
    _relay_env(monkeypatch)
    monkeypatch.delenv("ONBOARDING_NOTIFY_EMAIL", raising=False)
    sent = []
    monkeypatch.setattr(relay, "post", lambda *a, **k: sent.append(a) or httpx.Response(200, json={"id": "x"}))
    from src.features.staff import email
    m = email.send("approve", {"fields": {"business_name": "A"}}, [], None, None)
    assert sent == [] and m["to"] == "" and m["provider"] == "outbox"
    assert m["status"].startswith("Not sent (demo)") and "ONBOARDING_NOTIFY_EMAIL" in m["status"]


def _chat_ok(content, provider):
    return httpx.Response(200, headers={"x-relay-provider": provider},
                           json={"choices": [{"message": {"content": content}}],
                                 "usage": {"prompt_tokens": 100, "completion_tokens": 50}})


def test_chat_via_relay(monkeypatch):
    _relay_env(monkeypatch)
    from src.shared import meta, trace
    assert meta.enabled() is True
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append({"url": url, "headers": headers, "json": json, "timeout": timeout})
        assert "api.meta.ai" not in url and "baseten" not in url
        return _chat_ok("hello", "meta")

    monkeypatch.setattr(httpx, "post", fake_post)
    rows = []
    trace.set_sink(rows.append)
    try:
        assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "hello"
    finally:
        trace.set_sink(None)
    assert len(calls) == 1
    assert calls[0]["url"] == "https://relay.example.vercel.app/api/chat"
    assert calls[0]["headers"]["x-relay-secret"] == "test-secret"
    assert "authorization" not in {k.lower() for k in calls[0]["headers"]}
    assert calls[0]["json"]["model"] == "muse-spark-1.3"
    assert calls[0]["timeout"] == 50
    assert rows[-1]["ok"] is True and rows[-1]["model"] == "muse-spark-1.3"


def test_chat_relay_provider_trace(monkeypatch):
    _relay_env(monkeypatch)
    from src.shared import meta, trace
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _chat_ok("hi", "baseten"))
    rows = []
    trace.set_sink(rows.append)
    try:
        assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "hi"
        assert rows[-1]["ok"] is True
        assert rows[-1]["model"] == "meta-models/muse-spark-open-1026"
    finally:
        trace.set_sink(None)


def test_chat_relay_retry(monkeypatch):
    _relay_env(monkeypatch)
    from src.shared import meta
    sleeps = []
    monkeypatch.setattr(meta, "_sleep", sleeps.append)
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append(url)
        if len(calls) == 1:
            return httpx.Response(503, headers={"x-relay-provider": "none"}, json={})
        return _chat_ok("hello", "meta")

    monkeypatch.setattr(httpx, "post", fake_post)
    assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "hello"
    assert len(calls) == 2 and sleeps == [1]
