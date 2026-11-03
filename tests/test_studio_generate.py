"""Studio image generation: body shapes, retries, traces, exact sizes (no network)."""
import base64
import io
import uuid

import httpx
from PIL import Image

from src.features.imagegen import providers, studio
from src.shared import relay, trace
from src.shared.config import MEDIA_DIR


def _png_b64(size=(1600, 1600), colour="red"):
    buf = io.BytesIO()
    Image.new("RGB", size, colour).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _ok_response():
    return httpx.Response(200, json={"data": [{"b64_json": _png_b64()}]}, request=httpx.Request("POST", "https://x"))


def _direct_env(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    monkeypatch.delenv("RELAY_URL", raising=False)
    monkeypatch.delenv("RELAY_SECRET", raising=False)
    monkeypatch.delenv("META_API_BASE", raising=False)


def _track(monkeypatch):
    """Capture sleeps, trace rows, and media files made by studio_generate."""
    sleeps, rows, urls = [], [], []
    monkeypatch.setattr(studio, "_sleep", sleeps.append)
    trace.set_sink(rows.append)
    real_to_size = studio.to_size

    def wrap(url, size):
        out = real_to_size(url, size)
        urls.append(out)
        return out

    monkeypatch.setattr(studio, "to_size", wrap)
    return sleeps, rows, urls


def _cleanup(urls):
    for u in urls:
        try:
            (MEDIA_DIR / u.rsplit("/", 1)[-1]).unlink()
        except OSError:
            pass


def _media_size(url):
    with Image.open(MEDIA_DIR / url.rsplit("/", 1)[-1]) as im:
        return im.size


def test_generations_body_shape_and_trace(monkeypatch):
    _direct_env(monkeypatch)
    sleeps, rows, urls = _track(monkeypatch)
    seen = {}

    def fake_post(url, json=None, timeout=None, headers=None):
        seen.update(url=url, body=json, timeout=timeout, headers=headers)
        assert headers["Authorization"] == "Bearer test-key"
        return _ok_response()

    monkeypatch.setattr(httpx, "post", fake_post)
    try:
        out = studio.studio_generate("a sunny bakery post", "post", session_id="s1")
        assert out["ok"] is True and out["url"].startswith("/media/")
        assert seen["url"].endswith("/images/generations")
        body = seen["body"]
        assert body["model"] == "muse-image-1.0" and body["prompt"] == "a sunny bakery post"
        assert body["n"] == 1 and body["size"] == "1024x1024"
        assert body["response_format"] == "b64_json" and body["output_format"] == "png"
        assert body["reasoning_strength"] == "low"
        assert body["tool_enablement"] == {"enable_web_search": False, "enable_shell": False}
        assert "images" not in body and "user" not in body
        assert seen["timeout"] == 180
        assert _media_size(out["url"]) == (1080, 1080)
        assert len(rows) == 1 and not sleeps
        row = rows[0]
        assert row["step"] == "studio_image" and row["model"] == "muse-image-1.0"
        assert row["ok"] is True and row["session_id"] == "s1"
        assert row["cost_sgd"] == trace.usd_to_sgd(trace.IMAGE_USD)
        assert isinstance(row["latency_ms"], int)
    finally:
        _cleanup([out["url"]] if out.get("ok") else [])
        trace.set_sink(None)


def test_size_per_preset(monkeypatch):
    _direct_env(monkeypatch)
    for preset, hint in (("post", "1024x1024"), ("story", "1080x1920"), ("flyer", "1240x1754")):
        sleeps, rows, urls = _track(monkeypatch)
        seen = {}
        monkeypatch.setattr(httpx, "post",
                            lambda *a, **k: seen.update(body=k["json"]) or _ok_response())
        try:
            out = studio.studio_generate("p", preset, session_id="s")
            assert out["ok"] is True, preset
            assert seen["body"]["size"] == hint, preset
            cfg = studio.PRESETS[preset]
            assert _media_size(out["url"]) == (cfg["w"], cfg["h"]), preset
            assert rows[-1]["ok"] is True and rows[-1]["cost_sgd"] > 0
        finally:
            _cleanup([out["url"]] if out.get("ok") else [])
            trace.set_sink(None)


def test_user_only_when_given(monkeypatch):
    _direct_env(monkeypatch)
    sleeps, rows, urls = _track(monkeypatch)
    bodies = []
    monkeypatch.setattr(httpx, "post",
                        lambda *a, **k: bodies.append(k["json"]) or _ok_response())
    try:
        out = studio.studio_generate("p", "post")
        assert out["ok"] is True and "user" not in bodies[-1]
        _cleanup([out["url"]])
        out = studio.studio_generate("p", "post", user="marketer-7")
        assert out["ok"] is True and bodies[-1]["user"] == "marketer-7"
        _cleanup([out["url"]])
    finally:
        trace.set_sink(None)


def test_edits_remix_source_first_and_capped(monkeypatch):
    _direct_env(monkeypatch)
    sleeps, rows, urls = _track(monkeypatch)
    refs = []
    try:
        for colour in ("red", "green", "blue", "yellow", "pink", "teal", "navy"):
            p = str(MEDIA_DIR / f"studio-ref-{uuid.uuid4().hex}.jpg")
            Image.new("RGB", (400, 300), colour).save(p, "JPEG")
            refs.append(p)
        remix = str(MEDIA_DIR / f"studio-remix-{uuid.uuid4().hex}.jpg")
        Image.new("RGB", (500, 400), "orange").save(remix, "JPEG")
        refs.append(remix)
        ordered = [remix] + refs  # remix source first
        seen = {}
        monkeypatch.setattr(httpx, "post",
                            lambda url, **k: seen.update(url=url, body=k["json"]) or _ok_response())
        out = studio.studio_generate("remix this", "story", images=ordered, session_id="s9")
        assert out["ok"] is True
        assert seen["url"].endswith("/images/edits")
        body = seen["body"]
        assert len(body["images"]) == 6  # at most 6
        assert body["images"][0] == {"image_url": providers._data_url(remix)}
        assert body["size"] == "1080x1920"
        assert _media_size(out["url"]) == (1080, 1920)
        assert rows[-1]["ok"] is True
        _cleanup([out["url"]])
    finally:
        for p in refs:
            try:
                import os
                os.unlink(p)
            except OSError:
                pass
        trace.set_sink(None)


def test_503_then_success_retries(monkeypatch):
    _direct_env(monkeypatch)
    sleeps, rows, urls = _track(monkeypatch)
    calls = []

    def fake_post(*a, **k):
        calls.append(k["json"])
        if len(calls) == 1:
            return httpx.Response(503, text="overloaded")
        return _ok_response()

    monkeypatch.setattr(httpx, "post", fake_post)
    try:
        out = studio.studio_generate("p", "post", session_id="s2")
        assert out["ok"] is True
        assert len(calls) == 2
        assert len(sleeps) == 1 and 0.5 <= sleeps[0] <= 0.7
        assert [r["ok"] for r in rows] == [False, True]
        assert all(r["step"] == "studio_image" for r in rows)
        assert rows[0]["cost_sgd"] == 0.0 and rows[1]["cost_sgd"] > 0
        _cleanup([out["url"]])
    finally:
        trace.set_sink(None)


def test_429_retry_after_honoured(monkeypatch):
    _direct_env(monkeypatch)
    sleeps, rows, urls = _track(monkeypatch)
    calls = []

    def fake_post(*a, **k):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "2"}, text="rate limited")
        return _ok_response()

    monkeypatch.setattr(httpx, "post", fake_post)
    try:
        out = studio.studio_generate("p", "post")
        assert out["ok"] is True and len(calls) == 2
        assert sleeps == [2.0]
        assert [r["ok"] for r in rows] == [False, True]
        _cleanup([out["url"]])
    finally:
        trace.set_sink(None)


