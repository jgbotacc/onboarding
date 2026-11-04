"""Baseten-first chat with automatic Meta fallback (all offline, httpx.post is faked)."""
import base64
import io

import httpx

from src.shared import meta, trace

KEYS = ("BASETEN_API_KEY", "MODEL_API_KEY",
        "BASETEN_BASE_URL", "BASETEN_MODEL",
        "BASETEN_IN_USD_PER_1M", "BASETEN_OUT_USD_PER_1M",
        "META_API_BASE", "META_CHAT_MODEL")


def _clear(monkeypatch):
    for k in KEYS:
        monkeypatch.delenv(k, raising=False)


def _ok(content, **extra):
    msg = {"content": content}
    msg.update(extra)
    return httpx.Response(200, json={"choices": [{"message": msg}],
                                     "usage": {"prompt_tokens": 100, "completion_tokens": 50}})


def _baseten_ok_meta_ok(monkeypatch, baseten_resp, meta_text="meta answer"):
    """Baseten fails one way, Meta answers. Returns (calls, rows)."""
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-key")
    monkeypatch.setenv("MODEL_API_KEY", "meta-key")
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append({"url": url, "timeout": timeout,
                      "auth": (headers or {}).get("Authorization"),
                      "model": (json or {}).get("model")})
        if "baseten" in url:
            if isinstance(baseten_resp, Exception):
                raise baseten_resp
            return baseten_resp
        return _ok(meta_text)

    monkeypatch.setattr(httpx, "post", fake_post)
    rows = []
    trace.set_sink(rows.append)
    return calls, rows


def test_enabled_needs_a_key(monkeypatch):
    _clear(monkeypatch)
    assert meta.enabled() is False
    assert meta.chat("t", [{"role": "user", "content": "hi"}]) is None
    monkeypatch.setenv("MODEL_API_KEY", "meta-key")
    assert meta.enabled() is True
    monkeypatch.delenv("MODEL_API_KEY")
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-key")
    assert meta.enabled() is True


def test_baseten_success(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "key123")
    monkeypatch.setenv("MODEL_API_KEY", "meta-key")
    seen = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        seen.update(url=url, headers=headers, json=json, timeout=timeout)
        return _ok("hi")

    monkeypatch.setattr(httpx, "post", fake_post)
    assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "hi"
    assert seen["url"] == "https://inference.baseten.co/v1/chat/completions"
    assert seen["json"]["model"] == "meta-models/muse-spark-open-1026"
    assert seen["headers"]["Authorization"] == "Bearer key123"
    assert seen["timeout"] == 25


def test_baseten_custom_base_and_model(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "key123")
    monkeypatch.setenv("BASETEN_BASE_URL", "https://custom.example/v1")
    monkeypatch.setenv("BASETEN_MODEL", "custom-model")
    seen = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        seen.update(url=url, json=json)
        return _ok("hi")

    monkeypatch.setattr(httpx, "post", fake_post)
    assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "hi"
    assert seen["url"] == "https://custom.example/v1/chat/completions"
    assert seen["json"]["model"] == "custom-model"


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


def test_baseten_timeout_falls_back_to_meta(monkeypatch):
    _clear(monkeypatch)
    calls, rows = _baseten_ok_meta_ok(monkeypatch, httpx.TimeoutException("slow"))
    try:
        assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "meta answer"
        assert [c["model"] for c in calls] == ["meta-models/muse-spark-open-1026", "muse-spark-1.3"]
        assert calls[0]["timeout"] == 25
        assert calls[0]["auth"] == "Bearer baseten-key"
        assert calls[1]["auth"] == "Bearer meta-key"
        assert len(rows) == 2
        assert rows[0]["ok"] is False and rows[0]["model"] == "meta-models/muse-spark-open-1026"
        assert rows[1]["ok"] is True and rows[1]["model"] == "muse-spark-1.3"
    finally:
        trace.set_sink(None)


