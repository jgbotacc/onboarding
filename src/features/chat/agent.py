"""Onboarding agent state machine.
need_document -> missing_info -> need_direction -> awaiting_review -> accepted | handed_off
Staff decision -> approved | rejected | needs_info (resume link) -> missing_info -> pending_review
"""
import re
import uuid

from src.features.imagegen.providers import generate
from src.features.intake.extract import EMAIL, extract_fields
from src.features.intake.validate import check, parse_amount, reask
from src.shared.config import LABELS, MANDATORY, MAX_ROUNDS, MEDIA_DIR

SKIP = re.compile(r"^\s*(skip|no|none|nope|n/a|go ahead|proceed)\b", re.I)


def new_session() -> dict:
    return {"id": uuid.uuid4().hex[:12], "status": "need_document", "fields": {}, "refs": [],
            "direction": None, "round": 0, "images": [], "feedback": None, "history": [], "refill": []}

DESIGN_KEYS = {"design_preferences", "requirements_notes"}


def missing_keys(s):
    """Invalid fields first (they are what we ask about next), then empty mandatory / staff-requested ones."""
    bad = list(s.get("invalid", {}))
    base = list(s["refill"]) if s.get("refill") else [key for key, _ in MANDATORY if not s["fields"].get(key)]
    return bad + [k for k in base if k not in bad]


def invalid(s):
    return [{"field": k, "label": LABELS.get(k, k), **p} for k, p in s.get("invalid", {}).items()]


def missing(s):
    return [LABELS.get(k, k) for k in missing_keys(s)]


def _set_fields(s, fields: dict):
    """Apply field values; tracks re-filled fields during a staff 'more info' request."""
    bad = s.setdefault("invalid", {})
    for k, v in fields.items():
        if v is None or not str(v).strip():
            if k in bad and k not in dict(MANDATORY):  # cleared an invalid optional field
                bad.pop(k)
                s["fields"].pop(k, None)
            continue
        problem = check(k, v)
        if problem:  # saved (valid=false) so staff can see it, but counted as missing until fixed
            s["fields"][k] = str(v).strip()
            bad[k] = problem
            continue
        bad.pop(k, None)
        if k in DESIGN_KEYS and s["fields"].get(k) != str(v).strip() and s.get("resumed"):
            s["design_changed"] = True
        s["fields"][k] = str(v).strip()
        if k in s.get("refill", []):
            s["refill"].remove(k)


def resp(s, reply, images=None):
    return {"reply": reply, "images": images or [], "status": s["status"], "missing": missing(s),
            "round": s["round"], "invalid": invalid(s)}


def _after_fields(s, prefix=""):
    m = missing(s)
    if m:
        s["status"] = "missing_info"
        bad = s.get("invalid", {})
        if bad:
            fixes = " ".join(reask(k, LABELS.get(k, k), p) for k, p in bad.items())
            rest = [LABELS.get(k, k) for k in missing_keys(s) if k not in bad]
            return resp(s, prefix + fixes + (" I also still need: " + ", ".join(rest) + "." if rest else ""))
        return resp(s, prefix + "I still need: " + ", ".join(m) + f". What is your {m[0].lower()}?")
    name = s["fields"]["business_name"]
    if s.get("resumed"):
        s["resumed"] = False
        if s.get("resume"):
            s["resume"]["used"] = True
        if s.pop("design_changed", False) and s["round"] < MAX_ROUNDS:
            s["direction"] = s["fields"].get("design_preferences") or s["direction"]
            out = run_round(s)
            out["reply"] = prefix + "Thanks, your details are updated. Your design brief changed. " + out["reply"]
            return out
        s["status"] = "pending_review"
        return resp(s, prefix + "Thanks, your details are updated. Our team will review them and get back to you.",
                    s["images"])
    if s["fields"].get("design_preferences") and not s["round"]:
        s["direction"] = s["fields"]["design_preferences"]
        if s.get("via_pdf") and not s["refs"]:
            # PDF path has no reference-image field, so ask for refs before round 1.
            s["status"] = "need_direction"
            s["refs_pending"] = True
            return resp(s, prefix + f"Thanks, {name} is registered. I'll use your design preferences "
                        f"({s['direction']}). Upload any reference images (JPG or PNG) now, or say 'skip' to start.")
        out = run_round(s)
        out["reply"] = prefix + f"Thanks, {name} is registered.\n\n" + out["reply"]
        return out
    s["status"] = "need_direction"
    refs = f"Got {len(s['refs'])} reference image(s). Now tell me" if s["refs"] else \
        "Optionally upload reference images (JPG or PNG), then tell me"
    return resp(s, prefix + f"Thanks, {name} is registered. {refs} your design direction (e.g. 'minimal, warm, "
                "brown and cream') or say 'skip'.")


def on_document(s, fields: dict, filename: str):
    s["via_pdf"] = True
    _set_fields(s, fields)
    found = ", ".join(f"{k.replace('_', ' ')}: {v}" for k, v in fields.items() if v) or "nothing usable"
    return _after_fields(s, f"I read {filename}. Found {found}. ")


def on_form(s, fields: dict):
    s["via_pdf"] = False
    _set_fields(s, fields)
    return _after_fields(s, "Got your registration form. ")


def on_refs(s, paths):
    s["refs"].extend(paths)
    if s["status"] == "need_direction" and s.pop("refs_pending", False):
        out = run_round(s)  # PDF design preferences + these refs
        out["reply"] = f"Got {len(paths)} reference image(s).\n\n" + out["reply"]
        return out
    if s["status"] == "need_direction":
        return resp(s, f"Got {len(paths)} reference image(s). Now tell me your design direction, or say 'skip'.")
    return resp(s, f"Saved {len(paths)} reference image(s).") if s["status"] != "missing_info" \
        else _after_fields(s, f"Saved {len(paths)} reference image(s). ")


