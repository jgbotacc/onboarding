"""Mismatch flags (PRD 4.9.3.2/4.9.3.3): normalisation, detail payload, read-only flags."""
import json
import os
import tempfile
import uuid

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from src.app import app, store  # noqa: E402
from src.features.intake import compare  # noqa: E402
from src.shared import meta  # noqa: E402
from helpers import new_session, staff_client  # noqa: E402

c = staff_client(app)
FIX = "tests/fixtures/acra_fake.pdf"


@pytest.fixture(autouse=True)
def _no_meta(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("META_API_KEY", raising=False)
    assert not meta.enabled()


def _docs(snapshot, filename="acra.pdf", status="confirmed"):
    return {"d1": {"filename": filename, "status": status,
                   "path": "tests/fixtures/acra_fake.pdf", "fields": dict(snapshot)}}


# --- normalisation: suffix and punctuation variants must not flag -----------------
@pytest.mark.parametrize("intake,document", [
    ("ABC Pte Ltd", "ABC Private Limited"),
    ("ABC PTE. LTD.", "abc pte ltd"),
    ("ABC Pte Ltd", "abc  pte   ltd"),
    ("Kopi Corner, Pte Ltd", "kopi corner pte ltd"),
    ("Lumen Kopi PTE. LTD.", "LUMEN KOPI PRIVATE LIMITED"),
    ("ABC Ltd", "ABC Limited"),
])
def test_name_variants_do_not_flag(intake, document):
    docs = _docs({"business_name": document, "uen": "202498765K",
                  "registered_address": "8 Example Road"})
    assert compare.mismatch_flags({"business_name": intake, "uen": "202498765K",
                                   "registered_address": "8 Example Road"}, docs) == []


@pytest.mark.parametrize("field,intake,document", [
    ("uen", "202498765k", "202498765K"),
    ("uen", "2024 98765K", "202498765K"),
    ("registered_address", "8 Example Road, #02-15, Singapore 098765",
     "8 example road #02-15 singapore 098765"),
    ("registered_address", "8 EXAMPLE ROAD #02-15", "8 Example Road, #02-15"),
])
def test_uen_and_address_variants_do_not_flag(field, intake, document):
    docs = _docs({"business_name": "Acme", field: document})
    fields = {"business_name": "Acme", field: intake}
    assert compare.mismatch_flags(fields, docs) == []


# --- real differences must flag ------------------------------------------------------------------
def test_different_uen_flags():
    intake_uen, doc_uen = _uen(), _uen()
    out = compare.mismatch_flags({"uen": intake_uen},
                                 _docs({"uen": doc_uen}, filename="acra.pdf"))
    assert out == [{"field": "uen", "intake": intake_uen,
                   "document": doc_uen, "source": "acra.pdf"}]


def test_different_street_flags():
    out = compare.mismatch_flags(
        {"registered_address": "8 Sample Road, #02-15, Singapore 098765"},
        _docs({"registered_address": "8 Example Road, #02-15, Singapore 098765"}))
    assert len(out) == 1 and out[0]["field"] == "registered_address"
    assert out[0]["source"] == "acra.pdf"


def test_different_name_flags():
    out = compare.mismatch_flags({"business_name": "Lumen Tea Pte Ltd"},
                                 _docs({"business_name": "Lumen Kopi Pte Ltd"}))
    assert len(out) == 1 and out[0]["field"] == "business_name"


def test_empty_either_side_never_flags():
    docs = _docs({"business_name": "Acme", "uen": "202498765K"})
    assert compare.mismatch_flags({"business_name": "", "uen": "202498765K"}, docs) == []
    assert compare.mismatch_flags({"business_name": "Acme"}, _docs({})) == []
    assert compare.mismatch_flags({"business_name": "Acme"}, {}) == []


def test_only_confirmed_snapshots_count_and_latest_wins():
    old_uen, new_uen = _uen(), _uen()
    docs = {
        "d1": {"filename": "old.pdf", "status": "confirmed", "fields": {"uen": old_uen}},
        "d2": {"filename": "new.pdf", "status": "confirmed", "fields": {"uen": new_uen}},
        "d3": {"filename": "gone.pdf", "status": "removed", "fields": {"uen": _uen()}},
    }
    out = compare.mismatch_flags({"uen": new_uen}, docs)
    assert out == []  # latest confirmed snapshot agrees; removed doc ignored
    out = compare.mismatch_flags({"uen": old_uen}, docs)
    assert out == [{"field": "uen", "intake": old_uen,
                   "document": new_uen, "source": "new.pdf"}]


# --- detail payload through the real API ----------------------------------------------------------
def _uen():
    """Uuid-derived UEN, unique to this run.

    The suite shares one store, and the cross-client outbound guard masks any
    UEN another session already holds: a fixed literal collides with stale
    sessions from other tests (or earlier runs), making the suite
    order-dependent. A fresh uuid per test cannot collide.
    """
    return "U" + uuid.uuid4().hex[:8].upper() + "K"


def _acra_pdf_bytes(uen, name="LUMEN KOPI PTE. LTD."):
    """Minimal ACRA-style PDF with this test's own UEN."""
    import io
    from reportlab.pdfgen import canvas
    lines = ["ACCOUNTING AND CORPORATE REGULATORY AUTHORITY",
             f"Business Profile (Company) of {name} ({uen})",
             "", "Entity Information", f"UEN : {uen}", f"Name : {name}",
             "Type : EXEMPT PRIVATE COMPANY LIMITED BY SHARES", "Status : LIVE COMPANY",
             "", "Registered Office Address : 8 EXAMPLE ROAD, #02-15, SINGAPORE (098765)"]
    buf = io.BytesIO()
    page = canvas.Canvas(buf)
    for i, t in enumerate(lines):
        page.drawString(72, 760 - i * 24, t)
    page.save()
    return buf.getvalue()


def _confirm_acra(sid, doc_uen, edit_uen=None):
    """Confirm a generated ACRA doc; a UEN override counts as the client's own edit."""
    raw = _acra_pdf_bytes(doc_uen)
    r = c.post("/api/upload", data={"sessionId": sid},
               files={"files[]": ("acra_fake.pdf", raw, "application/pdf")}).json()
    assert r["status"] == "confirm_details", r
    doc_id = r["confirm"]["docId"]
    fields = {f["field"]: f["value"] for f in r["extracted"]}
    assert fields["uen"] == doc_uen, fields
    if edit_uen is not None:
        fields["uen"] = edit_uen
    r = c.post("/api/extracted/confirm",
               json={"sessionId": sid, "fields": fields}).json()
    return doc_id


def test_confirm_freezes_snapshot_and_detail_reports_no_flags():
    doc_uen = _uen()
    sid = new_session(c)
    doc_id = _confirm_acra(sid, doc_uen)
    snap = store.load(sid)["docs"][doc_id]
    assert snap["status"] == "confirmed" and snap["confirmed_at"]
    assert snap["fields"]["business_name"] == "Lumen Kopi PTE. LTD."
    assert snap["fields"]["uen"] == doc_uen
    assert "registered_address" in snap["fields"]
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert d["mismatch_flags"] == []
    assert d["documents"][doc_id]["filename"] == "acra_fake.pdf"
    assert d["documents"][doc_id]["openable"] is True


def test_diverged_intake_shows_flags_in_detail():
    doc_uen, edit_uen = _uen(), _uen()
    sid = new_session(c)
    c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "Lumen Tea Pte Ltd", "contact_name": "Mei Ling",
        "email": "mei@lumentea.example"}}).json()
    _confirm_acra(sid, doc_uen, edit_uen)  # client asserts their own UEN at confirm
    d = c.get(f"/api/staff/clients/{sid}").json()
    by_field = {f["field"]: f for f in d["mismatch_flags"]}
    assert set(by_field) == {"business_name", "uen"}
    assert by_field["business_name"]["document"] == "Lumen Kopi PTE. LTD."
    assert by_field["business_name"]["source"] == "acra_fake.pdf"
    assert by_field["uen"] == {"field": "uen", "intake": edit_uen,
                              "document": doc_uen, "source": "acra_fake.pdf"}


