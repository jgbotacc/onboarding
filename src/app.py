"""FastAPI entrypoint. Serves web/ at / and the onboarding API under /api."""
import os
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from datetime import datetime, timezone

from src.data.store import get_store
from src.features.staff import routes as staff
from src.features.chat import agent
from src.features.intake.extract import extract_fields, pdf_text
from src.shared.config import FORM_KEYS, MEDIA_DIR
from src.shared import security

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "dist"
_docs = os.getenv("DISABLE_DOCS", "") not in ("1", "true", "yes")
app = FastAPI(title="Onboarding Agent", docs_url="/docs" if _docs else None,
              redoc_url="/redoc" if _docs else None, openapi_url="/openapi.json" if _docs else None)


@app.middleware("http")
async def _nosniff(request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp
store = get_store()


class ChatIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    text: str


class FormIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    fields: dict[str, str | None]


class ReviewIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    accepted: bool
    feedback: str | None = None


def _load(sid, secret=None):
    """Load a client session; the caller must hold its secret (x-session-secret header or body field)."""
    s = store.load(sid) if sid else None
    if not s or not security.secret_ok(s, secret):
        raise HTTPException(403, "Unknown session or wrong session secret")
    return s


def _secret(request: Request, body_secret=None):
    return request.headers.get("x-session-secret") or body_secret


def _save(s):
    s["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    store.save(s)


def _done(s, out, kind=None, payload=None):
    _save(s)
    store.event(s["id"], kind or "msg", payload or {"reply": out["reply"]})
    if out["images"] and s["status"] == "awaiting_review" and kind != "round":
        store.event(s["id"], "round", {"images": out["images"]})
    return out


app.include_router(staff.make_router(store, _save))


@app.get("/api/resume/{token}")
def resume_get(token: str):
    got = staff.resume(store, token)
    if not got:
        raise HTTPException(404, "Unknown or expired resume link")
    s, out = got
    _done(s, out, "resume", {})
    # Read-only preview: no session secret here; the browser gets one from POST /api/session {resumeToken}.
    return dict(out, fields_to_refill=s["refill"], note=s["resume"].get("note"))


@app.get("/api/health")
def health():
    return {"ok": True, "store": store.kind}


class SessionIn(BaseModel):
    sessionId: str | None = None
    sessionSecret: str | None = None
    resumeToken: str | None = None


@app.post("/api/session")
def session(request: Request, body: SessionIn | None = None):
    if body and body.resumeToken:
        got = staff.resume(store, body.resumeToken)
        if not got:
            raise HTTPException(404, "Unknown or expired resume link")
        s, out = got
        out["sessionId"], out["sessionSecret"] = s["id"], security.issue_secret(s)
        return _done(s, out, "resume", {})
    old = store.load(body.sessionId) if body and body.sessionId else None
    if old and security.secret_ok(old, _secret(request, body.sessionSecret)):
        out = agent.resp(old, "Welcome back! Let's continue where you left off.", old.get("images"))
        out["sessionId"] = old["id"]
        return out
    s = agent.new_session()
    secret = security.issue_secret(s)
    out = agent.resp(s, "Hi! Upload your registration PDF, fill in the registration form, "
                        "or type your business name, contact name and email here.")
    out = _done(s, out, "session", {})
    out["sessionId"], out["sessionSecret"] = s["id"], secret  # the secret is only ever returned here
    return out


@app.post("/api/upload")
async def upload(request: Request):
    form = await request.form()
    s = _load(str(form.get("sessionId", "")), _secret(request, form.get("sessionSecret")))
    files = [v for k, v in form.multi_items() if k in ("files", "files[]") and hasattr(v, "read")]
    if len(files) > security.MAX_FILES:
        raise HTTPException(400, f"Upload at most {security.MAX_FILES} files at a time")
    checked = []  # validate every file before acting on any of them
    for f in files:
        data = await f.read(security.MAX_FILE_BYTES + 1)
        if len(data) > security.MAX_FILE_BYTES:
            raise HTTPException(400, f"{f.filename or 'File'} is larger than 10 MB")
        name = (f.filename or "").lower()
        if security.is_pdf(data):
            checked.append(("pdf", data, None, f.filename))
        elif name.endswith(".pdf") or f.content_type == "application/pdf":
            raise HTTPException(400, f"{f.filename or 'File'} is not a valid PDF")
        else:
            img, ext = security.clean_image(data)
            checked.append(("img", img, ext, f.filename))
    out, refs, ref_meta = None, [], []
    for kind, data, ext, fname in checked:
        if kind == "pdf":
            try:
                fields = extract_fields(pdf_text(data))
            except Exception:
                fields = {}
            out = agent.on_document(s, fields, fname)
        else:
            rid = uuid.uuid4().hex
            p = MEDIA_DIR / f"ref-{rid}{ext}"
            p.write_bytes(data)
            refs.append(str(p))
            ref_meta.append({"id": rid, "path": str(p), "filename": fname})
    if refs:
        r = agent.on_refs(s, refs)
        out = r if not out else dict(out, reply=out["reply"] + " " + r["reply"])
    if not out:
        raise HTTPException(400, "Upload a PDF, JPG or PNG")
    if ref_meta:
        store.event(s["id"], "refs", {"refs": ref_meta})
    return _done(s, out)


@app.post("/api/form")
def form(body: FormIn, request: Request):
    s = _load(body.sessionId, _secret(request, body.sessionSecret))
    fields = {k: v for k, v in body.fields.items() if k in FORM_KEYS}
    return _done(s, agent.on_form(s, fields))


@app.post("/api/chat")
def chat(body: ChatIn, request: Request):
    s = _load(body.sessionId, _secret(request, body.sessionSecret))
    return _done(s, agent.on_chat(s, body.text))


@app.post("/api/review")
def review(body: ReviewIn, request: Request):
    s = _load(body.sessionId, _secret(request, body.sessionSecret))
    out = agent.on_review(s, body.accepted, body.feedback)
    _save(s)
    store.event(s["id"], "review", {"accepted": body.accepted, "feedback": body.feedback})
    if s["status"] == "awaiting_review" and out["images"]:
        store.event(s["id"], "round", {"images": out["images"]})
    if s["status"] == "handed_off":
        store.event(s["id"], "handoff", {"reason": "3 rounds not accepted"})
    return out


app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
if not (WEB / "index.html").exists() and (WEB.parent / "index.html").exists() \
        and not (WEB.parent / "package.json").exists():
    WEB = WEB.parent  # plain HTML front end (pre-React)
if not (WEB / "index.html").exists() and (ROOT / "web" / "legacy" / "index.html").exists():
    WEB = ROOT / "web" / "legacy"  # React build missing: serve legacy plain-HTML UI
if (WEB / "index.html").exists():
    from fastapi.responses import FileResponse

    for _page in ("/staff", "/review", "/admin", "/staff/{rest:path}", "/review/{rest:path}"):
        app.add_api_route(_page, lambda rest="": FileResponse(WEB / "index.html"), methods=["GET"], include_in_schema=False)
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
else:
    @app.get("/", response_class=HTMLResponse)
    def stub():
        return "<h1>Onboarding Agent</h1><p>Front end coming soon. API at /api.</p>"
