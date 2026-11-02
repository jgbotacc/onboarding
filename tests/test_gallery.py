"""Gallery-first onboarding flow (opt-in)."""
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
import pytest  # noqa: E402

from src.app import app, store  # noqa: E402
from helpers import new_session, staff_client  # noqa: E402

c = staff_client(app)


@pytest.fixture(autouse=True)
def _no_meta(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("RELAY_URL", raising=False)
    monkeypatch.delenv("RELAY_SECRET", raising=False)


def _gallery_session():
    r = c.post("/api/session", json={"flow": "gallery"}).json()
    c.headers["x-session-secret"] = r["sessionSecret"]
    return r


def test_gallery_opens_with_starters():
    r = _gallery_session()
    assert r["status"] == "pick_poster", r
    assert r["round"] == 0, r
    opts = (r.get("looks") or {}).get("options") or []
    assert len(opts) == 3, r
    assert all(o["url"].startswith("/samples/") for o in opts), r
    assert r["lines"][:3] == ["Hi! Which poster do you like?",
                              "Pick one or more, and we'll make it yours.",
                              "Or type \"skip\" to start with your details."], r


def test_gallery_pick_then_questions():
    r = _gallery_session()
    sid = r["sessionId"]
    opts = r["looks"]["options"]
    sample2 = next(o["id"] for o in opts if o["url"].endswith("sample-2.jpg"))
    r = c.post("/api/looks", json={"sessionId": sid, "selected": [sample2]}).json()
    assert r["reply"].startswith("Nice pick!"), r
    assert "What's your business name?" in r["reply"], r
    assert r["flow"] == "gallery", r
    assert "Poster headline" in r["missing"], r
    s = store.load(sid)
    assert s["poster_first"] is True, s
    assert s["direction"] and "bold and bright" in s["direction"], s
    assert any("sample-2.jpg" in p for p in s["refs"]), s
    r = c.post("/api/chat", json={"sessionId": sid, "text": "Lumen Kopi"}).json()
    assert "What should your poster say?" in r["reply"], r
    assert "Poster headline" in r["missing"], r
    r = c.post("/api/chat", json={"sessionId": sid, "text": "20% off all coffee"}).json()
    assert "Who should we contact?" in r["reply"], r
    r = c.post("/api/chat", json={"sessionId": sid, "text": "Jo"}).json()
    assert "What's your email?" in r["reply"], r
    r = c.post("/api/chat", json={"sessionId": sid, "text": "jo@lumen.example"}).json()
    assert r["status"] == "awaiting_review", r
    assert r["round"] == 1, r
    assert len((r.get("looks") or {}).get("options") or []) == 3, r


def test_gallery_chat_pick_and_headline_skip():
    r = _gallery_session()
    sid = r["sessionId"]
    r = c.post("/api/chat", json={"sessionId": sid, "text": "1 and 3"}).json()
    assert r["reply"].startswith("Nice pick!"), r
    assert "What's your business name?" in r["reply"], r
    s = store.load(sid)
    assert "warm and cosy" in s["direction"] and "clean and premium" in s["direction"], s
    c.post("/api/chat", json={"sessionId": sid, "text": "Lumen Kopi"})
    r = c.post("/api/chat", json={"sessionId": sid, "text": "skip"}).json()
    assert "Who should we contact?" in r["reply"], r
    assert "Poster headline" not in r["missing"], r


def test_gallery_skip_to_details():
    r = _gallery_session()
    sid = r["sessionId"]
    r = c.post("/api/looks/skip", json={"sessionId": sid}).json()
    assert r["status"] == "need_document", r
    assert r["reply"].startswith("Okay, let's start with your details."), r


def test_classic_session_unchanged():
    sid = new_session(c)
    r = c.post("/api/chat", json={"sessionId": sid, "text": "hello there, I need help"}).json()
    assert r["status"] in ("need_document", "missing_info"), r
    assert "flow" not in r, r
    assert r.get("looks") is None, r
