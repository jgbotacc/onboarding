"""End-to-end API flow: upload PDF -> missing contact -> direction -> 3 rounds -> handoff."""
import os
import subprocess
import sys
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from fastapi.testclient import TestClient  # noqa: E402

from src.app import app  # noqa: E402

c = TestClient(app)


def test_flow():
    pdf = os.path.join(tempfile.mkdtemp(), "b.pdf")
    subprocess.run([sys.executable, "scripts/make_sample_pdf.py", pdf], check=True)
    sid = c.post("/api/session", json={}).json()["sessionId"]
    r = c.post("/api/upload", data={"sessionId": sid}, files={"files[]": ("b.pdf", open(pdf, "rb"), "application/pdf")}).json()
    assert r["missing"] == ["Email"], r
    r = c.post("/api/chat", json={"sessionId": sid, "text": "hello@kopicorner.example"}).json()
    assert r["status"] == "need_direction", r
    r = c.post("/api/chat", json={"sessionId": sid, "text": "warm retro kopitiam"}).json()
    assert r["status"] == "awaiting_review" and r["round"] == 1 and r["images"]
    assert c.get(r["images"][0]).status_code == 200
    for n in (2, 3):
        r = c.post("/api/review", json={"sessionId": sid, "accepted": False, "feedback": "more blue"}).json()
        assert r["round"] == n
    r = c.post("/api/review", json={"sessionId": sid, "accepted": False, "feedback": "still no"}).json()
    assert r["status"] == "handed_off", r


def test_form_with_design_preferences_generates_immediately():
    sid = c.post("/api/session", json={}).json()["sessionId"]
    r = c.post("/api/form", json={"sessionId": sid, "fields": {"business_name": "Acme", "contact_name": "Jo"}}).json()
    assert r["missing"] == ["Email"] and r["status"] == "missing_info", r
    r = c.post("/api/form", json={"sessionId": sid, "fields": {"email": "jo@acme.example", "design_preferences": "minimal blue"}}).json()
    assert r["status"] == "awaiting_review" and r["round"] == 1 and r["images"], r


def test_form_with_reference_images_uploaded_first():
    """Form path: JPGs go to /api/upload before /api/form and are kept as style refs."""
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (22, 100, 255)).save(buf, "JPEG")
    sid = c.post("/api/session", json={}).json()["sessionId"]
    r = c.post("/api/upload", data={"sessionId": sid},
               files={"files[]": ("ref.jpg", buf.getvalue(), "image/jpeg")})
    assert r.status_code == 200 and r.json()["status"] == "need_document", r.text
    r = c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.example", "design_preferences": "minimal blue"}}).json()
    assert r["status"] == "awaiting_review" and r["round"] == 1 and r["images"], r
    from src.app import store
    assert len(store.load(sid)["refs"]) == 1


def test_png_reference_upload_then_form():
    import io
    from PIL import Image
    buf = io.BytesIO(); Image.new("RGB", (64, 64), "#2563eb").save(buf, "PNG")
    sid = c.post("/api/session", json={}).json()["sessionId"]
    r = c.post("/api/upload", data={"sessionId": sid}, files={"files[]": ("ref.png", buf.getvalue(), "image/png")})
    assert r.status_code == 200, r.text
    r = c.post("/api/form", json={"sessionId": sid, "fields": {"business_name": "Acme", "contact_name": "Jo",
               "email": "jo@acme.example", "design_preferences": "minimal"}}).json()
    assert r["round"] == 1 and r["images"]
