"""Studio store tests: staff_drafts cap, reconciliation, and looks.source (no Meta)."""
import threading

from src.data.store import SqliteStore


def make_store(tmp_path, name="studio.sqlite3"):
    return SqliteStore(tmp_path / name)


def row(run="run1", preset="post", **kw):
    d = {"run_id": run, "preset": preset, "width": 1080, "height": 1080,
         "author": "staff:ann", "marketer_prompt": "sale", "chips": ["c1"],
         "style_title": "Bold", "style": "bold", "prompt": "a poster"}
    d.update(kw)
    return d


def test_reserve_333_then_full(tmp_path):
    st = make_store(tmp_path)
    ids = []
    for i in range(3):
        got = st.reserve_drafts("c1", [row(run=f"run{i}") for _ in range(3)])
        assert got is not None and len(got) == 3
        ids += got
    assert len(set(ids)) == 9
    assert st.reserve_drafts("c1", [row(run="run4")]) is None
    assert len(st.drafts("c1")) == 9
    # other sessions are unaffected
    assert st.reserve_drafts("c2", [row()]) is not None


def test_failed_rows_free_slots(tmp_path):
    st = make_store(tmp_path)
    ids = st.reserve_drafts("c1", [row() for _ in range(9)])
    assert st.reserve_drafts("c1", [row()]) is None
    st.finish_draft(ids[0], None, "failed", error="boom")
    st.finish_draft(ids[1], "/media/x.png", "ok")
    got = st.reserve_drafts("c1", [row()])
    assert got is not None and len(got) == 1  # failed freed one slot; ok still counts
    assert st.reserve_drafts("c1", [row()]) is None
    st.finish_draft(ids[2], None, "failed", error="bad")
    got = st.reserve_drafts("c1", [row()])
    assert got is not None and len(got) == 1
    d = st.get_draft(ids[0])
    assert d["status"] == "failed" and d["error"] == "boom" and d["url"] is None
    assert st.get_draft(ids[1])["url"] == "/media/x.png"
    assert st.get_draft("missing") is None


def test_concurrent_reserves_never_exceed_cap(tmp_path):
    st = make_store(tmp_path)
    barrier = threading.Barrier(2)
    results = []

    def worker():
        barrier.wait()
        results.append(st.reserve_drafts("c1", [row() for _ in range(5)]))

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r is None for r in results) == [False, True]
    assert len(st.drafts("c1")) == 5


def test_sweep_stale_drafts(tmp_path):
    st = make_store(tmp_path)
    ids = st.reserve_drafts("c1", [row(), row()])
    assert st.sweep_stale_drafts("c1") == 0  # fresh rows untouched
    st.db.execute("UPDATE staff_drafts SET created_at='2000-01-01 00:00:00' WHERE id=?", (ids[0],))
    st.db.commit()
    assert st.sweep_stale_drafts("c1") == 1
    d = st.get_draft(ids[0])
    assert d["status"] == "failed" and d["error"] == "timed out"
    assert st.get_draft(ids[1])["status"] == "reserved"
    # swept slot is free again
    assert st.reserve_drafts("c1", [row(), row(), row(), row(), row(), row(), row(), row()]) is not None
    assert st.sweep_stale_drafts("c1", older_than_s=600) == 0
    assert st.sweep_stale_drafts("other") == 0


def test_migrations_run_twice_on_same_file(tmp_path):
    path = tmp_path / "rerun.sqlite3"
    st = make_store(tmp_path, "rerun.sqlite3")
    ids = st.reserve_drafts("c1", [row()])
    st.add_looks("c1", 1, [{"id": "l1", "url": "u", "title": "T"}])
    st2 = SqliteStore(path)  # rerun every migration on the same file
    assert [d["id"] for d in st2.drafts("c1")] == ids
    assert st2.looks("c1")[0]["source"] == "agent"
    assert st2.reserve_drafts("c1", [row() for _ in range(8)]) is not None
    assert st2.reserve_drafts("c1", [row()]) is None


def test_add_looks_source_round_trip(tmp_path):
    st = make_store(tmp_path)
    st.add_looks("c1", 1, [{"id": "a", "url": "u1", "title": "A"}])
    st.add_looks("c1", 1, [{"id": "s1", "url": "u2", "title": "S"}], source="staff")
    st.add_looks("c1", 2, [{"id": "s2", "url": "u3", "title": "S2", "source": "staff"}])
    by_id = {l["id"]: l for l in st.looks("c1")}
    assert by_id["a"]["source"] == "agent"
    assert by_id["s1"]["source"] == "staff"
    assert by_id["s2"]["source"] == "staff"


def test_flags_and_sent_round_trip(tmp_path):
    st = make_store(tmp_path)
    (did,) = st.reserve_drafts("c1", [row()])
    d = st.get_draft(did)
    assert d["starred"] == 0 and d["pinned_to"] is None and d["sent_at"] is None
    d = st.set_draft_flags(did, starred=True)
    assert d["starred"] == 1 and d["pinned_to"] is None  # omitted fields untouched
    d = st.set_draft_flags(did, pinned_to="consult", pinned_consult_id="k1")
    assert d["pinned_to"] == "consult" and d["pinned_consult_id"] == "k1" and d["starred"] == 1
    d = st.set_draft_flags(did, starred=False, pinned_to="client", pinned_consult_id=None)
    assert d["starred"] == 0 and d["pinned_to"] == "client" and d["pinned_consult_id"] is None
    d = st.mark_draft_sent(did, "staff:ann", "2026-11-04T00:00:00+00:00")
    assert d["sent_at"] == "2026-11-04T00:00:00+00:00" and d["sent_by"] == "staff:ann"
    assert st.drafts("c1")[0]["sent_by"] == "staff:ann"
