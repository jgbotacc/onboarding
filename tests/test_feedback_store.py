"""Client feedback store tests: draft_feedback, shortlist and share_tokens (no network)."""
import json

import pytest

from src.data.store import SqliteStore


def make_store(tmp_path, name="feedback.sqlite3"):
    return SqliteStore(tmp_path / name)


def row(run="run1", **kw):
    d = {"run_id": run, "preset": "post", "width": 1080, "height": 1080,
         "author": "staff:ann", "style_title": "Bold", "style": "bold poster",
         "prompt": "a poster"}
    d.update(kw)
    return d


def sent(st, sid, **kw):
    (did,) = st.reserve_drafts(sid, [row(**kw)])
    st.finish_draft(did, "/media/x.png", "ok")
    return st.mark_draft_sent(did, "staff:ann", "2026-11-04T00:00:00+00:00")["id"]


def test_heart_adds_shortlist_reject_removes(tmp_path):
    st = make_store(tmp_path)
    did = sent(st, "c1")
    fb = st.record_feedback("c1", did, "heart", None, "client:share")
    assert fb["kind"] == "heart" and fb["note"] is None
    assert st.shortlist_for("c1") == [did]
    st.record_feedback("c1", did, "reject", "ignored note", "client:share")
    assert st.shortlist_for("c1") == []
    rows = {r["kind"]: r for r in st.feedback_for("c1")}
    assert set(rows) == {"heart", "reject"}
    assert rows["reject"]["note"] is None  # note ignored for non-changes kinds


def test_approve_and_changes_audit(tmp_path):
    st = make_store(tmp_path)
    did = sent(st, "c1")
    st.record_feedback("c1", did, "approve", None, "client:share")
    st.record_feedback("c1", did, "changes", "warmer red please", "client:share")
    rows = st.feedback_for("c1")
    assert rows[1]["note"] == "warmer red please"
    acts = {a["action"]: a for a in st.audit_log("c1")}
    assert acts["feedback_approve"]["actor"] == "client:share"
    assert acts["feedback_changes"]["details"] == {"draft_id": did, "note": "warmer red please"}


def test_record_validates(tmp_path):
    st = make_store(tmp_path)
    did = sent(st, "c1")
    with pytest.raises(ValueError):
        st.record_feedback("c1", did, "love", None, "client:share")
    with pytest.raises(ValueError):
        st.record_feedback("c1", did, "changes", "   ", "client:share")
    with pytest.raises(ValueError):
        st.record_feedback("c1", did, "changes", "x" * 501, "client:share")
    assert st.feedback_for("c1") == []


def test_record_rejects_unsent_missing_and_foreign_drafts(tmp_path):
    st = make_store(tmp_path)
    (unsent,) = st.reserve_drafts("c1", [row()])
    with pytest.raises(ValueError):
        st.record_feedback("c1", unsent, "heart", None, "client:share")
    with pytest.raises(ValueError):
        st.record_feedback("c1", "nope", "heart", None, "client:share")
    foreign = sent(st, "c2")
    with pytest.raises(ValueError):
        st.record_feedback("c1", foreign, "heart", None, "client:share")
    assert st.feedback_for("c1") == [] and st.shortlist_for("c1") == []


def test_shortlist_add_remove_idempotent(tmp_path):
    st = make_store(tmp_path)
    did = sent(st, "c1")
    assert st.shortlist_add("c1", did, "staff:ann") == [did]
    assert st.shortlist_add("c1", did, "staff:ann") == [did]
    assert st.shortlist_remove("c1", did) == []
    assert st.shortlist_remove("c1", did) == []


def test_issue_find_revoke_round_trip(tmp_path):
    st = make_store(tmp_path)
    tid, token = st.issue_share_token("c1", "staff:ann")
    assert len(token) >= 32 and tid != token
    got = st.find_share_token(token)
    assert got and got["id"] == tid and got["session_id"] == "c1"
    assert got["revoked_at"] is None and "token_hash" not in got and "token" not in got
    assert st.find_share_token("made-up") is None
    listed = st.shares_for("c1")
    assert len(listed) == 1 and "token_hash" not in json.dumps(listed)
    assert "token_hash" not in listed[0] and set(listed[0]) == {
        "id", "session_id", "created_by", "created_at", "expires_at", "revoked_at", "used_at"}
    assert st.shares_for("c2") == []
    rev = st.revoke_share_token(tid, "staff:ann")
    assert rev["revoked_at"]
    assert st.find_share_token(token) is None  # revoked reads like unknown
    assert st.revoke_share_token("nope", "staff:ann") is None


def test_no_plaintext_token_in_db_or_audit(tmp_path):
    st = make_store(tmp_path)
    tid, token = st.issue_share_token("c1", "staff:ann")
    blob = json.dumps(st.db.execute("SELECT * FROM share_tokens").fetchall())
    assert token not in blob
    assert token not in json.dumps(st.audit_log("c1"))
    (h,) = st.db.execute("SELECT token_hash FROM share_tokens WHERE id=?", (tid,)).fetchone()
    assert len(h) == 64 and h != token


def test_used_at_and_expiry_sweep(tmp_path):
    st = make_store(tmp_path)
    tid, token = st.issue_share_token("c1", "staff:ann", days=7)
    assert st.find_share_token(token)["used_at"] is None
    st.mark_share_used(tid)
    assert st.find_share_token(token)["used_at"]
    st.db.execute("UPDATE share_tokens SET expires_at='2000-01-01T00:00:00+00:00' WHERE id=?", (tid,))
    st.db.commit()
    assert st.find_share_token(token)["session_id"] == "c1"  # expired still resolves for a 410
    assert st.sweep_expired_tokens() == 1
    assert st.find_share_token(token) is None
    assert st.sweep_expired_tokens() == 0
