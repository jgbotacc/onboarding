"""Image generation behind a provider interface. Default = labelled Pillow PLACEHOLDER."""
import os
import re
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from src.shared import relay
from src.shared.config import MEDIA_DIR

NAMED = {"red": "#d64545", "blue": "#2563eb", "green": "#2f9e57", "brown": "#7a4b2a", "cream": "#f3e9d2",
         "black": "#111111", "white": "#ffffff", "orange": "#f08c2e", "yellow": "#f2c94c", "purple": "#7b4bd6",
         "pink": "#e86fa6", "navy": "#1e3a8a", "teal": "#14b8a6", "grey": "#9ca3af", "gray": "#9ca3af"}


def parse_colours(text: str | None) -> list[str]:
    if not text:
        return []
    found = re.findall(r"#[0-9a-fA-F]{6}", text)
    found += [NAMED[w] for w in re.findall(r"[a-z]+", text.lower()) if w in NAMED]
    return found[:3]


def _font(size):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


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
        cols = parse_colours(brief.get("brand_colours")) or parse_colours(brief.get("direction")) or ["#2563eb"]
        bg, accent = "#f8fafc", cols[0]
        img = Image.new("RGB", (1080, 1080), bg)
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, 1080, 140], fill=accent)
        d.text((40, 45), f"PLACEHOLDER  ·  round {round_n}", font=_font(44), fill="white")
        y = 200
        for line in _wrap(d, brief.get("business_name", "Your business"), _font(72), 1000)[:3]:
            d.text((40, y), line, font=_font(72), fill="#0f172a"); y += 86
        tag = brief.get("tagline") or " · ".join(x for x in [brief.get("business_type"), brief.get("industry")] if x)
        for line in _wrap(d, tag, _font(40), 1000)[:2]:
            d.text((40, y + 10), line, font=_font(40), fill="#334155"); y += 52
        for i, c in enumerate(cols):
            d.rectangle([40 + i * 90, y + 40, 110 + i * 90, y + 110], fill=c, outline="#0f172a")
        y += 150
        txt = "Design direction: " + (brief.get("direction") or "not given")
        if brief.get("feedback"):
            txt += "  |  Feedback: " + brief["feedback"]
        for line in _wrap(d, txt, _font(30), 1000)[:6]:
            d.text((40, y), line, font=_font(30), fill="#475569"); y += 40
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


class OpenAIProvider:
    """Real provider slot (gpt-image-1). Used only when OPENAI_API_KEY + IMAGE_PROVIDER=openai."""
    name = "openai"

    def generate(self, brief, refs, round_n):
        import base64, httpx
        prompt = (f"Square 1080x1080 social media marketing post for {brief.get('business_name')}, "
                  f"a {brief.get('industry')} business. Tagline: {brief.get('tagline','')}. "
                  f"Brand colours: {brief.get('brand_colours','')}. Requirements: {brief.get('requirements_notes','')}. Style: {brief.get('direction','')}. "
                  f"Changes requested: {brief.get('feedback','none')}.")
        r = httpx.post("https://api.openai.com/v1/images/generations", timeout=120,
                       headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
                       json={"model": "gpt-image-1", "prompt": prompt, "size": "1024x1024"})
        r.raise_for_status()
        name = f"{uuid.uuid4().hex}.png"
        Path(MEDIA_DIR / name).write_bytes(base64.b64decode(r.json()["data"][0]["b64_json"]))
        return [f"/media/{name}"]


class GeminiProvider:
    """Default real provider. Used when GEMINI_API_KEY is set (google-genai SDK)."""
    name = "gemini"

    def generate(self, brief, refs, round_n):
        from google import genai
        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        prompt = (f"Create a square 1:1 social media marketing post for {brief.get('business_name')}, "
                  f"a {brief.get('industry')} business. Tagline: {brief.get('tagline','')}. "
                  f"Brand colours: {brief.get('brand_colours','')}. Requirements: {brief.get('requirements_notes','')}. Design direction: {brief.get('direction','')}. "
                  f"Changes requested: {brief.get('feedback') or 'none'}. Use the attached images as style references.")
        parts = [prompt] + [Image.open(r) for r in refs[:3]]
        res = client.models.generate_content(
            model=os.getenv("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image"), contents=parts)
        for part in res.candidates[0].content.parts:
            if getattr(part, "inline_data", None) and part.inline_data.data:
                name = f"{uuid.uuid4().hex}.png"
                Path(MEDIA_DIR / name).write_bytes(part.inline_data.data)
                return [f"/media/{name}"]
        raise RuntimeError("Gemini returned no image")


def build_prompt(brief: dict) -> str:
    parts = [f"Square 1:1 social media marketing post for {brief.get('business_name') or 'a small business'}"]
    if brief.get("business_type") or brief.get("industry"):
        parts.append(f"a {' / '.join(x for x in [brief.get('business_type'), brief.get('industry')] if x)} business")
    if brief.get("direction"):
        parts.append(f"Design direction: {brief['direction']}")
    if brief.get("requirements_notes"):
        parts.append(f"Requirements: {brief['requirements_notes']}")
    if brief.get("brand_colours"):
        parts.append(f"Brand colours: {brief['brand_colours']}")
    parts.append(f"Show the business name '{brief.get('business_name', '')}' clearly. Clean, professional layout.")
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
    if os.getenv("IMAGE_PROVIDER") == "openai" and os.getenv("OPENAI_API_KEY"):
        return OpenAIProvider()
    if os.getenv("GEMINI_API_KEY"):
        return GeminiProvider()
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


def generate(brief, refs, round_n):
    prov = get_provider()
    try:
        urls = prov.generate(brief, refs, round_n)
    except Exception as e:
        print(f"[imagegen] {prov.name} failed, using placeholder: {e}")
        urls = PlaceholderProvider().generate(brief, refs, round_n)
    return [to_post_size(u) for u in urls]
