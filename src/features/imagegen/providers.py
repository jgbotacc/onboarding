"""Image generation behind a provider interface. Default = labelled Pillow PLACEHOLDER."""
import os
import re
import time
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from src.shared import relay, trace
from src.shared.config import MEDIA_DIR

NAMED = {"red": "#d64545", "blue": "#2563eb", "green": "#2f9e57", "brown": "#7a4b2a", "cream": "#f3e9d2",
         "black": "#111111", "white": "#ffffff", "orange": "#f08c2e", "yellow": "#f2c94c", "purple": "#7b4bd6",
         "pink": "#e86fa6", "navy": "#1e3a8a", "teal": "#14b8a6", "grey": "#9ca3af", "gray": "#9ca3af",
         "tomato": "#ff6347", "coral": "#ff7f50", "salmon": "#fa8072", "peach": "#ffdab9",
         "beige": "#f5f5dc", "ivory": "#fffff0", "khaki": "#f0e68c", "sand": "#e6ccb2",
         "terracotta": "#e2725b", "clay": "#b66e41", "honey": "#eb9e34", "mustard": "#ffdb58",
         "gold": "#ffd700", "silver": "#c0c0c0", "bronze": "#cd7f32", "blush": "#ffb6c1",
         "lavender": "#e6e6fa", "lilac": "#c8a2c8", "plum": "#dda0dd", "orchid": "#da70d6",
         "magenta": "#ff00ff", "maroon": "#800000", "burgundy": "#800020", "wine": "#722f37",
         "ruby": "#e0115f", "emerald": "#50c878", "mint": "#98ff98", "lime": "#32cd32",
         "olive": "#808000", "forest": "#228b22", "turquoise": "#40e0d0", "cyan": "#00bcd4",
         "sky": "#87ceeb", "indigo": "#4b0082", "charcoal": "#36454f", "slate": "#64748b"}


def parse_colours(text: str | None) -> list[str]:
    if not text:
        return []
    found = re.findall(r"#[0-9a-fA-F]{6}", text)
    found += [NAMED[w] for w in re.findall(r"[a-z]+", text.lower()) if w in NAMED]
    return found[:3]


