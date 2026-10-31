"""Registration summary before the first mockup: one field per line, fixed labels and order, closing line."""
import os
import tempfile

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from src.app import app  # noqa: E402
from src.features.chat import agent  # noqa: E402
from helpers import new_session, staff_client  # noqa: E402

c = staff_client(app)
CLOSE = "Using your design preferences and business information. Here is a mockup."
FULL = {"business_name": "Lumière Bakehouse", "business_type": "Bakery", "industry": "Food and beverage",
        "business_website": "lumierebakehouse.sg", "contact_name": "Clara Ong", "title_position": "Founder",
        "email": "clara@lumiere.example", "phone_number": "+65 6348 2210", "design_preferences": "cream and gold",
        "expected_annual_revenue": "480000", "requirements_notes": "Weekend croissant box post"}
LINES = ["Business name: Lumière Bakehouse", "Business type: Bakery", "Industry: Food and beverage",
         "Business website: lumierebakehouse.sg", "Contact name: Clara Ong", "Title / position: Founder",
         "Email: clara@lumiere.example", "Phone number: +65 6348 2210", "Design preferences: cream and gold",
         "Expected annual revenue: S$480,000", "Requirements / notes: Weekend croissant box post"]


def test_form_summary_all_fields_in_order():
    sid = new_session(c)
    r = c.post("/api/form", json={"sessionId": sid, "fields": FULL}).json()
    assert r["round"] == 1 and r["images"], r
    head, body = r["reply"].split("\n\n", 1)
    assert head == "Got your registration form. Thanks, Lumière Bakehouse is registered."
    assert body == "\n".join(LINES) + "\n\n" + CLOSE
    assert "Round" not in r["reply"] and "round" not in r["reply"]


def test_summary_only_lists_fields_with_values_and_formats_revenue():
    s = agent.new_session()
    s["fields"] = {"business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.example",
                   "expected_annual_revenue": "five thousand dollars", "industry": ""}
    assert agent.summary(s) == ("Business name: Acme\nContact name: Jo\nEmail: jo@acme.example\n"
                                "Expected annual revenue: S$5,000\n\n" + CLOSE)
    s["fields"]["expected_annual_revenue"] = "S$400k - 500k"  # ranges stay as typed
    assert "Expected annual revenue: S$400k - 500k" in agent.summary(s)


def test_chat_direction_shows_as_design_preferences():
    s = agent.new_session()
    s["fields"] = {"business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.example"}
    s["direction"] = "minimal blue"
    assert "Design preferences: minimal blue\n\n" + CLOSE in agent.summary(s)


def test_later_rounds_keep_their_own_message():
    sid = new_session(c)
    c.post("/api/form", json={"sessionId": sid, "fields": FULL})
    r = c.post("/api/review", json={"sessionId": sid, "accepted": False, "feedback": "more gold"}).json()
    assert r["round"] == 2 and CLOSE not in r["reply"], r


def test_no_round_wording_in_client_replies_but_handoff_after_3():
    sid = new_session(c)
    replies = [c.post("/api/form", json={"sessionId": sid, "fields": FULL}).json()]
    for fb in ("more gold", "bigger text", "still no"):
        replies.append(c.post("/api/review", json={"sessionId": sid, "accepted": False, "feedback": fb}).json())
    assert [r["status"] for r in replies] == ["awaiting_review"] * 3 + ["handed_off"]
    assert replies[1]["reply"].startswith("Here is the updated mockup.")
    for r in replies:
        assert "round" not in r["reply"].lower() and "of 3" not in r["reply"], r["reply"]
