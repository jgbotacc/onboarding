"""Intake-vs-document mismatch flags (PRD 4.9.3.2).

Staff-only, read-only: compare the client-given intake box for
``business_name``, ``uen`` and ``registered_address`` against the latest
confirmed pre-edit document snapshot, normalised first (case, punctuation,
whitespace, company suffixes). Flags never change or block anything:
no status change, no extra question, no write to the client record.
"""
import re

COMPARED = ("business_name", "uen", "registered_address")

_SUFFIX_PRIVATE = re.compile(r"\bprivate\s+limited\b")
_SUFFIX_LIMITED = re.compile(r"\blimited\b")
_PUNCT = re.compile(r"[^0-9a-zA-Z#\-]+")
_WS = re.compile(r"\s+")


def _squash(value: str) -> str:
    """Lower case, punctuation stripped (keeping # and -), whitespace collapsed."""
    return _WS.sub(" ", _PUNCT.sub(" ", value.lower())).strip()


def normalize_name(value: str) -> str:
    """Normalise a business name: suffixes canonicalised, then squashed.

    ``pte ltd``, ``pte. ltd.`` and ``private limited`` all become ``pte ltd``;
    a remaining standalone ``limited`` becomes ``ltd``.
    """
    s = _SUFFIX_PRIVATE.sub("pte ltd", value.lower())
    s = _SUFFIX_LIMITED.sub("ltd", s)
    return _WS.sub(" ", _PUNCT.sub(" ", s)).strip()


def normalize_address(value: str) -> str:
    """Normalise a registered address: lower case, punctuation (except #/-) stripped."""
    return _squash(value)


def normalize_uen(value: str) -> str:
    """Normalise a UEN: upper-cased, spaces removed."""
    return re.sub(r"\s+", "", value.strip().upper())


def _norm(field: str, value: str) -> str:
    if field == "uen":
        return normalize_uen(value)
    if field == "business_name":
        return normalize_name(value)
    return normalize_address(value)


def _latest_snapshot(docs: dict) -> tuple[dict, str]:
    """(fields, filename) of the latest confirmed document snapshot, or ({}, \"\").

    Drift simply drops the flag: removed/discarded docs, missing snapshots and
    snapshots without any compared field are skipped.
    """
    best, best_key, best_name = {}, None, ""
    for i, (doc_id, rec) in enumerate((docs or {}).items()):
        if not isinstance(rec, dict) or rec.get("status") != "confirmed":
            continue
        snap = rec.get("fields")
        if not isinstance(snap, dict) or not any(snap.get(f) for f in COMPARED):
            continue
        key = (str(rec.get("confirmed_at") or ""), i)
        if best_key is None or key >= best_key:
            best, best_key = snap, key
            best_name = str(rec.get("filename") or doc_id)
    if best_key is None:
        return {}, ""
    return best, best_name


def mismatch_flags(fields: dict, docs: dict) -> list[dict]:
    """Flags for real differences only: [{field, intake, document, source}].

    ``source`` is the document filename. Empty on either side, or equality
    after normalisation, means no flag. Never raises, never mutates.
    """
    snap, source = _latest_snapshot(docs)
    if not snap:
        return []
    out = []
    for f in COMPARED:
        intake = (fields or {}).get(f)
        document = snap.get(f)
        if not isinstance(intake, str) or not isinstance(document, str):
            continue
        if not intake.strip() or not document.strip():
            continue
        try:
            same = _norm(f, intake) == _norm(f, document)
        except Exception:
            return []
        if not same:
            out.append({"field": f, "intake": intake.strip(),
                        "document": document.strip(), "source": source})
    return out
