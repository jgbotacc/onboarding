"""Mismatch flags (PRD 4.9.3.2/4.9.3.3): normalisation, detail payload, read-only flags."""
import json
import os
import tempfile

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
    out = compare.mismatch_flags({"uen": "202400001A"},
                                 _docs({"uen": "202498765K"}, filename="acra.pdf"))
    assert out == [{"field": "uen", "intake": "202400001A",
                   "document": "202498765K", "source": "acra.pdf"}]


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
    docs = {
        "d1": {"filename": "old.pdf", "status": "confirmed", "fields": {"uen": "202400001A"}},
        "d2": {"filename": "new.pdf", "status": "confirmed", "fields": {"uen": "202400002B"}},
        "d3": {"filename": "gone.pdf", "status": "removed", "fields": {"uen": "202499999Z"}},
    }
    out = compare.mismatch_flags({"uen": "202400002B"}, docs)
    assert out == []  # latest confirmed snapshot agrees; removed doc ignored
    out = compare.mismatch_flags({"uen": "202400001A"}, docs)
    assert out == [{"field": "uen", "intake": "202400001A",
                   "document": "202400002B", "source": "new.pdf"}]


# --- detail payload through the real API ----------------------------------------------------------
def _confirm_acra(sid, uen):
    """Confirm the ACRA fixture, overriding the UEN with a session-unique value.

    The cross-client outbound guard masks a UEN another session already holds,
    so each test uses its own UEN to keep the suite order-independent.
    """
    with open(FIX, "rb") as f:
        raw = f.read()
    r = c.post("/api/upload", data={"sessionId": sid},
               files={"files[]": ("acra_fake.pdf", raw, "application/pdf")}).json()
    assert r["status"] == "confirm_details", r
    doc_id = r["confirm"]["docId"]
    fields = {f["field"]: f["value"] for f in r["extracted"]}
    fields["uen"] = uen
    r = c.post("/api/extracted/confirm",
               json={"sessionId": sid, "fields": fields}).json()
    return doc_id


def test_confirm_freezes_snapshot_and_detail_reports_no_flags():
    sid = new_session(c)
    doc_id = _confirm_acra(sid, "202400001A")
    snap = store.load(sid)["docs"][doc_id]
    assert snap["status"] == "confirmed" and snap["confirmed_at"]
    assert snap["fields"]["business_name"] == "Lumen Kopi PTE. LTD."
    assert snap["fields"]["uen"] == "202400001A"
    assert "registered_address" in snap["fields"]
    d = c.get(f"/api/staff/clients/{sid}").json()
    assert d["mismatch_flags"] == []
    assert d["documents"][doc_id]["filename"] == "acra_fake.pdf"
    assert d["documents"][doc_id]["openable"] is True


def test_diverged_intake_shows_flags_in_detail():
    sid = new_session(c)
    _confirm_acra(sid, "202400002B")
    s = store.load(sid)
    s["fields"]["business_name"] = "Lumen Tea Pte Ltd"  # client corrected the name after confirming
    s["fields"]["uen"] = "202400003C"
    store.save(s)
    d = c.get(f"/api/staff/clients/{sid}").json()
    by_field = {f["field"]: f for f in d["mismatch_flags"]}
    assert set(by_field) == {"business_name", "uen"}
    assert by_field["business_name"]["document"] == "Lumen Kopi PTE. LTD."
    assert by_field["business_name"]["source"] == "acra_fake.pdf"
    assert by_field["uen"] == {"field": "uen", "intake": "202400003C",
                              "document": "202400002B", "source": "acra_fake.pdf"}


def test_flags_never_change_the_session():
    sid = new_session(c)
    _confirm_acra(sid, "202400004D")
    s = store.load(sid)
    s["fields"]["uen"] = "202400005E"  # force a flag
    store.save(s)
    before = json.dumps(store.load(sid), sort_keys=True, default=str)
    for _ in range(2):
        d = c.get(f"/api/staff/clients/{sid}").json()
        assert len(d["mismatch_flags"]) == 1
    after = json.dumps(store.load(sid), sort_keys=True, default=str)
    assert before == after
