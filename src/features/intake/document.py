"""General business document reading (read-only): registration form, ACRA profile, other."""
import re

from src.features.intake import extract
from src.shared import guard, meta
from src.shared.config import LABELS

AUTHORITY = "ACCOUNTING AND CORPORATE REGULATORY AUTHORITY"
ACRONYMS = {"VCC", "LLP", "PTE", "LTD", "UEN", "SSIC", "ACRA"}


def is_acra(text: str) -> bool:
    """True for an ACRA business profile."""
    up = text.upper()
    return AUTHORITY in up or ("BUSINESS PROFILE" in up and "UEN" in up)


def _label_hits(text: str) -> int:
    """Distinct form labels with a regex_extract-style 'Label: value' line."""
    lines = [ln.strip() for ln in text.splitlines()]
    hits = 0
    for key, names in extract.ALIASES.items():
        names = sorted(set(names + [LABELS.get(key, key).lower()]), key=len, reverse=True)
        pat = re.compile(r"^\s*(?:" + "|".join(re.escape(n) for n in names) + r")\s*\*?\s*[:\-]\s*(.+)$",
                         re.IGNORECASE)
        for ln in lines:
            m = pat.match(ln)
            if m and m.group(1).strip():
                hits += 1
                break
    return hits


def is_registration_form(text: str) -> bool:
    """True when >= 2 form labels match and the text is not an ACRA profile."""
    return not is_acra(text) and _label_hits(text) >= 2


def _smart_title(s: str) -> str:
    """Title-case words, keeping acronyms (VCC, LLP, PTE, LTD) upper-case."""
    return " ".join(w.upper() if w.strip(".,()").upper() in ACRONYMS else w.title() for w in s.split())


def _title_address(s: str) -> str:
    """Title-case words but keep unit numbers (#01-23) and postal codes."""
    return " ".join(w if "#" in w or w.strip("(),").isdigit() else w.title() for w in s.split())


def _after_colon(lines: list[str], label: str) -> str:
    """Value after 'Label :' on the first matching line (case-insensitive)."""
    pat = re.compile(r"^" + re.escape(label) + r"\s*:\s*(.*)$", re.IGNORECASE)
    for ln in lines:
        m = pat.match(ln.strip())
        if m:
            return m.group(1).strip()
    return ""


_ACTIVITY_END = re.compile(r"^(Description|Registered\s+Office\s+Address|Officers)\b", re.IGNORECASE)


def _activity(lines: list[str]) -> str:
    """Activity value, joining wrapped lines until Description; SSIC code removed, sentence case."""
    buf: list[str] | None = None
    for ln in lines:
        s = ln.strip()
        if buf is None:
            m = re.match(r"^Activity\s*:\s*(.*)$", s, re.IGNORECASE)
            if m:
                buf = [m.group(1).strip()]
        elif _ACTIVITY_END.match(s):
            break
        elif s:
            buf.append(s)
    text = " ".join(p for p in buf or [] if p)
    text = re.sub(r"\s*(\(\d[\d\s\-/]*\)\s*)+$", "", text).strip()
    return text[:1].upper() + text[1:].lower() if text else ""


def _director(lines: list[str]) -> tuple[str, str]:
    """(name, 'Director') for the first Officers row with Position Held Director."""
    in_table = False
    for ln in lines:
        s = ln.strip()
        if not in_table:
            in_table = bool(re.match(r"^Officers\b", s, re.IGNORECASE))
            continue
        if not s or re.search(r"Identification\s+No", s, re.IGNORECASE):
            continue
        parts = [p.strip() for p in re.split(r"\s{2,}", s) if p.strip()]
        name, position = "", ""
        if len(parts) >= 3:
            name, position = parts[0], parts[2]
        else:  # single-space fallback: name is before the ID number
            m = guard.NRIC.search(s)
            if m:
                name = s[:m.start()].strip()
                rest = s[m.end():].strip().split()
                position = rest[0] if rest else ""
        if name and position.strip().lower() == "director":
            return _smart_title(name), "Director"
    return "", ""


def parse_acra(text: str) -> dict:
    """Pull mapped fields from ACRA profile text (pypdf or -layout columns). Never the ID number."""
    lines = text.splitlines()
    name, position = _director(lines)
    uen = _after_colon(lines, "UEN").strip().upper().split()
    out = {
        "business_name": _smart_title(_after_colon(lines, "Name")),
        "uen": uen[0] if uen else "",
        "business_type": _smart_title(_after_colon(lines, "Type")),
        "industry": _activity(lines),
        "registered_address": _title_address(_after_colon(lines, "Registered Office Address")),
        "contact_name": name,
        "title_position": position,
    }
    return {k: v for k, v in out.items() if v}


def drop_nric(fields: dict) -> tuple[dict, list[str]]:
    """Drop values that are an NRIC/FIN, mask values that contain one."""
    clean, hit = {}, False
    for k, v in fields.items():
        if isinstance(v, str) and guard.NRIC.search(v):
            hit = True
            if guard.NRIC.fullmatch(v.strip()):
                continue
            v = guard.scrub_nric(v)
        clean[k] = v
    return clean, ["nric"] if hit else []


def llm_fields(text: str, session_id: str | None = None) -> dict:
    """One doc_read model call: document text + field list only. {} when disabled/failing."""
    fields = "; ".join(f"{k} ({label})" for k, label in LABELS.items())
    prompt = ("Return JSON with only these keys (omit unknown): " + fields
              + ". Never include identification numbers.\n\nDocument:\n" + text[:8000])
    try:
        out = meta.chat_json("doc_read", [{"role": "user", "content": prompt}], session_id=session_id)
    except Exception:
        return {}
    if not isinstance(out, dict):
        return {}
    return {k: v.strip() for k, v in out.items() if k in LABELS and isinstance(v, str) and v.strip()}


def read_document(text: str, session_id: str | None = None) -> dict:
    """Classify (form/acra/other) and extract fields; NRIC always removed last."""
    if is_acra(text):
        kind, fields = "acra", parse_acra(text)
        for k, v in llm_fields(text, session_id=session_id).items():
            if not fields.get(k):
                fields[k] = v
    elif is_registration_form(text):
        kind, fields = "form", extract.regex_extract(text)
    else:
        kind = "other"
        fields = llm_fields(text, session_id=session_id) or extract.regex_extract(text)
    fields = {k: v for k, v in fields.items() if k in LABELS}
    clean, removed = drop_nric(fields)
    return {"kind": kind, "fields": clean, "removed": removed}
