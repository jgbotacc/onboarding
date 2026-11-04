"""Brand board: validation, model read (mocked), approve-gated brief, stores, routes (no network)."""
import io
import json
import os
import tempfile
import uuid

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from src.app import app, store  # noqa: E402
from src.data.store import SqliteStore  # noqa: E402
from src.features.brandboard import board  # noqa: E402
from src.features.looks.brief import design_context  # noqa: E402
from src.shared.config import MEDIA_DIR  # noqa: E402
from helpers import new_session  # noqa: E402

STAFF = {"x-staff-key": os.environ["STAFF_PASSCODE"], "x-staff-name": "Board QA"}
c = TestClient(app, headers=dict(STAFF))

GOOD = {"colours": ["#A63D2F", "#F3E6D3", "#2F6B45"], "tone_words": ["warm", "welcoming"],
        "style_words": ["retro", "minimal"], "summary": "Warm retro look in red and cream."}


def _png(seed=0, size=(800, 600)):
    import random
    rnd = random.Random(seed)
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(0, size[1], 4):
        for x in range(0, size[0], 4):
            c = (rnd.randrange(256), rnd.randrange(256), rnd.randrange(256))
            for dy in range(4):
                for dx in range(4):
                    px[x + dx, y + dy] = c
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _media_url():
    name = f"brand-{uuid.uuid4().hex}.jpg"
    Image.new("RGB", (300, 300), (150, 90, 60)).save(MEDIA_DIR / name)
    return f"/media/{name}"


# --- validation ---

def test_validate_board_ok_uppercases_hex():
    out = board.validate_board(dict(GOOD, colours=["#a63d2f", "#f3e6d3", "#2f6b45"]))
    assert out and out["colours"] == ["#A63D2F", "#F3E6D3", "#2F6B45"]


def test_validate_board_junk():
    assert board.validate_board({}) is None
    assert board.validate_board(dict(GOOD, colours=["red", "blue"])) is None
    assert board.validate_board(dict(GOOD, colours=["#A63D2F"])) is None  # too few
    assert board.validate_board(dict(GOOD, tone_words=["only-one"])) is None
    assert board.validate_board(dict(GOOD, summary="")) is None
    assert board.validate_board(dict(GOOD, summary="x" * 301)) is None
    assert board.validate_board(dict(GOOD, tone_words=["way too many words in one phrase here"])) is None
    assert board.validate_board("junk") is None


# --- read_board with mocked model ---

def _mock_meta(monkeypatch, replies, parts_ok=True):
    calls = []
    def fake_chat(kind, messages, session_id=None, timeout=90):
        calls.append(kind)
        return dict(replies.pop(0)) if replies else None
    monkeypatch.setattr(board.meta, "chat_json", fake_chat)
    if parts_ok:
        monkeypatch.setattr(board.meta, "image_part", lambda p, max_side=1024: {"type": "image"})
    else:
        def boom(p, max_side=1024):
            raise RuntimeError("bad bytes")
        monkeypatch.setattr(board.meta, "image_part", boom)
    monkeypatch.setattr(board.studio, "own_identifiers", lambda fields: set())
    return calls


def test_read_board_returns_validated(monkeypatch):
    calls = _mock_meta(monkeypatch, [dict(GOOD)])
    out = board.read_board([b"img-bytes"], {}, None, session_id="c1")
    assert out["colours"] == GOOD["colours"] and out["summary"] == GOOD["summary"]
    assert calls == ["brand_board"]


def test_read_board_retries_once_on_junk(monkeypatch):
    calls = _mock_meta(monkeypatch, [{"colours": ["junk"]}, dict(GOOD)])
    out = board.read_board([b"img-bytes"], {}, None)
    assert out["tone_words"] == GOOD["tone_words"]
    assert calls == ["brand_board", "brand_board"]  # one immediate retry


