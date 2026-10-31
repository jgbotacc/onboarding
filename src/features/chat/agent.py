"""Onboarding agent state machine.
need_document -> missing_info -> need_direction -> awaiting_review -> accepted | handed_off
"""
import re
import uuid

from src.features.imagegen.providers import generate
from src.features.intake.extract import EMAIL, extract_fields
from src.shared.config import MANDATORY, MAX_ROUNDS

SKIP = re.compile(r"^\s*(skip|no|none|nope|n/a|go ahead|proceed)\b", re.I)


def new_session() -> dict:
    return {"id": uuid.uuid4().hex[:12], "status": "need_document", "fields": {}, "refs": [],
            "direction": None, "round": 0, "images": [], "feedback": None}


def missing(s):
    return [label for key, label in MANDATORY if not s["fields"].get(key)]


def resp(s, reply, images=None):
    return {"reply": reply, "images": images or [], "status": s["status"], "missing": missing(s),
            "round": s["round"]}


def _after_fields(s, prefix=""):
    m = missing(s)
    if m:
        s["status"] = "missing_info"
        return resp(s, prefix + "I still need: " + ", ".join(m) + f". What is your {m[0].lower()}?")
    name = s["fields"]["business_name"]
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
    s["fields"].update({k: v for k, v in fields.items() if v})
    found = ", ".join(f"{k.replace('_', ' ')}: {v}" for k, v in fields.items()) or "nothing usable"
    return _after_fields(s, f"I read {filename}. Found {found}. ")


def on_form(s, fields: dict):
    s["fields"].update({k: str(v).strip() for k, v in fields.items() if v and str(v).strip()})
    return _after_fields(s, "Got your registration form. ")


def on_refs(s, paths):
    s["refs"].extend(paths)
    if s["status"] == "need_direction":
        return resp(s, f"Got {len(paths)} reference image(s). Now tell me your design direction, or say 'skip'.")
    return resp(s, f"Saved {len(paths)} reference image(s).") if s["status"] != "missing_info" \
        else _after_fields(s, f"Saved {len(paths)} reference image(s). ")


def _fill_from_text(s, text):
    got = extract_fields(text)
    m = [k for k, _ in MANDATORY if not s["fields"].get(k)]
    if not got and m:
        if m[0] == "email":
            e = re.search(EMAIL, text)
            if not e:
                return False
            text = e.group(0)
        got = {m[0]: text.strip()}
    s["fields"].update(got)
    return True


def run_round(s):
    s["round"] += 1
    brief = dict(s["fields"], direction=s["direction"], feedback=s["feedback"])
    s["images"] = generate(brief, s["refs"], s["round"])
    s["status"] = "awaiting_review"
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
    if st == "accepted":
        return resp(s, "Your design direction is locked in. Our team will follow up with final collaterals.", s["images"])
    return resp(s, "A team member has been notified and will contact you shortly.")


def on_review(s, accepted: bool, feedback: str | None):
    if s["status"] != "awaiting_review":
        return resp(s, "There's nothing to review yet.")
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
