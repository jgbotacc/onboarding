"""Outbound guard: mask NRIC/FIN and other clients' identifiers before display/send."""
import logging
import re

NRIC = re.compile(r"\b[STFGM]\d{7}[A-Z]\b", re.I)
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_KEYS = {"phone_number", "phone", "mobile"}
MASK = "[removed]"


def scrub_nric(text: str) -> str:
    """Replace NRIC/FIN numbers with [removed]."""
    return NRIC.sub(MASK, text)


# --- Private-contact masking (phones + Singapore addresses). Pure regex, no model call. ---
_UEN_KEEP = r"\d{8,10}[A-Z]|[ST]\d{2}[A-Z]{2}\d{4}[A-Z]"
_PRICE_KEEP = r"S?\$\s?\d[\d,]*(?:\.\d{1,2})?"
_DATE_KEEP = r"\d{1,4}[/-]\d{1,2}[/-]\d{1,4}"
_ORDER_KEEP = r"(?:order|invoice|inv|receipt|ref(?:erence)?|no\.?|num(?:ber)?)\s*[:#-]?\s*\d[\w-]*"
_CODE_KEEP = r"[A-Z]{2,}\d*-\d+"
_PHONE = (r"\+\d[\d \t().-]{5,}\d|\(\d{3}\)[\s.-]?\d{3}[\s.-]\d{4}"
          r"|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b|(?:\+65[\s-]?)?[689]\d{3}[\s-]?\d{4}|\d{7,15}")
_BLK = r"\bblk\b\s*\.?\s*\d+[A-Za-z]?|\bblock\s+\d+[A-Za-z]?"
_ROAD = r"\b(?:street|road|avenue|lane|drive|st|rd|ave)\b"
_UNIT = r"#\d+-\d+"
_POSTAL = r"\d{6}"
_PRIVATE = re.compile(
    r"(?P<keep>" + "|".join([_UEN_KEEP, _PRICE_KEEP, _DATE_KEEP, _ORDER_KEEP, _CODE_KEEP]) + r")"
    + r"|(?P<phone>" + _PHONE + r")"
    + r"|(?P<blk>" + _BLK + r")"
    + r"|(?P<road>" + _ROAD + r")"
    + r"|(?P<unit>" + _UNIT + r")"
    + r"|(?P<postal>" + _POSTAL + r")", re.IGNORECASE)
_BLK_LINE = re.compile(r"\bblk\b|\bblock\b", re.IGNORECASE)
_POSTAL_CUE = re.compile(r"\bblk\b|\bblock\b|\bstreet\b|\broad\b|#|singapore", re.IGNORECASE)


def _line_of(text: str, i: int, j: int) -> str:
    """The single line holding text[i:j]; postal/unit/road cues are line-scoped."""
    s = text.rfind("\n", 0, i) + 1
    e = text.find("\n", j)
    return text[s:] if e == -1 else text[s:e]


def _spans(text: str) -> list[tuple[int, int, str]]:
    """(start, end, kind) for each maskable span; kind is 'phone' or 'address'.

    UENs, prices, dates and order-number cues match first and are never masked.
    A digit run stays when attached to a longer token (letters, digits, decimal
    point, comma, currency mark, date separator, dash), and a bare 6-digit run
    counts as a postal code only with an address cue on its line.
    """
    out = []
    for m in _PRIVATE.finditer(text):
        kind, s, e = m.lastgroup, m.start(), m.end()
        if kind == "keep":
            continue
        raw = m.group(0)
        if kind == "phone":
            before, after = text[s - 1] if s > 0 else "", text[e] if e < len(text) else ""
            nxt, prv = text[e + 1] if e + 1 < len(text) else "", text[s - 2] if s - 2 >= 0 else ""
            if before.isalnum() or after.isalnum():
                continue
            if (before and before in "/$-") or (after and after in "/$-"):
                continue
            if (before == "," and prv.isdigit()) or (after == "," and nxt.isdigit()):
                continue  # thousands separator, not a boundary
            if (before == "." and prv.isdigit()) or (after == "." and nxt.isdigit()):
                continue  # decimal point, not a boundary
            if raw.startswith("+") and not 7 <= sum(c.isdigit() for c in raw) <= 15:
                continue
            out.append((s, e, "phone"))
            continue
        line = _line_of(text, s, e)
        if kind == "postal":
            before, after = text[s - 1] if s > 0 else "", text[e] if e < len(text) else ""
            nxt, prv = text[e + 1] if e + 1 < len(text) else "", text[s - 2] if s - 2 >= 0 else ""
            if before.isalnum() or after.isalnum():
                continue
            if (before and before in "/$-") or (after and after in "/$-"):
                continue
            if (before == "," and prv.isdigit()) or (after == "," and nxt.isdigit()):
                continue
            if (before == "." and prv.isdigit()) or (after == "." and nxt.isdigit()):
                continue
            if before == "(" and after == ")":
                continue  # postal in parens on a formal profile, not a bare code
            if not _POSTAL_CUE.search(line):
                continue
            out.append((s, e, "address"))
        elif _BLK_LINE.search(line):
            out.append((s, e, "address"))
    return out


