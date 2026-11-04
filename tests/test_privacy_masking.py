"""Privacy masking (4.9.3.1) + staff original-file route: no Meta calls, keys unset."""
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.app import app, store  # noqa: E402
from src.features.chat import agent  # noqa: E402
from src.features.intake import document  # noqa: E402
from src.shared import guard, meta  # noqa: E402
from helpers import new_session, staff_client  # noqa: E402

c = staff_client(app)
anon = TestClient(app)
FIX = "tests/fixtures/acra_fake.pdf"

ADDR = "Blk 123 Ang Mo Kio Ave 3 #05-12 Singapore 560123"


@pytest.fixture(autouse=True)
def _no_meta(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("META_API_KEY", raising=False)
    assert not meta.enabled()


# --- true positives: phones -------------------------------------------------
@pytest.mark.parametrize("phone", ["+65 9123 4567", "6123-4567", "81234567"])
def test_sg_phones_masked(phone):
    out = guard.scrub_private(f"call me at {phone} thanks")
    assert "[removed]" in out and phone not in out


@pytest.mark.parametrize("phone", ["+1 (415) 555-0132", "415-555-0132", "+44 20 7946 0958"])
def test_international_phones_masked(phone):
    out = guard.scrub_private(f"call me at {phone} thanks")
    assert "[removed]" in out and phone not in out


def test_sg_address_masked():
    out = guard.scrub_private(f"Visit us at {ADDR}.")
    for fragment in ("Blk 123", "#05-12", "560123"):
        assert fragment not in out, fragment
    assert "[removed]" in out


# --- over-masking negatives: everything here must stay -----------------------
@pytest.mark.parametrize("text", [
    "Total S$1,234.50 due", "balance $888888", "dated 2026-11-04", "dated 04/11/2026",
    "Order 560123 ready", "ref INV-123456", "UEN 201912345K", "UEN T19LL0001A",
    "We like tan colours",
])
def test_negatives_untouched(text):
    assert guard.scrub_private(text) == text


# --- drop_private: drop only-phone/address, mask embedded --------------------
def test_drop_private_phone_only():
    clean, removed = guard.drop_private({"phone_number": "+65 9123 4567", "business_name": "Acme"})
    assert clean == {"business_name": "Acme"} and removed == ["phone"]


def test_drop_private_address_only():
    clean, removed = guard.drop_private({"notes": ADDR, "business_name": "Acme"})
    assert "notes" not in clean and removed == ["address"]


def test_drop_private_masks_embedded_and_keeps_rest():
    clean, removed = guard.drop_private(
        {"notes": "Call 9123 4567 please", "uen": "201912345K", "price": "S$1,234.50"})
    assert clean["notes"] == "Call [removed] please" and removed == ["phone"]
    assert clean["uen"] == "201912345K" and clean["price"] == "S$1,234.50"


# --- read paths: model copy masked, held values cleaned ----------------------
def test_doc_read_model_copy_masked(monkeypatch):
    seen = {}

    def fake(step, messages, **kw):
        seen["body"] = messages[0]["content"]
        return {}

    monkeypatch.setattr(meta, "chat_json", fake)
    document.llm_fields(f"Phone +65 9123 4567 lives at {ADDR}.")
    assert "+65 9123 4567" not in seen["body"] and "Blk 123" not in seen["body"]
    assert "[removed]" in seen["body"]


def test_read_document_drops_phone_from_form():
    out = document.read_document("Business Name: Kopi Corner\nPhone Number: +65 9876 5432\n")
    assert out["kind"] == "form"
    assert "phone_number" not in out["fields"] and out["fields"]["business_name"] == "Kopi Corner"
    assert "phone" in out["removed"]


def test_confirm_line_names_private_details():
    s = agent.new_session()
    r = agent.on_extracted(s, "d1", "acra.pdf", {"business_name": "Acme"}, ["phone"])
    assert "I left out some private details (ID, phone, address)." in r["reply"]


# --- staff original-file route: byte-identical, audit-logged -----------------
def _upload_acra(sid):
    with open(FIX, "rb") as f:
        raw = f.read()
    r = c.post("/api/upload", data={"sessionId": sid},
               files={"files[]": ("acra_fake.pdf", raw, "application/pdf")}).json()
    return raw, r["confirm"]["docId"]


def test_staff_open_original_is_identical_and_audited():
    from pathlib import Path
    sid = new_session(c)
    raw, doc_id = _upload_acra(sid)
    assert Path(store.load(sid)["docs"][doc_id]["path"]).read_bytes() == raw
    r = c.get(f"/api/staff/clients/{sid}/documents/{doc_id}")
    assert r.status_code == 200 and r.content == raw
    assert r.headers["content-type"] == "application/pdf"
    audits = c.get("/api/staff/audit", params={"client": sid}).json()
    row = next(a for a in audits if a["action"] == "document_opened")
    assert row["target"] == doc_id and row["actor"].startswith("staff:") and row["at"]
    assert row["details"]["filename"] == "acra_fake.pdf"


def test_staff_open_needs_passcode_and_handles_missing():
    from pathlib import Path
    sid = new_session(c)
    _, doc_id = _upload_acra(sid)
    assert anon.get(f"/api/staff/clients/{sid}/documents/{doc_id}").status_code == 401
    assert c.get(f"/api/staff/clients/{sid}/documents/nope").status_code == 404
    Path(store.load(sid)["docs"][doc_id]["path"]).unlink()
    assert c.get(f"/api/staff/clients/{sid}/documents/{doc_id}").status_code == 404
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert d["documents"][doc_id]["status"] == "file missing"
    assert d["documents"][doc_id]["openable"] is False
