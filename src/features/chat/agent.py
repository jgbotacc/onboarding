"""Onboarding agent state machine.
need_document -> missing_info -> need_direction -> awaiting_review -> accepted | handed_off
Staff decision -> approved | rejected | needs_info (resume link) -> missing_info -> pending_review
"""
import re
import uuid
from datetime import datetime, timezone

from src.features.chat import consult
from src.features.imagegen.providers import PlaceholderProvider
from src.features.imagegen.providers import generate as generate_alt
from src.features.imagegen.providers import generate, self_check, to_post_size
from src.features.intake.extract import EMAIL, extract_fields
from src.features.intake.validate import check, fix_line, fix_message, missing_line, parse_amount
from src.features.looks import brief as looks_brief
from src.shared import trace
from src.shared.config import LABELS, MANDATORY, MAX_ROUNDS, MEDIA_DIR

SKIP = re.compile(r"^\s*(skip|no|none|nope|n/a|go ahead|proceed)\b", re.I)
YES_WORDS = {"yes", "y", "ok", "okay", "correct", "right", "confirm", "yep", "sure", "ya", "betul",
             "是", "对", "好", "ஆம்"}


def new_session() -> dict:
    return {"id": uuid.uuid4().hex[:12], "status": "need_document", "fields": {}, "refs": [],
            "direction": None, "round": 0, "images": [], "feedback": None, "history": [], "refill": [],
            "lang": None, "lang_set": False, "pending": None, "transcript": [], "looks": [],
            "rejected": [], "selected_looks": [], "consult": None, "fixes": [],
            "started": datetime.now(timezone.utc).isoformat(timespec="seconds")}

DESIGN_KEYS = {"design_preferences", "requirements_notes"}


def missing_keys(s):
    """Invalid fields first (they are what we ask about next), then empty mandatory / staff-requested ones."""
    bad = list(s.get("invalid", {}))
    fields = s.get("fields", {})
    base = list(s["refill"]) if s.get("refill") else [key for key, _ in MANDATORY if not fields.get(key)]
    return bad + [k for k in base if k not in bad]


def invalid(s):
    return [{"field": k, "label": LABELS.get(k, k), **p} for k, p in s.get("invalid", {}).items()]


def missing(s):
    return [LABELS.get(k, k) for k in missing_keys(s)]


def _set_fields(s, fields: dict):
    """Apply field values; tracks re-filled fields during a staff 'more info' request."""
    bad = s.setdefault("invalid", {})
    s.setdefault("fields", {})
    s.setdefault("fixes", [])
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
            if k not in s["fixes"]:
                s["fixes"].append(k)
            continue
        bad.pop(k, None)
        if k in DESIGN_KEYS and s["fields"].get(k) != str(v).strip() and s.get("resumed"):
            s["design_changed"] = True
        s["fields"][k] = str(v).strip()
        if k in s.get("refill", []):
            s["refill"].remove(k)


def resp(s, reply, images=None):
    out = {"reply": reply, "images": images or [], "status": s.get("status"), "missing": missing(s),
           "round": s.get("round", 0), "invalid": invalid(s)}
    out["lines"] = [ln.strip() for ln in str(reply).splitlines() if ln.strip()]
    out["lang"] = s.get("lang") or "en"
    out["retake"] = False
    out["retake_reason"] = None
    p = s.get("pending")
    out["confirm"] = ({"docId": p.get("docId"), "filename": p.get("filename"),
                       "fields": [{"key": k, "label": label(k), "value": v}
                                  for k, v in _ordered_fields(p.get("fields", {}))],
                       "removed": list(p.get("removed") or [])} if p else None)
    looks = s.get("looks") or []
    out["looks"] = ({"round": s.get("round", 0), "max_rounds": MAX_ROUNDS,
                     "prompt": "Which look do you prefer?",
                     "options": [{"id": lk.get("id"), "url": lk.get("url"), "title": lk.get("title"),
                                  "suggested": bool(lk.get("suggested") or lk.get("source") == "staff")}
                                 for lk in looks]}
                    if s.get("status") == "awaiting_review" and looks else None)
    sug = s.get("suggested_looks") or []
    out["suggested_looks"] = ([{"id": lk.get("id"), "url": lk.get("url"), "title": lk.get("title"),
                                "suggested": True} for lk in sug] if sug else None)
    cc = s.get("consult")
    out["consult"] = ({"id": cc.get("id"), "status": cc.get("status")} if cc else None)
    return out