def test_read_board_gives_empty_on_double_junk(monkeypatch):
    calls = _mock_meta(monkeypatch, [{"colours": ["junk"]}, {"nope": True}])
    assert board.read_board([b"img-bytes"], {}, None) == {}
    assert calls == ["brand_board", "brand_board"]


def test_read_board_empty_photos_no_model_call(monkeypatch):
    calls = _mock_meta(monkeypatch, [dict(GOOD)])
    assert board.read_board([], {}, None) == {}
    assert calls == []


def test_read_board_scrubs_own_identifiers(monkeypatch):
    fields = {"business_website": "https://shop-xyz.example"}
    got = dict(GOOD, summary="Lovely look, visit https://shop-xyz.example today")
    _mock_meta(monkeypatch, [got])
    out = board.read_board([b"img-bytes"], fields, None)
    assert out == {} or "shop-xyz.example" not in out.get("summary", "")


# --- approve gates the brief ---

def test_design_context_only_approved_board():
    fields = {"business_name": "Kopi Corner", "email": "mei@example.com",
              "design_preferences": "warm minimal"}
    ctx = design_context(fields, "warm", None)
    assert "brand_board" not in ctx and "email" not in ctx
    pending = dict(GOOD, status="pending_review", photos=["/media/b.jpg"])
    assert "brand_board" not in design_context(fields, "warm", None, pending)
    approved = dict(GOOD, status="approved", photos=["/media/b.jpg"])
    ctx2 = design_context(fields, "warm", None, approved)
    assert ctx2["brand_board"]["colours"] == GOOD["colours"]
    assert ctx2["brand_board"]["summary"] == GOOD["summary"]
    assert set(ctx2["brand_board"]) == {"colours", "tone", "style", "summary"}


# --- sqlite store ---

def test_sqlite_store_save_get_roundtrip(tmp_path):
    st = SqliteStore(tmp_path / "bb.sqlite3")
    assert st.get_brand_board("c9") is None
    saved = st.save_brand_board("c9", dict(GOOD, photos=["/media/a.jpg"],
                                           status="pending_review", approved_by=None,
                                           decided_at=None, note=None))
    assert saved["version"] == 1 and saved["status"] == "pending_review"
    got = st.get_brand_board("c9")
    assert got["colours"] == GOOD["colours"] and got["photos"] == ["/media/a.jpg"]
    saved2 = st.save_brand_board("c9", dict(saved, status="approved",
                                            approved_by="staff:qa", version=saved["version"]))
    assert saved2["status"] == "approved" and saved2["version"] == 1


# --- neo4j parity (fake transport, no live database) ---

def test_neo4j_board_one_statement_and_row(tmp_path):
    from src.data.neo4j_store import Neo4jStore
    seen = []
    canned = {"session_id": "c1", "version": 3, "colours": json.dumps(GOOD["colours"]),
              "tone_words": json.dumps(GOOD["tone_words"]),
              "style_words": json.dumps(GOOD["style_words"]), "summary": GOOD["summary"],
              "photos": json.dumps(["/media/a.jpg"]), "status": "approved",
              "approved_by": "staff:qa", "decided_at": "2026-11-04T00:00:00+00:00",
              "note": None, "created_at": "2026-11-04T00:00:00+00:00",
              "updated_at": "2026-11-04T00:00:00+00:00"}
    st = Neo4jStore.__new__(Neo4jStore)
    def fake_run(q, **p):
        seen.append((q, p))
        return [dict(canned)]
    st._run = fake_run
    out = st.save_brand_board("c1", dict(GOOD, photos=["/media/a.jpg"], status="approved"))
    assert len(seen) == 1 and "HAS_BOARD" in seen[0][0]
    assert out["colours"] == GOOD["colours"] and out["version"] == 3
    out2 = st.get_brand_board("c1")
    assert len(seen) == 2 and out2["status"] == "approved"


# --- routes ---

