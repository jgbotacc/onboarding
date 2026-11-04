"""Staff review API. Primary: /api/staff/clients*. Aliases: /api/clients*, /api/admin/clients*.
Every route needs the staff passcode (x-staff-key header, see shared/security.py)."""
import json
import secrets
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from src.features.chat import agent
from src.features.imagegen import studio
from src.features.looks.brief import design_context
from src.features.staff import email, metrics
from src.shared import guard
from src.shared.config import LABELS, MEDIA_DIR, PUBLIC_BASE_URL
from src.shared.security import require_staff

STATUS = {"approve": "approved", "reject": "rejected", "more_info": "needs_info"}


class DecisionIn(BaseModel):
    decision: Literal["approve", "reject", "more_info"]
    fields: list[str] = []
    note: str | None = None


class ConsultDecisionIn(BaseModel):
    decision: Literal["approve", "decline"]
    note: str | None = None


def actor(request: Request) -> str:
    return "staff:" + (request.headers.get("x-staff-name") or "staff")[:40]


def _summary(s):
    f = s.get("fields", {})
    return {"id": s["id"], "business_name": f.get("business_name"), "industry": f.get("industry"),
            "contact_name": f.get("contact_name"), "email": f.get("email"), "status": s["status"],
            "round": s.get("round", 0), "image": (s.get("images") or [None])[0], "updated": s.get("updated")}


def _mail(m):
    """Outbox entry without the body (it can hold a live resume link)."""
    return {k: m.get(k) for k in ("to", "subject", "status", "sent_at", "id") if k in m}


def _all_looks(store, cid):
    out = []
    for l in store.looks(cid):
        out.append({"round": l.get("round"), "id": l.get("id"), "url": l.get("url"),
                    "title": l.get("title"), "brief": l.get("brief"),
                    "selected": bool(l.get("selected")), "at": l.get("created_at") or l.get("at")})
    return out


def _rejected(store, s):
    """Not selected, from older rounds; once handed_off/accepted every non-pick counts."""
    cur, final = s.get("round", 0), s.get("status") in ("handed_off", "accepted")
    return [l for l in _all_looks(store, s["id"])
            if not l["selected"] and ((l.get("round") or 0) < cur or final)]


def feedback_as_rejected(store, sid):
    """Hearts, rejections and change requests mapped to the rejected-look shape.

    The next brief treats a reacted draft exactly like a rejected look: the
    studio avoid list and the variant titles both read this list. Approvals are
    final picks, not steer-away signals, so they stay out.
    """
    if not all(hasattr(store, m) for m in ("drafts", "feedback_for")):
        return []
    by_id = {d.get("id"): d for d in store.drafts(sid)}
    out = []
    for f in store.feedback_for(sid):
        if f.get("kind") not in ("heart", "reject", "changes"):
            continue
        d = by_id.get(f.get("draft_id"))
        if not d or not d.get("sent_at"):
            continue
        out.append({"round": None, "id": d.get("id"), "url": d.get("url"),
                    "title": d.get("style_title") or "Suggested by our team",
                    "brief": d.get("style") or d.get("marketer_prompt"),
                    "at": f.get("created_at")})
    return out


def _consult_for(store, cid):
    for c in store.consults():  # newest first
        if c.get("session_id") == cid or c.get("client_id") == cid:
            return c
    return None


def _with_pins(store, card):
    """Consult card plus pinned_drafts rendered at read time (never stored)."""
    if not card:
        return card
    sid = card.get("session_id") or card.get("client_id") or ""
    pins = [_draft_json(d) for d in store.drafts(sid)
            if d.get("pinned_to") == "consult" and d.get("pinned_consult_id") == card.get("id")]
    return dict(card, pinned_drafts=pins)