def problem_lines(s, only=None):
    """Short 'what was wrong' lines, one per field, in form order. No field dump."""
    bad, keys = s.get("invalid", {}), missing_keys(s)
    if only:
        keys = [k for k in keys if k in only]
    keys = sorted(keys, key=lambda k: ORDER.get(k, len(ORDER)))
    fields = s.get("fields", {})
    return [fix_line(k, label(k), fields.get(k, ""), bad[k]) if k in bad else missing_line(k, label(k))
            for k in keys]


def _after_fields(s, prefix="", touched=None):
    """Problems get just the short fix lines. The opener ('Got your registration form.' or the PDF name)
    waits in the session until every field is valid, so it also shows after fixes made in chat."""
    if missing_keys(s):
        s["status"] = "missing_info"
        # A single re-entered field that is still wrong: just that one line.
        still = [k for k in (touched or []) if k in s.get("invalid", {})]
        lines = problem_lines(s, only=still) if touched and len(touched) == 1 and still else problem_lines(s)
        return resp(s, prefix + fix_message(lines))
    prefix += s.pop("opener", "")
    name = s.get("fields", {}).get("business_name", "")
    pdf = s.pop("pdf_name", None)
    thanks = f"Thanks, I've read {pdf} and registered {name}." if pdf else f"Thanks, {name} is registered."
    if s.get("resumed"):
        s["resumed"] = False
        if s.get("resume"):
            s["resume"]["used"] = True
        if s.pop("design_changed", False) and s.get("round", 0) < MAX_ROUNDS:
            s["direction"] = s.get("fields", {}).get("design_preferences") or s.get("direction")
            out = run_round(s)
            out["reply"] = prefix + "Thanks, your details are updated.\nYour design brief changed.\n" + out["reply"]
            out["lines"] = [ln.strip() for ln in out["reply"].splitlines() if ln.strip()]
            return out
        s["status"] = "pending_review"
        return resp(s, prefix + "Thanks, your details are updated.\nOur team will contact you shortly.",
                    s.get("images"))
    if s.get("fields", {}).get("design_preferences") and not s.get("round"):
        s["direction"] = s["fields"]["design_preferences"]
        if s.get("via_pdf") and not s.get("refs"):
            # PDF path has no reference-image field, so ask for refs before round 1.
            s["status"] = "need_direction"
            s["refs_pending"] = True
            return resp(s, prefix + f"{thanks}\n\nI'll go with your design preferences: {s['direction']}\n\n"
                        "Want to add reference images (JPG or PNG)? Upload them now, or type \"skip\" to start.")
        out = run_round(s)
        out["reply"] = prefix + f"{thanks}\n\n" + out["reply"]
        out["lines"] = [ln.strip() for ln in out["reply"].splitlines() if ln.strip()]
        return out
    s["status"] = "need_direction"
    if s.get("refs"):
        refs = (f"Got {len(s['refs'])} reference image(s).\n"
                "Now tell me your design direction, or type \"skip\".")
    else:
        refs = ("You can upload reference images (JPG or PNG).\n"
                "Then tell me your design direction, like \"minimal, warm, brown and cream\".\n"
                "Or type \"skip\".")
    return resp(s, prefix + f"{thanks}\n\n{refs}")


def on_document(s, fields: dict, filename: str):
    s["via_pdf"] = True
    _set_fields(s, fields)
    s["pdf_name"] = filename
    s.pop("opener", None)
    return _after_fields(s)


def on_form(s, fields: dict):
    s["via_pdf"] = False
    _set_fields(s, fields)
    s["opener"] = "Got your registration form. "
    s.pop("pdf_name", None)
    return _after_fields(s)


def on_refs(s, paths):
    s.setdefault("refs", []).extend(paths)
    if s.get("status") == "need_direction" and s.pop("refs_pending", False):
        out = run_round(s)  # PDF design preferences + these refs
        out["reply"] = f"Got {len(paths)} reference image(s).\n\n" + out["reply"]
        out["lines"] = [ln.strip() for ln in out["reply"].splitlines() if ln.strip()]
        return out
    if s.get("status") == "need_direction":
        return resp(s, f"Got {len(paths)} reference image(s).\nNow tell me your design direction, or type \"skip\".")
    return resp(s, f"Saved {len(paths)} reference image(s).") if s.get("status") != "missing_info" \
        else _after_fields(s, f"Saved {len(paths)} reference image(s).\n\n")


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
    return list(got)


