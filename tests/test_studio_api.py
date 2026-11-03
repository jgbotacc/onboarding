"""Staff studio API: auth, brief shape, cap, failures, concurrency, remix, audit (no network)."""
import json
import os
import re
import tempfile
import threading
import time
import uuid

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from src.app import app, store  # noqa: E402
from src.features.imagegen import studio  # noqa: E402
from src.shared.config import MEDIA_DIR  # noqa: E402
from helpers import new_session  # noqa: E402

STAFF = {"x-staff-key": os.environ["STAFF_PASSCODE"], "x-staff-name": "Studio QA"}
c = TestClient(app, headers=dict(STAFF))
anon = TestClient(app)

PHONE = "+65 8123 8654"
PHONE_DIGITS = "6581238654"
NRIC = "S1234567D"


def _tag():
    return uuid.uuid4().hex[:8]


def _client(tag=None):
    """A session with contact-heavy fields plus off-form UEN/address, like a doc upload."""
    tag = tag or _tag()
    sid = new_session(c)
    fields = {"business_name": f"Studio Bakery {tag}", "contact_name": "Mei Lin Tan",
              "email": f"mei-{tag}@studio-{tag}.example", "phone_number": PHONE,
              "business_website": f"https://studio-{tag}.example/shop"}
    assert c.post("/api/form", json={"sessionId": sid, "fields": fields}).status_code == 200
    s = store.load(sid)
    s["fields"].update({"uen": f"UEN-{tag}-K",
                        "registered_address": f"{tag} Geylang Road Singapore 389310"})
    s["direction"] = "warm minimal"
    store.save(s)
    return sid, {"tag": tag, "email": fields["email"], "website": fields["business_website"],
                 "uen": s["fields"]["uen"], "address": s["fields"]["registered_address"]}


def _secrets(contact):
    return ["mei lin tan", contact["email"].lower(), contact["website"].lower(),
            contact["uen"].lower(), contact["address"].lower(), NRIC.lower()]


def _fake(monkeypatch, fail_first_n=0, delay=0.0):
    calls = []
    lock = threading.Lock()

    def gen(prompt, preset="post", images=(), session_id=None, user=None):
        with lock:
            calls.append({"prompt": prompt, "preset": preset,
                          "images": list(images), "session_id": session_id})
            n = len(calls)
        if delay:
            time.sleep(delay)
        if n <= fail_first_n:
            return {"ok": False, "error": "HTTP 503: overloaded"}
        name = f"studio-fake-{uuid.uuid4().hex}.png"
        Image.new("RGB", (400, 300), (120, 180, 200)).save(MEDIA_DIR / name)
        return {"ok": True, "url": f"/media/{name}"}

    monkeypatch.setattr(studio, "studio_generate", gen)
    return calls


def _look_media():
    name = f"studio-look-{uuid.uuid4().hex}.png"
    Image.new("RGB", (500, 400), (200, 120, 60)).save(MEDIA_DIR / name)
    return f"/media/{name}"


# 1. auth
def test_studio_needs_passcode(monkeypatch):
    assert anon.get("/api/staff/clients/nope/studio").status_code == 401
    assert anon.get("/api/staff/clients/nope/studio",
                    headers={"x-staff-key": "wrong"}).status_code == 401
    monkeypatch.delenv("STAFF_PASSCODE")
    assert c.get("/api/staff/clients/nope/studio").status_code == 503


def test_studio_unknown_client_404():
    assert c.get("/api/staff/clients/nope/studio").status_code == 404
    assert c.post("/api/staff/clients/nope/studio/drafts", json={}).status_code == 404
    assert c.post("/api/staff/clients/nope/studio/remix",
                  json={"source_id": "x", "source_kind": "draft"}).status_code == 404
    assert c.post("/api/staff/clients/nope/studio/drafts/x/star",
                  json={"starred": True}).status_code == 404


