"""v2 API: documents+confirm, delete, retake, language, looks+consult, guard, metrics, concurrency."""
import io
import json
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
import pytest  # noqa: E402
from PIL import Image, ImageDraw, ImageFilter, ImageFont  # noqa: E402

from src.app import app, store  # noqa: E402
from helpers import new_session, staff_client  # noqa: E402
from src.features.i18n import lang  # noqa: E402

c = staff_client(app)
FIX = "tests/fixtures/acra_fake.pdf"


@pytest.fixture(autouse=True)
def _no_meta(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("RELAY_URL", raising=False)
    monkeypatch.delenv("RELAY_SECRET", raising=False)


def _upload(sid, path, purpose=None):
    data = {"sessionId": sid}
    if purpose:
        data["purpose"] = purpose
    with open(path, "rb") as f:
        return c.post("/api/upload", data=data, files={"files[]": ("acra_fake.pdf", f, "application/pdf")})


def test_acra_upload_confirm_flow():
    sid = new_session(c)
    r = _upload(sid, FIX).json()
    assert r["status"] == "confirm_details", r
    assert r["confirm"] and any(f["key"] == "uen" for f in r["confirm"]["fields"])
    assert "S1234567D" not in json.dumps(r)
    doc_id = r["confirm"]["docId"]
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert d["fields"].get("business_name") in (None, "")  # A9: pending hidden
    r = c.post("/api/confirm", json={"sessionId": sid, "accept": True}).json()
    assert r["missing"] == ["Email"], r
    r = c.post("/api/chat", json={"sessionId": sid, "text": "ops@lumenkopi.example"}).json()
    assert r["status"] == "need_direction", r
    audits = c.get("/api/staff/audit", params={"client": sid}).json()
    assert any(a["action"] == "details_confirmed" and a["actor"] == "client" for a in audits)
    assert c.get(f"/media/{doc_id}.pdf").status_code == 404
    from pathlib import Path
    p = Path(store.load(sid)["docs"][doc_id]["path"])
    assert p.is_file() and "media" not in str(p).replace("\\", "/")


def test_delete_document():
    sid = new_session(c)
    doc_id = _upload(sid, FIX).json()["confirm"]["docId"]
    from pathlib import Path
    p = Path(store.load(sid)["docs"][doc_id]["path"])
    assert p.is_file()
    r = c.delete(f"/api/documents/{doc_id}?sessionId={sid}").json()
    assert "Removed" in r["reply"] and not p.exists()
    assert store.load(sid)["fields"] == {}
    assert store.load(sid)["docs"][doc_id]["status"] == "removed"
    assert c.delete(f"/api/documents/{doc_id}?sessionId={sid}").status_code == 404
    sid2 = new_session(c)
    doc2 = _upload(sid2, FIX).json()["confirm"]["docId"]
    c.post("/api/confirm", json={"sessionId": sid2, "accept": True})
    assert c.delete(f"/api/documents/{doc2}?sessionId={sid2}").status_code == 409


def _blurry_png():
    im = Image.new("RGB", (1200, 1600), "white")
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.load_default(size=48)
    except TypeError:
        font = ImageFont.load_default()
    for i in range(40):
        d.text((60, 40 + i * 38), f"LINE {i + 1:02d} LUMEN KOPI 202498765K", fill="black", font=font)
    buf = io.BytesIO()
    im.filter(ImageFilter.GaussianBlur(radius=8)).save(buf, "PNG")
    return buf.getvalue()


def test_blurry_document_photo_retake():
    sid = new_session(c)
    r = c.post("/api/upload", data={"sessionId": sid, "purpose": "document"},
               files={"files[]": ("page.png", _blurry_png(), "image/png")}).json()
    assert r["retake"] is True and r["retake_reason"] == "blurry", r
    assert r["status"] == "need_document" and store.load(sid).get("pending") is None


def test_language_prefix_and_transcript(monkeypatch):
    sid = new_session(c)
    monkeypatch.setattr(lang, "to_client", lambda t, l, s=None: "[zh] " + t if l == "zh" else t)
    r = c.post("/api/language", json={"sessionId": sid, "lang": "zh"}).json()
    assert r["reply"].startswith("[zh] ") and r["lines"] and r["lang"] == "zh"
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert d["lang"] == "zh"
    assert all(not (m["role"] == "bot" and m["text"].startswith("[zh] ")) for m in d["transcript"])
    monkeypatch.setattr(lang, "to_english", lambda t, l, s=None: "my shop needs help")
    sid2 = new_session(c)
    c.post("/api/chat", json={"sessionId": sid2, "text": "我的店需要帮助"})
    d2 = c.get(f"/api/staff/clients/{sid2}").json()
    cli = [m for m in d2["transcript"] if m["role"] == "client"][-1]
    assert cli["text"] == "my shop needs help" and cli["original"] == "我的店需要帮助"


def test_looks_skip_to_consult_and_approve():
    sid = new_session(c)
    r = c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "LookBiz", "contact_name": "Jo", "email": "jo@lookbiz.example",
        "design_preferences": "minimal blue"}}).json()
    assert r["status"] == "awaiting_review" and len(r["looks"]["options"]) == 3, r
    for _ in range(3):
        r = c.post("/api/looks", json={"sessionId": sid, "skip": True}).json()
    assert r["status"] == "handed_off", r
    cards = c.get("/api/staff/consults").json()
    card = next(x for x in cards if x.get("session_id") == sid or x.get("client_id") == sid)
    assert card["status"] == "pending_approval" and card["next_steps"]
    rej = c.get(f"/api/staff/clients/{sid}/rejected-looks").json()
    assert len(rej) == 9 and sorted({x["round"] for x in rej}) == [1, 2, 3]
    d = c.post(f"/api/staff/consults/{card['id']}/decision", json={"decision": "approve"},
               headers={"x-staff-name": "Ana"}).json()
    assert d["status"] == "approved" and d["approved_by"] == "staff:Ana"
    audits = c.get("/api/staff/audit", params={"client": sid}).json()
    assert any(a["action"] == "consult_approve" and a["actor"] == "staff:Ana" for a in audits)
    assert c.post(f"/api/staff/consults/{card['id']}/decision",
                  json={"decision": "approve"}).status_code == 409
    assert c.get(f"/api/staff/clients/{sid}").json()["outbox"] == []  # D5: no consult email


