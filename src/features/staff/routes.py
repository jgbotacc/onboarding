"""Staff review API. Primary: /api/staff/clients*. Aliases: /api/clients*, /api/admin/clients*. No auth (demo)."""
import secrets
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from src.features.chat import agent
from src.features.staff import email
from src.shared.config import LABELS, PUBLIC_BASE_URL

STATUS = {"approve": "approved", "reject": "rejected", "more_info": "needs_info"}


class DecisionIn(BaseModel):
    decision: Literal["approve", "reject", "more_info"]
    fields: list[str] = []
    note: str | None = None


def _summary(s):
    f = s.get("fields", {})
    return {"id": s["id"], "business_name": f.get("business_name"), "industry": f.get("industry"),
            "contact_name": f.get("contact_name"), "email": f.get("email"), "status": s["status"],
            "round": s.get("round", 0), "image": (s.get("images") or [None])[0], "updated": s.get("updated")}


def _detail(s):
    refs = ["/media/" + r.rsplit("/", 1)[-1] for r in s.get("refs", [])]
    return dict(_summary(s), fields=s.get("fields", {}), labels=LABELS, images=s.get("images", []),
                reference_images=refs, rounds=s.get("history", []), decisions=s.get("decisions", []),
                outbox=s.get("outbox", []), refill=s.get("refill", []), missing=agent.missing(s))


def make_router(store, save):
    r = APIRouter()

    def load(cid):
        s = store.load(cid)
        if not s:
            raise HTTPException(404, "Unknown client")
        return s

    def list_clients():
        rows = [_summary(s) for s in store.list_states() if s.get("fields", {}).get("business_name")]
        return sorted(rows, key=lambda x: x["updated"] or "", reverse=True)

    def get_client(cid: str):
        return _detail(load(cid))

    def decide(cid: str, body: DecisionIn, request: Request):
        s = load(cid)
        bad = [f for f in body.fields if f not in LABELS]
        if bad:
            raise HTTPException(400, f"Unknown field keys: {bad}")
        if body.decision == "more_info" and not body.fields and not body.note:
            raise HTTPException(400, "more_info needs fields or a note")
        token, url = None, None
        if body.decision == "more_info":
            token = secrets.token_urlsafe(16)
            base = PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
            url = f"{base}/?resume={token}"
            s["resume_token"] = token
            s["resume"] = {"fields": body.fields, "note": body.note}
        rec = {"id": uuid.uuid4().hex, "decision": body.decision, "fields": body.fields, "note": body.note,
               "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "previous_status": s["status"]}
        mail = email.send(body.decision, s, body.fields, body.note, url)
        s["status"] = STATUS[body.decision]
        s.setdefault("decisions", []).append(rec)
        s.setdefault("outbox", []).append(mail)
        save(s)
        store.event(s["id"], "decision", dict(rec, token=token))
        store.event(s["id"], "email", mail)
        return dict(_detail(s), email=mail, resume_url=url)

    for prefix in ("/api/staff/clients", "/api/clients", "/api/admin/clients"):
        r.add_api_route(prefix, list_clients, methods=["GET"])
        r.add_api_route(prefix + "/{cid}", get_client, methods=["GET"])
        r.add_api_route(prefix + "/{cid}/decision", decide, methods=["POST"])
    return r


def resume(store, token: str):
    """Load a client by resume token and switch it into refill mode. Returns (state, response) or None.
    Raises 410 once the requested fields have been submitted (link already used).
    Re-opening the link before submitting is allowed (page reloads)."""
    s = store.find_by_token(token)
    if not s or not s.get("resume") or s.get("resume_token") != token:
        return None
    if s["resume"].get("used"):
        raise HTTPException(410, "This link has already been used. Your details were submitted; "
                                 "our team will be in touch.")
    out = agent.start_resume(s, s["resume"]["fields"], s["resume"].get("note"))
    return s, out
