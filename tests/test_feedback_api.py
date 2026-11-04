"""Client feedback and share links API: staff routes, public routes, expiry, audit (no network)."""
import json
import os
import tempfile
import uuid

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from src.app import app, store  # noqa: E402
from src.shared.config import MEDIA_DIR  # noqa: E402
from helpers import new_session  # noqa: E402

STAFF = {"x-staff-key": os.environ["STAFF_PASSCODE"], "x-staff-name": "Share QA"}
c = TestClient(app, headers=dict(STAFF))
anon = TestClient(app)


def _tag():
    return uuid.uuid4().hex[:8]


def _client(tag=None):
    tag = tag or _tag()
    sid = new_session(c)
    fields = {"business_name": f"Share Bakery {tag}", "contact_name": "Mei Lin Tan",
              "email": f"share-{tag}@example.com", "phone_number": "+65 8123 8654"}
    assert c.post("/api/form", json={"sessionId": sid, "fields": fields}).status_code == 200
    return sid, fields


def _media():
    name = f"share-{uuid.uuid4().hex}.png"
    Image.new("RGB", (300, 300), (90, 140, 200)).save(MEDIA_DIR / name)
    return f"/media/{name}"


def _sent(sid, title="Bold Dawn", style="bold dawn poster"):
    url = _media()
    (did,) = store.reserve_drafts(sid, [{"run_id": "run1", "preset": "post", "width": 1080,
                                         "height": 1080, "author": "staff:Share QA",
                                         "style_title": title, "style": style,
                                         "prompt": "a poster"}])
    store.finish_draft(did, url, "ok")
    store.mark_draft_sent(did, "staff:Share QA", "2026-11-04T00:00:00+00:00")
    store.add_looks(sid, store.load(sid).get("round", 0),
                    [{"id": did, "url": url, "title": "Suggested by our team",
                      "brief": style}], source="staff")
    return did, url


