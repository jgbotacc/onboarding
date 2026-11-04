"""Staff review: approve, reject, more_info + resume, and a rollback case."""
import io
import os
import tempfile
import zipfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from fastapi.testclient import TestClient  # noqa: E402

from src.app import app  # noqa: E402
from helpers import new_session, resume, staff_client  # noqa: E402
from src.shared import security  # noqa: E402
from src.shared.config import MEDIA_DIR, notify_email_to  # noqa: E402

c = staff_client(app)
BASE = {"business_name": "Acme Cafe", "contact_name": "Jo", "email": "jo@acme.example", "industry": "F&B"}


def _body(sid):
    from src.app import store
    return store.load(sid)["outbox"][-1]["body"]


def _client(extra=None):
    sid = new_session(c)
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
    assert d["status"] == "approved" and d["email"]["to"] == notify_email_to() == "ops@example.com"
    assert "operations team will get in contact" in _body(sid)
    assert "Client email on file: jo@acme.example" in _body(sid)
    assert d["email"]["status"].startswith("Sent")


def test_reject():
    sid = _client()
    d = c.post(f"/api/staff/clients/{sid}/decision", json={"decision": "reject", "note": "Out of area"}).json()
    assert d["status"] == "rejected" and "unable to proceed" in _body(sid)


def test_more_info_resume_flow():
    sid = _client()
    d = c.post(f"/api/staff/clients/{sid}/decision",
               json={"decision": "more_info", "fields": ["phone_number", "business_website"], "note": "Need these"}).json()
    assert d["status"] == "needs_info" and "?resume=" in d["resume_url"] and "Phone number" in _body(sid)
    token = d["resume_url"].split("resume=")[1]
    r = resume(c, token).json()
    assert r["sessionId"] == sid and r["missing"] == ["Phone number", "Business website"]
    g = c.get(f"/api/resume/{token}").json()
    assert g["fields_to_refill"] == ["phone_number", "business_website"] and g["note"] == "Need these"
    r = c.post("/api/chat", json={"sessionId": sid, "text": "+65 6123 4567"}).json()
    assert r["missing"] == ["Business website"], r
    r = c.post("/api/chat", json={"sessionId": sid, "text": "acme.co"}).json()
    assert r["status"] == "pending_review" and r["round"] == 1, r  # no new image round
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert d["fields"]["phone_number"] == "+65 6123 4567" and d["fields"]["business_website"] == "acme.co"


def test_more_info_design_change_new_round():
    sid = _client()
    tok = c.post(f"/api/staff/clients/{sid}/decision", json={"decision": "more_info",
                 "fields": ["design_preferences"]}).json()["resume_url"].split("resume=")[1]
    resume(c, tok)
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
    assert resume(c, "bogus").status_code == 404


def test_send_to_designers():
    """POST /api/staff/clients/:id/send-to-designers: timestamp + audit row, idempotent, no emails."""
    sid = _client()
    before = c.get(f"/api/staff/clients/{sid}").json()
    assert before.get("sent_to_designers_at") in (None, "")
    row0 = next(r for r in c.get("/api/staff/clients").json() if r["id"] == sid)
    assert row0.get("sent_to_designers_at") in (None, "")
    audits0 = [a for a in before["audit"] if a.get("action") == "sent_to_designers"]

    r = c.post(f"/api/staff/clients/{sid}/send-to-designers")
    assert r.status_code == 200, r.text
    ts = r.json()["sent_to_designers_at"]
    assert isinstance(ts, str) and ts.strip()

    d = c.get(f"/api/staff/clients/{sid}").json()
    assert d["sent_to_designers_at"] == ts
    row = next(x for x in c.get("/api/staff/clients").json() if x["id"] == sid)
    assert row["sent_to_designers_at"] == ts
    sent = [a for a in d["audit"] if a.get("action") == "sent_to_designers"]
    assert len(sent) == len(audits0) + 1
    assert d["outbox"] == before["outbox"] == []  # no emails
    assert d["status"] == before["status"]  # status untouched

    r2 = c.post(f"/api/staff/clients/{sid}/send-to-designers")
    assert r2.status_code == 200 and r2.json()["sent_to_designers_at"] == ts
    d2 = c.get(f"/api/staff/clients/{sid}").json()
    assert len([a for a in d2["audit"] if a.get("action") == "sent_to_designers"]) == len(sent)

    assert c.post("/api/staff/clients/bogus/send-to-designers").status_code == 404


