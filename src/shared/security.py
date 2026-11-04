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


def _matches(got: str, want: str) -> bool:
    """An unset passcode never matches, so a missing env var fails closed."""
    return bool(want) and hmac.compare_digest(got.encode(), want.encode())


def caller_role(request: Request) -> str | None:
    """Role for the x-staff-key header: staff, designer, or None. Staff wins ties."""
    got = request.headers.get("x-staff-key", "")
    if _matches(got, os.getenv("STAFF_PASSCODE", "")):
        return "staff"
    if _matches(got, os.getenv("DESIGNER_PASSCODE", "")):
        return "designer"
    return None


def require_staff(request: Request):
    """Staff-only routes: designer keys get 403. Fails closed (503) when STAFF_PASSCODE is unset."""
    if not os.getenv("STAFF_PASSCODE", ""):
        raise HTTPException(503, "Staff access isn't set up yet.")
    role = caller_role(request)
    if role == "staff":
        return
    if role is None:
        raise HTTPException(401, "Please enter the staff passcode.")
    raise HTTPException(403, "Designers can't use this page. Please ask our team.")


def require_staff_or_designer(request: Request):
    """Designer handoff routes: staff or designer keys pass. Fails closed (503) when both are unset."""
    if not os.getenv("STAFF_PASSCODE", "") and not os.getenv("DESIGNER_PASSCODE", ""):
        raise HTTPException(503, "Staff access isn't set up yet.")
    if caller_role(request) in ("staff", "designer"):
        return
    raise HTTPException(401, "Please enter the staff passcode.")


def _hash(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def token_hash(token: str) -> str:
    """SHA-256 hex of a share token. Only the hash is stored, compared, or audited."""
    return hashlib.sha256(token.encode()).hexdigest()


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
        raise HTTPException(400, "Reference images must be JPG or PNG.")
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
