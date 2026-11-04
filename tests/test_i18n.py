"""i18n: detection, protected translation, cache, failure passthrough, chat switch rule."""
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from helpers import new_session, staff_client  # noqa: E402
from src.app import app, store  # noqa: E402
from src.features.i18n import lang  # noqa: E402
from src.shared import meta  # noqa: E402


@pytest.fixture(autouse=True)
def _clean():
    lang._out_cached.cache_clear()
    yield
    lang._out_cached.cache_clear()


def test_detect_cases():
    assert lang.detect("我想注册我的咖啡店") == "zh"
    assert lang.detect("நான் என் கடையை பதிவு செய்ய விரும்புகிறேன்") == "ta"
    assert lang.detect("Saya mahu daftar syarikat saya") == "ms"
    assert lang.detect("I want to register my shop") == "en"
    for t in ["yes", "Yes!", "1 and 3", "1 3", "jo@acme.example", "jo@x.com", "no", "skip", "ok",
              "", "   ", "https://example.com/shop", "+65 9123 4567", "S$120"]:
        assert lang.detect(t) is None, t
    assert lang.detect("Hello there friend") == "en"


def test_disabled_returns_unchanged(monkeypatch):
    monkeypatch.setattr(meta, "enabled", lambda: False)
    assert lang.to_english("saya mahu", "ms") == "saya mahu"
    assert lang.to_client("hello", "zh") == "hello"


def test_to_english_protects_pii(monkeypatch):
    seen = {}

    def fake(*, step=None, messages=None, session_id=None, **kw):
        seen["step"], seen["user"], seen["sys"] = step, messages[1]["content"], messages[0]["content"]
        assert len(messages) == 2 and messages[0]["role"] == "system" and messages[1]["role"] == "user"
        return messages[1]["content"].upper()

    monkeypatch.setattr(meta, "enabled", lambda: True)
    monkeypatch.setattr(meta, "chat", fake)
    out = lang.to_english("hubungi saya di jo@acme.example atau +65 9123 4567", "ms", session_id="s1")
    assert "jo@acme.example" in out and "+65 9123 4567" in out
    assert "⟦1⟧" in seen["user"] and "jo@acme.example" not in seen["user"]
    assert seen["step"] == "translate_in" and "Malay" in seen["sys"] and "translation only" in seen["sys"]


def test_to_client_step_and_cache(monkeypatch):
    seen = {}
    monkeypatch.setattr(meta, "enabled", lambda: True)

    def fake(*, step=None, messages=None, session_id=None, **kw):
        seen["step"], seen["sys"] = step, messages[0]["content"]
        return messages[1]["content"]

    monkeypatch.setattr(meta, "chat", fake)
    lang.to_client("Line one\n• fix this", "zh")
    assert seen["step"] == "translate_out" and "Chinese (Simplified)" in seen["sys"]
    calls = []

    def counting(*, step=None, messages=None, session_id=None, **kw):
        calls.append((messages[1]["content"], session_id))
        return messages[1]["content"]

    monkeypatch.setattr(meta, "chat", counting)
    lang._out_cached.cache_clear()
    assert lang.to_client("Hello there", "zh", session_id="a") == "Hello there"
    assert lang.to_client("Hello there", "zh", session_id="b") == "Hello there"
    assert len(calls) == 1 and calls[0][1] == "a"  # cached per text+lang, sid traced


def test_failure_falls_back(monkeypatch):
    monkeypatch.setattr(meta, "enabled", lambda: True)
    monkeypatch.setattr(meta, "chat", lambda **kw: None)
    assert lang.to_client("Hello there", "zh") == "Hello there"
    assert lang.to_english("sapa khabar", "ms") == "sapa khabar"


def test_protect_roundtrip_and_lines():
    raw = "UEN T20VC1234Z 202012345A S$1,250.50 #02-15 https://x.com/a 9123 4567 a@b.co"
    p, m = lang._protect(raw)
    assert "T20VC1234Z" not in p and "⟦1⟧" in p
    assert lang._restore(p, m) == raw
    assert lang._protect("plain words") == ("plain words", {})
    assert lang.lines("A\n\n• b\n") == ["A", "• b"]


def test_chat_switch_rule():
    """First detection sets lang; en never flips a non-en client back; en only leaves to non-en."""
    from src.app import switch_lang
    s = {}
    switch_lang(s, "我想注册")  # no lang yet -> zh
    assert s["lang"] == "zh"
    switch_lang(s, "Email: jo@x.example")  # short English must not flip back
    assert s["lang"] == "zh"
    switch_lang(s, "நான் கடை பதிவு செய்ய விரும்புகிறேன்")  # non-en -> non-en switches
    assert s["lang"] == "ta"
    s = {"lang": "en"}
    switch_lang(s, "Hello friend")  # en + en detection stays
    assert s["lang"] == "en"
    switch_lang(s, "Saya mahu daftar syarikat saya")  # en -> non-en switches
    assert s["lang"] == "ms"
    s = {"lang": "zh", "lang_set": True}  # explicit pick wins
    switch_lang(s, "Saya mahu daftar syarikat saya")
    assert s["lang"] == "zh"


def _fake_meta(calls, prefix="[ZH]"):
    def fake(*, step=None, messages=None, session_id=None, **kw):
        calls.append(step)
        if step == "translate_in":
            return messages[1]["content"]  # echo: keep agent input sane
        return prefix + messages[1]["content"]
    return fake


def _zh_session(monkeypatch):
    """Session with Meta mocked and a translated bot reply; returns (client, sid, lang_resp, calls)."""
    calls = []
    monkeypatch.setenv("MODEL_API_KEY", "x")
    monkeypatch.setattr(meta, "chat", _fake_meta(calls))
    c = staff_client(app)
    sid = new_session(c)
    r = c.post("/api/language", json={"sessionId": sid, "lang": "zh"}).json()
    assert r["lang"] == "zh", r
    lang._out_cached.cache_clear()  # setup translation must not warm the lru
    calls.clear()
    return c, sid, r, calls


