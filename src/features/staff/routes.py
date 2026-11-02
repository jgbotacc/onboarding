"""Staff review API. Primary: /api/staff/clients*. Aliases: /api/clients*, /api/admin/clients*.
Every route needs the staff passcode (x-staff-key header, see shared/security.py)."""
import secrets
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from src.features.chat import agent
from src.features.staff import email, metrics
from src.shared import guard
from src.shared.config import LABELS, PUBLIC_BASE_URL
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


def _consult_for(store, cid):
    for c in store.consults():  # newest first
        if c.get("session_id") == cid or c.get("client_id") == cid:
            return c
    return None


def _detail(store, s):
    refs = ["/media/" + r.rsplit("/", 1)[-1] for r in s.get("refs", [])]
    base = dict(_summary(s), fields=s.get("fields", {}), labels=LABELS, images=s.get("images", []),
                reference_images=refs, rounds=s.get("history", []), decisions=s.get("decisions", []),
                outbox=[_mail(m) for m in s.get("outbox", [])], refill=s.get("refill", []), missing=agent.missing(s))
    rej = [{"round": l["round"], "id": l["id"], "url": l["url"], "title": l["title"],
            "brief": l["brief"], "at": l["at"]} for l in _rejected(store, s)]
    docs = {k: {"filename": v.get("filename"), "status": v.get("status")} for k, v in (s.get("docs") or {}).items()}
    d = dict(base, lang=s.get("lang") or "en", transcript=s.get("transcript", []),
             looks=_all_looks(store, s["id"]), rejected_looks=rej,
             consult=_consult_for(store, s["id"]), audit=store.audit_log(s["id"]), documents=docs)
    d.pop("pending", None)  # A9: pending drafts never reach staff
    return guard.clean(d, guard.others_identifiers(store, s["id"]))[0]


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
        out = [{"round": l["round"], "id": l["id"], "url": l["url"], "title": l["title"],
                "brief": l["brief"], "at": l["at"]} for l in _rejected(store, s)]
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
            out.append(guard.clean(c, guard.others_identifiers(store, sid))[0])
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

    def get_metrics():
        return metrics.compute(store)

    def get_traces(client: str | None = None, limit: int = 100):
        return store.traces(client or None, limit)

    def get_audit(client: str | None = None):
        return store.audit_log(client or None)

    for prefix in ("/api/staff/clients", "/api/clients", "/api/admin/clients"):
        r.add_api_route(prefix, list_clients, methods=["GET"])
        r.add_api_route(prefix + "/{cid}", get_client, methods=["GET"])
        r.add_api_route(prefix + "/{cid}/decision", decide, methods=["POST"])
        r.add_api_route(prefix + "/{cid}/decision/preview", preview, methods=["POST"])
    r.add_api_route("/api/staff/clients/{cid}/rejected-looks", rejected_looks, methods=["GET"])
    r.add_api_route("/api/staff/consults", list_consults, methods=["GET"])
    r.add_api_route("/api/staff/consults/{cid}/decision", consult_decide, methods=["POST"])
    r.add_api_route("/api/staff/metrics", get_metrics, methods=["GET"])
    r.add_api_route("/api/staff/traces", get_traces, methods=["GET"])
    r.add_api_route("/api/staff/audit", get_audit, methods=["GET"])
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
