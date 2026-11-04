"""Reference-images step: refsStep flag and arrow wording.

The refs step is only status need_direction with refs_pending set (PDF path,
design preferences already read). Every other reply carries refsStep False.
"""
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())

from src.features.chat import agent  # noqa: E402

PREFS = "warm retro kopitiam, brown and cream"


def _pdf_session(monkeypatch):
    monkeypatch.setattr(agent, "generate", lambda brief, refs, rnd: [f"/media/r{rnd}.png"])
    s = agent.new_session()
    r = agent.on_document(s, {"business_name": "Kopi Corner", "contact_name": "Ah Hock",
                              "email": "ahhock@kopi.sg", "design_preferences": PREFS}, "b.pdf")
    assert r["status"] == "need_direction" and r["round"] == 0, r
    return s, r


def test_refs_step_flag_true_and_arrow_wording(monkeypatch):
    _, r = _pdf_session(monkeypatch)
    assert r["refsStep"] is True, r
    assert "press the arrow to skip" in r["reply"], r["reply"]
    assert 'type "skip"' not in r["reply"], r["reply"]


def test_refs_step_skip_clears_flag(monkeypatch):
    s, _ = _pdf_session(monkeypatch)
    r = agent.on_chat(s, "skip")
    assert r["status"] == "awaiting_review" and r["round"] == 1, r
    assert r["refsStep"] is False, r
    assert s["direction"] == PREFS


def test_plain_direction_step_flag_false():
    s = agent.new_session()
    r = agent.on_form(s, {"business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.sg"})
    assert r["status"] == "need_direction", r
    assert r["refsStep"] is False, r
    assert 'type "skip"' in r["reply"], r["reply"]


def test_refs_upload_without_pending_flag_false(monkeypatch):
    monkeypatch.setattr(agent, "generate", lambda brief, refs, rnd: [f"/media/r{rnd}.png"])
    s = agent.new_session()
    agent.on_form(s, {"business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.sg"})
    r = agent.on_refs(s, ["r1.png"])
    assert r["status"] == "need_direction", r
    assert r["refsStep"] is False, r


def test_other_statuses_flag_false(monkeypatch):
    s = agent.new_session()
    assert agent.resp(s, "hi")["refsStep"] is False
    s["status"] = "awaiting_review"
    assert agent.resp(s, "hi", ["u"])["refsStep"] is False
    s["status"] = "need_direction"
    s["refs_pending"] = True
    assert agent.resp(s, "hi")["refsStep"] is True
