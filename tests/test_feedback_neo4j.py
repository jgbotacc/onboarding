"""Feedback Neo4j parity tests: fake transport, no live database (PRD 4.8, A23)."""
import json

import pytest

from src.data.neo4j_store import FEEDBACK_RET, Neo4jStore


class Recorder:
    """Fake _run: records (statement, params), replays one canned result per call."""

    def __init__(self, *results):
        self.calls = []
        self.queue = list(results)

    def __call__(self, q, **p):
        self.calls.append((q, p))
        if len(self.queue) > 1:
            return self.queue.pop(0)
        return self.queue[0]


def make_store(*results):
    st = Neo4jStore.__new__(Neo4jStore)
    rec = Recorder(*results)
    st._run = rec
    return st, rec


def one_call(rec):
    assert len(rec.calls) == 1, f"expected one Cypher statement, got {len(rec.calls)}"


def canned_feedback(**kw):
    d = {"id": "f1", "session_id": "c1", "draft_id": "d1", "kind": "heart",
         "note": None, "actor": "client:share", "created_at": "2026-11-04T00:00:00+00:00"}
    d.update(kw)
    return d


def canned_share(**kw):
    d = {"id": "t1", "session_id": "c1", "created_by": "staff:ann",
         "created_at": "2026-11-04T00:00:00+00:00", "expires_at": "2026-11-11T00:00:00+00:00",
         "revoked_at": None, "used_at": None}
    d.update(kw)
    return d


def test_record_heart_is_one_statement_with_shortlist():
    st, rec = make_store([canned_feedback()])
    got = st.record_feedback("c1", "d1", "heart", None, "client:share")
    one_call(rec)
    q, p = rec.calls[0]
    assert "CREATE (f:Feedback" in q and "GAVE_FEEDBACK" in q
    assert "SHORTLISTED" in q and "Audit" in q and "'feedback_' + $kind" in q
    assert p == {"sid": "c1", "did": "d1", "kind": "heart", "note": None,
                 "actor": "client:share", "details": json.dumps({"draft_id": "d1"})}
    assert got["kind"] == "heart" and got["draft_id"] == "d1"


def test_record_reject_deletes_shortlist_in_same_statement():
    st, rec = make_store([canned_feedback(kind="reject")])
    st.record_feedback("c1", "d1", "reject", "ignored", "client:share")
    one_call(rec)
    q, p = rec.calls[0]
    assert "DELETE sl" in q and "$kind = 'reject'" in q
    assert p["note"] is None  # note ignored for non-changes kinds


def test_record_empty_result_means_unsent_draft():
    st, rec = make_store([])
    with pytest.raises(ValueError):
        st.record_feedback("c1", "d1", "heart", None, "client:share")
    one_call(rec)


def test_record_validates_before_touching_db():
    st, rec = make_store([canned_feedback()])
    with pytest.raises(ValueError):
        st.record_feedback("c1", "d1", "love", None, "client:share")
    with pytest.raises(ValueError):
        st.record_feedback("c1", "d1", "changes", "  ", "client:share")
    assert rec.calls == []


def test_feedback_for_shape():
    st, rec = make_store([canned_feedback(), canned_feedback(id="f2", kind="changes",
                                                             note="warmer")])
    rows = st.feedback_for("c1")
    one_call(rec)
    assert [r["kind"] for r in rows] == ["heart", "changes"]
    assert set(rows[0]) == {"id", "session_id", "draft_id", "kind", "note", "actor", "created_at"}


def test_shortlist_add_remove_for():
    st, rec = make_store([], [{"id": "d1"}])
    assert st.shortlist_add("c1", "d1", "client:share") == ["d1"]
    assert "SHORTLISTED" in rec.calls[0][0]
    assert len(rec.calls) == 2  # edge write, then the list read
    st2, rec2 = make_store([], [{"id": "d9"}])
    assert st2.shortlist_remove("c1", "d1") == ["d9"]
    assert "DELETE" in rec2.calls[0][0]
    assert len(rec2.calls) == 2


def test_issue_is_one_statement_with_hash_not_token():
    st, rec = make_store([{"id": "t1", "expires_at": "2026-11-11T00:00:00+00:00"}])
    tid, token = st.issue_share_token("c1", "staff:ann", days=7)
    one_call(rec)
    q, p = rec.calls[0]
    assert "CREATE (t:ShareToken" in q and "share_issued" in q
    assert "token_hash:$hash" in q and "$token" not in q
    assert set(p) == {"sid", "tid", "hash", "actor", "expires", "details"}
    assert len(p["hash"]) == 64 and token not in json.dumps(p)
    assert tid == p["tid"] and len(token) >= 32


def test_find_filters_revoked_in_python():
    st, rec = make_store([canned_share()])
    assert st.find_share_token("tok")["id"] == "t1"
    one_call(rec)
    q, p = rec.calls[0]
    assert "token_hash:$hash" in q and len(p["hash"]) == 64
    st2, rec2 = make_store([canned_share(revoked_at="2026-11-05T00:00:00+00:00")])
    assert st2.find_share_token("tok") is None
    one_call(rec2)


def test_revoke_is_one_statement_with_audit():
    st, rec = make_store([canned_share(revoked_at="2026-11-05T00:00:00+00:00")])
    got = st.revoke_share_token("t1", "staff:ann")
    one_call(rec)
    q, p = rec.calls[0]
    assert "revoked_at" in q and "share_revoked" in q
    assert set(p) == {"tid", "actor", "now", "details"}
    assert got["revoked_at"] == "2026-11-05T00:00:00+00:00"
    st2, rec2 = make_store([])
    assert st2.revoke_share_token("nope", "staff:ann") is None


def test_shares_for_never_returns_hashes():
    st, rec = make_store([canned_share()])
    (row,) = st.shares_for("c1")
    one_call(rec)
    assert "token_hash" not in rec.calls[0][0] and "token_hash" not in json.dumps(row)
    assert set(row) == {"id", "session_id", "created_by", "created_at",
                        "expires_at", "revoked_at", "used_at"}


def test_sweep_is_one_statement_returning_count():
    st, rec = make_store([{"n": 2}])
    assert st.sweep_expired_tokens() == 2
    one_call(rec)
    q, _ = rec.calls[0]
    assert "ShareToken" in q and "DETACH DELETE" in q
    st2, rec2 = make_store([])
    assert st2.sweep_expired_tokens() == 0


def test_feedback_ret_aliases_match_sqlite_cols():
    from src.data.store import SqliteStore
    assert [part.split(" AS ")[1] for part in FEEDBACK_RET.split(", ")] == list(
        SqliteStore._FEEDBACK_COLS)
