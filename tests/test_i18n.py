"""i18n: detection, protected translation, cache, failure passthrough, chat switch rule."""
import pytest

from src.features.i18n import lang
from src.shared import meta


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
