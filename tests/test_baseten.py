"""Baseten chat provider tests (all offline, httpx.post is faked)."""
import httpx

from src.shared import meta, trace

BASETEN_KEYS = ("CHAT_PROVIDER", "BASETEN_API_KEY", "MODEL_API_KEY",
                "BASETEN_BASE_URL", "BASETEN_MODEL",
                "BASETEN_IN_USD_PER_1M", "BASETEN_OUT_USD_PER_1M")


def _clear(monkeypatch):
    for k in BASETEN_KEYS:
        monkeypatch.delenv(k, raising=False)


def _ok(content, **extra):
    msg = {"content": content}
    msg.update(extra)
    return httpx.Response(200, json={"choices": [{"message": msg}],
                                     "usage": {"prompt_tokens": 100, "completion_tokens": 50}})


def test_provider_unset_picks_meta_without_baseten_key(monkeypatch):
    _clear(monkeypatch)
    assert meta.provider() == "meta"
    assert meta.enabled() is False


def test_provider_unset_picks_baseten_with_key(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "k")
    assert meta.provider() == "baseten"
    assert meta.enabled() is True


def test_provider_explicit_baseten(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("CHAT_PROVIDER", "baseten")
    monkeypatch.setenv("BASETEN_API_KEY", "k")
    assert meta.provider() == "baseten"
    assert meta.enabled() is True


def test_provider_explicit_meta_ignores_baseten_key(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("CHAT_PROVIDER", "meta")
    monkeypatch.setenv("BASETEN_API_KEY", "k")
    assert meta.provider() == "meta"
    assert meta.enabled() is False


def test_baseten_without_key_is_disabled_no_meta_fallback(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("CHAT_PROVIDER", "baseten")
    monkeypatch.setenv("MODEL_API_KEY", "meta-key")
    assert meta.provider() == "baseten"
    assert meta.enabled() is False

    def _fail(url, headers=None, json=None, timeout=None):
        raise AssertionError("must not call out when disabled")

    monkeypatch.setattr(httpx, "post", _fail)
    assert meta.chat("t", [{"role": "user", "content": "hi"}]) is None


def test_baseten_url_model_and_auth_header(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "key123")
    monkeypatch.setenv("BASETEN_BASE_URL", "https://custom.example/v1")
    monkeypatch.setenv("BASETEN_MODEL", "custom-model")
    seen = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        seen.update(url=url, headers=headers, json=json)
        return _ok("hi")

    monkeypatch.setattr(httpx, "post", fake_post)
    assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "hi"
    assert seen["url"] == "https://custom.example/v1/chat/completions"
    assert seen["json"]["model"] == "custom-model"
    assert seen["headers"]["Authorization"] == "Bearer key123"


def test_baseten_defaults(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "key123")
    seen = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        seen.update(url=url, json=json)
        return _ok("hi")

    monkeypatch.setattr(httpx, "post", fake_post)
    assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "hi"
    assert seen["url"] == "https://inference.baseten.co/v1/chat/completions"
    assert seen["json"]["model"] == "meta-models/muse-spark-open-1026"


def test_baseten_ignores_reasoning_content(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "key123")

    def fake_post(url, headers=None, json=None, timeout=None):
        return _ok("answer", reasoning_content="think think",
                   reasoning={"nodes": [1, 2]})

    monkeypatch.setattr(httpx, "post", fake_post)
    rows = []
    trace.set_sink(rows.append)
    try:
        assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "answer"
        assert rows[-1]["ok"] is True
        assert rows[-1]["model"] == "meta-models/muse-spark-open-1026"
    finally:
        trace.set_sink(None)


def test_baseten_empty_and_missing_content_fail(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "key123")
    monkeypatch.setattr(meta, "_sleep", lambda s: None)
    for bad in ("", None, "   "):
        monkeypatch.setattr(httpx, "post", lambda *a, **k: _ok(bad))
        rows = []
        trace.set_sink(rows.append)
        try:
            assert meta.chat("t", [{"role": "user", "content": "hi"}]) is None
            assert len(rows) == 1 and rows[0]["ok"] is False
        finally:
            trace.set_sink(None)

    monkeypatch.setattr(httpx, "post",
                        lambda *a, **k: httpx.Response(200, json={"choices": [{"message": {}}]}))
    rows = []
    trace.set_sink(rows.append)
    try:
        assert meta.chat("t", [{"role": "user", "content": "hi"}]) is None
        assert len(rows) == 1 and rows[0]["ok"] is False
    finally:
        trace.set_sink(None)


def test_baseten_traces_real_model_and_cost(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "key123")
    monkeypatch.setenv("BASETEN_MODEL", "custom-model")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _ok("hi"))
    rows = []
    trace.set_sink(rows.append)
    try:
        assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "hi"
        assert rows[-1]["model"] == "custom-model"
        assert rows[-1]["cost_sgd"] > 0
    finally:
        trace.set_sink(None)


def test_baseten_never_traces_key(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "super-secret-key")
    monkeypatch.setattr(meta, "_sleep", lambda s: None)
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(503, json={}))
    rows = []
    trace.set_sink(rows.append)
    try:
        assert meta.chat("t", [{"role": "user", "content": "hi"}]) is None
        assert rows and all(r["ok"] is False for r in rows)
        assert "super-secret-key" not in str(rows)
    finally:
        trace.set_sink(None)


def test_meta_path_unchanged(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("MODEL_API_KEY", "meta-key")
    seen = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        seen.update(url=url, headers=headers, json=json)
        return _ok("hello")

    monkeypatch.setattr(httpx, "post", fake_post)
    assert meta.provider() == "meta"
    assert meta.enabled() is True
    assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "hello"
    assert seen["url"].endswith("/chat/completions")
    assert seen["headers"]["Authorization"] == "Bearer meta-key"