# 2. GET shape
def test_studio_get_empty():
    sid, contact = _client()
    r = c.get(f"/api/staff/clients/{sid}/studio")
    assert r.status_code == 200
    body = r.json()
    assert body["cap"] == 9 and body["used"] == 0 and body["remaining"] == 9
    assert body["brief"]["business_name"] == f"Studio Bakery {contact['tag']}"
    assert set(body["brief"]) <= {"business_name", "business_type", "industry",
                                  "design_preferences", "requirements_notes",
                                  "tagline", "brand_colours", "direction", "feedback"}
    blob = json.dumps(body).lower()
    for s in _secrets(contact):
        assert s.lower() not in blob, s
    assert PHONE_DIGITS not in re.sub(r"\D", "", blob)
    assert body["avoid"] == [] and body["drafts"] == []
    assert {p["id"] for p in body["presets"]} == {"post", "story", "flyer"}
    assert {p["w"] for p in body["presets"] if p["id"] == "flyer"} == {1240}
    assert len(body["chips"]) == 6
    assert "prompt" not in blob


# 3. run: 3 drafts, audit, masking
def test_run_returns_3_drafts_and_remaining_6(monkeypatch):
    sid, contact = _client()
    calls = _fake(monkeypatch)
    marketer = (f"Grand opening sale, call {PHONE} or {contact['email']}, "
                f"visit {contact['website']}. Ref {NRIC}. Big bold headline.")
    r = c.post(f"/api/staff/clients/{sid}/studio/drafts",
               json={"marketer_prompt": marketer, "chips": ["festive"], "preset": "post"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["drafts"]) == 3 and body["remaining"] == 6
    assert len({d["id"] for d in body["drafts"]}) == 3
    assert len({d["style_title"] for d in body["drafts"]}) == 3
    assert {d["status"] for d in body["drafts"]} == {"ok"}
    assert all(d["run_id"] == body["run_id"] for d in body["drafts"])
    assert all("prompt" not in d and d["url"].startswith("/media/") for d in body["drafts"])
    assert len(calls) == 3
    for call in calls:
        assert call["preset"] == "post" and call["session_id"] == sid
        low = call["prompt"].lower()
        for s in _secrets(contact):
            assert s.lower() not in low, (s, call["prompt"])
        assert PHONE_DIGITS not in re.sub(r"\D", "", call["prompt"])
        assert NRIC.lower() not in low
    rows = [a for a in store.audit_log(sid) if a["action"] == "studio_draft"]
    assert len(rows) == 3
    for a in rows:
        assert a["actor"] == "staff:Studio QA" and a["target"] in {d["id"] for d in body["drafts"]}
        assert a["details"]["prompt"] and a["details"]["preset"] == "post"
        assert a["details"]["run_id"] == body["run_id"] and a["details"]["status"] == "ok"
        low = a["details"]["prompt"].lower()
        for s in _secrets(contact):
            assert s.lower() not in low, s
    assert c.get(f"/api/staff/clients/{sid}/studio").json()["used"] == 3


def test_draft_validation():
    sid, _ = _client()
    assert c.post(f"/api/staff/clients/{sid}/studio/drafts",
                  json={"marketer_prompt": "x" * 501}).status_code == 422
    assert c.post(f"/api/staff/clients/{sid}/studio/remix",
                  json={"source_id": "x", "source_kind": "draft", "note": "x" * 301}).status_code == 422
    assert c.post(f"/api/staff/clients/{sid}/studio/drafts",
                  json={"preset": "banner"}).status_code == 422


# 4. cap then 409
def test_fourth_run_409(monkeypatch):
    sid, _ = _client()
    _fake(monkeypatch)
    for i in range(3):
        r = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={})
        assert r.status_code == 200, i
        assert r.json()["remaining"] == 6 - 3 * i, r.json()
    r = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={})
    assert r.status_code == 409 and r.json()["detail"] == "Draft limit reached"


# 5. failed generations free slots
def test_failed_generation_frees_slots(monkeypatch):
    sid, _ = _client()
    calls = _fake(monkeypatch, fail_first_n=1)
    body = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).json()
    assert sorted(d["status"] for d in body["drafts"]) == ["failed", "ok", "ok"]
    assert body["remaining"] == 7 and len(calls) == 3
    assert c.get(f"/api/staff/clients/{sid}/studio").json()["used"] == 2


