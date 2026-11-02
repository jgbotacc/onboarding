"""Infra tests: meta client retries/traces, guard masking, store transactions."""
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
import httpx  # noqa: E402
import pytest  # noqa: E402

from src.data.store import SqliteStore  # noqa: E402
from src.shared import guard, meta, trace  # noqa: E402


def make_store(tmp_path):
    return SqliteStore(tmp_path / "infra.sqlite3")


def test_meta_chat_disabled_without_key(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    assert meta.enabled() is False
    assert meta.chat("t", [{"role": "user", "content": "hi"}]) is None


def test_meta_chat_retries_then_succeeds(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "fake")
    calls, sleeps, rows = [], [], []
    monkeypatch.setattr(meta, "_sleep", sleeps.append)
    trace.set_sink(rows.append)
    try:
        def fake_post(url, headers=None, json=None, timeout=None):
            calls.append(json)
            assert headers["Authorization"] == "Bearer fake"
            assert url.endswith("/chat/completions") and json["temperature"] == 0.2
            if len(calls) < 3:
                return httpx.Response(500, json={"error": "boom"})
            return httpx.Response(200, json={"choices": [{"message": {"content": "hello"}}],
                                             "usage": {"prompt_tokens": 100, "completion_tokens": 50}})
        monkeypatch.setattr(httpx, "post", fake_post)
        assert meta.chat("doc", [{"role": "user", "content": "hi"}], session_id="s1") == "hello"
        assert len(calls) == 3 and sleeps == [1, 2]
        assert [r["ok"] for r in rows] == [False, False, True]
        assert rows[-1]["cost_sgd"] > 0 and rows[-1]["session_id"] == "s1"
        assert rows[-1]["step"] == "doc" and isinstance(rows[-1]["latency_ms"], int)
    finally:
        trace.set_sink(None)


def test_meta_chat_all_fail_returns_none(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "fake")
    monkeypatch.setattr(meta, "_sleep", lambda s: None)
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(503, json={}))
    rows = []
    trace.set_sink(rows.append)
    try:
        assert meta.chat("t", []) is None
        assert len(rows) == 3 and all(not r["ok"] for r in rows)
    finally:
        trace.set_sink(None)


def test_meta_helpers(monkeypatch):
    monkeypatch.setattr(meta, "chat", lambda *a, **k: '```json\n{"a": 1}\n```')
    assert meta.chat_json("s", []) == {"a": 1}
    monkeypatch.setattr(meta, "chat", lambda *a, **k: "not json")
    assert meta.chat_json("s", []) is None
    import base64
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (2000, 100), "red").save(buf, "JPEG")
    part = meta.image_part(buf.getvalue())
    assert part["type"] == "image_url" and part["image_url"]["url"].startswith("data:image/jpeg;base64,")
    im = Image.open(io.BytesIO(base64.b64decode(part["image_url"]["url"].split(",", 1)[1])))
    assert max(im.size) <= 1600
    assert trace.usd_to_sgd(1.0) == round(trace.USD_SGD, 6)
    with trace.timer() as t:
        pass
    assert isinstance(t.ms, int)
    row = trace.record("s", "m", False, 5, 0.0, "x", "nric S1234567D " + "e" * 300)
    assert len(row["error"]) <= 200 and "S1234567D" not in row["error"]
    trace.set_sink(lambda r: 1 / 0)  # sink errors never raise
    try:
        assert trace.record("s", "m", True, 1)["ok"] is True
    finally:
        trace.set_sink(None)


def test_guard_masks_others_not_own(tmp_path):
    st = make_store(tmp_path)
    st.save({"id": "own", "status": "x", "fields": {
        "email": "me@own.example", "phone_number": "81234567", "uen": "T20VC1234Z"}, "invalid": {}})
    st.save({"id": "other", "status": "x", "fields": {
        "email": "you@other.example", "phone_number": "98765432", "uen": "201812345K"}, "invalid": {}})
    others = guard.others_identifiers(st, "own")
    assert {"you@other.example", "98765432", "201812345k"} <= others
    assert "me@own.example" not in others and "81234567" not in others
    obj = {"m": "NRIC S1234567D, mail YOU@other.example, call 9876-5432, UEN 201812345K. "
                "Mine: me@own.example 81234567 T20VC1234Z"}
    out, n = guard.clean(obj, others)
    assert n >= 4
    assert "S1234567D" not in out["m"] and "other.example" not in out["m"]
    assert "9876-5432" not in out["m"] and "201812345K" not in out["m"]
    assert "me@own.example" in out["m"] and "81234567" in out["m"] and "T20VC1234Z" in out["m"]