def test_retry_after_capped_at_ten(monkeypatch):
    _direct_env(monkeypatch)
    sleeps, rows, urls = _track(monkeypatch)
    calls = []

    def fake_post(*a, **k):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503, headers={"Retry-After": "120"}, text="busy")
        return _ok_response()

    monkeypatch.setattr(httpx, "post", fake_post)
    try:
        out = studio.studio_generate("p", "post")
        assert out["ok"] is True
        assert sleeps == [10.0]
        _cleanup([out["url"]])
    finally:
        trace.set_sink(None)


def test_400_content_policy_not_retried(monkeypatch):
    _direct_env(monkeypatch)
    sleeps, rows, urls = _track(monkeypatch)
    calls = []

    def fake_post(*a, **k):
        calls.append(1)
        return httpx.Response(400, json={"error": {"code": "content_policy_violation"}})

    monkeypatch.setattr(httpx, "post", fake_post)
    try:
        out = studio.studio_generate("p", "post", session_id="s3")
        assert out["ok"] is False and "400" in out["error"]
        assert len(calls) == 1 and sleeps == [] and len(rows) == 1
        assert rows[0]["ok"] is False and rows[0]["cost_sgd"] == 0.0
    finally:
        trace.set_sink(None)


def test_500_not_retried(monkeypatch):
    _direct_env(monkeypatch)
    sleeps, rows, urls = _track(monkeypatch)
    calls = []
    monkeypatch.setattr(httpx, "post",
                        lambda *a, **k: calls.append(1) or httpx.Response(500, text="boom"))
    try:
        out = studio.studio_generate("p", "post")
        assert out["ok"] is False
        assert len(calls) == 1 and sleeps == [] and len(rows) == 1
    finally:
        trace.set_sink(None)


