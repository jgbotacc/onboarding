"""Sense checks for the 11 onboarding fields + the form and chat re-ask paths."""
import os
import tempfile

import pytest

os.environ.setdefault("APP_DATA_DIR", tempfile.mkdtemp())
from fastapi.testclient import TestClient  # noqa: E402

from src.app import app  # noqa: E402
from helpers import new_session, resume, staff_client  # noqa: E402
from src.features.intake.validate import check, parse_amount  # noqa: E402

BT = '• Business type: "{}" isn\'t a business type. Something like "Restaurant" works.'
REV = '• Expected annual revenue: "cat" isn\'t an amount. Something like "S$250,000" works.'


def one(line):
    return f"I just need one fix:\n\n{line}\n\nJust type the correction here."

c = staff_client(app)

PASS = [
    ("expected_annual_revenue", "five thousand dollars"), ("expected_annual_revenue", "$5k"),
    ("expected_annual_revenue", "S$250,000"), ("expected_annual_revenue", "about 120k per year"),
    ("expected_annual_revenue", "$5,000 a month"), ("expected_annual_revenue", "1.5 million"),
    ("expected_annual_revenue", "two hundred and fifty thousand"), ("expected_annual_revenue", "100k-200k"),
    ("business_type", "Café"), ("business_type", "Retail shop"), ("industry", "F&B"),
    ("title_position", "CEO"), ("contact_name", "Mary-Jane O'Neil"), ("business_name", "7-Eleven"),
    ("email", "jo@kopicorner.sg"), ("phone_number", "+65 9123 4567"), ("phone_number", "(02) 9876-5432"),
    ("business_website", "kopicorner.sg"), ("business_website", "https://www.kopicorner.sg/about"),
    ("design_preferences", "warm, minimal, brown and cream"), ("requirements_notes", "Need a logo by December"),
]
FAIL = [
    ("expected_annual_revenue", "cat"), ("expected_annual_revenue", "lots"), ("expected_annual_revenue", "123abc"),
    ("business_type", "123"), ("business_type", "!!!"), ("business_type", "asdfgh"), ("industry", "42"),
    ("title_position", "###"), ("business_name", "123"), ("contact_name", "123"), ("contact_name", "Jo 99"),
    ("email", "jo@acme"), ("email", "not an email"), ("phone_number", "12345"), ("phone_number", "call me"),
    ("phone_number", "1234567890123456"), ("business_website", "not a site"),
    ("design_preferences", "asdfgh"), ("design_preferences", "!!!"), ("requirements_notes", "qwerty"),
]


@pytest.mark.parametrize("key,value", PASS)
def test_pass(key, value):
    assert check(key, value) is None


@pytest.mark.parametrize("key,value", FAIL)
def test_fail(key, value):
    p = check(key, value)
    assert p and p["message"] and p["example"]


def test_word_numbers():
    assert parse_amount("five thousand dollars") == 5000
    assert parse_amount("$5k") == 5000
    assert parse_amount("S$250,000") == 250000
    assert parse_amount("half a million") == 500000
    assert parse_amount("cat") is None


def _sid():
    return new_session(c)


def test_form_path_flags_invalid_and_blocks_until_fixed():
    sid = _sid()
    r = c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.example",
        "business_type": "123", "expected_annual_revenue": "cat", "phone_number": "12345"}}).json()
    assert {"reply", "images", "status", "missing", "round", "invalid"} <= set(r)
    assert r["status"] == "missing_info"
    bad = {i["field"]: i for i in r["invalid"]}
    assert set(bad) == {"business_type", "expected_annual_revenue", "phone_number"}
    assert set(bad["expected_annual_revenue"]) == {"field", "label", "message", "example"}
    assert "Expected annual revenue" in r["missing"]
    assert r["reply"] == (
        "I just need three fixes:\n\n" + BT.format("123") + "\n"
        '• Phone number: "12345" isn\'t a phone number. Something like "+65 6123 4567" works.\n'
        + REV + "\n\nJust type the corrections here."), r["reply"]
    assert bad["business_type"]["message"] == 'That isn\'t a business type. Something like "Restaurant" works.'
    assert bad["expected_annual_revenue"]["example"] == "S$250,000"
    assert "Acme" not in r["reply"] and "Got your registration form" not in r["reply"]
    from src.app import store
    if store.kind == "sqlite":
        rows = dict(store.db.execute("SELECT key, valid FROM field_values WHERE session_id=?", (sid,)).fetchall())
        assert rows["expected_annual_revenue"] == 0 and rows["business_name"] == 1
    # fix two, clear the optional phone: onboarding continues
    r = c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_type": "Café", "expected_annual_revenue": "five thousand dollars", "phone_number": ""}}).json()
    assert r["invalid"] == [] and r["missing"] == [] and r["status"] == "need_direction", r


