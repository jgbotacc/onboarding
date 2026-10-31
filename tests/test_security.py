"""Staff passcode, per-session secrets, upload checks and media headers."""
import io
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from src.app import app  # noqa: E402
from helpers import new_session, resume, staff_client  # noqa: E402

c = staff_client(app)
anon = TestClient(app)
STAFF_PATHS = ["/api/staff/clients", "/api/clients", "/api/admin/clients"]
FIELDS = {"business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.co", "design_preferences": "minimal"}


def _img(fmt, **info):
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), (200, 30, 30)).save(buf, fmt, **info)
    return buf.getvalue()


def _client():
    sid = new_session(c)
    assert c.post("/api/form", json={"sessionId": sid, "fields": FIELDS}).status_code == 200
    return sid


# 1. staff passcode
def test_staff_routes_need_passcode():
    sid = _client()
    for p in STAFF_PATHS:
        assert anon.get(p).status_code == 401
        assert anon.get(p, headers={"x-staff-key": "wrong"}).status_code == 401
        assert anon.get(f"{p}/{sid}").status_code == 401
        assert anon.post(f"{p}/{sid}/decision", json={"decision": "approve"}).status_code == 401
        assert c.get(p).status_code == 200
    assert c.get(f"/api/staff/clients/{sid}").json()["status"] != "approved"  # the 401 decisions did nothing


def test_staff_routes_fail_closed_without_passcode(monkeypatch):
    monkeypatch.delenv("STAFF_PASSCODE")
    assert c.get("/api/staff/clients").status_code == 503


def test_staff_page_shell_still_loads():
    for p in ("/staff", "/review", "/admin"):
        assert anon.get(p).status_code in (200, 404)  # 404 only when no front-end build is present


# 2. no email bodies or resume links in list/detail
def test_detail_hides_email_bodies_and_resume_links():
    sid = _client()
    d = c.post(f"/api/staff/clients/{sid}/decision", json={"decision": "more_info", "fields": ["phone_number"]}).json()
    token = d["resume_url"].split("resume=")[1]
    assert "body" not in d["email"]
    for body in (c.get(f"/api/staff/clients/{sid}").text, c.get("/api/staff/clients").text):
        assert token not in body and "resume" not in body.lower().replace("_refill", "")
        assert "secret" not in body
    assert all("body" not in m for m in c.get(f"/api/staff/clients/{sid}").json()["outbox"])


# 3. session secrets
def test_session_routes_need_the_secret():
    sid = _client()
    good = c.headers["x-session-secret"]
    for h in ({}, {"x-session-secret": "wrong"}):
        assert anon.post("/api/chat", json={"sessionId": sid, "text": "hi"}, headers=h).status_code == 403
        assert anon.post("/api/form", json={"sessionId": sid, "fields": {}}, headers=h).status_code == 403
        assert anon.post("/api/review", json={"sessionId": sid, "accepted": True}, headers=h).status_code == 403
        assert anon.post("/api/upload", data={"sessionId": sid}, headers=h,
                         files={"files[]": ("a.png", _img("PNG"), "image/png")}).status_code == 403
    # body field works as well as the header
    assert anon.post("/api/chat", json={"sessionId": sid, "sessionSecret": good, "text": "hi"}).status_code == 200


def test_session_reopen_needs_secret():
    sid = _client()
    assert anon.post("/api/session", json={"sessionId": sid}).json()["sessionId"] != sid  # new session instead
    r = anon.post("/api/session", json={"sessionId": sid, "sessionSecret": c.headers["x-session-secret"]}).json()
    assert r["sessionId"] == sid and "sessionSecret" not in r


def test_resume_link_issues_new_secret():
    sid = _client()
    old = c.headers["x-session-secret"]
    tok = c.post(f"/api/staff/clients/{sid}/decision", json={"decision": "more_info",
                 "fields": ["phone_number"]}).json()["resume_url"].split("resume=")[1]
    r = resume(c, tok)
    assert r.status_code == 200 and r.json()["sessionId"] == sid and c.headers["x-session-secret"] != old
    assert anon.post("/api/chat", json={"sessionId": sid, "sessionSecret": old, "text": "x"}).status_code == 403
    assert c.post("/api/chat", json={"sessionId": sid, "text": "+65 6123 4567"}).status_code == 200


# 4. uploads
def _up(name, data, ctype):
    sid = new_session(c)
    return c.post("/api/upload", data={"sessionId": sid}, files={"files[]": (name, data, ctype)})


def test_svg_html_and_fake_images_rejected():
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    for name, data in (("x.svg", svg), ("x.html", b"<script>alert(1)</script>"), ("x.png", svg),
                       ("x.gif", _img("GIF")), ("x.jpg", b"\xff\xd8\xff not really")):
        r = _up(name, data, "image/png")
        assert r.status_code == 400 and "JPG or PNG" in r.json()["detail"], (name, r.text)


def test_fake_pdf_and_big_file_rejected():
    assert _up("x.pdf", b"<html>hi</html>", "application/pdf").status_code == 400
    r = _up("big.png", b"\x89PNG" + b"0" * (10 * 1024 * 1024 + 10), "image/png")
    assert r.status_code == 400 and "10 MB" in r.json()["detail"]


def test_images_are_reencoded_and_served_safely():
    from src.app import store
    from src.shared.config import MEDIA_DIR
    exif = Image.Exif()
    exif[0x010F] = "SecretCamera"
    sid = new_session(c)
    r = c.post("/api/upload", data={"sessionId": sid},
               files={"files[]": ("photo.JPEG.html", _img("JPEG", exif=exif.tobytes()), "text/html")})
    assert r.status_code == 200, r.text
    path = store.load(sid)["refs"][0]
    assert path.endswith(".jpg")
    assert b"SecretCamera" not in open(path, "rb").read()
    m = anon.get("/media/" + path.rsplit("/", 1)[-1])
    assert m.headers["content-type"] == "image/jpeg" and m.headers["x-content-type-options"] == "nosniff"
    assert MEDIA_DIR.exists()
