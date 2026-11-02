"""Meta Model API client (Muse Spark chat + image parts).

Tests never call Meta: MODEL_API_KEY is unset in tests so chat() returns None,
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

_sleep = time.sleep


def enabled() -> bool:
    """True only when MODEL_API_KEY is set (read at call time)."""
    return bool(os.getenv("MODEL_API_KEY"))


def chat(step: str, messages: list, *, session_id: str | None = None, json_mode: bool = False,
         timeout: float = 60, temperature: float = 0.2) -> str | None:
    """POST chat/completions. Retries twice on timeouts/transport/429/5xx (1s, 2s).

    Every attempt is traced. Returns the content, or None if disabled or all
    attempts fail. Never raises, never logs the key.
    """
    key = os.getenv("MODEL_API_KEY")
    if not key:
        return None
    base = os.getenv("META_API_BASE", BASE)
    model = os.getenv("META_CHAT_MODEL", MODEL)
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
                u = data.get("usage") or {}
                usd = (u.get("prompt_tokens", 0) * IN_USD_PER_1M
                       + u.get("completion_tokens", 0) * OUT_USD_PER_1M) / 1e6
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