def _detail(store, s):
    refs = ["/media/" + r.rsplit("/", 1)[-1] for r in s.get("refs", [])]
    base = dict(_summary(s), fields=s.get("fields", {}), labels=LABELS, images=s.get("images", []),
                reference_images=refs, rounds=s.get("history", []), decisions=s.get("decisions", []),
                outbox=[_mail(m) for m in s.get("outbox", [])], refill=s.get("refill", []), missing=agent.missing(s))
    rej = [{"round": l["round"], "id": l["id"], "url": l["url"], "title": l["title"],
            "brief": l["brief"], "at": l["at"]} for l in _rejected(store, s)]
    docs = {k: {"filename": v.get("filename"), "status": v.get("status")} for k, v in (s.get("docs") or {}).items()}
    traces = [{"step": t.get("step"), "model": t.get("model"), "ok": t.get("ok"),
               "ms": t.get("latency_ms"), "cost_sgd": t.get("cost_sgd"), "at": t.get("at")}
              for t in store.traces(s["id"])]
    d = dict(base, lang=s.get("lang") or "en", transcript=s.get("transcript", []),
             looks=_all_looks(store, s["id"]), rejected_looks=rej,
             consult=_with_pins(store, _consult_for(store, s["id"])),
             audit=store.audit_log(s["id"]), documents=docs, traces=traces)
    d.pop("pending", None)  # A9: pending drafts never reach staff
    return guard.clean(d, guard.others_identifiers(store, s["id"]))[0]


STUDIO_CAP = 9


class DraftsIn(BaseModel):
    marketer_prompt: str | None = Field(default=None, max_length=500)
    chips: list[str] = []
    preset: Literal["post", "story", "flyer"] = "post"


class RemixIn(BaseModel):
    source_id: str
    source_kind: Literal["draft", "look"]
    note: str | None = Field(default=None, max_length=300)
    preset: Literal["post", "story", "flyer"] | None = None


class StarIn(BaseModel):
    starred: bool


class PinIn(BaseModel):
    target: Literal["client", "consult"] | None = None


class ShareIn(BaseModel):
    days: int = Field(default=7, ge=1, le=30)


class ShortlistIn(BaseModel):
    add: bool


class ShareFeedbackIn(BaseModel):
    draft_id: str
    kind: Literal["heart", "reject", "approve", "changes"]
    note: str | None = Field(default=None, max_length=500)


_studio_locks_guard = threading.Lock()
_studio_locks: dict[str, threading.Lock] = {}


def _studio_lock_for(sid: str) -> threading.Lock:
    with _studio_locks_guard:
        return _studio_locks.setdefault(sid, threading.Lock())


def _draft_json(d: dict) -> dict:
    chips = d.get("chips")
    if isinstance(chips, str):
        try:
            chips = json.loads(chips)
        except (ValueError, TypeError):
            pass
    return {"id": d.get("id"), "run_id": d.get("run_id"), "parent_id": d.get("parent_id"),
            "parent_kind": d.get("parent_kind"), "preset": d.get("preset"),
            "width": d.get("width"), "height": d.get("height"), "url": d.get("url"),
            "status": d.get("status"), "style_title": d.get("style_title"),
            "marketer_prompt": d.get("marketer_prompt"), "chips": chips,
            "author": d.get("author"), "starred": bool(d.get("starred")),
            "pinned_to": d.get("pinned_to"), "pinned_consult_id": d.get("pinned_consult_id"),
            "error": d.get("error"), "sent_at": d.get("sent_at"), "created_at": d.get("created_at")}


def _studio_usage(store, cid):
    """(drafts, used, remaining): used counts reserved+ok; failed rows free their slots."""
    ds = store.drafts(cid)
    used = sum(1 for d in ds if d.get("status") in ("reserved", "ok"))
    return ds, used, STUDIO_CAP - used


def _reconcile(store, cid):
    """Free timed-out reservations; flag ok drafts whose media file is gone."""
    store.sweep_stale_drafts(cid)
    for d in store.drafts(cid):
        if d.get("status") == "ok" and d.get("url"):
            if not (MEDIA_DIR / str(d["url"]).rsplit("/", 1)[-1]).is_file():
                store.finish_draft(d["id"], d.get("url"), "failed", "file missing")


def _mask_ids(fields) -> set[str]:
    """Mask set for marketer text: own email/phone/UEN/name plus the other
    contact-ish fields (website, address, title, revenue) that must never
    reach the image prompt. NRIC is always scrubbed by guard.clean."""
    ids = set(studio.own_identifiers(fields))
    for k in ("business_website", "website", "registered_address", "address",
              "title_position", "expected_annual_revenue"):
        v = (fields or {}).get(k)
        if isinstance(v, str) and len(v.strip()) >= 3:
            ids.add(v.strip())
    return ids