def scrub_private(text: str) -> str:
    """Mask Singapore/international phones and Singapore address cues with [removed]."""
    if not isinstance(text, str) or not text:
        return text
    out, last = [], 0
    for s, e, _ in _spans(text):
        out.append(text[last:s])
        out.append(MASK)
        last = e
    out.append(text[last:])
    return "".join(out)


def drop_private(fields: dict) -> tuple[dict, list[str]]:
    """Drop values that are only a phone or an address, mask one inside a longer value."""
    clean, kinds = {}, set()
    for k, v in fields.items():
        if isinstance(v, str) and v.strip():
            masked = scrub_private(v)
            if masked != v:
                spans = _spans(v)
                for _, _, kd in spans:
                    kinds.add(kd)
                bare = masked.replace(MASK, " ")
                rest = [t for t in re.findall(r"[A-Za-z]+", bare)
                        if len(t) > 3 and t.lower() != "singapore"]
                addr_n = sum(1 for _, _, kd in spans if kd == "address")
                if not bare.strip(" ,;:.#-/()") or (addr_n >= 2 and not rest):
                    continue
                v = masked
        clean[k] = v
    return clean, (["phone"] if "phone" in kinds else []) + (["address"] if "address" in kinds else [])


def others_identifiers(store, own_id) -> set[str]:
    """Lower-cased emails, phone digits (len>=8) and UENs of every other session.

    Own email/phone/UEN are excluded so a duplicate value never masks your own
    record; free-text matches (e.g. another client's email pasted in notes) still mask.
    """
    out: set[str] = set()
    own: set[str] = set()
    for st in store.list_states():
        is_own = st.get("id") == own_id
        for k, v in (st.get("fields") or {}).items():
            if not isinstance(v, str) or not v.strip():
                continue
            kl = str(k).lower()
            if kl == "email":
                (own if is_own else out).add(v.strip().lower())
            elif kl in _PHONE_KEYS:
                d = re.sub(r"\D", "", v)
                if len(d) >= 8:
                    (own if is_own else out).add(d)
            elif kl == "uen":
                (own if is_own else out).add(v.strip().lower())
            if not is_own:
                for m in _EMAIL.findall(v):
                    out.add(m.lower())
    out.discard("")
    own.discard("")
    return out - own - _examples()


def _examples() -> set[str]:
    """Sample values shown in our own help text (e.g. "+65 6123 4567") are never treated as client data."""
    from src.features.intake.validate import EXAMPLES
    vals = {v for vs in EXAMPLES.values() for v in vs}
    return {v.lower() for v in vals} | {re.sub(r"\D", "", v) for v in vals if len(re.sub(r"\D", "", v)) >= 8}


def clean(obj, others: set[str] = frozenset()) -> tuple:
    """Deep-walk obj; mask NRIC and any (case-insensitive) identifier in others.

    Phone identifiers (all digits) also match with spaces/dashes between digits.
    Returns (cleaned copy, replacement count). Logs the count only, never values.
    """
    pats = []
    for o in others:
        if not o:
            continue
        if o.isdigit():
            pats.append(re.compile(r"\+?" + r"[\s\-]*".join(re.escape(d) for d in o)))
        elif re.fullmatch(r"[A-Za-z'’\- ]+", o) and re.search(r"[A-Za-z]", o):
            pats.append(re.compile(r"\b" + re.escape(o) + r"\b", re.I))
        else:
            pats.append(re.compile(re.escape(o), re.I))
    n = 0

    def sub(s: str) -> str:
        nonlocal n
        s, k = NRIC.subn(MASK, s)
        n += k
        for p in pats:
            s, k = p.subn(MASK, s)
            n += k
        return s

    def walk(o):
        if isinstance(o, str):
            return sub(o)
        if isinstance(o, dict):
            return {k: walk(v) for k, v in o.items()}
        if isinstance(o, list):
            return [walk(v) for v in o]
        if isinstance(o, tuple):
            return tuple(walk(v) for v in o)
        return o

    out = walk(obj)
    if n:
        logging.getLogger("onboarding").warning("guard masked %d value(s)", n)
    return out, n
