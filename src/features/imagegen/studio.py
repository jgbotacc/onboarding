"""Staff image studio prompt builder and post-process resizing (no Meta calls)."""
import re
from pathlib import Path

from PIL import Image, ImageOps

from src.features.imagegen import providers
from src.features.looks import brief as looks_brief
from src.features.looks.brief import design_context
from src.shared import guard
from src.shared.config import MEDIA_DIR

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
                 "text": "Include the business logo prominently at the top of the design",
                 "prompt": "Include the business logo prominently at the top of the design"},
    "less_text": {"id": "less_text", "label": "Less text",
                  "text": "Keep text minimal, only the headline offer and the business name",
                  "prompt": "Keep text minimal, only the headline offer and the business name"},
    "story_size": {"id": "story_size", "label": "Story size",
                   "text": "Optimise the layout for a vertical full-screen story format",
                   "prompt": "Optimise the layout for a vertical full-screen story format"},
    "match_photos": {"id": "match_photos", "label": "Match photos",
                     "text": "Match the colours and style of the attached reference photos",
                     "prompt": "Match the colours and style of the attached reference photos"},
    "festive": {"id": "festive", "label": "Festive",
                "text": "Festive look with warm celebratory accents",
                "prompt": "Festive look with warm celebratory accents"},
    "bolder_headline": {"id": "bolder_headline", "label": "Bolder headline",
                        "text": "Make the headline extra big and bold, the dominant element",
                        "prompt": "Make the headline extra big and bold, the dominant element"},
}


def own_identifiers(fields: dict | None) -> set[str]:
    """The client's own email, phone digits and UEN (for guard.clean masking)."""
    out: set[str] = set()
    f = fields or {}
    email = f.get("email")
    if isinstance(email, str) and email.strip():
        out.add(email.strip().lower())
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


def _avoid_list(rejected) -> list[str]:
    items: list[str] = []
    for r in rejected or []:
        if isinstance(r, dict):
            for k in ("title", "brief", "style"):
                v = r.get(k)
                if isinstance(v, str) and v.strip() and v.strip() not in items:
                    items.append(v.strip())
        elif isinstance(r, str) and r.strip() and r.strip() not in items:
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
    avoid = _avoid_list(rejected)
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