def test_real_flow_form_then_doc_then_edit_flags_only_uen():
    """Real flow: form answers, then a doc with a different UEN and a suffix-only
    name difference, then confirm with an edit. The doc snapshot must freeze what
    the document said (pre-edit) and compare against the client-given intake, so
    exactly one UEN flag fires and the suffix-only name never flags."""
    sid = new_session(c)
    r = c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "Lumen Kopi Pte Ltd", "contact_name": "Mei Ling",
        "email": "mei@lumenkopi.example"}}).json()
    assert r["status"] in ("need_direction", "missing_info", "awaiting_review"), r
    raw = _acra_pdf_bytes(doc_uen := _uen())
    r = c.post("/api/upload", data={"sessionId": sid},
               files={"files[]": ("acra.pdf", raw, "application/pdf")}).json()
    assert r["status"] == "confirm_details", r
    extracted = {f["field"]: f["value"] for f in r["extracted"]}
    assert extracted["uen"] == doc_uen, extracted
    client_uen = _uen()
    given = dict(extracted)
    given["uen"] = client_uen  # client asserts their own UEN at confirm
    given["business_name"] = "Lumen Kopi Private Limited"  # suffix-only edit, still the same name
    c.post("/api/extracted/confirm", json={"sessionId": sid, "fields": given}).json()
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert d["mismatch_flags"] == [{"field": "uen", "intake": client_uen,
                                   "document": doc_uen, "source": "acra.pdf"}]


