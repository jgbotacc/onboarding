"""FastAPI entrypoint. Serves web/ at / and the onboarding API under /api."""
import io
import logging
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarHTTPException

from src.data.store import get_store
from src.features.chat import agent
from src.features.i18n import lang
from src.features.intake import document, photo
from src.features.intake.extract import pdf_text
from src.features.i18n.lang import LANGS
from src.features.staff import routes as staff
from src.shared import guard, security, trace
from src.shared.config import DATA_DIR, FORM_KEYS, MEDIA_DIR

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("onboarding")

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "dist"
_docs = os.getenv("DISABLE_DOCS", "") not in ("1", "true", "yes")
app = FastAPI(title="Onboarding Agent", docs_url="/docs" if _docs else None,
              redoc_url="/redoc" if _docs else None, openapi_url="/openapi.json" if _docs else None)


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception):
    if isinstance(exc, (HTTPException, StarHTTPException)):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    logger.exception("unhandled error %s", type(exc).__name__)  # traceback only, never bodies
    return JSONResponse(status_code=500, content={"detail": "Something went wrong. Please try again."})


@app.middleware("http")
async def _nosniff(request, call_next):
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


store = get_store()

# Per-session locks (A22): same session serialised, different sessions never block.
_locks_guard = threading.Lock()
_locks: dict[str, threading.Lock] = {}