def _issue(sid, days=None):
    body = {} if days is None else {"days": days}
    r = c.post(f"/api/staff/clients/{sid}/studio/share", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    return out["id"], out["url"].rsplit("/", 1)[-1], out


def _awaiting(sid, did):
    s = store.load(sid)
    s["status"] = "awaiting_review"
    s.setdefault("looks", []).append({"id": did, "url": _media(), "title": "Suggested by our team"})
    store.save(s)


# staff share routes
def test_share_needs_passcode():
    assert anon.post("/api/staff/clients/x/studio/share", json={}).status_code == 401
    assert anon.get("/api/staff/clients/x/studio/shares").status_code == 401
    assert anon.get("/api/staff/clients/x/studio/shortlist").status_code == 401


def test_issue_list_revoke_round_trip():
    sid, _ = _client()
    tid, token, out = _issue(sid)
    assert out["url"].endswith(f"/share/{token}") and out["expires_at"]
    listed = c.get(f"/api/staff/clients/{sid}/studio/shares").json()
    assert len(listed) == 1
    assert listed[0]["id"] == tid and listed[0]["revoked_at"] is None
    assert "token_hash" not in json.dumps(listed) and token not in json.dumps(listed)
    assert c.post(f"/api/staff/clients/{sid}/studio/shares/{tid}/revoke", json={}).json()["id"] == tid
    assert c.get(f"/api/staff/clients/{sid}/studio/shares").json()[0]["revoked_at"]
    assert c.post(f"/api/staff/clients/{sid}/studio/shares/{tid}/revoke", json={}).status_code == 200
    assert c.post(f"/api/staff/clients/{sid}/studio/shares/nope/revoke",
                  json={}).status_code == 404


def test_share_days_validated_and_scoped_to_client():
    sid, _ = _client()
    assert c.post(f"/api/staff/clients/{sid}/studio/share", json={"days": 0}).status_code == 422
    assert c.post(f"/api/staff/clients/{sid}/studio/share", json={"days": 31}).status_code == 422
    tid, _, _ = _issue(sid, days=1)
    other, _ = _client()
    assert c.get(f"/api/staff/clients/{other}/studio/shares").json() == []
    assert c.post(f"/api/staff/clients/{other}/studio/shares/{tid}/revoke",
                  json={}).status_code == 404  # another client's link id
    assert c.post("/api/staff/clients/nope/studio/share", json={}).status_code == 404


# public share page
def test_share_get_lists_only_sent_drafts():
    sid, _ = _client()
    did, _ = _sent(sid)
    (unsent,) = store.reserve_drafts(sid, [{"run_id": "r", "preset": "post", "width": 1080,
                                            "height": 1080, "author": "staff:x"}])
    store.finish_draft(unsent, _media(), "ok")  # finished but never sent
    _, token, _ = _issue(sid)
    body = anon.get(f"/api/share/{token}").json()
    assert body["business_name"] == store.load(sid)["fields"]["business_name"]
    assert {d["id"] for d in body["drafts"]} == {did}
    assert body["drafts"][0]["liked"] is False and body["shortlist"] == [] and body["decided"] is None


def test_share_unknown_revoked_expired():
    sid, _ = _client()
    _sent(sid)
    _, token, _ = _issue(sid)
    tid = c.get(f"/api/staff/clients/{sid}/studio/shares").json()[0]["id"]
    unknown = anon.get("/api/share/made-up-token")
    assert unknown.status_code == 404
    c.post(f"/api/staff/clients/{sid}/studio/shares/{tid}/revoke", json={})
    revoked = anon.get(f"/api/share/{token}")
    assert revoked.status_code == 404
    assert revoked.json() == unknown.json()  # revoked reads exactly like unknown
    assert anon.post(f"/api/share/{token}/feedback",
                     json={"draft_id": "x", "kind": "heart"}).status_code == 404
    tid2, token2, _ = _issue(sid)
    store.db.execute("UPDATE share_tokens SET expires_at='2000-01-01T00:00:00+00:00' WHERE id=?",
                     (tid2,))
    store.db.commit()
    expired = anon.get(f"/api/share/{token2}")
    assert expired.status_code == 410
    assert anon.post(f"/api/share/{token2}/feedback",
                     json={"draft_id": "x", "kind": "heart"}).status_code == 410


def test_share_first_read_marks_used():
    sid, _ = _client()
    _sent(sid)
    _, token, _ = _issue(sid)
    assert c.get(f"/api/staff/clients/{sid}/studio/shares").json()[0]["used_at"] is None
    assert anon.get(f"/api/share/{token}").status_code == 200
    assert c.get(f"/api/staff/clients/{sid}/studio/shares").json()[0]["used_at"]


# public feedback
def test_heart_and_reject_toggle_shortlist():
    sid, _ = _client()
    did, _ = _sent(sid)
    _, token, _ = _issue(sid)
    r = anon.post(f"/api/share/{token}/feedback", json={"draft_id": did, "kind": "heart"})
    assert r.status_code == 200 and r.json() == {"ok": True, "shortlist": [did]}
    assert anon.get(f"/api/share/{token}").json()["shortlist"] == [did]
    assert anon.get(f"/api/share/{token}").json()["drafts"][0]["liked"] is True
    r = anon.post(f"/api/share/{token}/feedback", json={"draft_id": did, "kind": "reject"})
    assert r.json() == {"ok": True, "shortlist": []}
    view = c.get(f"/api/staff/clients/{sid}/studio/shortlist").json()
    assert view["drafts"] == [] and sorted(f["kind"] for f in view["feedback"]) == ["heart", "reject"]
    kinds = {a["action"] for a in store.audit_log(sid)}
    assert {"feedback_heart", "feedback_reject"} <= kinds
    assert all(a["actor"] == "client:share"
               for a in store.audit_log(sid) if a["action"].startswith("feedback_"))


def test_feedback_guesses_and_foreign_drafts_404():
    sid, _ = _client()
    did, _ = _sent(sid)
    other, _ = _client()
    _, token, _ = _issue(sid)
    assert anon.post(f"/api/share/{token}/feedback",
                     json={"draft_id": "made-up", "kind": "heart"}).status_code == 404
    foreign, _ = _sent(other)
    assert anon.post(f"/api/share/{token}/feedback",
                     json={"draft_id": foreign, "kind": "heart"}).status_code == 404
    assert anon.post(f"/api/share/{token}/feedback",
                     json={"draft_id": did, "kind": "approve"}).status_code == 200  # own draft works


def test_approve_picks_and_audits_like_client_pick():
    sid, _ = _client()
    did, _ = _sent(sid)
    _awaiting(sid, did)
    _, token, _ = _issue(sid)
    r = anon.post(f"/api/share/{token}/feedback", json={"draft_id": did, "kind": "approve"})
    assert r.status_code == 200, r.text
    assert store.load(sid)["status"] == "accepted"
    assert [l for l in store.looks(sid) if l["id"] == did][0]["selected"] == 1
    assert anon.get(f"/api/share/{token}").json()["decided"] == {"draft_id": did, "kind": "approve"}
    rows = [a for a in store.audit_log(sid) if a["action"] == "feedback_approve"]
    assert rows and rows[0]["actor"] == "client:share" and rows[0]["target"]
    assert did in json.dumps(rows[0]["details"])


def test_changes_needs_note_and_scrubs_it():
    sid, fields = _client()
    did, _ = _sent(sid)
    _, token, _ = _issue(sid)
    assert anon.post(f"/api/share/{token}/feedback",
                     json={"draft_id": did, "kind": "changes"}).status_code == 400
    assert anon.post(f"/api/share/{token}/feedback",
                     json={"draft_id": did, "kind": "changes", "note": "   "}).status_code == 400
    assert anon.post(f"/api/share/{token}/feedback",
                     json={"draft_id": did, "kind": "changes",
                           "note": "x" * 501}).status_code == 422
    email = fields["email"]
    r = anon.post(f"/api/share/{token}/feedback",
                  json={"draft_id": did, "kind": "changes",
                        "note": f"make it warmer, reply to {email} please"})
    assert r.status_code == 200, r.text
    stored = [f for f in store.feedback_for(sid) if f["kind"] == "changes"][0]
    assert email.lower() not in stored["note"].lower()
    feed = c.get(f"/api/staff/clients/{sid}/studio/shortlist").json()["feedback"]
    assert email.lower() not in json.dumps(feed).lower()
    rows = [a for a in store.audit_log(sid) if a["action"] == "feedback_changes"]
    assert rows and email.lower() not in json.dumps(rows).lower()
    assert anon.get(f"/api/share/{token}").json()["decided"] == {"draft_id": did, "kind": "changes"}


def test_no_plaintext_token_in_db_audit_traces_or_logs(caplog):
    sid, _ = _client()
    did, _ = _sent(sid)
    _, token, out = _issue(sid)
    anon.get(f"/api/share/{token}")
    anon.post(f"/api/share/{token}/feedback", json={"draft_id": did, "kind": "heart"})
    blob = json.dumps(store.db.execute("SELECT * FROM share_tokens").fetchall())
    blob += json.dumps(store.audit_log(sid)) + json.dumps(store.all_traces()) + caplog.text
    assert token not in blob


def test_share_writes_rate_limited():
    sid, _ = _client()
    did, _ = _sent(sid)
    _, token, _ = _issue(sid)
    for i in range(30):
        r = anon.post(f"/api/share/{token}/feedback",
                      json={"draft_id": did, "kind": "heart" if i % 2 == 0 else "reject"})
        assert r.status_code == 200, i
    over = anon.post(f"/api/share/{token}/feedback",
                     json={"draft_id": did, "kind": "heart"})
    assert over.status_code == 429


# staff shortlist
def test_staff_shortlist_add_remove_and_view():
    sid, _ = _client()
    did, _ = _sent(sid)
    assert c.get(f"/api/staff/clients/{sid}/studio/shortlist").json() == {"drafts": [], "feedback": []}
    r = c.post(f"/api/staff/clients/{sid}/studio/shortlist/{did}", json={"add": True})
    assert [d["id"] for d in r.json()["drafts"]] == [did]
    assert c.get(f"/api/staff/clients/{sid}/studio/shortlist").json()["drafts"][0]["id"] == did
    assert c.post(f"/api/staff/clients/{sid}/studio/shortlist/{did}",
                  json={"add": False}).json() == {"drafts": []}
    assert {a["action"] for a in store.audit_log(sid)} >= {"shortlist_add", "shortlist_remove"}
    other, _ = _client()
    assert c.post(f"/api/staff/clients/{other}/studio/shortlist/{did}",
                  json={"add": True}).status_code == 404
    assert c.post(f"/api/staff/clients/{sid}/studio/shortlist/nope",
                  json={"add": True}).status_code == 404