def test_case_view_contract():
    """Case view inputs: detail carries everything buildCase needs, no new endpoint."""
    sid = _client()
    d = c.get(f"/api/staff/clients/{sid}").json()
    for key in ("transcript", "looks", "audit", "documents", "traces", "consult"):
        assert key in d, key
    g = c.get(f"/api/staff/clients/{sid}/studio").json()
    assert "drafts" in g


def _png(color=(180, 40, 40)):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), color).save(buf, "PNG")
    return buf.getvalue()


def _sent(tag=None):
    """A client handed off to designers."""
    sid = _client({"requirements_notes": f"Designer case {tag}"} if tag else None)
    r = c.post(f"/api/staff/clients/{sid}/send-to-designers")
    assert r.status_code == 200, r.text
    return sid


def test_designer_list_rows():
    sid = _sent("x")
    other = _client({"business_name": "Not Sent Co"})
    rows = c.get("/api/staff/designer").json()
    ids = [r["id"] for r in rows]
    assert sid in ids and other not in ids
    row = next(r for r in rows if r["id"] == sid)
    assert row["business_name"] == "Acme Cafe"
    for key in ("business_type", "industry", "design_preferences", "requirements_notes",
                "brand_colours", "chosen_look", "final_images", "final_status",
                "sent_to_designers_at"):
        assert key in row, key
    assert row["final_images"] == [] and row["final_status"] == "Pending final edit"
    assert isinstance(row["chosen_look"], str)


def test_designer_pending_sorts_first():
    a = _sent("a")
    b = _sent("b")
    c.post(f"/api/staff/clients/{a}/final-images",
           files=[("files", ("a.png", _png(), "image/png"))])
    rows = c.get("/api/staff/designer").json()
    pos = {r["id"]: i for i, r in enumerate(rows)}
    assert pos[b] < pos[a]  # pending before done
    assert next(r for r in rows if r["id"] == a)["final_status"] == "Done"


def test_designer_download_zip():
    from src.app import store
    sid = _sent("z")
    name = f"zip-look-{sid}.png"
    (MEDIA_DIR / name).write_bytes(_png())
    store.add_looks(sid, 1, [{"id": "lk-zip", "url": f"/media/{name}",
                              "title": "Zip look", "brief": "Zip brief"}])
    store.add_looks(sid, 1, [{"id": "lk-gone", "url": "/media/no-such-file.png",
                              "title": "Gone", "brief": "Gone"}])
    r = c.get(f"/api/staff/clients/{sid}/images.zip")
    assert r.status_code == 200, r.text
    assert "zip" in r.headers["content-type"]
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert name in names and "no-such-file.png" not in names
    assert c.get("/api/staff/clients/bogus/images.zip").status_code == 404


def test_designer_upload_finals():
    from src.app import store
    sid = _sent("f")
    r = c.post(f"/api/staff/clients/{sid}/final-images",
               files=[("files", ("a.png", _png((10, 80, 160)), "image/png")),
                      ("files", ("b.png", _png((160, 80, 10)), "image/png"))])
    assert r.status_code == 200, r.text
    urls = r.json()["final_images"]
    assert len(urls) == 2 and all(u.startswith("/media/final-") for u in urls)
    assert all((MEDIA_DIR / u.rsplit("/", 1)[-1]).is_file() for u in urls)
    assert store.load(sid)["final_images"] == urls
    audits = [a for a in store.audit_log(sid) if a.get("action") == "final_images_uploaded"]
    assert len(audits) == 1
    row = next(r for r in c.get("/api/staff/designer").json() if r["id"] == sid)
    assert row["final_images"] == urls and row["final_status"] == "Done"


def test_designer_upload_rejects_bad_files():
    sid = _sent("g")
    r = c.post(f"/api/staff/clients/{sid}/final-images",
               files=[("files", ("a.txt", b"not an image", "text/plain"))])
    assert r.status_code == 400
    big = b"\xff" * (security.MAX_FILE_BYTES + 1)
    r = c.post(f"/api/staff/clients/{sid}/final-images",
               files=[("files", ("big.png", big, "image/png"))])
    assert r.status_code == 400
    many = [("files", (f"{i}.png", _png(), "image/png")) for i in range(11)]
    assert c.post(f"/api/staff/clients/{sid}/final-images", files=many).status_code == 400
    assert c.post("/api/staff/clients/bogus/final-images",
                  files=[("files", ("a.png", _png(), "image/png"))]).status_code == 404


