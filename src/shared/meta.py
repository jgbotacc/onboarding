"""Chat client: Baseten Muse Spark with automatic Meta fallback, plus image parts.

Text and vision model calls go to Baseten first; when that call fails the
same request is retried once on Meta. Image generation stays on Meta
(see src/features/imagegen).

- Baseten: key BASETEN_API_KEY, base BASETEN_BASE_URL
  (default https://inference.baseten.co/v1), model BASETEN_MODEL
  (default meta-models/muse-spark-open-1026). OpenAI-compatible
  POST {base}/chat/completions with a Bearer key, 25s timeout.
- Meta fallback: key MODEL_API_KEY, base META_API_BASE
  (default https://api.meta.ai/v1), model META_CHAT_MODEL
  (default muse-spark-1.3).
- Without BASETEN_API_KEY the request goes straight to Meta (with the
  long-standing retry policy). Without either key chat is disabled (None).

The Baseten model always reasons: only choices[0].message.content is read;
reasoning_content and any reasoning field are ignored, and empty or missing
content counts as a failed call (traced, then Meta is tried). Reasoning
tokens arrive inside completion_tokens. Baseten cost uses
BASETEN_IN_USD_PER_1M and BASETEN_OUT_USD_PER_1M (defaults 1.25 and 4.25
USD, a high estimate).

Both attempts are traced with the real model id when they run. The key is
never logged or traced. chat() never raises.

Tests never call either provider: chat() returns None when no key is set,
and tests that need model output patch `meta.chat` (or httpx.post with a fake).
"""
import base64
import io
import json
import os
import time
from pathlib import Path

import httpx

from src.shared import trace

BASE = os.getenv("META_API_BASE", "https://api.meta.ai/v1")
MODEL = os.getenv("META_CHAT_MODEL", "muse-spark-1.3")
IN_USD_PER_1M = 1.25
OUT_USD_PER_1M = 4.25

BASETEN_BASE = os.getenv("BASETEN_BASE_URL", "https://inference.baseten.co/v1")
BASETEN_MODEL = os.getenv("BASETEN_MODEL", "meta-models/muse-spark-open-1026")
BASETEN_TIMEOUT = 25
BASETEN_IN_USD_PER_1M = 1.25
BASETEN_OUT_USD_PER_1M = 4.25

_sleep = time.sleep


def enabled() -> bool:
    """True when chat can run: either provider key is set (read at call time)."""
    return bool(os.getenv("BASETEN_API_KEY") or os.getenv("MODEL_API_KEY"))


def _usd_per_1m(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return float(default)


def _single(step: str, base: str, model: str, key: str, body: dict, timeout: float,
            session_id: str | None, in_rate: float, out_rate: float) -> tuple[str | None, bool]:
    """One POST {base}/chat/completions. Returns (content_or_None, retryable).

    Only message.content is read; reasoning fields are ignored and empty or
    missing content fails. Every outcome is traced with the real model id.
    Never raises, never logs the key.
    """
    t0 = time.perf_counter()
    try:
        r = httpx.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"},
                       json=body, timeout=timeout)
    except (httpx.TimeoutException, httpx.TransportError) as e:
        ms = int((time.perf_counter() - t0) * 1000)
        trace.record(step, model, False, ms, 0.0, session_id, type(e).__name__)
        return None, True
    except Exception as e:
        ms = int((time.perf_counter() - t0) * 1000)
        trace.record(step, model, False, ms, 0.0, session_id, f"{type(e).__name__}: {e}")
        return None, False
    ms = int((time.perf_counter() - t0) * 1000)
    if r.status_code == 429 or r.status_code >= 500:
        trace.record(step, model, False, ms, 0.0, session_id, f"HTTP {r.status_code}")
        return None, True
    if r.status_code >= 400:
        trace.record(step, model, False, ms, 0.0, session_id, f"HTTP {r.status_code}")
        return None, False
    try:
        data = r.json()
        content = data["choices"][0]["message"]["content"]
    except Exception as e:
        trace.record(step, model, False, ms, 0.0, session_id, f"bad response: {e}")
        return None, False
    if not content or (isinstance(content, str) and not content.strip()):
        trace.record(step, model, False, ms, 0.0, session_id, "empty content")
        return None, False
    u = data.get("usage") or {}
    usd = (u.get("prompt_tokens", 0) * in_rate
           + u.get("completion_tokens", 0) * out_rate) / 1e6
    trace.record(step, model, True, ms, trace.usd_to_sgd(usd), session_id)
    return content, False


