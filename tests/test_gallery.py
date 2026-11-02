"""Pick-the-poster start: gallery first, then only what the poster needs, then contact details."""
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from src.app import app, store  # noqa: E402
from helpers import staff_client  # noqa: E402

c = staff_client(app)


def _gallery():
    r = c.post("/api/session", json={"flow": "gallery"}).json()
    c.headers["x-session-secret"] = r["sessionSecret"]
    return r["sessionId"], r


def _chat(sid, text):
    return c.post("/api/chat", json={"sessionId": sid, "text": text}).json()


def test_gallery_opens_on_three_sample_posters_without_model_calls():
    sid, r = _gallery()
    assert r["status"] == "pick_poster" and r["lines"][0] == "Hi! Which poster do you like?"
    opts = r["looks"]["options"]
    assert len(opts) == 3 and all(o["url"].startswith("/samples/") for o in opts)
    assert all(c.get(o["url"]).status_code == 200 for o in opts)
    assert not [t for t in store.traces(sid) if t["step"] in ("image_gen", "image_brief")]


def test_pick_then_ask_only_what_the_poster_needs():
    sid, r = _gallery()
    r = c.post("/api/looks/pick", json={"sessionId": sid, "picked_ids": ["sample-2"]}).json()
    assert r["status"] == "missing_info" and r["lines"][:2] == ["Nice pick!", "What's your business name?"], r
    assert "upload your business document" in r["reply"]
    s = store.load(sid)
    assert s["fields"]["design_preferences"].startswith("bold and bright") and s["refs"]
    r = _chat(sid, "Lumen Kopi")
    assert r["lines"][0] == "What should your poster say?", r
    r = _chat(sid, "20% off all coffee this week")
    assert r["lines"][0] == "Who should we contact?", r
    r = _chat(sid, "Tan Mei Ling")
    assert r["lines"] == ["What's your email?"], r
    r = _chat(sid, "mei@lumenkopi.example")
    assert r["status"] == "awaiting_review" and r["round"] == 1 and len(r["looks"]["options"]) == 3, r
    f = store.load(sid)["fields"]
    assert f["business_name"] == "Lumen Kopi" and f["requirements_notes"].startswith("20% off")


def test_headline_can_be_skipped_and_chat_numbers_pick():
    sid, _ = _gallery()
    r = _chat(sid, "1 and 3")
    assert r["lines"][1] == "What's your business name?"
    assert "; " in store.load(sid)["fields"]["design_preferences"]  # both styles kept
    _chat(sid, "Acme Bakery")
    r = _chat(sid, "skip")
    assert r["lines"][0] == "Who should we contact?", r


def test_skip_gallery_goes_to_details_first_start():
    sid, _ = _gallery()
    r = c.post("/api/looks/skip", json={"sessionId": sid}).json()
    assert r["status"] == "need_document" and r["looks"] is None and "details" in r["lines"][0], r


def test_default_session_is_unchanged():
    r = c.post("/api/session", json={}).json()
    assert r["status"] == "need_document" and r["looks"] is None
