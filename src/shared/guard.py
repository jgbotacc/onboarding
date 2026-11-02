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