def _body(model: str, messages: list, json_mode: bool, temperature: float) -> dict:
    body = {"model": model, "messages": messages, "temperature": temperature}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    return body


def chat(step: str, messages: list, *, session_id: str | None = None, json_mode: bool = False,
         timeout: float = 60, temperature: float = 0.2) -> str | None:
    """POST chat/completions on Baseten, falling back to Meta once.

    When BASETEN_API_KEY is set, one Baseten attempt (25s timeout) runs
    first; any failure (error, timeout, HTTP error, bad response, empty
    content) retries the same request once on Meta if MODEL_API_KEY is set.
    Without BASETEN_API_KEY the request goes straight to Meta, retrying
    twice on timeouts/transport/429/5xx (1s, 2s). Returns the content, or
    None when disabled or every attempt fails. Never raises, never logs
    the key.
    """
    baseten_key = os.getenv("BASETEN_API_KEY")
    meta_key = os.getenv("MODEL_API_KEY")
    if baseten_key:
        base = os.getenv("BASETEN_BASE_URL", BASETEN_BASE)
        model = os.getenv("BASETEN_MODEL", BASETEN_MODEL)
        in_rate = _usd_per_1m("BASETEN_IN_USD_PER_1M", BASETEN_IN_USD_PER_1M)
        out_rate = _usd_per_1m("BASETEN_OUT_USD_PER_1M", BASETEN_OUT_USD_PER_1M)
        content, _ = _single(step, base, model, baseten_key,
                             _body(model, messages, json_mode, temperature),
                             BASETEN_TIMEOUT, session_id, in_rate, out_rate)
        if content is not None:
            return content
        if not meta_key:
            return None
        m_base = os.getenv("META_API_BASE", BASE)
        m_model = os.getenv("META_CHAT_MODEL", MODEL)
        content, _ = _single(step, m_base, m_model, meta_key,
                             _body(m_model, messages, json_mode, temperature),
                             timeout, session_id, IN_USD_PER_1M, OUT_USD_PER_1M)
        return content
    if not meta_key:
        return None
    base = os.getenv("META_API_BASE", BASE)
    model = os.getenv("META_CHAT_MODEL", MODEL)
    body = _body(model, messages, json_mode, temperature)
    for i in range(3):
        content, retryable = _single(step, base, model, meta_key, body,
                                     timeout, session_id, IN_USD_PER_1M, OUT_USD_PER_1M)
        if content is not None:
            return content
        if not retryable:
            return None
        if i < 2:
            _sleep(1 if i == 0 else 2)
    return None


def chat_json(step, messages, **kw) -> dict | None:
    """chat() with json_mode; parse JSON (strips ``` fences). None on failure."""
    try:
        out = chat(step, messages, json_mode=True, **kw)
        if not out:
            return None
        s = out.strip()
        if s.startswith("```"):
            lines = s.splitlines()[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            s = "\n".join(lines)
        d = json.loads(s)
        return d if isinstance(d, dict) else None
    except Exception:
        return None


def image_part(path_or_bytes, max_side=1600) -> dict:
    """Image understanding part: JPEG data URL (RGB, q85, thumbnail to max_side)."""
    from PIL import Image
    data = open(path_or_bytes, "rb").read() if isinstance(path_or_bytes, (str, Path)) else bytes(path_or_bytes)
    im = Image.open(io.BytesIO(data)).convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return {"type": "image_url",
            "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()}}
