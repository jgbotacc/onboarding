"""Staff passcode, per-session secrets and upload checks."""
import hashlib
import hmac
import io
import os
import secrets

from fastapi import HTTPException, Request
from PIL import Image

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_FILES = 10
Image.MAX_IMAGE_PIXELS = 40_000_000  # larger images raise DecompressionBombError


def require_staff(request: Request):
    """Every staff route: header x-staff-key must match STAFF_PASSCODE. Fails closed (503) when unset."""
    want = os.getenv("STAFF_PASSCODE", "")
    if not want:
        raise HTTPException(503, "Staff access is not configured")
    got = request.headers.get("x-staff-key", "")
    if not hmac.compare_digest(got.encode(), want.encode()):
        raise HTTPException(401, "Staff passcode required")


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def issue_secret(s: dict) -> str:
    """New random secret for this session; only its hash is stored. Replaces any earlier secret."""
    secret = secrets.token_urlsafe(24)
    s["secret_hash"] = _hash(secret)
    return secret


def secret_ok(s: dict, secret: str | None) -> bool:
    want = s.get("secret_hash")
    return bool(want and secret) and hmac.compare_digest(_hash(secret), want)


def clean_image(data: bytes) -> tuple[bytes, str]:
    """Decode as JPEG/PNG by content, then re-encode (drops metadata). Returns (bytes, ext). Raises 400."""
    try:
        with Image.open(io.BytesIO(data)) as im:
            im.verify()
        im = Image.open(io.BytesIO(data))
        fmt = im.format
        if fmt not in ("JPEG", "PNG"):
            raise ValueError(fmt)
        im.load()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Reference images must be JPG or PNG files")
    out = io.BytesIO()
    if fmt == "JPEG":
        im.convert("RGB").save(out, "JPEG", quality=90)
        return out.getvalue(), ".jpg"
    if im.mode not in ("RGB", "RGBA", "L", "LA"):
        im = im.convert("RGBA")
    im.save(out, "PNG")
    return out.getvalue(), ".png"


def is_pdf(data: bytes) -> bool:
    return data[:1024].lstrip().startswith(b"%PDF-")