def _client_sid():
    sid = new_session(c)
    fields = {"business_name": "Board Bakery", "contact_name": "Mei Lin Tan",
              "email": "mei-board@example.com", "phone_number": "+65 8123 8654"}
    assert c.post("/api/form", json={"sessionId": sid, "fields": fields}).status_code == 200
    return sid


def _upload(sid, n=2):
    files = [("files", (f"s{i}.png",  _png(i), "image/png")) for i in range(n)]
    return c.post("/api/brand-board/photos", data={"sessionId": sid}, files=files)


def test_client_photos_upload_and_get(monkeypatch):
    sid = _client_sid()
    monkeypatch.setattr(board, "read_board", lambda *a, **k: dict(GOOD))
    r = _upload(sid)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["board"]["status"] == "pending_review"
    assert len(body["photos"]) == 2 and all(u.startswith("/media/brand-") for u in body["photos"])
    g = c.get("/api/brand-board", params={"sessionId": sid})
    assert g.status_code == 200 and g.json()["board"]["summary"] == GOOD["summary"]


def test_client_photos_junk_output_still_pending(monkeypatch):
    sid = _client_sid()
    monkeypatch.setattr(board, "read_board", lambda *a, **k: {})
    r = _upload(sid)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["board"]["colours"] == [] and body["board"]["status"] == "pending_review"


def test_client_photos_validation():
    sid = _client_sid()
    r = c.post("/api/brand-board/photos", data={"sessionId": sid})
    assert r.status_code == 400
    files = [("files", (f"s{i}.png",  _png(i), "image/png")) for i in range(7)]
    r = c.post("/api/brand-board/photos", data={"sessionId": sid}, files=files)
    assert r.status_code == 400
    files = [("files", ("doc.pdf", b"%PDF-1.4 fake", "application/pdf"))]
    r = c.post("/api/brand-board/photos", data={"sessionId": sid}, files=files)
    assert r.status_code == 200 and r.json()["board"] is None


def test_staff_board_get_edit_decide(monkeypatch):
    sid = _client_sid()
    monkeypatch.setattr(board, "read_board", lambda *a, **k: dict(GOOD))
    assert _upload(sid).status_code == 200
    g = c.get(f"/api/staff/clients/{sid}/brand-board")
    assert g.status_code == 200 and g.json()["board"]["status"] == "pending_review"
    e = c.post(f"/api/staff/clients/{sid}/brand-board",
               json={"colours": ["#111111", "#222222", "#333333"]})
    assert e.status_code == 200, e.text
    assert e.json()["colours"] == ["#111111", "#222222", "#333333"]
    bad = c.post(f"/api/staff/clients/{sid}/brand-board", json={"colours": ["red"]})
    assert bad.status_code == 400
    empty = c.post(f"/api/staff/clients/{sid}/brand-board", json={})
    assert empty.status_code == 400
    d = c.post(f"/api/staff/clients/{sid}/brand-board/decision",
               json={"decision": "approve"})
    assert d.status_code == 200 and d.json()["status"] == "approved"
    again = c.post(f"/api/staff/clients/{sid}/brand-board/decision",
                   json={"decision": "reject"})
    assert again.status_code == 409  # decided boards need a fresh upload


def test_staff_board_missing_is_404():
    sid = _client_sid()
    assert c.get(f"/api/staff/clients/{sid}/brand-board").json()["board"] is None
    assert c.post(f"/api/staff/clients/{sid}/brand-board",
                  json={"summary": "hi"}).status_code == 404
    assert c.post(f"/api/staff/clients/{sid}/brand-board/decision",
                  json={"decision": "approve"}).status_code == 404


def test_prune_missing_drops_gone_files(tmp_path):
    st = SqliteStore(tmp_path / "prune.sqlite3")
    url = _media_url()
    st.save_brand_board("cp", dict(GOOD, photos=[url, "/media/brand-gone.jpg"],
                                   status="pending_review"))
    bb, changed = board.prune_missing(st.get_brand_board("cp"))
    assert changed and bb["photos"] == [url]
