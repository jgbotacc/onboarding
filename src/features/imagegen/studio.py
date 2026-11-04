"""Staff image studio: prompt builder, post-process resizing, and Meta image calls."""
import base64
import os
import random
import re
import time
import uuid
from pathlib import Path

import httpx
from PIL import Image, ImageOps

from src.features.imagegen import providers
from src.features.looks import brief as looks_brief
from src.features.looks.brief import design_context
from src.shared import guard, relay, trace
from src.shared.config import MEDIA_DIR

_sleep = time.sleep

MAX_PROMPT = 3900

PRESETS = {
    "post": {"id": "post", "label": "Square post", "w": 1080, "h": 1080,
             "width": 1080, "height": 1080, "size": "1024x1024", "hint": "1024x1024",
             "shape": "Square 1:1 social media marketing post. Clean, professional layout"},
    "story": {"id": "story", "label": "Story", "w": 1080, "h": 1920,
              "width": 1080, "height": 1920, "size": "1080x1920", "hint": "1080x1920",
              "shape": "Portrait 9:16 social media story"},
    "flyer": {"id": "flyer", "label": "Flyer", "w": 1240, "h": 1754,
              "width": 1240, "height": 1754, "size": "1240x1754", "hint": "1240x1754",
              "shape": "Portrait A5 flyer"},
}

CHIPS = {
    "add_logo": {"id": "add_logo", "label": "Add logo",
                 "text": "Include the business logo at the top of the design",
                 "prompt": "Include the business logo at the top of the design"},
    "less_text": {"id": "less_text", "label": "Less text",
                  "text": "Keep text minimal, only the headline offer and the business name",
                  "prompt": "Keep text minimal, only the headline offer and the business name"},
    "match_photos": {"id": "match_photos", "label": "Match photos",
                     "text": "Match the colours and style of the attached reference photos",
                     "prompt": "Match the colours and style of the attached reference photos"},
    "festive": {"id": "festive", "label": "Festive",
                "text": "Festive look with warm celebratory accents",
                "prompt": "Festive look with warm celebratory accents"},
    "bolder_headline": {"id": "bolder_headline", "label": "Bolder headline",
                        "text": "Make the headline big and bold, the main element",
                        "prompt": "Make the headline big and bold, the main element"},
}


def own_identifiers(fields: dict | None) -> set[str]:
    """The client's own email, phone digits, UEN and contact-name parts (for guard.clean masking)."""
    out: set[str] = set()
    f = fields or {}
    email = f.get("email")
    if isinstance(email, str) and email.strip():
        out.add(email.strip().lower())
    name = f.get("contact_name")
    if isinstance(name, str) and len(name.strip()) >= 3:
        out.add(name.strip())
        for part in re.findall(r"[A-Za-z]{3,}", name):
            out.add(part.strip())
    for key in ("phone_number", "phone", "mobile"):
        v = f.get(key)
        if isinstance(v, str) and v.strip():
            d = re.sub(r"\D", "", v)
            if len(d) >= 8:
                out.add(d)
    uen = f.get("uen")
    if isinstance(uen, str) and uen.strip():
        out.add(uen.strip().lower())
    out.discard("")
    return out


def _rejected_titles(rejected) -> set[str]:
    titles: set[str] = set()
    for r in rejected or []:
        if isinstance(r, dict):
            t = r.get("title")
            if isinstance(t, str) and t.strip():
                titles.add(t.strip())
        elif isinstance(r, str) and r.strip():
            titles.add(r.strip())
    return titles


def _avoid_list(rejected, exclude=()) -> list[str]:
    exc = {str(e).strip().lower() for e in (exclude or [])
           if isinstance(e, str) and str(e).strip()}
    items: list[str] = []
    for r in rejected or []:
        if isinstance(r, dict):
            t = r.get("title")
            if isinstance(t, str) and t.strip():
                if t.strip().lower() != "your brief" and t.strip() not in items:
                    items.append(t.strip())
            for k in ("brief", "style"):
                v = r.get(k)
                if isinstance(v, str) and v.strip() and v.strip() not in items:
                    if v.strip().lower() not in exc:
                        items.append(v.strip())
        elif isinstance(r, str) and r.strip() and r.strip() not in items:
            if r.strip().lower() == "your brief":
                continue
            if r.strip().lower() in exc:
                continue
            items.append(r.strip())
    return items


