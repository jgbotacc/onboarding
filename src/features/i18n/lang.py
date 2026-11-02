"""Client-language support: free detection + Meta translation (PRD 2.2; A11, A12, D3).

detect() guesses zh/ta/ms/en from script share and word hits (no model call).
to_english() converts client text for storage/staff; to_client() converts bot
replies back. PROTECT keeps emails, URLs, phones, UENs, S$ amounts and #units
untranslated via ⟦n⟧ tokens; lines() splits replies for read-aloud.
"""
import contextvars
import functools
import re

from src.shared import meta

LANGS = {"en": "English", "zh": "Chinese (Simplified)", "ms": "Malay", "ta": "Tamil"}

_MALAY = frozenset(
    "saya nama syarikat perniagaan terima kasih boleh tidak ya untuk dengan kami anda "
    "alamat emel telefon reka bentuk warna mahu sila apa ini itu dan yang".split()
)
_COMMANDS = frozenset({"yes", "no", "y", "n", "ok", "okay", "skip"})

PROTECT = re.compile(
    r"https?://[^\s⟦⟧]+|www\.[^\s⟦⟧]+"
    r"|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+"
    r"|\b\d{8,9}[A-Z]\b|\b[ST]\d{2}[A-Z]{2}\d{4}[A-Z]\b"
    r"|S\$\s?\d[\d,]*(\.\d{1,2})?"
    r"|#\d+(?:-\d+)?"
    r"|\+\d[\d\s().-]{5,}\d|\b\d{3,4}[\s.-]\d{4}\b|\b\d{7,15}\b",
    re.IGNORECASE,
)

_session = contextvars.ContextVar("i18n_session_id", default=None)


def detect(text: str) -> str | None:
    """Guess the client's language (free heuristics, no model call)."""
    if not text or not text.strip():
        return None
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return None
    n = len(chars)
    if sum("\u4e00" <= c <= "\u9fff" for c in chars) / n >= 0.3:
        return "zh"
    if sum("\u0b80" <= c <= "\u0bff" for c in chars) / n >= 0.3:
        return "ta"
    if len(set(re.findall(r"[a-z]+", text.lower())) & _MALAY) >= 2:
        return "ms"
    bare = PROTECT.sub("", text)
    if sum(c.isascii() and c.isalpha() for c in bare) < 3:
        return None
    toks = re.findall(r"[a-z]+|\d+", bare.lower())
    if toks and all(t == "and" or t.isdigit() for t in toks) and any(t.isdigit() for t in toks):
        return None  # look picks ("1 and 3") never switch language
    if len(toks) == 1 and toks[0] in _COMMANDS:
        return None  # yes/no/skip/ok never switch language
    return "en"


def _protect(text: str) -> tuple[str, dict]:
    mapping: dict = {}

    def _swap(m: re.Match) -> str:
        tok = f"⟦{len(mapping) + 1}⟧"
        mapping[tok] = m.group(0)
        return tok

    return PROTECT.sub(_swap, text), mapping


def _restore(text: str, mapping: dict) -> str:
    for tok, orig in mapping.items():
        text = text.replace(tok, orig)
    return text


def to_english(text: str, lang: str | None, session_id: str | None = None) -> str:
    """Translate client text to English; unchanged when en/disabled, original on failure."""
    if lang in (None, "en") or lang not in LANGS or not meta.enabled():
        return text
    protected, mapping = _protect(text)
    out = meta.chat(
        step="translate_in",
        messages=[
            {"role": "system", "content": (
                f"Translate the user's message from {LANGS[lang]} to English. "
                "Keep names of people and businesses, and every ⟦n⟧ token, "
                "exactly as written. Reply with the translation only.")},
            {"role": "user", "content": protected},
        ],
        session_id=session_id,
    )
    return text if out is None else _restore(out, mapping)


@functools.lru_cache(maxsize=512)
def _out_cached(text: str, lang: str) -> str | None:
    protected, mapping = _protect(text)
    out = meta.chat(
        step="translate_out",
        messages=[
            {"role": "system", "content": (
                f"Translate to {LANGS[lang]}. Plain, friendly words for a small "
                "business owner. Keep the same number of lines, line breaks, bullet "
                "characters (•), names, and every ⟦n⟧ token unchanged. "
                "Reply with the translation only.")},
            {"role": "user", "content": protected},
        ],
        session_id=_session.get(),
    )
    return None if out is None else _restore(out, mapping)


def to_client(text: str, lang: str | None, session_id: str | None = None) -> str:
    """Translate a bot reply to the client's language; English passthrough on failure."""
    if lang in (None, "en") or lang not in LANGS or not meta.enabled():
        return text
    tok = _session.set(session_id)
    try:
        out = _out_cached(text, lang)
    finally:
        _session.reset(tok)
    return text if out is None else out


def lines(text: str) -> list[str]:
    """Split a reply into short display lines for read-aloud."""
    return [ln.strip() for ln in text.split("\n") if ln.strip()]