def _font(size, bold=True):
    names = (["DejaVuSans-Bold.ttf", "DejaVuSans.ttf"] if bold
             else ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"])
    for d in ("/usr/share/fonts/truetype/dejavu/", "/usr/share/fonts/dejavu/"):
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


# Fixed high-contrast + soft-warm palettes for the two alternative looks.
BOLD_COLOURS = ["#ff2e63", "#08d9d6", "#ffd60a"]
WARM_COLOURS = ["#e8935a", "#f6d8b8", "#c97b4a"]
NEUTRAL_COLOURS = ["#64748b"]


def _theme(brief: dict) -> str:
    """Which look draft this brief is: 'bold', 'warm', or the client's own 'brief'.

    Pure string matching on the look title when the caller passes one
    (``look_title``), else on the exact alternative style lines from
    ``looks.brief.ALTERNATIVES``; anything else is the client's brief.
    Never calls a model.
    """
    from src.features.looks.brief import ALTERNATIVES
    styles = {t.lower(): s.lower() for t, s in ALTERNATIVES}
    title = str(brief.get("look_title") or brief.get("title") or "").strip().lower()
    if title:
        if "bold" in title or "colourful" in title or "colorful" in title:
            return "bold"
        if "warm" in title or "friendly" in title:
            return "warm"
        return "brief"
    direction = str(brief.get("direction") or "").strip().lower()
    for known_title, known_style in styles.items():
        if direction and direction == known_style:
            if "bold" in known_title or "colourful" in known_title or "colorful" in known_title:
                return "bold"
            if "warm" in known_title or "friendly" in known_title:
                return "warm"
    return "brief"


def _client_colours(brief: dict) -> list[str]:
    """Colours named in the client's own fields; neutral fallback. No model call."""
    for key in ("brand_colours", "direction", "design_preferences"):
        cols = parse_colours(brief.get(key))
        if cols:
            return cols
    return list(NEUTRAL_COLOURS)


def _wrap(draw, text, font, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=font) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    return lines + ([cur] if cur else [])


class PlaceholderProvider:
    name = "placeholder"

    def generate(self, brief: dict, refs: list[str], round_n: int) -> list[str]:
        theme = _theme(brief)
        if theme == "bold":
            # Bright high-contrast palette, heavy large headline, full-width colour block.
            bg, accent, ink, sub = "#141414", BOLD_COLOURS[0], "#ffffff", "#ffd60a"
            cols = list(BOLD_COLOURS)
            head_size, head_bold, head_y = 96, True, 380
            d_head = "Design direction: bold, bright, high contrast"
        elif theme == "warm":
            # Soft warm palette, rounded shapes and corners, lighter friendlier type.
            bg, accent, ink, sub = "#fff4e6", WARM_COLOURS[0], "#7c4a2d", "#a9714b"
            cols = list(WARM_COLOURS)
            head_size, head_bold, head_y = 64, False, 280
            d_head = "Design direction: soft, warm and friendly"
        else:
            # The client's own brief: palette and feel from its colours, else neutral.
            cols = _client_colours(brief)
            bg, accent, ink, sub = "#f8fafc", cols[0], "#0f172a", "#475569"
            head_size, head_bold, head_y = 72, True, 200
            direction = brief.get("direction") or "not given"
            d_head = "Design direction: " + direction
            if brief.get("feedback"):
                d_head += "  |  Feedback: " + brief["feedback"]
        img = Image.new("RGB", (1080, 1080), bg)
        d = ImageDraw.Draw(img)
        if theme == "bold":
            d.rectangle([0, 0, 1080, 320], fill=accent)
            d.rectangle([0, 320, 1080, 344], fill=sub)
            d.text((40, 45), f"PLACEHOLDER  ·  round {round_n}", font=_font(44), fill="white")
        elif theme == "warm":
            d.rounded_rectangle([40, 36, 1040, 220], radius=60, fill=accent)
            d.text((80, 100), f"PLACEHOLDER  ·  round {round_n}", font=_font(36, False), fill="white")
        else:
            d.rectangle([0, 0, 1080, 140], fill=accent)
            d.text((40, 45), f"PLACEHOLDER  ·  round {round_n}", font=_font(44), fill="white")
        y = head_y
        for line in _wrap(d, brief.get("business_name", "Your business"), _font(head_size, head_bold), 1000)[:3]:
            d.text((40, y), line, font=_font(head_size, head_bold), fill=ink); y += head_size + 14
        tag = brief.get("tagline") or " · ".join(x for x in [brief.get("business_type"), brief.get("industry")] if x)
        for line in _wrap(d, tag, _font(40, not theme == "warm"), 1000)[:2]:
            d.text((40, y + 10), line, font=_font(40, not theme == "warm"), fill=sub if theme == "warm" else ink); y += 52
        for i, c in enumerate(cols):
            if theme == "warm":
                d.rounded_rectangle([40 + i * 90, y + 40, 110 + i * 90, y + 110], radius=24,
                                    fill=c, outline=sub)
            else:
                d.rectangle([40 + i * 90, y + 40, 110 + i * 90, y + 110], fill=c,
                            outline="#0f172a" if theme == "brief" else "white")
        y += 150
        txt = d_head
        for line in _wrap(d, txt, _font(30, theme != "warm"), 1000)[:6]:
            d.text((40, y), line, font=_font(30, theme != "warm"), fill=sub); y += 40
        for i, ref in enumerate(refs[:3]):
            try:
                th = Image.open(ref).convert("RGB"); th.thumbnail((300, 220))
                img.paste(th, (40 + i * 340, 820))
            except Exception:
                pass
        d.text((40, 1045), "Mock-up only. Not a final design.", font=_font(24), fill="#94a3b8")
        name = f"{uuid.uuid4().hex}.png"
        img.save(MEDIA_DIR / name)
        return [f"/media/{name}"]


SQUARE_LINE = "Square 1:1 social media marketing post. Clean, professional layout"
SHAPES = {
    "post": SQUARE_LINE,
    "story": "Portrait 9:16 social media story",
    "flyer": "Portrait A5 flyer",
}


def build_prompt(brief: dict, shape: str | None = None) -> str:
    """Muse prompt. Order: the post's headline offer (requirements / notes), then the design direction
    (style and colours), then business type and industry, then the business name. Empty fields are skipped.

    shape replaces the closing size line; None keeps the exact square text.
    A preset id ('post' | 'story' | 'flyer') maps to its size line, any other
    string is used verbatim.
    """
    clean = {k: v for k, v in (brief or {}).items() if not str(k).startswith("_")}
    name = (clean.get("business_name") or "").strip() or "a small business"
    notes = (clean.get("requirements_notes") or "").strip()
    style = (clean.get("direction") or clean.get("design_preferences") or "").strip()
    kind = " / ".join(x.strip() for x in (clean.get("business_type"), clean.get("industry")) if x and x.strip())
    parts = []
    if notes:
        parts.append(f"Main message and headline offer of the post: {notes}. Make this the biggest, clearest text "
                     "and show it as the focus of the image")
    else:
        parts.append(f"Social media marketing post for {name}")
    if style:
        parts.append(f"Design direction (style and colours): {style}")
    if clean.get("brand_colours"):
        parts.append(f"Brand colours: {clean['brand_colours']}")
    if kind:
        parts.append(f"Business type and industry: {kind}")
    parts.append(f"Business name: show '{name}' clearly")
    avoid = [str(a).strip() for a in (clean.get("avoid") or []) if str(a).strip()]
    if avoid:
        parts.append(f"Avoid these looks the client rejected: {'; '.join(avoid)}")
    if shape is None:
        line = SQUARE_LINE
    elif str(shape) in SHAPES:
        line = SHAPES[str(shape)]
    else:
        line = str(shape)
    parts.append(line)
    return ". ".join(parts) + "."


def _data_url(path: str, max_side: int = 1024) -> str:
    """JPEG data URL, downscaled so several images fit the relay's 4.5 MB body limit."""
    import base64, io
    im = Image.open(path).convert("RGB")
    im.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


class MuseProvider:
    """Meta Muse Image (muse-image-1.0) via the OpenAI-compatible images API. Needs MODEL_API_KEY."""
    name = "muse"
    base = os.getenv("META_API_BASE", "https://api.meta.ai/v1")

    def generate(self, brief, refs, round_n):
        import base64, httpx
        prompt = build_prompt(brief)
        images = []
        prev = brief.get("prev_image")
        if round_n > 1 and prev and Path(prev).exists():
            images.append(prev)
            prompt = (f"Revise this marketing post. Client feedback: {brief.get('feedback') or 'improve it'}. "
                      f"Keep what works. Context: " + prompt)
        images += [r for r in refs if Path(r).exists()][: 6 - len(images)]
        body = {"model": os.getenv("MUSE_MODEL", "muse-image-1.0"), "prompt": prompt[:3900], "n": 1,
                "response_format": "b64_json", "output_format": "png", "size": "1024x1024"}
        path = "/images/generations"
        if images:
            path = "/images/edits"
            body["images"] = [{"image_url": _data_url(i)} for i in images]
            if refs and round_n == 1:
                body["prompt"] = "Use the attached images as style references. " + body["prompt"]
        if relay.enabled():
            r = relay.post("/api/muse?op=" + path.rsplit("/", 1)[-1], json=body, timeout=90)
        else:
            r = httpx.post(self.base + path, json=body, timeout=180,
                           headers={"Authorization": f"Bearer {os.environ['MODEL_API_KEY']}"})
        if r.status_code >= 400:
            raise RuntimeError(f"Muse {path} HTTP {r.status_code}: {r.text[:300]}")
        name = f"{uuid.uuid4().hex}.png"
        Path(MEDIA_DIR / name).write_bytes(base64.b64decode(r.json()["data"][0]["b64_json"]))
        return [f"/media/{name}"]


def get_provider():
    if (os.getenv("MODEL_API_KEY") or relay.enabled()) and os.getenv("IMAGE_PROVIDER", "muse") == "muse":
        return MuseProvider()
    return PlaceholderProvider()


POST_SIZE = (1080, 1080)


def to_post_size(url: str) -> str:
    """Resize a stored /media image to exactly 1080x1080 (LANCZOS). Muse returns ~1600x1600 regardless of size."""
    path = MEDIA_DIR / url.rsplit("/", 1)[-1]
    with Image.open(path) as im:
        if im.size == POST_SIZE:
            return url
        out = im.convert("RGB").resize(POST_SIZE, Image.LANCZOS)
    out.save(path, "PNG")
    return url


def self_check(url: str) -> bool:
    """True when the url points to a decodable 1080x1080 file under MEDIA_DIR."""
    try:
        path = MEDIA_DIR / str(url).rsplit("/", 1)[-1]
        if not path.is_file():
            return False
        with Image.open(path) as im:
            return im.size == (1080, 1080)
    except Exception:
        return False


def generate(brief, refs, round_n, session_id=None):
    prov = get_provider()
    sid = session_id or (brief.get("_sid") if isinstance(brief, dict) else None)
    model = "muse-image-1.0" if isinstance(prov, MuseProvider) else prov.name
    t0 = time.perf_counter()
    try:
        urls = prov.generate(brief, refs, round_n)
    except Exception as e:
        ms = int((time.perf_counter() - t0) * 1000)
        trace.record("image_gen", model, False, ms, 0.0, sid, f"{type(e).__name__}: {e}")
        print(f"[imagegen] {prov.name} failed, using placeholder: {e}")
        t1 = time.perf_counter()
        urls = PlaceholderProvider().generate(brief, refs, round_n)
        trace.record("image_gen", "placeholder", True, int((time.perf_counter() - t1) * 1000), 0.0, sid)
        return [to_post_size(u) for u in urls]
    ms = int((time.perf_counter() - t0) * 1000)
    cost = trace.usd_to_sgd(trace.IMAGE_USD) if isinstance(prov, MuseProvider) else 0.0
    trace.record("image_gen", model, True, ms, cost, sid)
    return [to_post_size(u) for u in urls]