def test_designer_routes_require_passcode():
    anon = TestClient(app)
    sid = _sent("h")
    assert anon.get("/api/staff/designer").status_code == 401
    assert anon.get(f"/api/staff/clients/{sid}/images.zip").status_code == 401
    assert anon.post(f"/api/staff/clients/{sid}/final-images",
                     files=[("files", ("a.png", _png(), "image/png"))]).status_code == 401


DESIGNER_KEY = "test-designer-key"
anon = TestClient(app)


def _designer_client():
    from fastapi.testclient import TestClient  # local import keeps module import order stable
    return TestClient(app, headers={"x-staff-key": DESIGNER_KEY})


def test_role_route_returns_role(monkeypatch):
    monkeypatch.setenv("DESIGNER_PASSCODE", DESIGNER_KEY)
    assert c.get("/api/staff/role").json() == {"role": "staff"}
    assert _designer_client().get("/api/staff/role").json() == {"role": "designer"}
    assert anon.get("/api/staff/role").status_code == 401
    assert anon.get("/api/staff/role", headers={"x-staff-key": "wrong"}).status_code == 401


def test_designer_reaches_designer_routes(monkeypatch):
    monkeypatch.setenv("DESIGNER_PASSCODE", DESIGNER_KEY)
    d = _designer_client()
    sid = _sent("roles-ok")
    rows = d.get("/api/staff/designer")
    assert rows.status_code == 200, rows.text
    assert any(r["id"] == sid for r in rows.json())
    assert d.get(f"/api/staff/clients/{sid}/images.zip").status_code == 200
    r = d.post(f"/api/staff/clients/{sid}/final-images",
               files=[("files", ("a.png", _png(), "image/png"))])
    assert r.status_code == 200, r.text


def test_designer_refused_on_staff_routes(monkeypatch):
    monkeypatch.setenv("DESIGNER_PASSCODE", DESIGNER_KEY)
    d = _designer_client()
    sid = _sent("roles-no")
    assert d.get("/api/staff/clients").status_code == 403
    assert d.get(f"/api/staff/clients/{sid}").status_code == 403
    assert d.post(f"/api/staff/clients/{sid}/decision",
                 json={"decision": "approve"}).status_code == 403
    assert d.post(f"/api/staff/clients/{sid}/send-to-designers").status_code == 403


def test_wrong_key_rejected_on_role_and_designer_routes():
    bad = TestClient(app, headers={"x-staff-key": "wrong"})
    assert bad.get("/api/staff/role").status_code == 401
    assert bad.get("/api/staff/designer").status_code == 401
    assert bad.get("/api/staff/clients").status_code == 401


def test_designer_key_fails_without_designer_passcode(monkeypatch):
    monkeypatch.delenv("DESIGNER_PASSCODE", raising=False)
    d = _designer_client()
    assert d.get("/api/staff/role").status_code == 401
    assert d.get("/api/staff/designer").status_code == 401


def test_role_and_designer_fail_closed_without_passcodes(monkeypatch):
    monkeypatch.delenv("STAFF_PASSCODE", raising=False)
    monkeypatch.delenv("DESIGNER_PASSCODE", raising=False)
    assert c.get("/api/staff/role").status_code == 503
    assert c.get("/api/staff/designer").status_code == 503


def test_used_resume_token_returns_410():
    sid = _client()
    tok = c.post(f"/api/staff/clients/{sid}/decision", json={"decision": "more_info",
                 "fields": ["phone_number"]}).json()["resume_url"].split("resume=")[1]
    assert resume(c, tok).status_code == 200
    assert resume(c, tok).status_code == 200  # reload before submit is fine
    c.post("/api/chat", json={"sessionId": sid, "text": "+65 6000 0000"})
    r = resume(c, tok)
    assert r.status_code == 410 and "already been used" in r.json()["detail"]
    assert c.get(f"/api/resume/{tok}").status_code == 410
