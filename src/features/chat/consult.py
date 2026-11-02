"""Consult handoff card for staff when no look is picked after 3 rounds."""
import uuid
from datetime import datetime, timezone

from src.shared.config import MANDATORY


def build_card(s, labels) -> dict:
    """Pending consult card: submitted fields, rejected looks and next steps."""
    fields = s.get("fields", {}) or {}
    invalid_keys = list((s.get("invalid") or {}).keys())
    if s.get("refill"):
        ask = [k for k in s["refill"] if k not in invalid_keys]
    else:
        ask = [k for k, _ in MANDATORY if not str(fields.get(k) or "").strip() and k not in invalid_keys]
    steps = ["Arrange a consult to find out the client's design preferences",
             "Pick a look with the client (3 rounds of looks were skipped)"]
    steps += [f"Ask for: {labels.get(k, k)}" for k in ask]
    steps += [f"Fix: {labels.get(k, k)}" for k in invalid_keys]
    if s.get("pending") and (s["pending"] or {}).get("filename"):
        steps.append(f"Client has unconfirmed details from {s['pending']['filename']}")
    steps.append("Approve or reject the registration")
    rounds = sorted({r.get("round") for r in (s.get("rejected") or []) if r.get("round")})
    return {
        "id": uuid.uuid4().hex,
        "session_id": s["id"],
        "client_id": s["id"],
        "business_name": fields.get("business_name", ""),
        "status": "pending_approval",
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "lang": s.get("lang") or "en",
        "submitted": {labels.get(k, k): v for k, v in fields.items()},
        "next_steps": steps,
        "rejected_rounds": len(rounds) if rounds else s.get("round", 0),
        "rejected_looks": [{"round": r.get("round"), "id": r.get("id"),
                            "url": r.get("url"), "title": r.get("title")}
                           for r in (s.get("rejected") or [])],
        "approved_by": None,
        "decided_at": None,
        "note": None,
    }
