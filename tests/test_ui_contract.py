"""UI contract (Docs/UI-API-CONTRACT.md) aliases and shapes."""
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
for _k in ("MODEL_API_KEY", "RELAY_URL", "RELAY_SECRET"):
    os.environ.pop(_k, None)

from fastapi.testclient import TestClient  # noqa: E402

import src.app as appmod  # noqa: E402
from src.shared import trace as trace_mod  # noqa: E402

client = TestClient(appmod.app)


def _reset_sink():
    try:
        trace_mod.set_sink(appmod.store.trace)
    except Exception:
        pass

FULL = {"business_name": "Acme Cafe", "contact_name": "Jo", "email": "jo@acme.example",
        "business_type": "Cafe", "industry": "F&B", "design_preferences": "minimal blue"}


def _new_session():
    r = client.post("/api/session", json={})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b.get("step") == b.get("status")
    return b["sessionId"], b["sessionSecret"], b


def _assert_reply(b):
    assert b.get("step") == b.get("status"), b
    return b


def test_x_lang_header_sets_session_lang():
    sid, secret, _ = _new_session()
    r = client.post("/api/chat", json={"sessionId": sid, "sessionSecret": secret, "text": "hello"},
                    headers={"x-lang": "zh"})
    assert r.status_code == 200, r.text
    b = _assert_reply(r.json())
    assert b["lang"] == "zh"
    s = appmod.store.load(sid)
    assert s["lang"] == "zh" and s["lang_set"] is True


def _to_review():
    sid, secret, _ = _new_session()
    r = client.post("/api/form", json={"sessionId": sid, "sessionSecret": secret, "fields": dict(FULL)})
    assert r.status_code == 200, r.text
    b = _assert_reply(r.json())
    assert b["status"] == "awaiting_review", b
    assert b["looks"] and len(b["looks"]["options"]) == 3
    for o in b["looks"]["options"]:
        assert o.get("alt") == o.get("title")
    return sid, secret, b


def test_looks_skip_x3_handoff_no_images():
    sid, secret, _ = _to_review()
    b = None
    for _ in range(3):
        r = client.post("/api/looks/skip", json={"sessionId": sid, "sessionSecret": secret})
        assert r.status_code == 200, r.text
        b = _assert_reply(r.json())
    assert b["status"] == "handed_off", b
    assert b["step"] == "handed_off"
    assert b.get("consult")
    assert not b.get("images")
    assert b.get("looks") is None


def test_looks_pick():
    sid, secret, first = _to_review()
    pid = first["looks"]["options"][0]["id"]
    r = client.post("/api/looks/pick",
                    json={"sessionId": sid, "sessionSecret": secret, "picked_ids": [pid]})
    assert r.status_code == 200, r.text
    b = _assert_reply(r.json())
    assert b["status"] == "accepted", b
    assert b["step"] == "accepted"


def _upload_acra(sid, secret):
    with open("tests/fixtures/acra_fake.pdf", "rb") as f:
        pdf = f.read()
    r = client.post("/api/upload",
                    data={"sessionId": sid, "sessionSecret": secret},
                    files=[("files", ("acra_fake.pdf", pdf, "application/pdf"))])
    assert r.status_code == 200, r.text
    return _assert_reply(r.json())


def test_extracted_confirm_saves_edits():
    sid, secret, _ = _new_session()
    b = _upload_acra(sid, secret)
    assert b["status"] == "confirm_details", b
    assert b.get("confirm") and b.get("extracted")
    assert "Tan Mei Ling" not in b["reply"]
    fields = {f["field"]: f["value"] for f in b["extracted"]}
    assert fields.get("contact_name") == "Tan Mei Ling"
    fields["contact_name"] = "Edited Name"
    fields["email"] = "edited@example.com"
    r = client.post("/api/extracted/confirm",
                    json={"sessionId": sid, "sessionSecret": secret, "fields": fields})
    assert r.status_code == 200, r.text
    b2 = _assert_reply(r.json())
    assert "Tan Mei Ling" not in b2["reply"]
    s = appmod.store.load(sid)
    assert s["fields"].get("contact_name") == "Edited Name"
    assert s["fields"].get("email") == "edited@example.com"
    docs = s.get("docs") or {}
    assert docs and all(d.get("status") == "confirmed" for d in docs.values())


def test_delete_upload_removes_pending():
    sid, secret, _ = _new_session()
    b = _upload_acra(sid, secret)
    assert b["status"] == "confirm_details"
    s = appmod.store.load(sid)
    assert (s.get("pending") or {}).get("docId")
    r = client.request("DELETE", "/api/upload", json={"sessionId": sid, "sessionSecret": secret})
    assert r.status_code == 200, r.text
    _assert_reply(r.json())
    s2 = appmod.store.load(sid)
    assert not s2.get("pending")
    assert all(d.get("status") == "removed" for d in (s2.get("docs") or {}).values())
    r2 = client.request("DELETE", "/api/upload", json={"sessionId": sid, "sessionSecret": secret})
    assert r2.status_code == 200
    assert "There's no file to remove." in r2.json()["reply"]


def test_trace_stores_listen():
    _reset_sink()
    sid, secret, _ = _new_session()
    r = client.post("/api/trace",
                    json={"sessionId": sid, "sessionSecret": secret,
                          "kind": "listen", "ok": True, "ms": 123.9})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    rows = appmod.store.traces(sid)
    assert any(t.get("step") == "listen" and t.get("model") == "browser" for t in rows)
    r2 = client.post("/api/trace",
                     json={"sessionId": sid, "sessionSecret": secret,
                           "kind": "nope", "ok": True, "ms": 1})
    assert r2.status_code == 400


def test_staff_approve_alias_and_shapes(monkeypatch):
    _reset_sink()
    monkeypatch.setenv("STAFF_PASSCODE", "ui-staff-key")
    h = {"x-staff-key": "ui-staff-key"}
    sid, secret, _ = _to_review()
    for _ in range(3):
        r = client.post("/api/looks/skip", json={"sessionId": sid, "sessionSecret": secret})
        assert r.status_code == 200
    client.post("/api/trace", json={"sessionId": sid, "sessionSecret": secret,
                                    "kind": "listen", "ok": True, "ms": 50})
    r = client.get("/api/staff/consults", headers=h)
    assert r.status_code == 200, r.text
    cards = [c for c in r.json() if c.get("client_id") == sid or c.get("session_id") == sid]
    assert cards, r.json()
    card = cards[0]
    for k in ("id", "client_id", "business_name", "status", "submitted", "next_steps", "created"):
        assert k in card, card
    cid = card["id"]
    r = client.post(f"/api/staff/consults/{cid}/approve", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"
    r = client.get(f"/api/staff/clients/{sid}/rejected-looks", headers=h)
    assert r.status_code == 200, r.text
    grouped = r.json()
    assert isinstance(grouped, list) and grouped
    rounds = [g["round"] for g in grouped]
    assert rounds == sorted(rounds)
    for g in grouped:
        assert isinstance(g.get("options"), list) and g["options"]
        for o in g["options"]:
            for k in ("id", "url", "alt", "title", "brief", "at"):
                assert k in o, o
            assert o["alt"] == o["title"]
    r = client.get(f"/api/staff/clients/{sid}", headers=h)
    assert r.status_code == 200, r.text
    detail = r.json()
    assert "traces" in detail and detail["traces"]
    t = detail["traces"][0]
    for k in ("step", "model", "ok", "ms", "cost_sgd", "at"):
        assert k in t, t
