"""Staff review: approve, reject, more_info + resume, and a rollback case."""
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from fastapi.testclient import TestClient  # noqa: E402

from src.app import app  # noqa: E402
from src.shared.config import DEMO_EMAIL_TO  # noqa: E402

c = TestClient(app)
BASE = {"business_name": "Acme Cafe", "contact_name": "Jo", "email": "jo@acme.co", "industry": "F&B"}


def _client(extra=None):
    sid = c.post("/api/session", json={}).json()["sessionId"]
    c.post("/api/form", json={"sessionId": sid, "fields": dict(BASE, design_preferences="minimal", **(extra or {}))})
    return sid


def test_list_and_detail():
    sid = _client()
    rows = c.get("/api/staff/clients").json()
    assert any(r["id"] == sid and r["business_name"] == "Acme Cafe" and r["image"] for r in rows)
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert {"fields", "images", "status", "round", "rounds", "decisions", "outbox"} <= set(d)
    assert c.get(f"/api/clients/{sid}").status_code == 200  # alias


def test_approve():
    sid = _client()
    d = c.post(f"/api/staff/clients/{sid}/decision", json={"decision": "approve"}).json()
    assert d["status"] == "approved" and d["email"]["to"] == DEMO_EMAIL_TO
    assert "operations team will get in contact" in d["email"]["body"]
    assert "Client email on file: jo@acme.co" in d["email"]["body"]
    assert d["email"]["status"].startswith("Sent")


def test_reject():
    sid = _client()
    d = c.post(f"/api/staff/clients/{sid}/decision", json={"decision": "reject", "note": "Out of area"}).json()
    assert d["status"] == "rejected" and "unable to proceed" in d["email"]["body"]


def test_more_info_resume_flow():
    sid = _client()
    d = c.post(f"/api/staff/clients/{sid}/decision",
               json={"decision": "more_info", "fields": ["phone_number", "business_website"], "note": "Need these"}).json()
    assert d["status"] == "needs_info" and "?resume=" in d["resume_url"] and "Phone Number" in d["email"]["body"]
    token = d["resume_url"].split("resume=")[1]
    r = c.post("/api/session", json={"resumeToken": token}).json()
    assert r["sessionId"] == sid and r["missing"] == ["Phone Number", "Business Website"]
    g = c.get(f"/api/resume/{token}").json()
    assert g["fields_to_refill"] == ["phone_number", "business_website"] and g["note"] == "Need these"
    r = c.post("/api/chat", json={"sessionId": sid, "text": "+65 6123 4567"}).json()
    assert r["missing"] == ["Business Website"], r
    r = c.post("/api/chat", json={"sessionId": sid, "text": "acme.co"}).json()
    assert r["status"] == "pending_review" and r["round"] == 1, r  # no new image round
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert d["fields"]["phone_number"] == "+65 6123 4567" and d["fields"]["business_website"] == "acme.co"


def test_more_info_design_change_new_round():
    sid = _client()
    tok = c.post(f"/api/staff/clients/{sid}/decision", json={"decision": "more_info",
                 "fields": ["design_preferences"]}).json()["resume_url"].split("resume=")[1]
    c.post("/api/session", json={"resumeToken": tok})
    r = c.post("/api/chat", json={"sessionId": sid, "text": "bold red and black"}).json()
    assert r["status"] == "awaiting_review" and r["round"] == 2, r


def test_rollback_invalid_decision_leaves_client_unchanged():
    sid = _client()
    before = c.get(f"/api/staff/clients/{sid}").json()
    r = c.post(f"/api/staff/clients/{sid}/decision", json={"decision": "more_info", "fields": ["not_a_field"]})
    assert r.status_code == 400
    r = c.post(f"/api/staff/clients/{sid}/decision", json={"decision": "more_info"})
    assert r.status_code == 400
    after = c.get(f"/api/staff/clients/{sid}").json()
    assert after["status"] == before["status"] and after["decisions"] == [] and after["outbox"] == []
    assert c.post("/api/session", json={"resumeToken": "bogus"}).status_code == 404
