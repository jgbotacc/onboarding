"""Chat client: Baseten Muse Spark with Meta fallback, plus image parts.

Text and vision model calls go through Baseten when it is configured, with
Meta as the fallback. Image generation stays on Meta (see src/features/imagegen).

Provider choice (read at call time from the environment):
- CHAT_PROVIDER=baseten or meta. When unset: baseten if BASETEN_API_KEY
  is set, else meta.
- Baseten: key BASETEN_API_KEY, base BASETEN_BASE_URL
  (default https://inference.baseten.co/v1), model BASETEN_MODEL
  (default meta-models/muse-spark-open-1026). OpenAI-compatible
  POST {base}/chat/completions with a Bearer key.
- Meta: key MODEL_API_KEY, base META_API_BASE, model META_CHAT_MODEL.
- CHAT_PROVIDER=baseten without BASETEN_API_KEY means chat is disabled
  (returns None); it never falls back to Meta silently.

The Baseten model always reasons: only choices[0].message.content is read;
reasoning_content and any reasoning field are ignored, and empty or missing
content counts as a failed call (traced, returns None). Reasoning tokens
arrive inside completion_tokens. Baseten cost uses BASETEN_IN_USD_PER_1M
and BASETEN_OUT_USD_PER_1M (defaults 1.25 and 4.25 USD, a high estimate).

Both providers share the same retries, tracing and never-raise behaviour,
and the real model id is traced. The key is never logged or traced.

Tests never call either provider: chat() returns None when the chosen
provider has no key, and tests that need model output patch `meta.chat`
(or httpx.post with a fake).
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
BASETEN_IN_USD_PER_1M = 1.25
BASETEN_OUT_USD_PER_1M = 4.25

_sleep = time.sleep


def provider() -> str:
    """Return "baseten" or "meta", chosen by env, read at call time.

    CHAT_PROVIDER=baseten or meta wins. When unset (or anything else),
    baseten is chosen if BASETEN_API_KEY is set, else meta.
    """
    which = os.getenv("CHAT_PROVIDER")
    if which == "baseten":
        return "baseten"
    if which == "meta":
        return "meta"
    return "baseten" if os.getenv("BASETEN_API_KEY") else "meta"


def enabled() -> bool:
    """True only when the chosen provider has its key (read at call time)."""
    if provider() == "baseten":
        return bool(os.getenv("BASETEN_API_KEY"))
    return bool(os.getenv("MODEL_API_KEY"))


def _usd_per_1m(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return float(default)


def chat(step: str, messages: list, *, session_id: str | None = None, json_mode: bool = False,
         timeout: float = 60, temperature: float = 0.2) -> str | None:
    """POST {base}/chat/completions via the chosen provider.

    Retries twice on timeouts/transport/429/5xx (1s, 2s). Every attempt is
    traced with the real model id. Returns the content, or None if disabled
    (including CHAT_PROVIDER=baseten without BASETEN_API_KEY) or all
    attempts fail. Only choices[0].message.content is read; reasoning
    fields are ignored and empty/missing content fails. Never raises,
    never logs the key.
    """
    if provider() == "baseten":
        key = os.getenv("BASETEN_API_KEY")
        if not key:
            return None
        base = os.getenv("BASETEN_BASE_URL", BASETEN_BASE)
        model = os.getenv("BASETEN_MODEL", BASETEN_MODEL)
        in_rate = _usd_per_1m("BASETEN_IN_USD_PER_1M", BASETEN_IN_USD_PER_1M)
        out_rate = _usd_per_1m("BASETEN_OUT_USD_PER_1M", BASETEN_OUT_USD_PER_1M)
    else:
        key = os.getenv("MODEL_API_KEY")
        if not key:
            return None
        base = os.getenv("META_API_BASE", BASE)
        model = os.getenv("META_CHAT_MODEL", MODEL)
        in_rate, out_rate = IN_USD_PER_1M, OUT_USD_PER_1M
    body = {"model": model, "messages": messages, "temperature": temperature}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    for i in range(3):
        t0 = time.perf_counter()
        try:
            r = httpx.post(f"{base}/chat/completions", headers={"Authorization": f"Bearer {key}"},
                           json=body, timeout=timeout)
            ms = int((time.perf_counter() - t0) * 1000)
            if r.status_code == 429 or r.status_code >= 500:
                trace.record(step, model, False, ms, 0.0, session_id, f"HTTP {r.status_code}")
            elif r.status_code >= 400:
                trace.record(step, model, False, ms, 0.0, session_id, f"HTTP {r.status_code}")
                return None
            else:
                try:
                    data = r.json()
                    content = data["choices"][0]["message"]["content"]
                except Exception as e:
                    trace.record(step, model, False, ms, 0.0, session_id, f"bad response: {e}")
                    return None
                if not content or (isinstance(content, str) and not content.strip()):
                    trace.record(step, model, False, ms, 0.0, session_id, "empty content")
                    return None
                u = data.get("usage") or {}
                usd = (u.get("prompt_tokens", 0) * in_rate
                       + u.get("completion_tokens", 0) * out_rate) / 1e6
                trace.record(step, model, True, ms, trace.usd_to_sgd(usd), session_id)
                return content
        except (httpx.TimeoutException, httpx.TransportError) as e:
            ms = int((time.perf_counter() - t0) * 1000)
            trace.record(step, model, False, ms, 0.0, session_id, type(e).__name__)
        except Exception as e:
            ms = int((time.perf_counter() - t0) * 1000)
            trace.record(step, model, False, ms, 0.0, session_id, f"{type(e).__name__}: {e}")
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
