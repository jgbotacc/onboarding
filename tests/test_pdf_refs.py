"""PDF path has no reference-image field: ask for refs before round 1, then use the PDF's design preferences."""
import io
import os
import subprocess
import sys
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from PIL import Image  # noqa: E402

from src.app import app, store  # noqa: E402
from src.features.chat import agent  # noqa: E402
from helpers import new_session, staff_client  # noqa: E402

c = staff_client(app)
PREFS = "warm retro kopitiam, brown and cream"


def _pdf(full=True):
    p = os.path.join(tempfile.mkdtemp(), "b.pdf")
    subprocess.run([sys.executable, "scripts/make_sample_pdf.py", p] + (["--full"] if full else []), check=True)
    return open(p, "rb").read()


def _png():
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), "#2563eb").save(buf, "PNG")
    return buf.getvalue()


def _upload(sid, *files):
    r = c.post("/api/upload", data={"sessionId": sid}, files=[("files[]", f) for f in files])
    assert r.status_code == 200, r.text
    return r.json()


def _pdf_with_prefs():
    sid = new_session(c)
    r = _upload(sid, ("b.pdf", _pdf(), "application/pdf"))
    assert r["status"] == "need_direction" and r["round"] == 0 and not r["images"], r
    assert "JPG or PNG" in r["reply"] and PREFS in r["reply"] and '"skip"' in r["reply"], r
    return sid


def test_pdf_with_prefs_asks_for_refs_then_skip_uses_prefs():
    sid = _pdf_with_prefs()
    r = c.post("/api/chat", json={"sessionId": sid, "text": "skip"}).json()
    assert r["status"] == "awaiting_review" and r["round"] == 1 and r["images"], r
    s = store.load(sid)
    assert s["direction"] == PREFS and s["history"][0]["direction"] == PREFS and not s["refs"]


def test_pdf_with_prefs_then_ref_upload_starts_round_1():
    sid = _pdf_with_prefs()
    r = _upload(sid, ("ref.png", _png(), "image/png"))
    assert r["status"] == "awaiting_review" and r["round"] == 1 and r["images"], r
    assert r["reply"].startswith("Got 1 reference image(s).") and "direction" not in r["reply"].split(".")[1], r
    s = store.load(sid)
    assert s["direction"] == PREFS and len(s["refs"]) == 1


def test_pdf_with_prefs_typed_direction_overrides():
    sid = _pdf_with_prefs()
    r = c.post("/api/chat", json={"sessionId": sid, "text": "minimal blue"}).json()
    assert r["round"] == 1 and store.load(sid)["direction"] == "minimal blue", r


def test_pdf_with_prefs_and_refs_in_same_upload_starts_round_1():
    sid = new_session(c)
    r = _upload(sid, ("b.pdf", _pdf(), "application/pdf"), ("ref.png", _png(), "image/png"))
    assert r["status"] == "awaiting_review" and r["round"] == 1 and r["images"], r
    assert len(store.load(sid)["refs"]) == 1


def test_pdf_without_prefs_unchanged():
    sid = new_session(c)
    r = _upload(sid, ("b.pdf", _pdf(full=False), "application/pdf"))
    r = c.post("/api/chat", json={"sessionId": sid, "text": "hello@kopicorner.sg"}).json()
    assert r["status"] == "need_direction" and "JPG or PNG" in r["reply"], r
    r = _upload(sid, ("ref.png", _png(), "image/png"))
    assert r["status"] == "need_direction" and "tell me your design direction" in r["reply"], r
    r = c.post("/api/chat", json={"sessionId": sid, "text": "skip"}).json()
    assert r["round"] == 1 and store.load(sid)["direction"] is None, r


def test_pdf_prefs_missing_email_asks_for_refs_after_chat_fill(monkeypatch):
    monkeypatch.setattr(agent, "generate", lambda brief, refs, rnd: [f"/media/r{rnd}.png"])
    s = agent.new_session()
    r = agent.on_document(s, {"business_name": "Kopi Corner", "contact_name": "Ah Hock", "design_preferences": PREFS}, "b.pdf")
    assert r["status"] == "missing_info" and r["missing"] == ["Email"], r
    r = agent.on_chat(s, "hello@kopicorner.sg")
    assert r["status"] == "need_direction" and r["round"] == 0 and "JPG or PNG" in r["reply"], r
    r = agent.on_chat(s, "skip")
    assert r["round"] == 1 and s["direction"] == PREFS


def test_form_with_prefs_after_pdf_goes_straight_to_round_1():
    sid = new_session(c)
    _upload(sid, ("b.pdf", _pdf(full=False), "application/pdf"))
    r = c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.example", "design_preferences": "minimal blue"}}).json()
    assert r["status"] == "awaiting_review" and r["round"] == 1 and r["images"], r


def test_pdf_skip_and_ref_paths_show_summary():
    close = "Using your design preferences and business information. Here is a mockup."
    sid = _pdf_with_prefs()
    r = c.post("/api/chat", json={"sessionId": sid, "text": "skip"}).json()
    assert r["reply"].startswith("Business name: ") and r["reply"].endswith("\n\n" + close), r
    assert f"Design preferences: {PREFS}\n" in r["reply"]
    sid = _pdf_with_prefs()
    r = _upload(sid, ("ref.png", _png(), "image/png"))
    assert r["reply"].startswith("Got 1 reference image(s).\n\nBusiness name: ") and r["reply"].endswith(close), r