def test_reply_lock_detect():
    assert lang.detect_reply_lang("please reply in English") == "en"
    assert lang.detect_reply_lang("keep English") == "en"
    assert lang.detect_reply_lang("用英文回复") == "en"
    assert lang.detect_reply_lang("balas dalam bahasa Inggeris") == "en"
    assert lang.detect_reply_lang("reply in Chinese please") == "zh"
    assert lang.detect_reply_lang("请用中文回复") == "zh"
    assert lang.detect_reply_lang("jawab dalam bahasa Melayu") == "ms"
    assert lang.detect_reply_lang("reply in Tamil") == "ta"
    assert lang.detect_reply_lang("我想注册我的咖啡店") is None
    assert lang.detect_reply_lang("Saya mahu daftar syarikat saya") is None
    assert lang.detect_reply_lang("hello") is None
    assert lang.detect_reply_lang("") is None


def test_source_carried_on_replies(monkeypatch):
    c, sid, r, _ = _zh_session(monkeypatch)
    assert r["source"] and r["source"] != r["reply"]
    tr = store.load(sid)["transcript"]
    assert tr and tr[-1]["role"] == "bot" and tr[-1]["text"] == r["source"]


def test_translate_only_transcript_and_no_side_effects(monkeypatch):
    c, sid, r, _ = _zh_session(monkeypatch)
    before = store.load(sid)
    n, status = len(before["transcript"]), before["status"]
    out = c.post("/api/translate", json={
        "sessionId": sid, "lang": "zh", "texts": [r["source"], "client made this up"]}).json()
    assert out["lang"] == "zh"
    assert out["texts"] == [r["reply"], "client made this up"]
    after = store.load(sid)
    assert len(after["transcript"]) == n and after["status"] == status


def test_translate_cached_second_call_no_meta(monkeypatch):
    c, sid, r, calls = _zh_session(monkeypatch)
    body = {"sessionId": sid, "lang": "zh", "texts": [r["source"]]}
    assert c.post("/api/translate", json=body).json()["texts"] == [r["reply"]]
    assert calls.count("translate_out") == 1
    assert c.post("/api/translate", json=body).json()["texts"] == [r["reply"]]
    assert calls.count("translate_out") == 1  # lru + session dict: no second call
    lang._out_cached.cache_clear()  # simulate a restart: lru gone, session dict remains
    assert c.post("/api/translate", json=body).json()["texts"] == [r["reply"]]
    assert calls.count("translate_out") == 1


def test_translate_failure_returns_source(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "x")
    monkeypatch.setattr(meta, "chat", lambda **kw: None)
    c = staff_client(app)
    sid = new_session(c)
    src = store.load(sid)["transcript"][-1]["text"]
    out = c.post("/api/translate", json={
        "sessionId": sid, "lang": "zh", "texts": [src]}).json()
    assert out == {"lang": "zh", "texts": [src]}


def test_reply_lang_lock_respected(monkeypatch):
    c, sid, r, calls = _zh_session(monkeypatch)
    old_reply = r["reply"]
    locked = c.post("/api/chat", json={"sessionId": sid, "text": "please reply in English"}).json()
    assert store.load(sid)["reply_lang"] == "en"
    assert locked["lang"] == "en" and locked["reply"] == locked["source"]
    assert "translate_out" not in calls  # lock wins over the zh picker
    out = c.post("/api/translate", json={
        "sessionId": sid, "lang": "zh", "texts": [r["source"]]}).json()
    assert out["lang"] == "en" and out["texts"] == [r["source"]]
    assert old_reply != r["source"]  # sanity: zh translation really differs
    # Asking otherwise in chat moves the lock.
    c.post("/api/chat", json={"sessionId": sid, "text": "请用中文回复"})
    assert store.load(sid)["reply_lang"] == "zh"
    out = c.post("/api/translate", json={
        "sessionId": sid, "lang": "en", "texts": [r["source"]]}).json()
    assert out["lang"] == "zh" and out["texts"] == ["[ZH]" + r["source"]]


def test_translate_failure_not_cached_retries(monkeypatch):
    """A failed non-en call (source back unchanged) is not cached, so it retries."""
    monkeypatch.setenv("MODEL_API_KEY", "x")
    calls = []

    def fake(**kw):
        calls.append(kw.get("step"))
        return None

    monkeypatch.setattr(meta, "chat", fake)
    c = staff_client(app)
    sid = new_session(c)
    src = store.load(sid)["transcript"][-1]["text"]
    body = {"sessionId": sid, "lang": "zh", "texts": [src]}
    assert c.post("/api/translate", json=body).json() == {"lang": "zh", "texts": [src]}
    assert calls.count("translate_out") == 1
    assert store.load(sid).get("translate_cache", {}) == {}
    lang._out_cached.cache_clear()  # simulate a restart: process lru gone, nothing persisted
    assert c.post("/api/translate", json=body).json() == {"lang": "zh", "texts": [src]}
    assert calls.count("translate_out") == 2


def test_translate_auth_and_lang_validation(monkeypatch):
    c, sid, r, _ = _zh_session(monkeypatch)
    body = {"sessionId": sid, "lang": "zh", "texts": [r["source"]]}
    assert TestClient(app).post("/api/translate", json=body).status_code == 403
    bad = dict(body, sessionSecret="nope")
    assert TestClient(app).post("/api/translate", json=bad).status_code == 403
    assert c.post("/api/translate", json=dict(body, lang="xx")).status_code == 400
