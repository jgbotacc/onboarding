"""Muse prompt: headline offer first, then design direction, then business type / industry, then the name."""
from src.features.chat import agent
from src.features.imagegen.providers import build_prompt

F = {"business_name": "Slice & Stone Pizzeria Pte Ltd", "contact_name": "Jin", "email": "jin@slice.example",
     "business_type": "Restaurant", "industry": "Food and Beverage",
     "design_preferences": "Warm and rustic, wood-fired oven feel, tomato red and cream",
     "requirements_notes": "Post for our new truffle pizza, 1-for-1 Tuesdays"}


def _order(p, *bits):
    idx = [p.index(b) for b in bits]
    assert idx == sorted(idx), (idx, p)


def test_prompt_has_all_four_fields_in_order():
    p = build_prompt(dict(F, direction=F["design_preferences"]))
    _order(p, F["requirements_notes"], F["design_preferences"], "Restaurant / Food and Beverage", F["business_name"])
    assert p.startswith("Main message and headline offer of the post: Post for our new truffle pizza")


def test_empty_fields_are_skipped_cleanly():
    p = build_prompt({"business_name": "Acme", "business_type": "", "industry": None, "requirements_notes": " "})
    assert "None" not in p and ": ." not in p and "Business type" not in p and "Design direction" not in p
    assert p.startswith("Social media marketing post for Acme") and "'Acme'" in p


def test_design_preferences_used_when_direction_skipped():
    assert F["design_preferences"] in build_prompt(dict(F, direction=None))


def test_feedback_rounds_keep_the_fields(monkeypatch):
    briefs = []
    monkeypatch.setattr(agent, "generate", lambda brief, refs, rnd: briefs.append(brief) or [f"/media/r{rnd}.png"])
    s = agent.new_session()
    agent.on_form(s, dict(F))
    agent.on_review(s, False, "more cheese")
    assert len(briefs) == 2 and briefs[1]["feedback"] == "more cheese"
    for b in briefs:
        p = build_prompt(b)
        for v in (F["requirements_notes"], F["design_preferences"], "Restaurant", "Food and Beverage"):
            assert v in p, (v, p)