def test_failed_rows_free_cap_slots(monkeypatch):
    sid, _ = _client()
    _fake(monkeypatch)
    for _ in range(3):
        assert c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).status_code == 200
    assert c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).status_code == 409
    ds = c.get(f"/api/staff/clients/{sid}/studio").json()["drafts"]
    for d in ds[:3]:
        store.finish_draft(d["id"], d["url"], "failed", "do-over")
    assert c.get(f"/api/staff/clients/{sid}/studio").json()["remaining"] == 3
    r = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={})
    assert r.status_code == 200 and len(r.json()["drafts"]) == 3
    assert r.json()["remaining"] == 0


# 6. concurrent runs never exceed 9
def test_concurrent_runs_never_exceed_cap(monkeypatch):
    sid, _ = _client()
    _fake(monkeypatch, delay=0.3)
    statuses = []

    def worker():
        tc = TestClient(app, headers=dict(STAFF))
        statuses.append(tc.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).status_code)

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(statuses) == [200, 200, 200, 409]
    body = c.get(f"/api/staff/clients/{sid}/studio").json()
    assert body["used"] == 9 and body["remaining"] == 0 and len(body["drafts"]) == 9


# 7. remix of a draft
def test_remix_of_draft(monkeypatch):
    sid, contact = _client()
    calls = _fake(monkeypatch)
    src = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).json()["drafts"][0]
    r = c.post(f"/api/staff/clients/{sid}/studio/remix",
               json={"source_id": src["id"], "source_kind": "draft", "note": "a touch warmer"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["drafts"]) == 1 and body["remaining"] == 5
    d = body["drafts"][0]
    assert d["parent_id"] == src["id"] and d["parent_kind"] == "draft" and d["status"] == "ok"
    assert len(calls) == 4
    remix = calls[-1]
    assert "Make a close variation of this design; keep layout and colours" in remix["prompt"]
    assert "a touch warmer" in remix["prompt"]
    assert remix["images"] and remix["images"][0].endswith(src["url"].rsplit("/", 1)[-1])
    low = remix["prompt"].lower()
    for s in _secrets(contact):
        assert s.lower() not in low, s
    assert PHONE_DIGITS not in re.sub(r"\D", "", remix["prompt"])
    assert c.post(f"/api/staff/clients/{sid}/studio/remix",
                  json={"source_id": "nope", "source_kind": "draft"}).status_code == 404


def test_remix_note_partial_name_masked(monkeypatch):
    sid, _ = _client()
    calls = _fake(monkeypatch)
    src = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).json()["drafts"][0]
    r = c.post(f"/api/staff/clients/{sid}/studio/remix",
               json={"source_id": src["id"], "source_kind": "draft", "note": "call Mei Lin please"})
    assert r.status_code == 200
    low = calls[-1]["prompt"].lower()
    assert re.search(r"\bmei\b", low) is None, calls[-1]["prompt"]
    assert re.search(r"\blin\b", low) is None, calls[-1]["prompt"]


def test_remix_of_rejected_look_and_foreign_draft_404(monkeypatch):
    sid, contact = _client()
    calls = _fake(monkeypatch)
    url = _look_media()
    store.add_looks(sid, 1, [{"id": "look-neon", "url": url, "title": "Neon Blast",
                              "brief": "neon cyberpunk poster"}])
    s = store.load(sid)
    s["round"] = 2
    store.save(s)
    assert any(o["title"] == "Neon Blast"
               for o in c.get(f"/api/staff/clients/{sid}/studio").json()["avoid"])
    r = c.post(f"/api/staff/clients/{sid}/studio/remix",
               json={"source_id": "look-neon", "source_kind": "look", "preset": "story"})
    assert r.status_code == 200
    d = r.json()["drafts"][0]
    assert d["parent_id"] == "look-neon" and d["parent_kind"] == "look"
    assert d["preset"] == "story" and len(calls) == 1
    assert calls[0]["images"][0].endswith(url.rsplit("/", 1)[-1])
    other, _ = _client()
    assert c.post(f"/api/staff/clients/{other}/studio/remix",
                  json={"source_id": "look-neon", "source_kind": "look"}).status_code == 404
    foreign = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).json()["drafts"][0]
    assert c.post(f"/api/staff/clients/{other}/studio/drafts/{foreign['id']}/star",
                  json={"starred": True}).status_code == 404


