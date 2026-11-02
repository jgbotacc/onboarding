"""Look rounds (3 per round), skip-to-consult, picks and the confirm step."""
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from src.features.chat import agent  # noqa: E402
from src.features.looks import brief as looks_brief  # noqa: E402
from src.shared import meta  # noqa: E402

FULL = {"business_name": "Acme Cafe", "contact_name": "Jo", "email": "jo@acme.example",
        "business_type": "Cafe", "industry": "F&B", "design_preferences": "minimal blue"}


def _round1():
    s = agent.new_session()
    r = agent.on_form(s, dict(FULL))
    assert r["status"] == "awaiting_review" and s["round"] == 1, r
    return s, r


def test_round_makes_3_looks_with_distinct_ids():
    s, r = _round1()
    assert len(s["looks"]) == 3 and len(s["images"]) == 3
    ids = [lk["id"] for lk in s["looks"]]
    assert len(set(ids)) == 3 and all(ids)
    assert [lk["url"] for lk in s["looks"]] == s["images"]
    assert s["looks"][0]["title"] == "Your brief"
    assert r["looks"] and r["looks"]["prompt"] == "Which look do you prefer?"
    assert len(r["looks"]["options"]) == 3
    assert {o["id"] for o in r["looks"]["options"]} == set(ids)
    assert r["looks"]["max_rounds"] == 3 and r["round"] == 1


def test_skip_3_times_hands_off_with_consult_card():
    s, _ = _round1()
    r = None
    for _ in range(3):
        r = agent.on_chat(s, "skip")
    assert s["status"] == "handed_off", r
    assert s["consult"] and s["consult"]["status"] == "pending_approval"
    assert len(s["rejected"]) == 9
    assert sorted({lk["round"] for lk in s["rejected"]}) == [1, 2, 3]
    assert r["consult"] == {"id": s["consult"]["id"], "status": "pending_approval"}
    assert "consult" in s["consult"]["next_steps"][0].lower()
    assert r["reply"].endswith("Our team will contact you shortly.")
    assert "consult" in r["reply"].lower()


def test_pick_1_and_3_via_chat():
    s, _ = _round1()
    r = agent.on_chat(s, "1 and 3")
    assert r["status"] == "accepted" and s["status"] == "accepted", r
    assert len(s["selected_looks"]) == 2
    assert [lk["id"] for lk in s["selected_looks"]] == [s["looks"][0]["id"], s["looks"][2]["id"]]


def test_make_briefs_fallback_skips_rejected_and_rotates():
    ctx = looks_brief.design_context(dict(FULL), "minimal blue", None)
    rej = [{"title": "Bold and colourful", "brief": "x"}, {"title": "Warm and friendly", "brief": "y"}]
    out = looks_brief.make_briefs(ctx, rej, 1)
    assert len(out) == 3 and out[0]["title"] == "Your brief"
    assert all(t not in ("Bold and colourful", "Warm and friendly") for t in (out[1]["title"], out[2]["title"]))
    r1 = [b["title"] for b in looks_brief.make_briefs(ctx, [], 1)[1:]]
    r2 = [b["title"] for b in looks_brief.make_briefs(ctx, [], 2)[1:]]
    assert r1 != r2  # rotated by round_n


def test_make_briefs_sends_no_contact_details_to_meta(monkeypatch):
    fields = dict(FULL, contact_name="Secret Person", email="secret@example.com")
    ctx = looks_brief.design_context(fields, "minimal", None)
    assert "secret@example.com" not in str(ctx) and "Secret Person" not in str(ctx)
    seen = {}
    monkeypatch.setattr(meta, "enabled", lambda: True)
    def fake_json(step, messages, **kw):
        seen["step"] = step
        seen["messages"] = messages
        return {"looks": [{"title": "Meta One", "style": "meta style one"},
                          {"title": "Meta Two", "style": "meta style two"}]}
    monkeypatch.setattr(meta, "chat_json", fake_json)
    out = looks_brief.make_briefs(ctx, [], 1, "sid1")
    assert seen["step"] == "image_brief"
    assert "secret@example.com" not in str(seen["messages"])
    assert "Secret Person" not in str(seen["messages"])
    assert [b["title"] for b in out] == ["Your brief", "Meta One", "Meta Two"]


def test_confirm_flow_lists_uen_edits_then_saves():
    s = agent.new_session()
    r = agent.on_extracted(s, "doc1", "acra.pdf",
                           {"business_name": "Acme Pte Ltd", "uen": "T20VC1234Z", "contact_name": "Jo"},
                           ["nric"])
    assert r["status"] == "confirm_details" and s["status"] == "confirm_details"
    assert s["fields"] == {} and s["pending"]["fields"]["uen"] == "T20VC1234Z"
    assert "T20VC1234Z" not in r["reply"] and "ID number" in r["reply"]
    assert r["confirm"] and r["confirm"]["docId"] == "doc1"
    assert any(f["key"] == "uen" and f["value"] == "T20VC1234Z" for f in r["confirm"]["fields"])
    r = agent.on_chat(s, "Email: jo@x.example")
    assert s["status"] == "confirm_details" and s["pending"]["fields"]["email"] == "jo@x.example"
    assert r["reply"].startswith("Updated.\n")
    r = agent.on_chat(s, "yes")
    assert s["pending"] is None and s["fields"]["email"] == "jo@x.example"
    assert s["fields"]["business_name"] == "Acme Pte Ltd" and s["via_pdf"] is True
    assert r["status"] in ("need_direction", "missing_info"), r


def test_remove_pending_restores_and_saves_nothing():
    s = agent.new_session()
    agent.on_extracted(s, "doc9", "other.pdf", {"business_name": "X"}, [])
    assert s["status"] == "confirm_details"
    r = agent.remove_pending(s, "doc9")
    assert s["status"] == "need_document" and s["pending"] is None and s["fields"] == {}
    assert "Removed other.pdf." in r["reply"] and "Nothing from it was saved." in r["reply"]
    r = agent.remove_pending(s, "doc9")
    assert r["reply"] == "That file is already saved or gone."