def _fill_from_text(s, text):
    m = missing_keys(s)
    got = {k: v for k, v in extract_fields(text).items() if not s.get("refill") or k in m}
    if not got and m:
        if m[0] in s.get("invalid", {}) and m[0] not in dict(MANDATORY) and SKIP.match(text):
            got = {m[0]: ""}  # 'skip' clears an invalid optional field
        else:
            e = re.search(EMAIL, text) if m[0] == "email" else None
            got = {m[0]: (e.group(0) if e else text).strip()}
    _set_fields(s, got)
    return True


SUMMARY = [("business_name", "Business name"), ("business_type", "Business type"), ("industry", "Industry"),
           ("business_website", "Business website"), ("contact_name", "Contact name"),
           ("title_position", "Title / position"), ("email", "Email"), ("phone_number", "Phone number"),
           ("design_preferences", "Design preferences"), ("expected_annual_revenue", "Expected annual revenue"),
           ("requirements_notes", "Requirements / notes")]
SUMMARY_CLOSE = "Using your design preferences and business information. Here is a mockup."


def _money(v):
    """'480000', '480k' or 'five thousand dollars' -> 'S$480,000'. Ranges and unparsed text stay as typed."""
    if re.search(r"\d\s*[a-z]{0,3}\s*(?:-|–|—|\bto\b)\s*\S", v, re.I):
        return v
    n = parse_amount(v)
    return f"S${n:,.0f}" if n is not None else v


def summary(s):
    """Registration summary shown with the first mockup: one field per line, then the closing line."""
    f, bad = dict(s["fields"]), s.get("invalid", {})
    if not f.get("design_preferences") and s.get("direction"):
        f["design_preferences"] = s["direction"]  # direction typed in chat
    lines = []
    for k, label in SUMMARY:
        v = str(f.get(k) or "").strip()
        if v and k not in bad:
            lines.append(f"{label}: {_money(v) if k == 'expected_annual_revenue' else v}")
    return "\n".join(lines) + "\n\n" + SUMMARY_CLOSE


def run_round(s):
    s["round"] += 1
    prev = str(MEDIA_DIR / s["images"][0].rsplit("/", 1)[-1]) if s.get("images") else None
    brief = dict(s["fields"], direction=s["direction"], feedback=s["feedback"], prev_image=prev)
    s["images"] = generate(brief, s["refs"], s["round"])
    s["status"] = "awaiting_review"
    s.setdefault("history", []).append({"round": s["round"], "images": s["images"], "direction": s["direction"],
                                        "feedback": None, "accepted": None})
    if s["round"] == 1:
        return resp(s, summary(s), s["images"])
    return resp(s, "Here is the updated mockup. Happy with this direction? Accept it, or tell me what to change.",
                s["images"])


def on_chat(s, text):
    st = s["status"]
    if st in ("need_document", "missing_info"):
        ok = _fill_from_text(s, text)
        if not ok:
            return resp(s, "That doesn't look like an email address. What's the best contact email?")
        return _after_fields(s)
    if st == "need_direction":
        pending = s.pop("refs_pending", False)  # 'skip' keeps the PDF's design preferences
        s["direction"] = (s["direction"] if pending else None) if SKIP.match(text) else text.strip()
        return run_round(s)
    if st == "awaiting_review":
        return on_review(s, False, text)
    if st in ("approved", "rejected", "pending_review"):
        msg = {"approved": "You're approved! Our operations team will get in contact with you soon.",
               "rejected": "Thanks for your interest. Our team has reviewed your application and will be in touch.",
               "pending_review": "Thanks! Our team is reviewing your details and will get back to you."}[st]
        return resp(s, msg, s["images"])
    if st == "accepted":
        return resp(s, "Your design direction is locked in. Our team will follow up with final collaterals.", s["images"])
    return resp(s, "A team member has been notified and will contact you shortly.")


def start_resume(s, fields: list[str], note: str | None):
    """Staff asked for more info: chat only asks for these fields."""
    s["refill"] = [f for f in fields if f in LABELS]
    s["resumed"] = True
    s["status"] = "missing_info"
    labels = ", ".join(LABELS[f] for f in s["refill"])
    return resp(s, "Welcome back! Our team needs a bit more information" + (f": {note}" if note else ".") +
                f" Please update: {labels}. What is your {LABELS[s['refill'][0]].lower()}?" if s["refill"]
                else "Welcome back! " + (note or "Please reply with the requested details."))


def on_review(s, accepted: bool, feedback: str | None):
    if s["status"] != "awaiting_review":
        return resp(s, "There's nothing to review yet.")
    if s.get("history"):
        s["history"][-1].update(accepted=bool(accepted), feedback=(feedback or "").strip() or None)
    if accepted:
        s["status"] = "accepted"
        return resp(s, "Great, design direction accepted! We'll prepare your marketing collaterals.", s["images"])
    s["feedback"] = (feedback or "").strip() or None
    if s["round"] >= MAX_ROUNDS:
        s["status"] = "handed_off"
        return resp(s, "Thanks for the feedback. I'm handing you to a human designer, "
                    "who will contact you shortly with your feedback in hand.")
    if not s["feedback"]:
        s["status"] = "awaiting_review"
        return resp(s, "What would you like changed? (colours, style, text, layout...)")
    return run_round(s)