SUMMARY = [("business_name", "Business name"), ("business_type", "Business type"), ("industry", "Industry"),
           ("business_website", "Business website"), ("contact_name", "Contact name"),
           ("title_position", "Title / position"), ("email", "Email"), ("phone_number", "Phone number"),
           ("design_preferences", "Design preferences"), ("expected_annual_revenue", "Expected annual revenue"),
           ("requirements_notes", "Requirements / notes")]
ORDER = {k: i for i, (k, _) in enumerate(SUMMARY)}
CONFIRM_ORDER = {k: i for i, k in enumerate(
    [k for k, _ in SUMMARY] + ["uen", "registered_address", "tagline", "brand_colours"])}


def label(k):
    """Client-facing label, e.g. 'Title / position' (never the raw key)."""
    return dict(SUMMARY).get(k) or LABELS.get(k, k.replace("_", " ").capitalize())


def _ordered_fields(fields: dict):
    """(key, value) pairs in form order; unknown keys last."""
    return sorted((fields or {}).items(), key=lambda kv: (CONFIRM_ORDER.get(kv[0], len(CONFIRM_ORDER)), kv[0]))


SUMMARY_CLOSE = "Using your design preferences and business information."
SUMMARY_CLOSE_NO_PREFS = "Using your business information."
LOOKS_PROMPT = "Which look do you prefer?"
LOOKS_HINT = "Pick one or more, or type \"skip\" for new ones."
LOOKS_HINT_SHORT = "Pick one or more, or type \"skip\"."


def _money(v):
    """'480000', '480k' or 'five thousand dollars' -> 'S$480,000'. Ranges and unparsed text stay as typed."""
    if re.search(r"\d\s*[a-z]{0,3}\s*(?:-|–|—|\bto\b)\s*\S", v, re.I):
        return v
    n = parse_amount(v)
    return f"S${n:,.0f}" if n is not None else v


def summary(s):
    """Registration summary shown with the first mockup: one field per line, then the closing line."""
    f, bad = dict(s.get("fields", {})), s.get("invalid", {})
    if not f.get("design_preferences") and s.get("direction"):
        f["design_preferences"] = s["direction"]  # direction typed in chat
    lines = []
    for k, label in SUMMARY:
        v = str(f.get(k) or "").strip()
        if v and k not in bad:
            lines.append(f"{label}: {_money(v) if k == 'expected_annual_revenue' else v}")
    close = SUMMARY_CLOSE if str(f.get("design_preferences") or "").strip() and "design_preferences" not in bad \
        else SUMMARY_CLOSE_NO_PREFS
    return "\n".join(lines) + "\n\n" + close


def _make_look(url, title, style, round_n):
    """One look entry from a generated image url."""
    stem = str(url).rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return {"id": stem, "url": url, "title": title, "brief": style, "round": round_n}


def _checked(brief, refs, round_n, s):
    """Generate one image url; on self-check failure regenerate once with a placeholder."""
    fn = brief.pop("_fn", None) or generate
    urls = fn(dict(brief, _sid=s.get("id")), refs, round_n)
    url = urls[0]
    if not self_check(url):
        trace.record("image_check", "placeholder", False, 0, 0.0, s.get("id"),
                     "self-check failed; regenerated with placeholder")
        url = to_post_size(PlaceholderProvider().generate(brief, refs, round_n)[0])
    return url


def run_round(s):
    s["round"] = s.get("round", 0) + 1
    images = s.get("images") or []
    prev = str(MEDIA_DIR / images[0].rsplit("/", 1)[-1]) if images else None
    ctx = looks_brief.design_context(s.get("fields", {}), s.get("direction"), s.get("feedback"))
    briefs = looks_brief.make_briefs(ctx, s.get("rejected", []), s["round"], s.get("id"))
    base = dict(ctx, direction=s.get("direction"), feedback=s.get("feedback"), prev_image=prev)
    avoid = [r.get("brief") or r.get("style") for r in (s.get("rejected") or [])
             if r.get("brief") or r.get("style")]
    url1 = _checked(dict(base, _fn=generate), s.get("refs", []), s["round"], s)
    looks = [_make_look(url1, briefs[0]["title"], briefs[0]["style"], s["round"])]
    for b in briefs[1:]:
        alt = dict(base, direction=b["style"], prev_image=None, feedback=None, avoid=avoid,
                   _fn=generate_alt)
        looks.append(_make_look(_checked(alt, s.get("refs", []), s["round"], s),
                                b["title"], b["style"], s["round"]))
    s["looks"] = looks
    s["images"] = [lk["url"] for lk in looks]
    s["status"] = "awaiting_review"
    s.setdefault("history", []).append({"round": s["round"], "images": s["images"], "direction": s.get("direction"),
                                        "feedback": None, "accepted": None, "looks": looks})
    s["new_looks"] = True
    if s["round"] == 1:
        return resp(s, f"{summary(s)}\n{LOOKS_PROMPT}\n{LOOKS_HINT}", s["images"])
    return resp(s, f"Here are 3 new looks.\n{LOOKS_PROMPT}\n{LOOKS_HINT_SHORT}", s["images"])