# 8. star and pin
def test_star_and_pin(monkeypatch):
    sid, _ = _client()
    _fake(monkeypatch)
    did = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).json()["drafts"][0]["id"]
    assert c.post(f"/api/staff/clients/{sid}/studio/drafts/{did}/star",
                  json={"starred": True}).json()["starred"] is True
    assert c.post(f"/api/staff/clients/{sid}/studio/drafts/{did}/star",
                  json={"starred": False}).json()["starred"] is False
    assert c.post(f"/api/staff/clients/{sid}/studio/drafts/{did}/pin",
                  json={"target": "client"}).json()["pinned_to"] == "client"
    r = c.post(f"/api/staff/clients/{sid}/studio/drafts/{did}/pin",
               json={"target": "consult"})
    assert r.status_code == 409
    store.save_consult({"id": "consult-1", "session_id": sid, "status": "pending_approval"})
    pinned = c.post(f"/api/staff/clients/{sid}/studio/drafts/{did}/pin",
                    json={"target": "consult"}).json()
    assert pinned["pinned_to"] == "consult" and pinned["pinned_consult_id"] == "consult-1"
    assert c.post(f"/api/staff/clients/{sid}/studio/drafts/{did}/pin",
                  json={"target": None}).json()["pinned_to"] is None
    kinds = {a["action"] for a in store.audit_log(sid)}
    assert {"studio_draft", "studio_star", "studio_pin"} <= kinds
    assert all(a["actor"] == "staff:Studio QA"
               for a in store.audit_log(sid) if a["action"] in ("studio_star", "studio_pin"))


# 9. client routes never expose drafts
def test_client_routes_never_expose_drafts(monkeypatch):
    sid, contact = _client()
    _fake(monkeypatch)
    c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).json()
    secret = c.headers["x-session-secret"]
    anon_c = TestClient(app, headers={"x-session-secret": secret})
    r = anon_c.post("/api/chat", json={"sessionId": sid, "text": "hello"})
    assert r.status_code == 200
    body = r.json()
    assert "drafts" not in body
    assert '"drafts"' not in json.dumps(body) and "studio_draft" not in json.dumps(body)
    detail = c.get(f"/api/staff/clients/{sid}").json()
    assert "drafts" not in detail


def _to_awaiting(sid):
    s = store.load(sid)
    s["status"] = "awaiting_review"
    s["round"] = 1
    base = [{"id": f"base-{i}-{sid[:4]}", "url": _look_media(), "title": f"Base {i}",
             "brief": f"base style {i}", "round": 1} for i in range(3)]
    s["looks"] = base
    s["images"] = [b["url"] for b in base]
    store.save(s)
    return base


def _client_view(sid, secret):
    anon_c = TestClient(app, headers={"x-session-secret": secret})
    r = anon_c.post("/api/session", json={"sessionId": sid})
    assert r.status_code == 200, r.text
    return r.json()


