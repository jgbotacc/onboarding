"""Onboarding agent state machine.
need_document -> missing_info -> need_direction -> awaiting_review -> accepted | handed_off
Staff decision -> approved | rejected | needs_info (resume link) -> missing_info -> pending_review
"""
import re
import uuid

from src.features.imagegen.providers import generate
from src.features.intake.extract import EMAIL, extract_fields
from src.shared.config import LABELS, MANDATORY, MAX_ROUNDS, MEDIA_DIR

SKIP = re.compile(r"^\s*(skip|no|none|nope|n/a|go ahead|proceed)\b", re.I)


def new_session() -> dict:
    return {"id": uuid.uuid4().hex[:12], "status": "need_document", "fields": {}, "refs": [],
            "direction": None, "round": 0, "images": [], "feedback": None, "history": [], "refill": []}

DESIGN_KEYS = {"design_preferences", "requirements_notes"}


def missing_keys(s):
    if s.get("refill"):
        return list(s["refill"])
    return [key for key, _ in MANDATORY if not s["fields"].get(key)]


def missing(s):
    return [LABELS.get(k, k) for k in missing_keys(s)]


def _set_fields(s, fields: dict):
    """Apply field values; tracks re-filled fields during a staff 'more info' request."""
    for k, v in fields.items():
        if v is None or not str(v).strip():
            continue
        if k in DESIGN_KEYS and s["fields"].get(k) != str(v).strip() and s.get("resumed"):
            s["design_changed"] = True
        s["fields"][k] = str(v).strip()
        if k in s.get("refill", []):
            s["refill"].remove(k)


def resp(s, reply, images=None):
    return {"reply": reply, "images": images or [], "status": s["status"], "missing": missing(s),
            "round": s["round"]}


def _after_fields(s, prefix=""):
    m = missing(s)
    if m:
        s["status"] = "missing_info"
        return resp(s, prefix + "I still need: " + ", ".join(m) + f". What is your {m[0].lower()}?")
    name = s["fields"]["business_name"]
    if s.get("resumed"):
        s["resumed"] = False
        if s.pop("design_changed", False) and s["round"] < MAX_ROUNDS:
            s["direction"] = s["fields"].get("design_preferences") or s["direction"]
            out = run_round(s)
            out["reply"] = prefix + "Thanks, your details are updated. Your design brief changed, so " + out["reply"]
            return out
        s["status"] = "pending_review"
        return resp(s, prefix + "Thanks, your details are updated. Our team will review them and get back to you.",
                    s["images"])
    if s["fields"].get("design_preferences") and not s["round"]:
        s["direction"] = s["fields"]["design_preferences"]
        out = run_round(s)
        out["reply"] = prefix + f"Thanks, {name} is registered. Using your design preferences. " + out["reply"]
        return out
    s["status"] = "need_direction"
    return resp(s, prefix + f"Thanks, {name} is registered. Optionally upload "
                "reference images (JPG), then tell me your design direction (e.g. 'minimal, warm, "
                "brown and cream') or say 'skip'.")


def on_document(s, fields: dict, filename: str):
    _set_fields(s, fields)
    found = ", ".join(f"{k.replace('_', ' ')}: {v}" for k, v in fields.items()) or "nothing usable"
    return _after_fields(s, f"I read {filename}. Found {found}. ")


def on_form(s, fields: dict):
    _set_fields(s, fields)
    return _after_fields(s, "Got your registration form. ")


def on_refs(s, paths):
    s["refs"].extend(paths)
    if s["status"] == "need_direction":
        return resp(s, f"Got {len(paths)} reference image(s). Now tell me your design direction, or say 'skip'.")
    return resp(s, f"Saved {len(paths)} reference image(s).") if s["status"] != "missing_info" \
        else _after_fields(s, f"Saved {len(paths)} reference image(s). ")


def _fill_from_text(s, text):
    m = missing_keys(s)
    got = {k: v for k, v in extract_fields(text).items() if not s.get("refill") or k in m}
    if not got and m:
        if m[0] == "email":
            e = re.search(EMAIL, text)
            if not e:
                return False
            text = e.group(0)
        got = {m[0]: text.strip()}
    _set_fields(s, got)
    return True


def run_round(s):
    s["round"] += 1
    prev = str(MEDIA_DIR / s["images"][0].rsplit("/", 1)[-1]) if s.get("images") else None
    brief = dict(s["fields"], direction=s["direction"], feedback=s["feedback"], prev_image=prev)
    s["images"] = generate(brief, s["refs"], s["round"])
    s["status"] = "awaiting_review"
    s.setdefault("history", []).append({"round": s["round"], "images": s["images"], "direction": s["direction"],
                                        "feedback": None, "accepted": None})
    return resp(s, f"Here is mock-up round {s['round']} of {MAX_ROUNDS}. Happy with this direction? "
                "Accept it, or tell me what to change.", s["images"])


def on_chat(s, text):
    st = s["status"]
    if st in ("need_document", "missing_info"):
        ok = _fill_from_text(s, text)
        if not ok:
            return resp(s, "That doesn't look like an email address. What's the best contact email?")
        return _after_fields(s)
    if st == "need_direction":
        s["direction"] = None if SKIP.match(text) else text.strip()
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
        return resp(s, f"We've done {MAX_ROUNDS} rounds, so I'm handing you to a human designer, "
                    "who will contact you shortly with your feedback in hand.")
    if not s["feedback"]:
        s["status"] = "awaiting_review"
        return resp(s, "What would you like changed? (colours, style, text, layout...)")
    return run_round(s)
