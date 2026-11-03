"""Studio Neo4j parity tests: fake transport, no live database (PRD 4.7.3/4.7.5, A23)."""
import json

from src.data.neo4j_store import DRAFT_COLS, Neo4jStore
from src.data.store import SqliteStore


def row(run="run1", preset="post", **kw):
    d = {"id": "d1", "run_id": run, "preset": preset, "width": 1080, "height": 1080,
         "author": "staff:ann", "marketer_prompt": "sale", "chips": ["c1"],
         "style_title": "Bold", "style": "bold", "prompt": "a poster"}
    d.update(kw)
    return d


def canned_draft(**kw):
    d = {k: None for k in DRAFT_COLS}
    d.update({"id": "d1", "session_id": "c1", "run_id": "run1", "preset": "post",
              "width": 1080, "height": 1080, "marketer_prompt": "sale",
              "chips": '["c1"]', "style_title": "Bold", "style": "bold",
              "prompt": "a poster", "status": "reserved", "author": "staff:ann",
              "starred": 0, "created_at": "2026-11-04T00:00:00+00:00"})
    d.update(kw)
    return d


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


def test_reserve_returns_ids_and_passes_cap_and_rows():
    st, rec = make_store([{"id": "d1"}, {"id": "d2"}])
    got = st.reserve_drafts("c1", [row(id="d1"), row(id="d2")], cap=9)
    one_call(rec)
    q, p = rec.calls[0]
    assert p["cap"] == 9 and len(p["rows"]) == 2
    assert "size($rows)" in q and "$cap" in q
    assert got == ["d1", "d2"]


def test_reserve_returns_none_on_empty_result():
    st, rec = make_store([])
    assert st.reserve_drafts("c1", [row()], cap=9) is None
    one_call(rec)


def test_reserve_is_one_conditional_statement():
    st, rec = make_store([{"id": "d1"}])
    st.reserve_drafts("c1", [row(id="d1")])
    one_call(rec)
    q, _ = rec.calls[0]
    assert "OPTIONAL MATCH" in q and "HAS_DRAFT" in q and "UNWIND $rows" in q
    assert "IN ['reserved','ok']" in q


def test_finish_draft_shape_matches_sqlite(tmp_path):
    st, rec = make_store([canned_draft(url="/media/d1.png", status="ok")])
    got = st.finish_draft("d1", "/media/d1.png", "ok")
    one_call(rec)
    assert set(got) == set(SqliteStore._DRAFT_COLS)
    assert got["chips"] == ["c1"] and got["starred"] == 0
    assert got["url"] == "/media/d1.png" and got["status"] == "ok"


def test_finish_draft_missing_returns_none():
    st, rec = make_store([])
    assert st.finish_draft("nope", None, "failed", error="boom") is None
    one_call(rec)


def test_drafts_and_get_draft_shapes_match_sqlite(tmp_path):
    sql = SqliteStore(tmp_path / "s.sqlite3")
    (did,) = sql.reserve_drafts("c1", [row()])
    want = sql.get_draft(did)
    stored = dict(want)
    stored["chips"] = json.dumps(want["chips"])
    st, rec = make_store([canned_draft(**stored)], [canned_draft(**stored)])
    assert st.drafts("c1") == [want]
    assert st.get_draft(did) == want
    assert len(rec.calls) == 2


def test_get_draft_missing_returns_none():
    st, rec = make_store([])
    assert st.get_draft("missing") is None
    one_call(rec)


def test_set_draft_flags_single_statement_partial_update():
    st, rec = make_store([canned_draft(starred=1)])
    got = st.set_draft_flags("d1", starred=True)
    one_call(rec)
    q, p = rec.calls[0]
    assert "d.starred=$starred" in q.split("RETURN")[0]
    assert set(p) == {"id", "starred"}  # omitted fields untouched
    assert p["starred"] == 1 and got["starred"] == 1


def test_mark_draft_sent_shape():
    st, rec = make_store([canned_draft(sent_at="2026-11-04T00:00:00+00:00",
                                       sent_by="staff:ann")])
    got = st.mark_draft_sent("d1", "staff:ann", "2026-11-04T00:00:00+00:00")
    one_call(rec)
    assert got["sent_at"] == "2026-11-04T00:00:00+00:00"
    assert got["sent_by"] == "staff:ann"


def test_sweep_returns_count_single_statement():
    st, rec = make_store([{"n": 2}])
    assert st.sweep_stale_drafts("c1") == 2
    one_call(rec)
    q, p = rec.calls[0]
    assert "timed out" in q and p["sid"] == "c1"
    st2, rec2 = make_store([])
    assert st2.sweep_stale_drafts("c1") == 0
    one_call(rec2)


def test_add_looks_source_single_statement():
    st, rec = make_store([])
    st.add_looks("c1", 1, [{"id": "s1", "url": "u", "title": "T"}], source="staff")
    one_call(rec)
    _, p = rec.calls[0]
    assert p["source"] == "staff"
    assert p["looks"][0]["id"] == "s1"


def test_looks_returns_source():
    st, rec = make_store([{"id": "s1", "session_id": "c1", "round": 1, "url": "u",
                           "title": "T", "brief": "b", "source": "staff",
                           "selected": 0, "created_at": "t"}])
    (look,) = st.looks("c1")
    one_call(rec)
    assert look["source"] == "staff"