def test_three_timeouts_give_ok_false(monkeypatch):
    _direct_env(monkeypatch)
    sleeps, rows, urls = _track(monkeypatch)
    calls = []

    def fake_post(*a, **k):
        calls.append(1)
        raise httpx.ReadTimeout("timed out")

    monkeypatch.setattr(httpx, "post", fake_post)
    try:
        out = studio.studio_generate("p", "flyer", session_id="s4")
        assert out["ok"] is False and out["error"]
        assert len(calls) == 3 and len(rows) == 3
        assert all(not r["ok"] for r in rows)
        assert len(sleeps) == 2
        assert 0.5 <= sleeps[0] <= 0.7 and 1.0 <= sleeps[1] <= 1.2
    finally:
        trace.set_sink(None)


def test_transport_error_retried_then_success(monkeypatch):
    _direct_env(monkeypatch)
    sleeps, rows, urls = _track(monkeypatch)
    calls = []

    def fake_post(*a, **k):
        calls.append(1)
        if len(calls) == 1:
            raise httpx.ConnectError("conn reset")
        return _ok_response()

    monkeypatch.setattr(httpx, "post", fake_post)
    try:
        out = studio.studio_generate("p", "post")
        assert out["ok"] is True and len(calls) == 2 and len(sleeps) == 1
        _cleanup([out["url"]])
    finally:
        trace.set_sink(None)


def test_relay_path_used_when_configured(monkeypatch):
    monkeypatch.setenv("RELAY_URL", "https://relay.example.vercel.app")
    monkeypatch.setenv("RELAY_SECRET", "test-secret")
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    sleeps, rows, urls = _track(monkeypatch)
    seen = {}

    def fake_relay(path, json=None, timeout=60, client=None):
        seen.update(path=path, body=json, timeout=timeout)
        return _ok_response()

    monkeypatch.setattr(relay, "post", fake_relay)

    def no_net(*a, **k):
        raise AssertionError("direct httpx.post must not be called in relay mode")

    monkeypatch.setattr(httpx, "post", no_net)
    try:
        out = studio.studio_generate("relay pic", "post", session_id="s5")
        assert out["ok"] is True
        assert seen["path"] == "/api/muse?op=generations"
        assert seen["timeout"] == 90
        assert seen["body"]["size"] == "1024x1024"
        assert _media_size(out["url"]) == (1080, 1080)
        _cleanup([out["url"]])
    finally:
        trace.set_sink(None)


def test_relay_edits_op(monkeypatch):
    monkeypatch.setenv("RELAY_URL", "https://relay.example.vercel.app")
    monkeypatch.setenv("RELAY_SECRET", "test-secret")
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    sleeps, rows, urls = _track(monkeypatch)
    ref = str(MEDIA_DIR / f"studio-ref-{uuid.uuid4().hex}.jpg")
    Image.new("RGB", (300, 200), "green").save(ref, "JPEG")
    seen = {}
    monkeypatch.setattr(relay, "post",
                        lambda path, json=None, **k: seen.update(path=path, body=json) or _ok_response())
    try:
        out = studio.studio_generate("remix", "post", images=[ref])
        assert out["ok"] is True
        assert seen["path"] == "/api/muse?op=edits"
        assert len(seen["body"]["images"]) == 1
        _cleanup([out["url"]])
    finally:
        try:
            import os
            os.unlink(ref)
        except OSError:
            pass
        trace.set_sink(None)


def test_not_configured(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.delenv("RELAY_URL", raising=False)
    monkeypatch.delenv("RELAY_SECRET", raising=False)
    monkeypatch.setattr(httpx, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("no network")))
    out = studio.studio_generate("p", "post")
    assert out == {"ok": False, "error": "image generation is not configured"}


def test_never_raises_on_unexpected_error(monkeypatch):
    _direct_env(monkeypatch)
    monkeypatch.setattr(studio, "_sleep", lambda s: None)
    trace.set_sink(lambda r: None)
    try:
        monkeypatch.setattr(httpx, "post", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("weird")))
        out = studio.studio_generate("p", "post")
        assert out["ok"] is False and out["error"]
    finally:
        trace.set_sink(None)


def test_contact_name_masked_in_own_identifiers_and_prompt():
    fields = {"business_name": "An Ban Bakery", "contact_name": "Mei Chen",
              "email": "m@example.com", "uen": "201912345K"}
    ids = studio.own_identifiers(fields)
    assert "Mei Chen" in ids
    short = studio.own_identifiers({"contact_name": "Jo"})
    assert "Jo" not in short
    p = studio.studio_prompt(fields, "Warm", [], "Featuring Mei Chen this weekend", [], "post")
    assert "Mei Chen" not in p