def _consult(s):
    """No pick after 3 rounds: hand off with a consult card for staff."""
    s["status"] = "handed_off"
    s["consult"] = consult.build_card(s, LABELS)
    return resp(s, "No problem.\nOur staff will arrange a consult to better find out your preferences.\n"
                   "Our team will contact you shortly.")


def on_looks(s, selected_ids: list[str], skip: bool = False):
    """Pick one or more looks, or skip the round for 3 new ones."""
    if s.get("status") != "awaiting_review":
        return resp(s, "There's nothing to pick yet.")
    looks = s.get("looks") or []
    by_id = {lk.get("id"): lk for lk in looks}
    ids = [i for i in (selected_ids or []) if i in by_id]
    if ids and not skip:
        if s.get("history"):
            s["history"][-1]["accepted"] = True
        chosen = [by_id[i] for i in ids]
        s["selected_looks"] = chosen
        s["status"] = "accepted"
        return resp(s, "Great choice!\nOur team will contact you shortly.", [c["url"] for c in chosen])
    s.setdefault("rejected", []).extend(looks)
    if s.get("history"):
        s["history"][-1]["accepted"] = False
    if s.get("round", 0) >= MAX_ROUNDS:
        return _consult(s)
    out = run_round(s)
    out["reply"] = "No problem.\n" + out["reply"]
    out["lines"] = [ln.strip() for ln in out["reply"].splitlines() if ln.strip()]
    return out


def _looks_chat(s, text):
    """Parse a looks reply: skip words, numeric picks, or feedback text."""
    low = text.strip().lower()
    if re.match(r"^\s*(skip|none)\b", low) or "new ones" in low or "show me others" in low \
            or low in ("others", "show others"):
        return on_looks(s, [], True)
    looks = s.get("looks") or []
    if looks:
        if re.search(r"\b(all|both)\b", low):
            return on_looks(s, [lk["id"] for lk in looks])
        nums = sorted({int(n) for n in re.findall(r"\b([123])\b", text)} - {0})
        if nums and all(1 <= n <= len(looks) for n in nums):
            return on_looks(s, [looks[n - 1]["id"] for n in nums])
    return on_review(s, False, text)


def _confirm_text(s):
    """The 'please check these details' card for the pending draft."""
    p = s.get("pending") or {}
    lines = [f"I read {p.get('filename')}.", "Please check the details below."]
    if "nric" in (p.get("removed") or []):
        lines.append("I left out the ID number.")
    if p.get("removed"):
        lines.append("I left out some private details (ID, phone, address).")
    lines.append("Is this right? Tap Confirm, or type what to change.")
    return "\n".join(lines)


def on_extracted(s, doc_id, filename, fields, removed):
    """Hold extracted details as a pending draft until the client confirms."""
    if not fields:
        return resp(s, f"I couldn't find business details in {filename}.\n"
                       "Please type your business name, contact name and email.")
    s["pending"] = {"docId": doc_id, "filename": filename, "fields": dict(fields),
                    "removed": list(removed or [])}
    s["status_before"] = s.get("status")
    s["status"] = "confirm_details"
    return resp(s, _confirm_text(s))