def _lock_for(sid: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(sid, threading.Lock())


class ChatIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    text: str
    lang: str | None = None


class FormIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    fields: dict[str, str | None]
    lang: str | None = None


class ReviewIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    accepted: bool
    feedback: str | None = None
    lang: str | None = None


class SessionIn(BaseModel):
    sessionId: str | None = None
    sessionSecret: str | None = None
    resumeToken: str | None = None
    lang: str | None = None


class LanguageIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    lang: str


class ConfirmIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    accept: bool
    edits: dict | None = None
    remove: list | None = None
    lang: str | None = None


class LooksIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    selected: list[str] = []
    skip: bool = False
    lang: str | None = None


class LooksPickIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    picked_ids: list[str]
    lang: str | None = None


class LooksSkipIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    lang: str | None = None


class ExtractedConfirmIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    fields: dict[str, str]
    lang: str | None = None


class TraceIn(BaseModel):
    sessionId: str
    sessionSecret: str | None = None
    kind: str
    ok: bool
    ms: float
    lang: str | None = None


def _load(sid, secret=None):
    """Load a client session; the caller must hold its secret (x-session-secret header or body field)."""
    s = store.load(sid) if sid else None
    if not s or not security.secret_ok(s, secret):
        raise HTTPException(403, "This chat session has ended. Please refresh the page to start again.")
    return s


def _secret(request: Request, body_secret=None):
    return request.headers.get("x-session-secret") or body_secret


def _apply_lang(s, request: Request, body_lang=None):
    v = body_lang or request.headers.get("x-lang")
    if v in LANGS:
        s["lang"] = v
        s["lang_set"] = True


def _save(s):
    s["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    store.save(s)


def _finish(s, out, kind=None, payload=None):
    """Persist + translate + guard; every client route returns through here."""
    sid = s["id"]
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    s.setdefault("transcript", []).append({"role": "bot", "text": out["reply"], "at": now})
    if s.get("new_looks"):
        store.add_looks(sid, s.get("round", 0), s.get("looks") or [])
        s.pop("new_looks", None)
    if s.get("selected_looks"):  # pick happened: mark ids (idempotent)
        ids = [lk.get("id") for lk in s["selected_looks"] if lk.get("id")]
        if ids:
            store.mark_looks(sid, ids)
    if s.get("consult") and not s.get("consult_saved"):
        card = s["consult"]
        store.save_consult(card)
        store.audit(sid, "system", "consult_handoff_created", card.get("id"))
        s["consult_saved"] = True
    confirmed = s.pop("confirmed_doc", None)
    if confirmed:
        store.audit(sid, "client", "details_confirmed", confirmed.get("docId"),
                    {"fields": confirmed.get("fields") or []})
    _save(s)
    store.event(sid, kind or "msg", payload or {"reply": out["reply"]})
    imgs = out.get("images") or s.get("images") or []
    if imgs and s.get("status") == "awaiting_review" and kind != "round":
        store.event(sid, "round", {"images": imgs})
    lng = s.get("lang") or "en"
    out["reply"] = lang.to_client(out["reply"], lng, sid)
    out["lines"] = lang.lines(out["reply"])
    out["lang"] = lng
    out["step"] = out.get("status")
    conf = out.get("confirm")
    if conf and isinstance(conf.get("fields"), list):
        out["extracted"] = [{"field": f.get("key"), "label": f.get("label"), "value": f.get("value")}
                            for f in conf["fields"]]
    looks = out.get("looks")
    if looks and isinstance(looks.get("options"), list):
        for o in looks["options"]:
            if isinstance(o, dict) and o.get("title") is not None:
                o["alt"] = o.get("title")
    out, n = guard.clean(out, guard.others_identifiers(store, sid))
    if n:
        store.audit(sid, "system", "outbound_masked", None, {"count": n})
    return out


def switch_lang(s, text):
    """Auto language switch; an explicit POST /api/language pick wins."""
    if s.get("lang_set"):
        return
    d = lang.detect(text)
    if not d:
        return
    cur = s.get("lang")
    if not cur:
        s["lang"] = d
    elif cur == "en":
        if d != "en":
            s["lang"] = d
    elif d != "en":  # non-English stays: short English bits must not flip it back
        s["lang"] = d


app.include_router(staff.make_router(store, _save))
app.include_router(staff.make_share_router(store, _save, _lock_for))


@app.get("/api/resume/{token}")
def resume_get(token: str):
    peek = store.find_by_token(token)
    with _lock_for(peek["id"] if peek else "resume-missing"):
        got = staff.resume(store, token)
        if not got:
            raise HTTPException(404, "This link is no longer valid. Please contact our team.")
        s, out = got
        out = _finish(s, out, "resume", {})
        # Read-only preview: no session secret here; the browser gets one from POST /api/session {resumeToken}.
        return dict(out, fields_to_refill=s["refill"], note=s["resume"].get("note"))


@app.get("/api/health")
def health():
    return {"ok": True, "store": store.kind}


@app.post("/api/session")
def session(request: Request, body: SessionIn | None = None):
    if body and body.resumeToken:
        peek = store.find_by_token(body.resumeToken)
        with _lock_for(peek["id"] if peek else "resume-missing"):
            got = staff.resume(store, body.resumeToken)
            if not got:
                raise HTTPException(404, "This link is no longer valid. Please contact our team.")
            s, out = got
            _apply_lang(s, request, body.lang)
            secret = security.issue_secret(s)
            out = _finish(s, out, "resume", {})
            out["sessionId"], out["sessionSecret"] = s["id"], secret
            return out
    if body and body.sessionId:
        with _lock_for(body.sessionId):
            old = store.load(body.sessionId)
            if old and security.secret_ok(old, _secret(request, body.sessionSecret)):
                _apply_lang(old, request, body.lang)
                out = agent.resp(old, "Welcome back! Let's continue where you left off.", old.get("images"))
                out = _finish(old, out)
                out["sessionId"] = old["id"]
                return out
    s = agent.new_session()
    secret = security.issue_secret(s)
    with _lock_for(s["id"]):
        _apply_lang(s, request, body.lang if body else None)
        out = agent.resp(s, "Hi! Let's get you set up.\nUpload your business document or registration form.\n"
                            "Or type your business name, contact name and email.")
        out = _finish(s, out, "session", {})
        out["sessionId"], out["sessionSecret"] = s["id"], secret  # the secret is only ever returned here
        return out


def _heic_to_jpeg(data: bytes) -> bytes:
    img = photo.load_image(data).convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


@app.post("/api/upload")
async def upload(request: Request):
    form = await request.form()
    sid = str(form.get("sessionId", ""))
    purpose = str(form.get("purpose") or "").lower()
    files = [v for k, v in form.multi_items() if k in ("files", "files[]") and hasattr(v, "read")]
    if len(files) > security.MAX_FILES:
        raise HTTPException(400, f"Too many files. Upload up to {security.MAX_FILES} at a time.")
    blobs = []  # read before locking (await must not hold the session lock)
    for f in files:
        data = await f.read(security.MAX_FILE_BYTES + 1)
        if len(data) > security.MAX_FILE_BYTES:
            raise HTTPException(400, f"{f.filename or 'That file'} is too big. Max 10 MB.")
        blobs.append((f.filename, f.content_type, data))
    with _lock_for(sid or "missing"):
        s = _load(sid, _secret(request, form.get("sessionSecret")))
        _apply_lang(s, request, form.get("lang"))
        checked = []  # validate every file before acting on any of them
        for fname, ctype, data in blobs:
            name = (fname or "").lower()
            if security.is_pdf(data):
                checked.append(("pdf", data, None, fname))
            elif name.endswith(".pdf") or ctype == "application/pdf":
                raise HTTPException(400, f"{fname or 'That file'} isn't a readable PDF.")
            elif photo.is_heic(data):
                try:
                    data = _heic_to_jpeg(data)
                except ValueError as e:
                    if "heic" in str(e).lower():
                        out = agent.resp(s, "I can't open this photo type.\nPlease send a JPG or PNG.")
                        out["retake"] = True
                        return _finish(s, out)
                    raise
                img, ext = security.clean_image(data)
                checked.append(("img", img, ext, fname))
            else:
                img, ext = security.clean_image(data)
                checked.append(("img", img, ext, fname))
        docs_dir = DATA_DIR / "docs"
        out, refs, ref_meta, pdfs = None, [], [], []
        doc_imgs = []
        for kind, data, ext, fname in checked:
            if kind == "pdf":
                pdfs.append((data, fname))
            elif purpose == "document":
                doc_imgs.append((data, fname))
            else:
                rid = uuid.uuid4().hex
                p = MEDIA_DIR / f"ref-{rid}{ext}"
                p.write_bytes(data)
                refs.append(str(p))
                ref_meta.append({"id": rid, "path": str(p), "filename": fname})
        if pdfs and refs:  # refs sent with the PDF count before it is read, so no second ask for them
            s["refs"].extend(refs)
        for data, fname in pdfs:
            try:
                text = pdf_text(data)
            except Exception:
                text = ""
            if len(re.sub(r"\s", "", text)) < 30:
                out = agent.resp(s, "I can't read this PDF.\nPlease send a photo of it instead.")
                out["retake"] = True
                out["retake_reason"] = "unreadable"
                continue
            doc = document.read_document(text, sid)
            if doc["kind"] == "form":
                out = agent.on_document(s, doc["fields"], fname)
                continue
            docs_dir.mkdir(parents=True, exist_ok=True)
            doc_id = uuid.uuid4().hex
            p = docs_dir / f"{doc_id}.pdf"
            p.write_bytes(data)
            s.setdefault("docs", {})[doc_id] = {"path": str(p), "filename": fname, "status": "pending"}
            store.audit(sid, "client", "document_uploaded", doc_id, {"filename": fname})
            out = agent.on_extracted(s, doc_id, fname, doc["fields"], doc["removed"])
        if pdfs and refs and out is not None and out["status"] == "missing_info":
            out = dict(out, reply=out["reply"] + f"\n\nSaved {len(refs)} reference image(s).")
        if refs and not pdfs:
            out = agent.on_refs(s, refs)
        for data, fname in doc_imgs:
            r = photo.read_photo(data, sid)
            if r.get("reason") == "no_reader":
                out = agent.resp(s, "I couldn't read this photo.\n"
                                    "Please type your business name, contact name and email.")
                continue
            if r.get("retake"):
                reason = r.get("reason")
                first = ("This photo is a bit blurry." if reason == "blurry"
                         else "Part of the page is cut off." if reason == "cropped"
                         else "I can't read this photo.")
                out = agent.resp(s, first + "\nPlease retake it in good light, with the whole page in view.")
                out["retake"] = True
                out["retake_reason"] = reason
                continue
            docs_dir.mkdir(parents=True, exist_ok=True)
            doc_id = uuid.uuid4().hex
            p = docs_dir / f"{doc_id}.jpg"
            p.write_bytes(data)
            s.setdefault("docs", {})[doc_id] = {"path": str(p), "filename": fname, "status": "pending"}
            store.audit(sid, "client", "document_uploaded", doc_id, {"filename": fname})
            out = agent.on_extracted(s, doc_id, fname, r["fields"], r["removed"])
        if not out:
            raise HTTPException(400, "Please upload a PDF, JPG or PNG.")
        if ref_meta:
            store.event(s["id"], "refs", {"refs": ref_meta})
        return _finish(s, out)


@app.post("/api/form")
def form(body: FormIn, request: Request):
    with _lock_for(body.sessionId):
        s = _load(body.sessionId, _secret(request, body.sessionSecret))
        _apply_lang(s, request, body.lang)
        fields = {k: v for k, v in body.fields.items() if k in FORM_KEYS}
        return _finish(s, agent.on_form(s, fields))


@app.post("/api/chat")
def chat(body: ChatIn, request: Request):
    with _lock_for(body.sessionId):
        s = _load(body.sessionId, _secret(request, body.sessionSecret))
        _apply_lang(s, request, body.lang)
        switch_lang(s, body.text)
        english = lang.to_english(body.text, s.get("lang"), s["id"])
        s.setdefault("transcript", []).append({
            "role": "client", "text": english,
            "original": body.text if body.text != english else None,
            "lang": s.get("lang") or "en",
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
        return _finish(s, agent.on_chat(s, english))


@app.post("/api/language")
def language(body: LanguageIn, request: Request):
    if body.lang not in LANGS:
        raise HTTPException(400, "Unknown language. Choose en, zh, ms or ta.")
    with _lock_for(body.sessionId):
        s = _load(body.sessionId, _secret(request, body.sessionSecret))
        _apply_lang(s, request, body.lang)
        s["lang"] = body.lang
        s["lang_set"] = True
        last = "Okay."
        for m in reversed(s.get("transcript") or []):
            if m.get("role") == "bot" and m.get("text"):
                last = m["text"]
                break
        return _finish(s, agent.resp(s, last))


@app.post("/api/confirm")
def confirm(body: ConfirmIn, request: Request):
    with _lock_for(body.sessionId):
        s = _load(body.sessionId, _secret(request, body.sessionSecret))
        _apply_lang(s, request, body.lang)
        pending = dict(s.get("pending") or {})
        doc_id = pending.get("docId")
        out = agent.on_confirm(s, body.accept, body.edits, body.remove)
        if doc_id and doc_id in (s.get("docs") or {}):
            if body.accept:
                s["docs"][doc_id]["status"] = "confirmed"
            else:
                try:
                    Path(s["docs"][doc_id].get("path", "")).unlink(missing_ok=True)
                except Exception:
                    pass
                s["docs"][doc_id]["status"] = "discarded"
        return _finish(s, out)


@app.post("/api/looks")
def looks(body: LooksIn, request: Request):
    with _lock_for(body.sessionId):
        s = _load(body.sessionId, _secret(request, body.sessionSecret))
        _apply_lang(s, request, body.lang)
        sel = body.selected or []
        out = agent.on_looks(s, sel, body.skip or not sel)
        if s.get("selected_looks"):
            ids = [lk.get("id") for lk in s["selected_looks"] if lk.get("id")]
            if ids:
                store.mark_looks(s["id"], ids)
                store.audit(s["id"], "client", "look_selected", None, {"ids": ids})
        return _finish(s, out)


@app.delete("/api/documents/{doc_id}")
async def docs_delete(doc_id: str, request: Request):
    qsid = request.query_params.get("sessionId")
    body: dict = {}
    if not qsid:
        try:
            b = await request.json()
            if isinstance(b, dict):
                body = b
        except Exception:
            body = {}
    sid = qsid or body.get("sessionId", "")
    secret = request.headers.get("x-session-secret") or body.get("sessionSecret")
    with _lock_for(sid or "missing"):
        s = _load(sid, secret)
        _apply_lang(s, request, body.get("lang"))
        docs = s.get("docs") or {}
        if doc_id not in docs:
            raise HTTPException(404, "Document not found.")
        if docs[doc_id].get("status") == "confirmed":
            raise HTTPException(409, "That file's details are already saved.")
        if docs[doc_id].get("status") != "pending":
            raise HTTPException(404, "Document not found.")
        try:
            Path(docs[doc_id].get("path", "")).unlink(missing_ok=True)
        except Exception:
            pass
        docs[doc_id]["status"] = "removed"
        out = agent.remove_pending(s, doc_id)
        store.audit(s["id"], "client", "document_removed", doc_id)
        return _finish(s, out)


@app.post("/api/review")
def review(body: ReviewIn, request: Request):
    with _lock_for(body.sessionId):
        s = _load(body.sessionId, _secret(request, body.sessionSecret))
        _apply_lang(s, request, body.lang)
        out = agent.on_review(s, body.accepted, body.feedback)
        out = _finish(s, out, "review", {"accepted": body.accepted, "feedback": body.feedback})
        if s["status"] == "handed_off":
            store.event(s["id"], "handoff", {"reason": "3 rounds not accepted"})
        return out


@app.post("/api/looks/pick")
def looks_pick(body: LooksPickIn, request: Request):
    with _lock_for(body.sessionId):
        s = _load(body.sessionId, _secret(request, body.sessionSecret))
        _apply_lang(s, request, body.lang)
        sel = body.picked_ids or []
        out = agent.on_looks(s, sel, not sel)
        if s.get("selected_looks"):
            ids = [lk.get("id") for lk in s["selected_looks"] if lk.get("id")]
            if ids:
                store.mark_looks(s["id"], ids)
                store.audit(s["id"], "client", "look_selected", None, {"ids": ids})
        return _finish(s, out)


@app.post("/api/looks/skip")
def looks_skip(body: LooksSkipIn, request: Request):
    with _lock_for(body.sessionId):
        s = _load(body.sessionId, _secret(request, body.sessionSecret))
        _apply_lang(s, request, body.lang)
        out = agent.on_looks(s, [], True)
        if s.get("selected_looks"):
            ids = [lk.get("id") for lk in s["selected_looks"] if lk.get("id")]
            if ids:
                store.mark_looks(s["id"], ids)
                store.audit(s["id"], "client", "look_selected", None, {"ids": ids})
        return _finish(s, out)


@app.post("/api/extracted/confirm")
def extracted_confirm(body: ExtractedConfirmIn, request: Request):
    with _lock_for(body.sessionId):
        s = _load(body.sessionId, _secret(request, body.sessionSecret))
        _apply_lang(s, request, body.lang)
        pending = dict(s.get("pending") or {})
        doc_id = pending.get("docId")
        pending_fields = pending.get("fields") or {}
        given = body.fields or {}
        remove = [k for k in pending_fields if k not in given]
        out = agent.on_confirm(s, True, given, remove)
        if doc_id and doc_id in (s.get("docs") or {}):
            s["docs"][doc_id]["status"] = "confirmed"
        return _finish(s, out)


@app.delete("/api/upload")
async def upload_delete(request: Request):
    qsid = request.query_params.get("sessionId")
    body: dict = {}
    if not qsid:
        try:
            b = await request.json()
            if isinstance(b, dict):
                body = b
        except Exception:
            body = {}
    sid = qsid or body.get("sessionId", "")
    secret = request.headers.get("x-session-secret") or body.get("sessionSecret")
    with _lock_for(sid or "missing"):
        s = _load(sid, secret)
        _apply_lang(s, request, body.get("lang"))
        p = s.get("pending") or {}
        doc_id = p.get("docId")
        if not doc_id:
            return _finish(s, agent.resp(s, "There's no file to remove."))
        docs = s.get("docs") or {}
        if doc_id not in docs:
            raise HTTPException(404, "Document not found.")
        if docs[doc_id].get("status") == "confirmed":
            raise HTTPException(409, "That file's details are already saved.")
        if docs[doc_id].get("status") != "pending":
            raise HTTPException(404, "Document not found.")
        try:
            Path(docs[doc_id].get("path", "")).unlink(missing_ok=True)
        except Exception:
            pass
        docs[doc_id]["status"] = "removed"
        out = agent.remove_pending(s, doc_id)
        store.audit(s["id"], "client", "document_removed", doc_id)
        return _finish(s, out)


@app.post("/api/trace")
def trace_in(body: TraceIn, request: Request):
    if body.kind not in ("listen", "mic"):
        raise HTTPException(400, "Unknown trace kind.")
    with _lock_for(body.sessionId):
        s = _load(body.sessionId, _secret(request, body.sessionSecret))
        _apply_lang(s, request, body.lang)
        trace.record(step=body.kind, model="browser", ok=body.ok,
                     latency_ms=int(body.ms), cost_sgd=0.0, session_id=s["id"])
        _save(s)
        return {"ok": True}


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
