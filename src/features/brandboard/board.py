"""Brand board: client style photos in, look-and-feel board out.

The client uploads shop photos or screenshots of old posts (up to 6).
Muse Spark reads them and returns colours (hex), tone words, style words
and a short plain summary. Only an approved board feeds into briefs.
"""
import re

from src.features.imagegen import studio
from src.shared import guard, meta

MAX_PHOTOS = 6
MAX_SUMMARY = 300

HEX_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")
STATUSES = ("pending_review", "approved", "rejected")

INSTRUCTION = (
    "Describe only the look and feel shared across these photos "
    "(colours, mood, style). Return JSON {\"colours\": [3-6 hex like \"#A63D2F\"], "
    "\"tone_words\": [2-6 single words], \"style_words\": [2-6 single words], "
    "\"summary\": \"one short plain sentence, max 300 chars\"}. "
    "Never include names, contact details, ID numbers, business names, "
    "prices or readable text from the photos."
)


def prune_missing(board: dict | None) -> tuple[dict | None, bool]:
    """Drop photo urls whose file is gone from disk. Returns (board, changed)."""
    from pathlib import Path

    from src.shared.config import MEDIA_DIR
    if not isinstance(board, dict):
        return board, False
    kept = [u for u in (board.get("photos") or [])
            if isinstance(u, str) and (MEDIA_DIR / u.rsplit("/", 1)[-1]).is_file()]
    if kept == (board.get("photos") or []):
        return board, False
    return dict(board, photos=kept), True


def empty_board() -> dict:
    """A board with no extracted content yet (photos stored, read pending/failed)."""
    return {"colours": [], "tone_words": [], "style_words": [], "summary": ""}


def _word_list(v) -> list[str] | None:
    """2-6 short plain words, or None when the value is junk."""
    if not isinstance(v, list) or not 2 <= len(v) <= 6:
        return None
    out = []
    for w in v:
        if not isinstance(w, str):
            return None
        w = " ".join(w.split())
        if not w or len(w) > 30 or len(w.split()) > 3:
            return None
        out.append(w)
    return out


def validate_board(d) -> dict | None:
    """Shape-checked board {colours, tone_words, style_words, summary}, or None (junk)."""
    if not isinstance(d, dict):
        return None
    colours = d.get("colours")
    if (not isinstance(colours, list) or not 3 <= len(colours) <= 6
            or any(not isinstance(c, str) or not HEX_RE.match(c.strip()) for c in colours)):
        return None
    tone = _word_list(d.get("tone_words"))
    style = _word_list(d.get("style_words"))
    summary = d.get("summary")
    if tone is None or style is None:
        return None
    if not isinstance(summary, str) or not summary.strip() or len(summary.strip()) > MAX_SUMMARY:
        return None
    return {"colours": [c.strip().upper() for c in colours],
            "tone_words": tone, "style_words": style, "summary": summary.strip()}


def board_prompt(fields, direction=None) -> str:
    """Image-brief-safe prompt tail: design fields only, never contact details."""
    from src.features.looks.brief import design_context
    ctx = design_context(fields, direction, None)
    bits = []
    if ctx.get("direction"):
        bits.append(str(ctx["direction"]).strip())
    if ctx.get("design_preferences"):
        bits.append(str(ctx["design_preferences"]).strip())
    tail = (" Client direction: " + " / ".join(b for b in bits if b)) if bits else ""
    return INSTRUCTION + tail


def read_board(photo_data: list[bytes], fields=None, direction=None,
               session_id: str | None = None) -> dict:
    """One model read over the photo bytes. Returns a validated board dict.

    Never raises, never returns contact details: the output is shape-validated
    and scrubbed with the client's own identifiers. {} means unreadable/junk
    (the caller keeps the empty board and lets staff edit by hand).
    """
    photos = [p for p in (photo_data or []) if p][:MAX_PHOTOS]
    if not photos:
        return {}
    own_ids = set(studio.own_identifiers(fields or {}))
    for k in ("business_website", "website", "registered_address", "address",
              "title_position", "expected_annual_revenue"):
        v = (fields or {}).get(k)
        if isinstance(v, str) and len(v.strip()) >= 3:
            own_ids.add(v.strip())
    content: list[dict] = [{"type": "text", "text": board_prompt(fields, direction)}]
    try:
        content += [meta.image_part(p, max_side=1024) for p in photos]
    except Exception:
        return {}
    def _read():
        try:
            return meta.chat_json("brand_board", [{"role": "user", "content": content}],
                                  session_id=session_id, timeout=90)
        except Exception:
            return None

    board = validate_board(_read())
    if not board:  # junk: one immediate retry with the same photos
        board = validate_board(_read())
    if not board:
        return {}
    # Junk retry once with the same photos before giving up to staff edit.
    cleaned, _ = guard.clean(board, own_ids)
    board = validate_board(cleaned)
    return board or {}
