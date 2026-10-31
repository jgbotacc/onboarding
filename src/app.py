"""FastAPI entrypoint. Serves web/ at / and the onboarding API under /api."""
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src.data.store import get_store
from src.features.chat import agent
from src.features.intake.extract import extract_fields, pdf_text
from src.shared.config import MEDIA_DIR

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "dist"
app = FastAPI(title="Onboarding Agent")
store = get_store()


class ChatIn(BaseModel):
    sessionId: str
    text: str


class ReviewIn(BaseModel):
    sessionId: str
    accepted: bool
    feedback: str | None = None


def _load(sid):
    s = store.load(sid)
    if not s:
        raise HTTPException(404, "Unknown session")
    return s


def _done(s, out, kind=None, payload=None):
    store.save(s)
    store.event(s["id"], kind or "msg", payload or {"reply": out["reply"]})
    if out["images"] and s["status"] == "awaiting_review" and kind != "round":
        store.event(s["id"], "round", {"images": out["images"]})
    return out


@app.get("/api/health")
def health():
    return {"ok": True, "store": store.kind}


class SessionIn(BaseModel):
    sessionId: str | None = None


@app.post("/api/session")
def session(body: SessionIn | None = None):
    old = store.load(body.sessionId) if body and body.sessionId else None
    if old:
        out = agent.resp(old, "Welcome back! Let's continue where you left off.", old.get("images"))
        out["sessionId"] = old["id"]
        return out
    s = agent.new_session()
    out = agent.resp(s, "Hi! Upload a PDF with your business details (company name, address, "
                        "contact, industry) or just type them here.")
    out["sessionId"] = s["id"]
    return _done(s, out, "session", {})


@app.post("/api/upload")
async def upload(request: Request):
    form = await request.form()
    s = _load(str(form.get("sessionId", "")))
    files = [v for k, v in form.multi_items() if k in ("files", "files[]") and hasattr(v, "read")]
    out, refs = None, []
    for f in files:
        data = await f.read()
        name = (f.filename or "").lower()
        if name.endswith(".pdf") or f.content_type == "application/pdf":
            try:
                fields = extract_fields(pdf_text(data))
            except Exception:
                fields = {}
            out = agent.on_document(s, fields, f.filename)
        elif name.endswith((".jpg", ".jpeg", ".png")) or (f.content_type or "").startswith("image/"):
            p = MEDIA_DIR / f"ref-{uuid.uuid4().hex}{Path(name).suffix or '.jpg'}"
            p.write_bytes(data)
            refs.append(str(p))
    if refs:
        r = agent.on_refs(s, refs)
        out = r if not out else dict(out, reply=out["reply"] + " " + r["reply"])
    if not out:
        raise HTTPException(400, "Upload a PDF or JPG")
    return _done(s, out)


@app.post("/api/chat")
def chat(body: ChatIn):
    s = _load(body.sessionId)
    return _done(s, agent.on_chat(s, body.text))


@app.post("/api/review")
def review(body: ReviewIn):
    s = _load(body.sessionId)
    out = agent.on_review(s, body.accepted, body.feedback)
    store.save(s)
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
    app.mount("/", StaticFiles(directory=WEB, html=True), name="web")
else:
    @app.get("/", response_class=HTMLResponse)
    def stub():
        return "<h1>Onboarding Agent</h1><p>Front end coming soon. API at /api.</p>"