def test_baseten_5xx_falls_back_to_meta(monkeypatch):
    _clear(monkeypatch)
    calls, rows = _baseten_ok_meta_ok(monkeypatch, httpx.Response(500, json={"error": "boom"}))
    monkeypatch.setattr(meta, "_sleep", lambda s: None)
    try:
        assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "meta answer"
        assert len(calls) == 2 and len(rows) == 2
        assert rows[0]["ok"] is False and "500" in str(rows[0]["error"])
        assert rows[1]["ok"] is True and rows[1]["model"] == "muse-spark-1.3"
    finally:
        trace.set_sink(None)


def test_baseten_empty_content_falls_back_to_meta(monkeypatch):
    _clear(monkeypatch)
    for bad in ("", None, "   "):
        calls, rows = _baseten_ok_meta_ok(monkeypatch, _ok(bad))
        try:
            assert meta.chat("t", [{"role": "user", "content": "hi"}]) == "meta answer"
            assert len(calls) == 2 and len(rows) == 2
            assert rows[0]["ok"] is False and rows[0]["error"] == "empty content"
            assert rows[1]["ok"] is True
        finally:
            trace.set_sink(None)


def test_baseten_failure_without_meta_key_returns_none(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-key")
    calls = []

    def fake_post(url, headers=None, json=None, timeout=None):
        calls.append(url)
        return httpx.Response(503, json={})

    monkeypatch.setattr(httpx, "post", fake_post)
    rows = []
    trace.set_sink(rows.append)
    try:
        assert meta.chat("t", [{"role": "user", "content": "hi"}]) is None
        assert len(calls) == 1 and len(rows) == 1 and rows[0]["ok"] is False
    finally:
        trace.set_sink(None)


def test_no_keys_makes_no_calls(monkeypatch):
    _clear(monkeypatch)

    def _fail(url, headers=None, json=None, timeout=None):
        raise AssertionError("must not call out when disabled")

    monkeypatch.setattr(httpx, "post", _fail)
    assert meta.enabled() is False
    assert meta.chat("t", [{"role": "user", "content": "hi"}]) is None


def test_fallback_never_logs_keys(monkeypatch):
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "super-secret-baseten")
    monkeypatch.setenv("MODEL_API_KEY", "super-secret-meta")

    def fake_post(url, headers=None, json=None, timeout=None):
        if "baseten" in url:
            return httpx.Response(500, json={})
        return httpx.Response(500, json={})

    monkeypatch.setattr(httpx, "post", fake_post)
    rows = []
    trace.set_sink(rows.append)
    try:
        assert meta.chat("t", [{"role": "user", "content": "hi"}]) is None
        assert len(rows) == 2 and all(r["ok"] is False for r in rows)
        assert "super-secret-baseten" not in str(rows)
        assert "super-secret-meta" not in str(rows)
    finally:
        trace.set_sink(None)


def test_image_path_never_calls_baseten(monkeypatch, tmp_path):
    """Image generation stays on Meta Muse Image even with a Baseten key set."""
    from PIL import Image

    from src.features.imagegen import providers
    _clear(monkeypatch)
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-key")
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    monkeypatch.delenv("RELAY_URL", raising=False)
    monkeypatch.delenv("RELAY_SECRET", raising=False)
    monkeypatch.setattr(providers.MuseProvider, "base", "http://meta.example/v1")
    monkeypatch.setattr(providers, "MEDIA_DIR", tmp_path)
    assert "baseten" not in providers.MuseProvider.base

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buf, "PNG")
    seen = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        seen.update(url=url, headers=headers, json=json)
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(buf.getvalue()).decode()}]})

    monkeypatch.setattr(httpx, "post", fake_post)
    urls = providers.generate({"business_name": "Acme"}, [], 1)
    assert len(urls) == 1 and urls[0].startswith("/media/")
    assert seen["url"] == "http://meta.example/v1/images/generations"
    assert "baseten" not in seen["url"]
    assert seen["headers"]["Authorization"] == "Bearer test-key"
    assert seen["json"]["model"] == "muse-image-1.0"
