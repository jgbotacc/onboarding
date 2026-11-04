"""Phone photos of documents: load, quality check, model read. Never guesses."""
import io

from PIL import Image, ImageFilter, ImageStat

from src.features.intake import document
from src.shared import guard, meta
from src.shared.config import LABELS

BLUR_MIN = 60

try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    HEIF_OK = True
except ImportError:
    HEIF_OK = False


def is_heic(data: bytes) -> bool:
    """True when bytes carry an HEIC ftyp brand."""
    return len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in (b"heic", b"heix", b"mif1")


def load_image(data: bytes) -> Image.Image:
    """Open JPEG/PNG/HEIC bytes. Raises ValueError('heic_unsupported') without pillow-heif."""
    if is_heic(data) and not HEIF_OK:
        raise ValueError("heic_unsupported")
    im = Image.open(io.BytesIO(data))
    im.load()
    return im


def quality(img: Image.Image) -> str | None:
    """'unreadable' if tiny, 'blurry' if edge variance < BLUR_MIN, else None."""
    if min(img.size) < 600:
        return "unreadable"
    g = img.convert("L")
    g.thumbnail((1000, 1000))
    edges = g.filter(ImageFilter.FIND_EDGES)
    edges = edges.crop((2, 2, edges.width - 2, edges.height - 2))  # drop filter border artifact
    var = ImageStat.Stat(edges).var[0]
    return "blurry" if var < BLUR_MIN else None


def _blank(retake: bool, reason: str | None) -> dict:
    return {"retake": retake, "reason": reason, "kind": "photo", "fields": {}, "removed": []}


def read_photo(data: bytes, session_id: str | None = None) -> dict:
    """Quality-gate, then one photo_read model call; no_reader (never a guess) without one."""
    try:
        img = load_image(data)
    except Exception:
        return _blank(True, "unreadable")
    problem = quality(img)
    if problem:
        return _blank(True, problem)
    fields = "; ".join(f"{k} ({label})" for k, label in LABELS.items())
    instruction = ('Read the document in this photo and return JSON {"readable": bool, '
                   '"problem": "blurry"|"cropped"|"unreadable"|null, "text": "all readable text", '
                   '"fields": {...}} using only these keys (omit unknown): ' + fields
                   + ". Never include identification numbers.")
    try:
        out = meta.chat_json("photo_read", [{"role": "user", "content": [
            {"type": "text", "text": instruction}, meta.image_part(data)]}],
            session_id=session_id, timeout=90)
    except Exception:
        out = None
    if not isinstance(out, dict):
        return _blank(False, "no_reader")
    if not out.get("readable"):
        return _blank(True, out.get("problem"))
    parsed = document.read_document(out.get("text") or "", session_id=session_id)["fields"]
    given = out.get("fields") or {}
    merged = {k: v.strip() for k, v in given.items() if k in LABELS and isinstance(v, str) and v.strip()}
    merged.update(parsed)  # text-based parse wins
    clean, removed = document.drop_nric(merged)
    clean, removed_private = guard.drop_private(clean)
    return {"retake": False, "reason": None, "kind": "photo", "fields": clean, "removed": removed + removed_private}