def _ref_paths(s) -> list[str]:
    out = []
    for r in s.get("refs") or []:
        p = Path(str(r))
        if p.is_file():
            out.append(str(p))
    return out


def make_router(store, save):
    r = APIRouter(dependencies=[Depends(require_staff)])

    def load(cid):
        s = store.load(cid)
        if not s:
            raise HTTPException(404, "Client not found.")
        return s

    def list_clients():
        rows = [_summary(s) for s in store.list_states() if s.get("fields", {}).get("business_name")]
        return sorted(rows, key=lambda x: x["updated"] or "", reverse=True)

    def get_client(cid: str):
        return _detail(store, load(cid))

    def rejected_looks(cid: str):
        s = load(cid)
        by_round: dict = {}
        for l in _rejected(store, s):
            rnd = l.get("round") or 0
            by_round.setdefault(rnd, []).append(
                {"id": l.get("id"), "url": l.get("url"), "alt": l.get("title"),
                 "title": l.get("title"), "brief": l.get("brief"), "at": l.get("at")})
        out = [{"round": rnd, "options": by_round[rnd]} for rnd in sorted(by_round)]
        return guard.clean(out, guard.others_identifiers(store, cid))[0]

    def decide(cid: str, body: DecisionIn, request: Request):
        s = load(cid)
        bad = [f for f in body.fields if f not in LABELS]
        if bad:
            raise HTTPException(400, "Unknown field: " + ", ".join(bad) + ".")
        if body.decision == "more_info" and not body.fields and not body.note:
            raise HTTPException(400, "Pick at least one field or add a note.")
        act = actor(request)
        token, url = None, None
        if body.decision == "more_info":
            token = secrets.token_urlsafe(16)
            base = PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
            url = f"{base}/?resume={token}"
            s["resume_token"] = token
            s["resume"] = {"fields": body.fields, "note": body.note}
        rec = {"id": uuid.uuid4().hex, "decision": body.decision, "fields": body.fields, "note": body.note,
               "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "previous_status": s["status"]}
        others = guard.others_identifiers(store, cid)
        s_clean = guard.clean(s, others)[0]
        note_clean = guard.clean(body.note, others)[0] if body.note else body.note
        mail = guard.clean(email.send(body.decision, s_clean, body.fields, note_clean, url), others)[0]
        s["status"] = STATUS[body.decision]
        s.setdefault("decisions", []).append(rec)
        s.setdefault("outbox", []).append(mail)
        save(s)
        store.event(s["id"], "decision", dict(rec, token=token))
        store.event(s["id"], "email", mail)
        store.audit(cid, act, "decision_" + body.decision, rec["id"])
        kept = "Not sent" in mail.get("status", "") or "failed" in mail.get("status", "")
        store.audit(cid, act, "email_kept" if kept else "email_sent",
                    mail.get("subject"), {"status": mail.get("status")})
        return dict(_detail(store, s), email=_mail(mail), resume_url=url)  # link shown once, to staff only

    def preview(cid: str, body: DecisionIn):
        s = load(cid)
        bad = [f for f in body.fields if f not in LABELS]
        if bad:
            raise HTTPException(400, "Unknown field: " + ", ".join(bad) + ".")
        if body.decision == "more_info" and not body.fields and not body.note:
            raise HTTPException(400, "Pick at least one field or add a note.")
        others = guard.others_identifiers(store, cid)
        s_clean = guard.clean(s, others)[0]
        note_clean = guard.clean(body.note, others)[0] if body.note else body.note
        subject, text = email.compose(body.decision, s_clean, body.fields, note_clean,
                                      "<link created when you confirm>")
        return guard.clean({"subject": subject, "body": text}, others)[0]

    def list_consults():
        out = []
        for c in store.consults():
            sid = c.get("session_id") or c.get("client_id")
            out.append(guard.clean(_with_pins(store, c), guard.others_identifiers(store, sid))[0])
        return out

    def consult_decide(cid: str, body: ConsultDecisionIn, request: Request):
        card = store.get_consult(cid)
        if not card:
            raise HTTPException(404, "Consult not found.")
        if card.get("status") != "pending_approval":
            raise HTTPException(409, "This consult was already decided.")
        act = actor(request)
        card["status"] = "approved" if body.decision == "approve" else "declined"
        card["approved_by"] = act
        card["decided_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if body.note is not None:
            card["note"] = body.note
        store.save_consult(card)
        sess_id = card.get("session_id") or card.get("client_id")
        store.audit(sess_id, act, "consult_" + body.decision, card["id"])
        if sess_id:
            s = store.load(sess_id)
            if s and s.get("consult"):
                s["consult"]["status"] = card["status"]
                s["consult"]["approved_by"] = act
                s["consult"]["decided_at"] = card["decided_at"]
                if body.note is not None:
                    s["consult"]["note"] = body.note
                save(s)
        return guard.clean(card, guard.others_identifiers(store, sess_id))[0]

    def consult_approve(cid: str, request: Request):
        return consult_decide(cid, ConsultDecisionIn(decision="approve"), request)

    def get_metrics():
        return metrics.compute(store)

    def get_traces(client: str | None = None, limit: int = 100):
        return store.traces(client or None, limit)

    def get_audit(client: str | None = None):
        return store.audit_log(client or None)

    def studio_get(cid: str):
        s = load(cid)
        _reconcile(store, cid)
        others = guard.others_identifiers(store, cid)
        brief = design_context(s.get("fields", {}), s.get("direction"), None)
        avoid = [{"id": l["id"], "title": l["title"], "brief": l.get("brief"), "url": l.get("url")}
                 for l in _rejected(store, s) + feedback_as_rejected(store, cid)]
        presets = [{"id": p["id"], "label": p["label"], "w": p["w"], "h": p["h"]}
                   for p in studio.PRESETS.values()]
        chips = [{"id": c["id"], "label": c["label"], "text": c["text"]}
                 for c in studio.CHIPS.values()]
        ds, used, remaining = _studio_usage(store, cid)
        out = {"brief": brief, "avoid": avoid, "presets": presets, "chips": chips,
               "drafts": [_draft_json(d) for d in ds],
               "cap": STUDIO_CAP, "used": used, "remaining": remaining}
        return guard.clean(out, others)[0]

    def studio_drafts(cid: str, body: DraftsIn, request: Request):
        s = load(cid)
        with _studio_lock_for(cid):
            _reconcile(store, cid)
            fields = s.get("fields", {})
            others = guard.others_identifiers(store, cid)
            own_ids = _mask_ids(fields)
            rejected = _rejected(store, s) + feedback_as_rejected(store, cid)
            rej_titles = [l.get("title") for l in rejected if l.get("title")]
            vs = studio.variants(rej_titles, s.get("direction"))
            masked_mp, _ = guard.clean(body.marketer_prompt or "", set(own_ids))
            chips = [c for c in (body.chips or []) if c in studio.CHIPS]
            cfg = studio.PRESETS[body.preset]
            run_id = uuid.uuid4().hex
            author = actor(request)
            refs = _ref_paths(s)
            rows, prompts = [], []
            for v in vs:
                prompt = studio.studio_prompt(fields, s.get("direction"), rejected, masked_mp,
                                              chips, body.preset, style=v, own_ids=own_ids)
                prompts.append(prompt)
                rows.append({"run_id": run_id, "preset": body.preset,
                             "width": cfg["w"], "height": cfg["h"],
                             "marketer_prompt": masked_mp or None, "chips": chips,
                             "style_title": v.get("title"), "style": v.get("style"),
                             "prompt": prompt, "author": author})
            ids = store.reserve_drafts(cid, rows, cap=STUDIO_CAP)
            if ids is None:
                raise HTTPException(409, "Draft limit reached")

            def _one(i):
                did = ids[i]
                res = studio.studio_generate(prompts[i], body.preset, images=refs, session_id=cid)
                if res.get("ok"):
                    d = store.finish_draft(did, res.get("url"), "ok")
                    status = "ok"
                else:
                    d = store.finish_draft(did, None, "failed", res.get("error"))
                    status = "failed"
                store.audit(cid, author, "studio_draft", did,
                            {"prompt": prompts[i], "preset": body.preset,
                             "run_id": run_id, "parent_id": None, "status": status})
                return d

            with ThreadPoolExecutor(max_workers=3) as ex:
                ds = [d for d in ex.map(_one, range(len(ids))) if d]
            _, _, remaining = _studio_usage(store, cid)
            out = {"run_id": run_id, "drafts": [_draft_json(d) for d in ds], "remaining": remaining}
            return guard.clean(out, others)[0]

    def studio_remix(cid: str, body: RemixIn, request: Request):
        s = load(cid)
        if body.source_kind == "draft":
            src = store.get_draft(body.source_id)
            if not src or src.get("session_id") != cid:
                raise HTTPException(404, "Source not found.")
            if not src.get("url"):
                raise HTTPException(404, "Source not found.")
            src_file = MEDIA_DIR / str(src["url"]).rsplit("/", 1)[-1]
            if not src_file.is_file():
                raise HTTPException(404, "Source not found.")
            preset = body.preset or (src.get("preset") if src.get("preset") in studio.PRESETS else "post")
            src_style = {"title": src.get("style_title"), "style": src.get("style")} if src.get("style") else None
        else:
            lk = next((l for l in store.looks(cid) if l.get("id") == body.source_id), None)
            if not lk:
                raise HTTPException(404, "Source not found.")
            src_file = MEDIA_DIR / str(lk.get("url") or "").rsplit("/", 1)[-1]
            if not lk.get("url") or not src_file.is_file():
                raise HTTPException(404, "Source not found.")
            preset = body.preset or "post"
            src_style = None
        with _studio_lock_for(cid):
            _reconcile(store, cid)
            fields = s.get("fields", {})
            others = guard.others_identifiers(store, cid)
            own_ids = _mask_ids(fields)
            masked_note, _ = guard.clean(body.note or "", set(own_ids))
            rejected = _rejected(store, s) + feedback_as_rejected(store, cid)
            base = studio.studio_prompt(fields, s.get("direction"), rejected, "", [],
                                        preset, style=src_style, own_ids=own_ids)
            prompt = base + " Make a close variation of this design; keep layout and colours."
            if isinstance(masked_note, str) and masked_note.strip():
                prompt += f" Note: {masked_note.strip()}"
            prompt = prompt[:studio.MAX_PROMPT]
            cfg = studio.PRESETS[preset]
            run_id = uuid.uuid4().hex
            author = actor(request)
            rows = [{"run_id": run_id, "parent_id": body.source_id, "parent_kind": body.source_kind,
                     "preset": preset, "width": cfg["w"], "height": cfg["h"],
                     "marketer_prompt": masked_note.strip() or None, "chips": [],
                     "style_title": (src_style or {}).get("title") or "Remix",
                     "style": (src_style or {}).get("style") or (s.get("direction") or ""),
                     "prompt": prompt, "author": author}]
            ids = store.reserve_drafts(cid, rows, cap=STUDIO_CAP)
            if ids is None:
                raise HTTPException(409, "Draft limit reached")
            res = studio.studio_generate(prompt, preset, images=[str(src_file)] + _ref_paths(s),
                                         session_id=cid)
            if res.get("ok"):
                d = store.finish_draft(ids[0], res.get("url"), "ok")
                status = "ok"
            else:
                d = store.finish_draft(ids[0], None, "failed", res.get("error"))
                status = "failed"
            store.audit(cid, author, "studio_draft", ids[0],
                        {"prompt": prompt, "preset": preset, "run_id": run_id,
                         "parent_id": body.source_id, "parent_kind": body.source_kind, "status": status})
            _, _, remaining = _studio_usage(store, cid)
            out = {"run_id": run_id, "drafts": [_draft_json(d)], "remaining": remaining}
            return guard.clean(out, others)[0]

    def studio_star(cid: str, did: str, body: StarIn, request: Request):
        load(cid)
        d = store.get_draft(did)
        if not d or d.get("session_id") != cid:
            raise HTTPException(404, "Draft not found.")
        d = store.set_draft_flags(did, starred=body.starred)
        store.audit(cid, actor(request), "studio_star", did, {"starred": bool(body.starred)})
        return guard.clean(_draft_json(d), guard.others_identifiers(store, cid))[0]

    def studio_pin(cid: str, did: str, body: PinIn, request: Request):
        load(cid)
        d = store.get_draft(did)
        if not d or d.get("session_id") != cid:
            raise HTTPException(404, "Draft not found.")
        if body.target == "consult":
            card = _consult_for(store, cid)
            if not card:
                raise HTTPException(409, "This client has no consult.")
            d = store.set_draft_flags(did, pinned_to="consult", pinned_consult_id=card["id"])
            details = {"target": "consult", "pinned_consult_id": card["id"]}
        elif body.target == "client":
            d = store.set_draft_flags(did, pinned_to="client", pinned_consult_id=None)
            details = {"target": "client"}
        else:
            d = store.set_draft_flags(did, pinned_to=None, pinned_consult_id=None)
            details = {"target": None}
        store.audit(cid, actor(request), "studio_pin", did, details)
        return guard.clean(_draft_json(d), guard.others_identifiers(store, cid))[0]

    def studio_send(cid: str, did: str, request: Request):
        s = load(cid)
        with _studio_lock_for(cid):
            d = store.get_draft(did)
            if not d or d.get("session_id") != cid:
                raise HTTPException(404, "Draft not found.")
            if d.get("sent_at"):
                raise HTTPException(409, "This draft was already sent.")
            if d.get("status") != "ok" or not d.get("url"):
                raise HTTPException(409, "Only finished drafts can be sent.")
            act = actor(request)
            look = {"id": d["id"], "url": d.get("url"), "title": "Suggested by our team",
                    "brief": d.get("style"), "round": s.get("round", 0),
                    "suggested": True, "source": "staff"}
            store.add_looks(cid, s.get("round", 0), [look], source="staff")
            d = store.mark_draft_sent(
                did, act, datetime.now(timezone.utc).isoformat(timespec="seconds"))
            if s.get("status") == "awaiting_review":
                s.setdefault("looks", []).append(look)
            else:
                s.setdefault("suggested_looks", []).append(look)
                card = _consult_for(store, cid)
                if card:
                    entry = {"id": look["id"], "url": look["url"], "title": look["title"],
                             "brief": look.get("brief"), "round": look.get("round"),
                             "suggested": True}
                    card.setdefault("suggested_looks", []).append(entry)
                    store.save_consult(card)
                    if s.get("consult") and s["consult"].get("id") == card["id"]:
                        s["consult"] = card
            save(s)
            store.audit(cid, act, "studio_send", did,
                        {"look_id": look["id"], "round": look.get("round")})
            out = dict(_draft_json(d), look_id=look["id"])
            return guard.clean(out, guard.others_identifiers(store, cid))[0]

    def studio_share(cid: str, body: "ShareIn", request: Request):
        load(cid)
        tid, token = store.issue_share_token(cid, actor(request), days=body.days)
        base = PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
        exp = next((t["expires_at"] for t in store.shares_for(cid) if t["id"] == tid), None)
        # Fragment carries the token: it never leaves the browser, so it never
        # reaches the server (or its access log). The page reads it and sends
        # it back in the x-share-token header.
        return {"id": tid, "url": f"{base}/share#t={token}", "expires_at": exp}

    def studio_shares(cid: str):
        load(cid)
        return [{"id": t["id"], "expires_at": t["expires_at"], "revoked_at": t["revoked_at"],
                 "used_at": t["used_at"], "created_by": t["created_by"]}
                for t in store.shares_for(cid)]

    def studio_revoke(cid: str, tid: str, request: Request):
        load(cid)
        if not any(t["id"] == tid for t in store.shares_for(cid)):
            raise HTTPException(404, "Share link not found.")
        d = store.revoke_share_token(tid, actor(request))
        if not d:
            raise HTTPException(404, "Share link not found.")
        return {"id": tid, "revoked_at": d["revoked_at"]}

    def studio_shortlist(cid: str):
        load(cid)
        return _shortlist_view(store, cid)

    def studio_shortlist_set(cid: str, did: str, body: "ShortlistIn", request: Request):
        load(cid)
        d = store.get_draft(did)
        if not d or d.get("session_id") != cid:
            raise HTTPException(404, "Draft not found.")
        act = actor(request)
        if body.add:
            store.shortlist_add(cid, did, act)
        else:
            store.shortlist_remove(cid, did)
        store.audit(cid, act, "shortlist_add" if body.add else "shortlist_remove", did)
        return {"drafts": _shortlist_view(store, cid)["drafts"]}

    for prefix in ("/api/staff/clients", "/api/clients", "/api/admin/clients"):
        r.add_api_route(prefix, list_clients, methods=["GET"])
        r.add_api_route(prefix + "/{cid}", get_client, methods=["GET"])
        r.add_api_route(prefix + "/{cid}/decision", decide, methods=["POST"])
        r.add_api_route(prefix + "/{cid}/decision/preview", preview, methods=["POST"])
    r.add_api_route("/api/staff/clients/{cid}/rejected-looks", rejected_looks, methods=["GET"])
    r.add_api_route("/api/staff/consults", list_consults, methods=["GET"])
    r.add_api_route("/api/staff/consults/{cid}/decision", consult_decide, methods=["POST"])
    r.add_api_route("/api/staff/consults/{cid}/approve", consult_approve, methods=["POST"])
    r.add_api_route("/api/staff/clients/{cid}/studio", studio_get, methods=["GET"])
    r.add_api_route("/api/staff/clients/{cid}/studio/drafts", studio_drafts, methods=["POST"])
    r.add_api_route("/api/staff/clients/{cid}/studio/remix", studio_remix, methods=["POST"])
    r.add_api_route("/api/staff/clients/{cid}/studio/drafts/{did}/star", studio_star, methods=["POST"])
    r.add_api_route("/api/staff/clients/{cid}/studio/drafts/{did}/pin", studio_pin, methods=["POST"])
    r.add_api_route("/api/staff/clients/{cid}/studio/drafts/{did}/send", studio_send, methods=["POST"])
    r.add_api_route("/api/staff/clients/{cid}/studio/share", studio_share, methods=["POST"])
    r.add_api_route("/api/staff/clients/{cid}/studio/shares", studio_shares, methods=["GET"])
    r.add_api_route("/api/staff/clients/{cid}/studio/shares/{tid}/revoke", studio_revoke,
                    methods=["POST"])
    r.add_api_route("/api/staff/clients/{cid}/studio/shortlist", studio_shortlist, methods=["GET"])
    r.add_api_route("/api/staff/clients/{cid}/studio/shortlist/{did}", studio_shortlist_set,
                    methods=["POST"])
    r.add_api_route("/api/staff/metrics", get_metrics, methods=["GET"])
    r.add_api_route("/api/staff/traces", get_traces, methods=["GET"])
    r.add_api_route("/api/staff/audit", get_audit, methods=["GET"])
    return r


def _shortlist_view(store, cid):
    """Staff shortlist view: shortlisted drafts plus the feedback feed."""
    ids = set(store.shortlist_for(cid))
    drafts = [_draft_json(d) for d in store.drafts(cid) if d.get("id") in ids]
    fb = [{"draft_id": f["draft_id"], "kind": f["kind"], "note": f.get("note"),
           "actor": f["actor"], "created_at": f.get("created_at")}
          for f in store.feedback_for(cid)]
    return guard.clean({"drafts": drafts, "feedback": fb},
                       guard.others_identifiers(store, cid))[0]


def _parse_ts(v):
    """ISO or SQLite datetime -> aware datetime, else None."""
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _share_expired(row) -> bool:
    exp = _parse_ts(row.get("expires_at"))
    return exp is None or exp <= datetime.now(timezone.utc)


_share_hits: dict[str, list[float]] = {}
_share_hits_guard = threading.Lock()
SHARE_WRITES_PER_HOUR = 30


def _share_limited(tid: str) -> bool:
    """Per-token write budget: 30 writes per rolling hour. True when over."""
    now = time.monotonic()
    with _share_hits_guard:
        if len(_share_hits) > 1000:  # prune dead tokens, keep memory bounded
            for k in [k for k, v in _share_hits.items() if not [t for t in v if now - t < 3600]]:
                del _share_hits[k]
        hits = [t for t in _share_hits.get(tid, []) if now - t < 3600]
        if len(hits) >= SHARE_WRITES_PER_HOUR:
            _share_hits[tid] = hits
            return True
        hits.append(now)
        _share_hits[tid] = hits
        return False


def _share_token_from(request: Request) -> str | None:
    """The share token arrives in the x-share-token header only.

    It is never read from the path or query string, so uvicorn's access log
    (which records the request target) cannot capture it.
    """
    return request.headers.get("x-share-token")


def make_share_router(store, save, lock_for):
    """Public share links: no login, the token is the only secret."""
    r = APIRouter()

    def resolve(request: Request) -> dict:
        """Hash the header token, then check session, expiry and revoked_at.

        Unknown and revoked tokens both read 404, so a revoked link is
        indistinguishable from a made-up one; expired tokens read 410.
        """
        token = _share_token_from(request)
        row = store.find_share_token(token) if token else None
        if not row:
            raise HTTPException(404, "This link is no longer valid. Please ask our team for a new one.")
        if _share_expired(row):
            raise HTTPException(410, "This link has expired. Please ask our team for a new one.")
        return row

    def share_get(request: Request):
        row = resolve(request)
        if not row.get("used_at"):
            store.mark_share_used(row["id"])
        store.sweep_expired_tokens()
        sid = row["session_id"]
        s = store.load(sid)
        if not s:
            raise HTTPException(404, "This link is no longer valid. Please ask our team for a new one.")
        liked = set(store.shortlist_for(sid))
        drafts = [{"id": d["id"], "url": d["url"],
                   "title": d.get("style_title") or "Suggested by our team",
                   "liked": d["id"] in liked}
                  for d in store.drafts(sid) if d.get("sent_at")]
        dec = None
        for f in store.feedback_for(sid):
            if f.get("kind") in ("approve", "changes"):
                dec = {"draft_id": f["draft_id"], "kind": f["kind"]}
        out = {"business_name": (s.get("fields") or {}).get("business_name"),
               "drafts": drafts, "shortlist": sorted(liked), "decided": dec}
        return guard.clean(out, guard.others_identifiers(store, sid))[0]

    def share_feedback(request: Request, body: ShareFeedbackIn):
        row = resolve(request)
        sid = row["session_id"]
        with lock_for(sid):
            if _share_limited(row["id"]):
                raise HTTPException(429, "Too many tries. Please wait a while before trying again.")
            s = store.load(sid)
            if not s:
                raise HTTPException(404, "This link is no longer valid. Please ask our team for a new one.")
            if body.kind == "changes" and not (body.note or "").strip():
                raise HTTPException(400, "Please add a short note about what to change.")
            note = None
            if body.kind == "changes":
                note, _ = guard.clean(body.note.strip(), _mask_ids(s.get("fields", {})))
            try:
                store.record_feedback(sid, body.draft_id, body.kind, note, "client:share")
            except ValueError:
                raise HTTPException(404, "Draft not found.")
            if body.kind == "approve":  # final pick: mark the look selected, like a client pick
                store.mark_looks(sid, [body.draft_id])
                ids = {lk.get("id") for lk in s.get("looks") or []}
                if body.draft_id in ids and s.get("status") == "awaiting_review":
                    s["selected_looks"] = [lk for lk in s["looks"]
                                          if lk.get("id") == body.draft_id]
                    s["status"] = "accepted"
                    if s.get("history"):
                        s["history"][-1]["accepted"] = True
            save(s)
            return {"ok": True, "shortlist": store.shortlist_for(sid)}

    r.add_api_route("/api/share", share_get, methods=["GET"])
    r.add_api_route("/api/share/feedback", share_feedback, methods=["POST"])
    return r


def resume(store, token: str):
    """Load a client by resume token and switch it into refill mode. Returns (state, response) or None.
    Raises 410 once the requested fields have been submitted (link already used).
    Re-opening the link before submitting is allowed (page reloads)."""
    s = store.find_by_token(token)
    if not s or not s.get("resume") or s.get("resume_token") != token:
        return None
    if s["resume"].get("used"):
        raise HTTPException(410, "This link has already been used. Your details are saved, and our team will be in touch.")
    out = agent.start_resume(s, s["resume"]["fields"], s["resume"].get("note"))
    return s, out