def variants(rejected_titles=None, direction: str | None = None) -> list[dict]:
    """3 style variants, no Meta call: the brief first, then 2 ALTERNATIVES not rejected."""
    if isinstance(rejected_titles, str) and isinstance(direction, (list, tuple, set)):
        rejected_titles, direction = direction, rejected_titles
    rej: set[str] = set()
    for t in rejected_titles or []:
        if isinstance(t, dict):
            v = t.get("title")
            if isinstance(v, str) and v.strip():
                rej.add(v.strip())
        elif isinstance(t, str) and t.strip():
            rej.add(t.strip())
    style1 = str(direction or "").strip() or "clean and professional"
    out = [{"title": "Your brief", "style": style1}]
    for title, style in looks_brief.ALTERNATIVES:
        if title not in rej:
            out.append({"title": title, "style": style})
        if len(out) == 3:
            break
    if len(out) < 3:  # everything rejected: fill from the list anyway
        for title, style in looks_brief.ALTERNATIVES:
            if title not in {d["title"] for d in out}:
                out.append({"title": title, "style": style})
            if len(out) == 3:
                break
    # One run must never show the same style title twice: suffix any repeat.
    seen: set[str] = set()
    for d in out:
        title = d["title"]
        if title in seen:
            i = 2
            while f"{title} ({i})" in seen:
                i += 1
            d["title"] = f"{title} ({i})"
        seen.add(d["title"])
    return out


def studio_prompt(fields, direction=None, rejected=None, marketer_prompt: str = "",
                  chips=(), preset: str = "post", style=None, own_ids=None) -> str:
    """Prompt from design_context only + avoid titles/briefs + masked marketer text.

    Contact fields never enter via design_context ALLOWED; the marketer text is
    masked with guard.clean (own email/phone/UEN + NRIC scrub). Capped at 3900 chars.
    """
    if own_ids is None:
        own_ids = own_identifiers(fields)
    masked, _ = guard.clean(marketer_prompt or "", set(own_ids))
    if isinstance(style, dict):
        style_text = style.get("style") or style.get("title")
    else:
        style_text = style
    ctx = design_context(fields, (str(style_text).strip() or direction)
                         if style_text else direction, None)
    _exc = []
    if isinstance(direction, str) and direction.strip():
        _exc.append(direction.strip())
    _dp = (fields or {}).get("design_preferences")
    if isinstance(_dp, str) and _dp.strip():
        _exc.append(_dp.strip())
    avoid = _avoid_list(rejected, _exc)
    if avoid:
        ctx = dict(ctx, avoid=avoid)
    key = str(preset) if str(preset) in PRESETS else "post"
    base = providers.build_prompt(ctx, shape=PRESETS[key]["shape"])
    parts = [base]
    if isinstance(masked, str) and masked.strip():
        parts.append(f"Marketer direction: {masked.strip()}")
    for cid in chips or []:
        chip = CHIPS.get(str(cid))
        if chip:
            parts.append(chip["text"])
    prompt = ". ".join(p.strip().rstrip(".") for p in parts if p and p.strip()) + "."
    prompt, _ = guard.clean(prompt, set(own_ids))
    return prompt[:MAX_PROMPT]