def on_confirm(s, accept: bool, edits: dict | None = None, remove: list | None = None):
    """Confirm (save) or discard the pending draft."""
    p = s.get("pending")
    if not p:
        return resp(s, "There's nothing to confirm.")
    if not accept:
        s["pending"] = None
        s["status"] = s.pop("status_before", None) or "need_document"
        return resp(s, "Okay, I won't use that file.\nUpload another, or type your details.")
    fields = dict(p.get("fields", {}))
    for k in (remove or []):
        fields.pop(k, None)
    for k, v in (edits or {}).items():
        if k in LABELS:
            fields[k] = v
    s["pending"] = None
    s["via_pdf"] = True
    s["pdf_name"] = p.get("filename")
    doc = (s.get("docs") or {}).get(p.get("docId"))
    if isinstance(doc, dict):  # frozen snapshot for staff mismatch flags (PRD 4.9.3.2)
        doc["fields"] = {k: fields[k] for k in ("business_name", "uen", "registered_address")
                         if fields.get(k)}
        doc["confirmed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    s["status"] = s.pop("status_before", None) or "need_document"
    s["confirmed_doc"] = {"docId": p.get("docId"), "filename": p.get("filename"), "fields": list(fields)}
    _set_fields(s, fields)
    return _after_fields(s)


def remove_pending(s, doc_id):
    """Remove a pending draft before anything from it is saved."""
    p = s.get("pending")
    if p and p.get("docId") == doc_id:
        fn = p.get("filename", "")
        s["pending"] = None
        s["status"] = s.pop("status_before", None) or "need_document"
        return resp(s, f"Removed {fn}.\nNothing from it was saved.")
    return resp(s, "That file is already saved or gone.")


def _confirm_chat(s, text):
    """Yes/no/edits while a draft awaits confirmation."""
    norm = text.strip().lower().strip().rstrip(".!").strip()
    if norm in YES_WORDS:
        return on_confirm(s, True)
    if norm in ("no", "wrong"):
        return resp(s, "What should I change?\nType it like: Email: jo@shop.sg")
    got = extract_fields(text)
    if got:
        s["pending"]["fields"].update(got)
        return resp(s, "Updated.\n" + _confirm_text(s))
    return resp(s, "Reply \"yes\" if it's right.\nOr type a fix, like: Email: jo@shop.sg")


def on_chat(s, text):
    st = s.get("status")
    if st in ("need_document", "missing_info"):
        return _after_fields(s, touched=_fill_from_text(s, text))
    if st == "need_direction":
        pending = s.pop("refs_pending", False)  # 'skip' keeps the PDF's design preferences
        s["direction"] = (s["direction"] if pending else None) if SKIP.match(text) else text.strip()
        return run_round(s)
    if st == "confirm_details":
        return _confirm_chat(s, text)
    if st == "awaiting_review":
        return _looks_chat(s, text)
    if st in ("approved", "rejected", "pending_review"):
        msg = {"approved": "You're approved!\nOur team will contact you shortly.",
               "rejected": "Thanks for your interest.\nOur team will contact you shortly.",
               "pending_review": "Thanks! We're reviewing your details.\nOur team will contact you shortly."}[st]
        return resp(s, msg, s.get("images"))
    if st == "accepted":
        return resp(s, "Your design direction is locked in.\nOur team will contact you shortly.", s.get("images"))
    return resp(s, "A designer has your details.\nOur team will contact you shortly.")


def start_resume(s, fields: list[str], note: str | None):
    """Staff asked for more info: chat only asks for these fields."""
    s["refill"] = [f for f in fields if f in LABELS]
    s["resumed"] = True
    s["status"] = "missing_info"
    if not s["refill"]:
        return resp(s, "Welcome back! " + (note or "Please reply with the requested details."))
    head = "Welcome back! Our team needs a little more from you" + (f":\n\n{note.strip()}" if note else ".")
    return resp(s, head + "\n\nCould you update:\n" + "\n".join(f"• {label(f)}" for f in s["refill"]))


def on_review(s, accepted: bool, feedback: str | None):
    if s.get("status") != "awaiting_review":
        return resp(s, "There's nothing to review yet.")
    if s.get("history"):
        s["history"][-1].update(accepted=bool(accepted), feedback=(feedback or "").strip() or None)
    if accepted:
        if s.get("looks"):
            s["selected_looks"] = [s["looks"][0]]
        s["status"] = "accepted"
        return resp(s, "Great, design direction accepted! Our team will contact you shortly.", s.get("images"))
    s["feedback"] = (feedback or "").strip() or None
    if s.get("round", 0) >= MAX_ROUNDS:
        s.setdefault("rejected", []).extend(s.get("looks") or [])
        return _consult(s)
    if not s["feedback"]:
        s["status"] = "awaiting_review"
        return resp(s, "What would you like changed? (colours, style, text, layout...)")
    s.setdefault("rejected", []).extend(s.get("looks") or [])
    return run_round(s)