# 10. send to an awaiting_review client
def test_send_to_awaiting_review_shows_suggested_and_picks(monkeypatch):
    sid, _ = _client()
    secret = c.headers["x-session-secret"]
    base = _to_awaiting(sid)
    _fake(monkeypatch)
    drafts = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).json()["drafts"]
    did = drafts[0]["id"]
    # unsent drafts never reach client routes
    before = _client_view(sid, secret)
    assert did not in {o["id"] for o in before["looks"]["options"]}
    r = c.post(f"/api/staff/clients/{sid}/studio/drafts/{did}/send", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sent_at"] and body["look_id"] == did
    after = _client_view(sid, secret)
    opts = {o["id"]: o for o in after["looks"]["options"]}
    assert did in opts
    assert opts[did]["suggested"] is True
    assert opts[did]["title"] == "Suggested by our team"
    # picking it works like any look
    anon_c = TestClient(app, headers={"x-session-secret": secret})
    pick = anon_c.post("/api/looks/pick", json={"sessionId": sid, "picked_ids": [did]})
    assert pick.status_code == 200, pick.text
    assert pick.json()["status"] == "accepted"
    rows = [a for a in store.audit_log(sid) if a["action"] == "studio_send"]
    assert rows and rows[0]["actor"] == "staff:Studio QA" and rows[0]["target"] == did


# 11. send to a handed_off client lands in suggested_looks + consult card
def test_send_to_handed_off_shows_suggested_and_consult_card(monkeypatch):
    sid, _ = _client()
    secret = c.headers["x-session-secret"]
    _fake(monkeypatch)
    drafts = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).json()["drafts"]
    s = store.load(sid)
    s["status"] = "handed_off"
    s["round"] = 3
    card = {"id": f"consult-{sid}", "session_id": sid, "client_id": sid,
            "status": "pending_approval", "business_name": "x"}
    store.save_consult(card)
    s["consult"] = dict(card)
    store.save(s)
    did = drafts[0]["id"]
    r = c.post(f"/api/staff/clients/{sid}/studio/drafts/{did}/send", json={})
    assert r.status_code == 200, r.text
    view = _client_view(sid, secret)
    assert view.get("looks") is None
    sug = {o["id"]: o for o in (view.get("suggested_looks") or [])}
    assert did in sug and sug[did]["suggested"] is True
    detail = c.get(f"/api/staff/clients/{sid}").json()
    card_out = detail["consult"]
    assert did in {o["id"] for o in card_out["suggested_looks"]}
    listed = [x for x in c.get("/api/staff/consults").json() if x["id"] == card["id"]]
    assert listed and did in {o["id"] for o in listed[0]["suggested_looks"]}


# 12. double send 409, failed draft send 409, foreign draft 404
def test_send_conflicts_and_failed(monkeypatch):
    sid, _ = _client()
    _fake(monkeypatch)
    did = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).json()["drafts"][0]["id"]
    assert c.post(f"/api/staff/clients/{sid}/studio/drafts/{did}/send", json={}).status_code == 200
    assert c.post(f"/api/staff/clients/{sid}/studio/drafts/{did}/send",
                 json={}).status_code == 409
    other, _ = _client()
    _fake(monkeypatch, fail_first_n=99)
    failed = c.post(f"/api/staff/clients/{other}/studio/drafts", json={}).json()["drafts"][0]
    assert failed["status"] == "failed"
    assert c.post(f"/api/staff/clients/{other}/studio/drafts/{failed['id']}/send",
                 json={}).status_code == 409
    assert c.post(f"/api/staff/clients/{other}/studio/drafts/{did}/send",
                 json={}).status_code == 404


# 13. pinned drafts appear on the consult card
def test_pinned_drafts_on_consult_card(monkeypatch):
    sid, _ = _client()
    _fake(monkeypatch)
    did = c.post(f"/api/staff/clients/{sid}/studio/drafts", json={}).json()["drafts"][0]["id"]
    store.save_consult({"id": f"consult-{sid}", "session_id": sid, "status": "pending_approval"})
    pinned = c.post(f"/api/staff/clients/{sid}/studio/drafts/{did}/pin",
                    json={"target": "consult"}).json()
    assert pinned["pinned_consult_id"] == f"consult-{sid}"
    detail = c.get(f"/api/staff/clients/{sid}").json()
    assert did in {d["id"] for d in detail["consult"]["pinned_drafts"]}
    listed = [x for x in c.get("/api/staff/consults").json()
              if x["id"] == f"consult-{sid}"]
    assert listed and did in {d["id"] for d in listed[0]["pinned_drafts"]}
