"""Hearts and rejections reach the next studio brief through the rejected/avoid path."""
import os
import tempfile
import uuid

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from src.app import app, store  # noqa: E402
from src.features.imagegen import studio  # noqa: E402
from src.features.staff import routes as staff_routes  # noqa: E402
from src.shared.config import MEDIA_DIR  # noqa: E402
from helpers import new_session  # noqa: E402

STAFF = {"x-staff-key": os.environ["STAFF_PASSCODE"], "x-staff-name": "Brief QA"}
c = TestClient(app, headers=dict(STAFF))


def _sid():
    sid = new_session(c)
    fields = {"business_name": "Brief Bakery", "contact_name": "Mei Lin Tan",
              "email": f"brief-{uuid.uuid4().hex[:8]}@example.com"}
    assert c.post("/api/form", json={"sessionId": sid, "fields": fields}).status_code == 200
    return sid


def _sent(sid, title, style):
    name = f"brief-{uuid.uuid4().hex}.png"
    Image.new("RGB", (300, 300), (60, 120, 180)).save(MEDIA_DIR / name)
    (did,) = store.reserve_drafts(sid, [{"run_id": "run1", "preset": "post", "width": 1080,
                                         "height": 1080, "author": "staff:Brief QA",
                                         "style_title": title, "style": style,
                                         "prompt": "a poster"}])
    store.finish_draft(did, f"/media/{name}", "ok")
    store.mark_draft_sent(did, "staff:Brief QA", "2026-11-04T00:00:00+00:00")
    return did


def test_feedback_mapped_to_rejected_shape():
    sid = _sid()
    hearted = _sent(sid, "Golden Harvest", "golden wheat harvest poster")
    rejected = _sent(sid, "Neon Storm", "neon cyberpunk storm poster")
    store.record_feedback(sid, hearted, "heart", None, "client:share")
    store.record_feedback(sid, rejected, "reject", None, "client:share")
    got = staff_routes.feedback_as_rejected(store, sid)
    assert {g["id"] for g in got} == {hearted, rejected}
    by_id = {g["id"]: g for g in got}
    assert by_id[hearted]["title"] == "Golden Harvest"
    assert by_id[rejected]["brief"] == "neon cyberpunk storm poster"
    assert all(set(g) >= {"id", "title", "brief", "url"} for g in got)


def test_approve_stays_out_of_avoid():
    sid = _sid()
    did = _sent(sid, "Final Pick", "final pick poster")
    store.record_feedback(sid, did, "approve", None, "client:share")
    assert staff_routes.feedback_as_rejected(store, sid) == []


def test_next_brief_avoids_reacted_drafts():
    sid = _sid()
    hearted = _sent(sid, "Golden Harvest", "golden wheat harvest poster")
    rejected = _sent(sid, "Neon Storm", "neon cyberpunk storm poster")
    store.record_feedback(sid, hearted, "heart", None, "client:share")
    store.record_feedback(sid, rejected, "reject", None, "client:share")
    # studio GET avoid list shows both reacted drafts
    avoid = c.get(f"/api/staff/clients/{sid}/studio").json()["avoid"]
    assert {"Golden Harvest", "Neon Storm"} <= {a["title"] for a in avoid}
    # existing path: _avoid_list carries their briefs into the prompt ...
    s = store.load(sid)
    rejected_all = staff_routes._rejected(store, s) + staff_routes.feedback_as_rejected(store, sid)
    prompt = studio.studio_prompt(s.get("fields", {}), s.get("direction"), rejected_all,
                                  "", [], "post")
    assert "golden wheat harvest poster" in prompt
    assert "neon cyberpunk storm poster" in prompt
    # ... and variants drops their titles so the next run differs
    titles = [r.get("title") for r in rejected_all if r.get("title")]
    assert "Golden Harvest" not in [v["title"] for v in studio.variants(titles, None)]
    assert "Neon Storm" not in [v["title"] for v in studio.variants(titles, None)]


def test_changes_note_also_steers_away():
    sid = _sid()
    did = _sent(sid, "Blue Calm", "calm blue waves poster")
    store.record_feedback(sid, did, "changes", "warmer please", "client:share")
    assert [g["title"] for g in staff_routes.feedback_as_rejected(store, sid)] == ["Blue Calm"]