def test_chat_path_reasks_with_example():
    sid = _sid()
    c.post("/api/form", json={"sessionId": sid, "fields": {"business_name": "Acme", "contact_name": "Jo"}})
    r = c.post("/api/chat", json={"sessionId": sid, "text": "cat"}).json()
    assert r["status"] == "missing_info" and r["invalid"][0]["field"] == "email"
    assert r["reply"] == one('• Email: "cat" isn\'t an email address. Something like "name@business.com" works.'), r["reply"]
    r = c.post("/api/chat", json={"sessionId": sid, "text": "jo@acme.example"}).json()
    assert r["invalid"] == [] and r["status"] == "need_direction", r


def test_chat_revenue_line_from_text():
    sid = _sid()
    c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.example", "expected_annual_revenue": "cat"}})
    r = c.post("/api/chat", json={"sessionId": sid, "text": "S$250,000"}).json()
    assert r["invalid"] == [] and r["status"] == "need_direction", r


def test_resume_link_answer_is_checked():
    sid = _sid()
    c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.example", "design_preferences": "minimal"}})
    d = c.post(f"/api/staff/clients/{sid}/decision",
               json={"decision": "more_info", "fields": ["expected_annual_revenue"]}).json()
    token = d["resume_url"].split("resume=")[1]
    resume(c, token)
    r = c.post("/api/chat", json={"sessionId": sid, "text": "cat"}).json()
    assert r["status"] == "missing_info" and r["invalid"][0]["field"] == "expected_annual_revenue"
    assert "Expected annual revenue" in r["missing"]
    assert r["reply"] == one(REV), r["reply"]
    r = c.post("/api/chat", json={"sessionId": sid, "text": "five thousand dollars"}).json()
    assert r["invalid"] == [] and r["status"] == "pending_review", r


def test_missing_fields_listed_one_per_line():
    sid = _sid()
    r = c.post("/api/form", json={"sessionId": sid, "fields": {"business_name": "Acme", "business_type": "123"}}).json()
    assert r["reply"] == ("I just need three fixes:\n\n" + BT.format("123") + "\n"
                          '• Contact name: I couldn\'t find one. Something like "Tan Mei Ling" works.\n'
                          '• Email: I couldn\'t find one. Something like "name@business.com" works.\n\n'
                          "Just type the corrections here."), r["reply"]


def test_single_reentered_field_still_wrong_gets_one_line():
    sid = _sid()
    c.post("/api/form", json={"sessionId": sid, "fields": {
        "business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.example",
        "business_type": "123", "expected_annual_revenue": "cat"}})
    r = c.post("/api/chat", json={"sessionId": sid, "text": "456"}).json()
    assert r["reply"] == one(BT.format("456")), r["reply"]
    r = c.post("/api/chat", json={"sessionId": sid, "text": "Restaurant"}).json()
    assert r["reply"] == one(REV), r["reply"]


def test_pdf_with_invalid_fields_does_not_dump_fields():
    from src.features.chat import agent
    s = agent.new_session()
    r = agent.on_document(s, {"business_name": "Slice & Stone", "contact_name": "Jin", "email": "jin@slice.sg",
                              "business_type": "123", "expected_annual_revenue": "cat",
                              "title_position": "Owner"}, "form.pdf")
    assert r["reply"] == "I just need two fixes:\n\n" + BT.format("123") + "\n" + REV + \
        "\n\nJust type the corrections here.", r["reply"]
    assert "Slice" not in r["reply"] and "form.pdf" not in r["reply"]


def test_too_long_value_is_not_echoed():
    from src.features.chat import agent
    s = agent.new_session()
    r = agent.on_form(s, {"business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.sg",
                          "requirements_notes": "x " * 3000})
    assert r["reply"] == one("• Requirements / notes: that's a bit long. Please keep it under 4000 characters."), r["reply"]


def test_resume_welcome_and_pdf_valid_reply_read_naturally():
    from src.features.chat import agent
    s = agent.new_session()
    s["fields"] = {"business_name": "Acme", "contact_name": "Jo", "email": "jo@acme.sg"}
    r = agent.start_resume(s, ["expected_annual_revenue"], "Please confirm your revenue.")
    assert r["reply"] == ("Welcome back! Our team needs a little more from you:\n\nPlease confirm your revenue.\n\n"
                          "Could you update:\n• Expected annual revenue"), r["reply"]
    s = agent.new_session()
    r = agent.on_document(s, {"business_name": "Slice & Stone Pizzeria Pte Ltd", "contact_name": "Jin",
                              "email": "jin@slice.sg", "design_preferences": "Warm and rustic"}, "x.pdf")
    assert r["reply"] == ("Thanks, I've read x.pdf and registered Slice & Stone Pizzeria Pte Ltd.\n\n"
                          "I'll go with your design preferences: Warm and rustic\n\n"
                          'Want to add reference images (JPG or PNG)? Upload them now, or press the arrow to skip.'), r["reply"]