def test_looks_pick_accepts():
    sid = new_session(c)
    r = c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "PickBiz", "contact_name": "Jo", "email": "jo@pickbiz.example",
        "design_preferences": "warm retro"}}).json()
    lid = r["looks"]["options"][0]["id"]
    r = c.post("/api/looks", json={"sessionId": sid, "selected": [lid]}).json()
    assert r["status"] == "accepted", r


def test_outbound_guard_masks_other_client():
    ca, cb = staff_client(app), staff_client(app)
    sa = new_session(ca)
    ca.post("/api/form", json={"sessionId": sa, "fields": {
        "business_name": "A Biz", "contact_name": "Ann", "email": "a@one.example"}})
    sb = new_session(cb)
    cb.post("/api/form", json={"sessionId": sb, "fields": {
        "business_name": "B Biz", "contact_name": "Bob", "email": "b@two.example",
        "requirements_notes": "call a@one.example S1234567D"}})
    r = cb.post("/api/chat", json={"sessionId": sb, "text": "minimal blue"}).json()
    assert "a@one.example" not in r["reply"] and "S1234567D" not in r["reply"]
    assert "a@one.example" not in json.dumps(r) and "S1234567D" not in json.dumps(r)
    d = cb.get(f"/api/staff/clients/{sb}").json()
    assert "a@one.example" not in json.dumps(d) and "S1234567D" not in json.dumps(d)


def test_metrics_traces_and_401():
    m = c.get("/api/staff/metrics").json()
    assert {"sessions", "completed", "completion_rate", "avg_minutes_to_finish",
            "avg_fields_needing_fixes", "avg_rounds_to_pick", "consult_rate"} <= set(m["outcomes"])
    assert isinstance(m["steps"], list) and "total_cost_sgd" in m
    assert c.get("/api/staff/traces", params={"limit": 5}).status_code == 200
    assert c.get("/api/staff/audit").status_code == 200
    from fastapi.testclient import TestClient
    anon = TestClient(app)
    assert anon.get("/api/staff/metrics").status_code == 401
    assert anon.get("/api/staff/clients").status_code == 401


def test_concurrent_sessions_isolated():
    from concurrent.futures import ThreadPoolExecutor

    def one(i):
        cc = staff_client(app)
        sid = new_session(cc)
        cc.post("/api/form", json={"sessionId": sid, "fields": {
            "business_name": f"Biz{i}", "contact_name": f"Person{i}",
            "email": f"user{i}@conc.example"}})
        return sid, i

    with ThreadPoolExecutor(max_workers=8) as ex:
        rows = list(ex.map(one, range(8)))
    for sid, i in rows:
        f = c.get(f"/api/staff/clients/{sid}").json()["fields"]
        assert f["business_name"] == f"Biz{i}" and f["email"] == f"user{i}@conc.example", (i, f)


def test_decision_preview_no_outbox():
    sid = new_session(c)
    c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "PrevBiz", "contact_name": "Jo", "email": "jo@prevbiz.example"}})
    assert c.get(f"/api/staff/clients/{sid}").json()["outbox"] == []
    r = c.post(f"/api/staff/clients/{sid}/decision/preview", json={"decision": "approve"}).json()
    assert r["subject"] and r["body"] and "PrevBiz" in r["subject"]
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert d["outbox"] == [] and d["decisions"] == []