FIX_ADDR_REAL = "8 Example Road, #02-15, Singapore (098765)"  # parse_acra value, pre-mask
FIX_ADDR_TYPED = "8 Example Road, #02-15, Singapore 098765"  # how a client types the same address


def _confirm_acra_with_address(sid, address):
    """Upload the real ACRA fixture and confirm with this address as the client's own edit."""
    with open(FIX, "rb") as f:
        raw = f.read()
    r = c.post("/api/upload", data={"sessionId": sid},
               files={"files[]": ("acra_fake.pdf", raw, "application/pdf")}).json()
    assert r["status"] == "confirm_details", r
    doc_id = r["confirm"]["docId"]
    payload = {f["field"]: f["value"] for f in r["extracted"]}
    joined = json.dumps(payload)
    assert "EXAMPLE ROAD" not in joined and "Example Road" not in joined, payload
    payload["registered_address"] = address
    c.post("/api/extracted/confirm", json={"sessionId": sid, "fields": payload}).json()
    return doc_id


def test_same_address_as_fixture_does_not_flag():
    sid = new_session(c)
    c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "Lumen Kopi Pte. Ltd.", "contact_name": "Mei Ling",
        "email": "mei@lumenkopi.example"}}).json()
    doc_id = _confirm_acra_with_address(sid, FIX_ADDR_TYPED)
    snap = store.load(sid)["docs"][doc_id]
    assert snap["fields"]["registered_address"] == FIX_ADDR_REAL
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert [f for f in d["mismatch_flags"] if f["field"] == "registered_address"] == []


def test_different_street_flags_with_real_document_value():
    sid = new_session(c)
    c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "Lumen Kopi Pte. Ltd.", "contact_name": "Mei Ling",
        "email": "mei@lumenkopi.example"}}).json()
    _confirm_acra_with_address(sid, "9 Sample Road, #02-15, Singapore 098765")
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert [f for f in d["mismatch_flags"] if f["field"] == "registered_address"] == [
        {"field": "registered_address",
         "intake": "9 Sample Road, #02-15, Singapore 098765",
         "document": FIX_ADDR_REAL, "source": "acra_fake.pdf"}]


def test_flags_never_change_the_session():
    doc_uen, edit_uen = _uen(), _uen()
    sid = new_session(c)
    _confirm_acra(sid, doc_uen, edit_uen)  # client edit at confirm forces a flag
    s = store.load(sid)
    assert s["intake"]["uen"] == edit_uen
    before = json.dumps(store.load(sid), sort_keys=True, default=str)
    for _ in range(2):
        d = c.get(f"/api/staff/clients/{sid}").json()
        assert len(d["mismatch_flags"]) == 1
    after = json.dumps(store.load(sid), sort_keys=True, default=str)
    assert before == after