def _edge_colour(im: Image.Image) -> tuple:
    """Average colour sampled from the image edge, for pad backgrounds."""
    rgb = im.convert("RGB")
    w, h = rgb.size
    e = max(1, min(w, h) // 50)
    px = rgb.load()
    rs = gs = bs = n = 0
    for x in range(w):
        for y in list(range(e)) + list(range(h - e, h)):
            r, g, b = px[x, y]
            rs += r; gs += g; bs += b; n += 1
    for y in range(e, h - e):
        for x in list(range(e)) + list(range(w - e, w)):
            r, g, b = px[x, y]
            rs += r; gs += g; bs += b; n += 1
    if not n:
        r, g, b = px[w // 2, h // 2]
        return (r, g, b)
    return (rs // n, gs // n, bs // n)


def to_size(url: str, size: tuple) -> str:
    """Resize a stored /media image to exactly (w, h) without stretching.

    Centre-crop (ImageOps.fit) by default; when the crop would cut more than
    15% of either side, pad on an edge-sampled background instead.
    """
    w, h = int(size[0]), int(size[1])
    path = Path(MEDIA_DIR) / str(url).rsplit("/", 1)[-1]
    with Image.open(path) as im:
        im = im.convert("RGB")
        if im.size == (w, h):
            return url
        iw, ih = im.size
        scale = max(w / iw, h / ih)
        cut_w = (iw - w / scale) / iw if iw else 0
        cut_h = (ih - h / scale) / ih if ih else 0
        if cut_w > 0.15 or cut_h > 0.15:
            bg = _edge_colour(im)
            fit_scale = min(w / iw, h / ih)
            nw, nh = max(1, round(iw * fit_scale)), max(1, round(ih * fit_scale))
            small = im.resize((nw, nh), Image.LANCZOS)
            out = Image.new("RGB", (w, h), bg)
            out.paste(small, ((w - nw) // 2, (h - nh) // 2))
        else:
            out = ImageOps.fit(im, (w, h), Image.LANCZOS)
    out.save(path, "PNG")
    return url


def _http_error(status, text) -> str:
    """Short one-line error for an HTTP failure."""
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if text:
        return f"HTTP {status}: {text[:150]}"
    return f"HTTP {status}"


def _retry_delay(response, attempt: int) -> float:
    """Backoff before the next retry: 0.5 s then 1 s plus jitter, or Retry-After (capped at 10 s)."""
    try:
        raw = response.headers.get("retry-after")
    except Exception:
        raw = None
    if raw is not None:
        try:
            return max(0.0, min(float(str(raw).strip()), 10.0))
        except (TypeError, ValueError):
            pass
    base = 0.5 if attempt == 0 else 1.0
    return base + random.uniform(0, 0.1)


def studio_generate(prompt, preset="post", images=(), session_id=None, user=None) -> dict:
    """One studio image call (generations, or edits with reference images). Never raises.

    Returns {"ok": True, "url": "/media/<uuid>.png"} or {"ok": False, "error": short text}.
    Retries 429, 503, timeouts and transport errors twice; every attempt is traced
    as "studio_image". No placeholder fallback: failures stay failed.
    """
    try:
        return _studio_generate(prompt, preset, images, session_id, user)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:200]}


def _studio_generate(prompt, preset="post", images=(), session_id=None, user=None) -> dict:
    use_relay = relay.enabled()
    key = os.getenv("MODEL_API_KEY")
    if not use_relay and not key:
        return {"ok": False, "error": "image generation is not configured"}
    model = os.getenv("MUSE_MODEL", "muse-image-1.0")
    cfg = PRESETS.get(str(preset)) or PRESETS["post"]
    refs = list(images or [])
    op = "edits" if refs else "generations"
    body = {"model": model, "prompt": prompt, "n": 1, "size": cfg["hint"],
            "response_format": "b64_json", "output_format": "png",
            "reasoning_strength": "low",
            "tool_enablement": {"enable_web_search": False, "enable_shell": False}}
    if user:
        body["user"] = user
    if refs:
        try:
            data_urls = [providers._data_url(p) for p in refs[:6]]
        except Exception as e:
            err = f"{type(e).__name__}: {e}"[:200]
            trace.record("studio_image", model, False, 0, 0.0, session_id, err)
            return {"ok": False, "error": err}
        body["images"] = [{"image_url": u} for u in data_urls]
    for attempt in range(3):
        t0 = time.perf_counter()
        try:
            if use_relay:
                r = relay.post(f"/api/muse?op={op}", json=body, timeout=90)
            else:
                base = os.getenv("META_API_BASE", "https://api.meta.ai/v1")
                r = httpx.post(f"{base}/images/{op}", json=body, timeout=180,
                               headers={"Authorization": f"Bearer {key}"})
        except (httpx.TimeoutException, httpx.TransportError) as e:
            ms = int((time.perf_counter() - t0) * 1000)
            err = f"{type(e).__name__}: {e}"[:200] or type(e).__name__
            trace.record("studio_image", model, False, ms, 0.0, session_id, err)
            if attempt < 2:
                _sleep(0.5 + random.uniform(0, 0.1) if attempt == 0
                       else 1.0 + random.uniform(0, 0.1))
                continue
            return {"ok": False, "error": err}
        except Exception as e:
            ms = int((time.perf_counter() - t0) * 1000)
            err = f"{type(e).__name__}: {e}"[:200]
            trace.record("studio_image", model, False, ms, 0.0, session_id, err)
            return {"ok": False, "error": err}
        ms = int((time.perf_counter() - t0) * 1000)
        status = r.status_code
        if status >= 400:
            try:
                text = r.text
            except Exception:
                text = ""
            err = _http_error(status, text)
            trace.record("studio_image", model, False, ms, 0.0, session_id, err)
            if status in (429, 503) and attempt < 2:
                _sleep(_retry_delay(r, attempt))
                continue
            return {"ok": False, "error": err}
        try:
            raw = base64.b64decode(r.json()["data"][0]["b64_json"])
        except Exception as e:
            err = f"bad response: {e}"[:200]
            trace.record("studio_image", model, False, ms, 0.0, session_id, err)
            return {"ok": False, "error": err}
        try:
            name = f"{uuid.uuid4().hex}.png"
            (MEDIA_DIR / name).write_bytes(raw)
            url = f"/media/{name}"
            to_size(url, (cfg["w"], cfg["h"]))
        except Exception as e:
            err = f"{type(e).__name__}: {e}"[:200]
            trace.record("studio_image", model, False, ms, 0.0, session_id, err)
            return {"ok": False, "error": err}
        trace.record("studio_image", model, True, ms, trace.usd_to_sgd(trace.IMAGE_USD), session_id)
        return {"ok": True, "url": url}
    return {"ok": False, "error": "request failed"}