def test_add_looks_rolls_back(tmp_path):
    st = make_store(tmp_path)
    st.add_looks("s1", 1, [{"id": "a", "url": "http://x/a", "title": "A", "brief": "b"}])
    with pytest.raises(Exception):
        st.add_looks("s1", 2, [{"id": "b", "url": "http://x/b"}, {"id": "c"}])  # missing url: NOT NULL
    assert [l["id"] for l in st.looks("s1")] == ["a"]
    st.mark_looks("s1", ["a"])
    assert st.looks("s1")[0]["selected"] == 1


def test_neo4j_writes_are_one_statement():
    from src.data import neo4j_store
    st = object.__new__(neo4j_store.Neo4jStore)
    bodies = []

    class FakeResp:
        status_code = 200

        def json(self):
            return {"data": {"fields": [], "values": []}}

    class FakeHttp:
        def post(self, url, auth=None, headers=None, json=None):
            bodies.append(json)
            return FakeResp()

    st.http, st.url, st.auth, st.hdrs = FakeHttp(), "http://x", None, {}
    st.save({"id": "c1", "status": "registering", "fields": {"business_name": "Acme"}, "invalid": {}})
    assert len(bodies) == 1 and "CALL" in bodies[0]["statement"]
    st.save({"id": "c2", "status": "registering", "fields": {}, "invalid": {}})
    assert len(bodies) == 2
    st.add_looks("c1", 1, [{"id": "l1", "url": "u"}])
    st.mark_looks("c1", ["l1"])
    st.save_consult({"id": "k", "session_id": "c1", "status": "pending_approval"})
    st.audit("c1", "staff:a", "approve")
    st.trace({"session_id": "c1", "step": "s", "model": "m", "ok": True, "latency_ms": 1})
    st.trace({"session_id": None, "step": "s", "model": "m", "ok": True, "latency_ms": 1})
    st.add_eval("doc", 0.9, 3, {})
    assert len(bodies) == 2 + 7  # every write above sent exactly one statement


def test_audit_consult_roundtrip(tmp_path):
    st = make_store(tmp_path)
    st.audit("s1", "staff:ann", "approve", "c1", {"note": "ok"})
    log = st.audit_log("s1")
    assert len(log) == 1 and log[0]["actor"] == "staff:ann" and log[0]["action"] == "approve"
    assert log[0]["target"] == "c1" and log[0]["details"] == {"note": "ok"}
    card = {"id": "k1", "session_id": "s1", "status": "pending_approval",
            "approved_by": None, "decided_at": None, "note": "hi"}
    st.save_consult(card)
    assert st.get_consult("k1") == card
    assert st.consults()[0]["id"] == "k1"
    assert st.get_consult("nope") is None


def test_traces_evals_events(tmp_path):
    st = make_store(tmp_path)
    st.save({"id": "s1", "status": "x", "fields": {}, "invalid": {}})
    st.event("s1", "msg", {"reply": "hi"})
    st.trace({"session_id": "s1", "step": "doc", "model": "m", "ok": True,
              "latency_ms": 12, "cost_sgd": 0.001, "error": None, "at": "2026-01-01T00:00:00+00:00"})
    st.trace({"session_id": None, "step": "sys", "model": "m", "ok": False,
              "latency_ms": 3, "cost_sgd": 0.0, "error": "boom", "at": "2026-01-02T00:00:00+00:00"})
    assert [t["step"] for t in st.traces("s1")] == ["doc"]
    assert st.traces("s1")[0]["ok"] is True
    assert len(st.all_traces()) == 2
    st.add_eval("doc", 0.9, 5, {"n_ok": 4})
    st.add_eval("doc", 0.8, 5, {"n_ok": 3})
    assert st.latest_evals()["doc"]["score"] == 0.8
    assert st.events_for("s1") == [{"kind": "msg", "payload": {"reply": "hi"},
                                    "created_at": st.events_for("s1")[0]["created_at"]}]
