"""Studio prompt masking, variants and exact-size resizing (no network)."""
import re
import uuid

from PIL import Image

from src.features.imagegen import providers, studio
from src.features.looks.brief import ALTERNATIVES
from src.shared.config import MEDIA_DIR

FIELDS = {
    "business_name": "An Ban Bakery Pte Ltd",
    "business_type": "Bakery",
    "industry": "Food and Beverage",
    "contact_name": "Mei Chen",
    "email": "meichen@anban-bakery.example",
    "phone_number": "+65 9123 4567",
    "title_position": "Founder Director",
    "business_website": "https://anban-bakery.example/shop",
    "expected_annual_revenue": "S$250,000",
    "uen": "201912345K",
    "registered_address": "123 Geylang Road #04-56 Singapore 389310",
    "requirements_notes": "Grand opening: 20% off egg tarts (ref S1234567D, do not print)",
    "design_preferences": "Warm and cosy, wood tones",
}

SECRETS = ["Mei Chen", "meichen@anban-bakery.example", "Founder Director",
           "https://anban-bakery.example/shop", "S$250,000", "201912345K",
           "123 Geylang Road #04-56 Singapore 389310", "S1234567D"]

PHONE_DIGITS = "6591234567"


def _stripped(s):
    return re.sub(r"\D", "", s)


def test_no_contact_values_in_prompt():
    p = studio.studio_prompt(FIELDS, "Warm and cosy", [], "", [], "post")
    low = p.lower()
    for s in SECRETS:
        assert s.lower() not in low, (s, p)
    assert PHONE_DIGITS not in _stripped(p)


def test_marketer_text_repeating_email_and_phone_is_masked():
    marketer = f"Call us at {FIELDS['phone_number']} or {FIELDS['email']} for orders"
    p = studio.studio_prompt(FIELDS, "Warm and cosy", [], marketer, [], "story")
    low = p.lower()
    assert FIELDS["email"].lower() not in low
    assert PHONE_DIGITS not in _stripped(p)
    assert "S1234567D".lower() not in low


def test_partial_reordered_and_lowercase_name_parts_masked():
    fields = dict(FIELDS, contact_name="Tan Mei Ling")
    for marketer in ("call Mei Ling on Friday", "call Ling Mei Tan today", "call mei ling now"):
        p = studio.studio_prompt(fields, "Warm and cosy", [], marketer, [], "post")
        low = p.lower()
        assert "mei ling" not in low, (marketer, p)
        assert "ling mei tan" not in low, (marketer, p)
        assert re.search(r"\bmei\b", low) is None, (marketer, p)
        assert re.search(r"\bling\b", low) is None, (marketer, p)
        assert re.search(r"\btan\b", low) is None, (marketer, p)


def test_ordinary_words_not_masked_by_name_parts():
    fields = dict(FIELDS, contact_name="Tan Mei Ling")
    p = studio.studio_prompt(fields, "Warm and cosy", [], "tangent meiosis darling", [], "post")
    assert "tangent meiosis darling" in p.lower(), p


def test_avoid_skips_your_brief_and_current_direction():
    fields = dict(FIELDS, design_preferences="Warm and cosy, wood tones")
    rejected = [{"title": "Your brief", "brief": "Warm and cosy, wood tones"},
                {"title": "Neon Blast", "brief": "neon cyberpunk poster"},
                {"title": "Copy", "brief": "warm minimal"}]
    p = studio.studio_prompt(fields, "warm minimal", rejected, "", [], "post")
    assert "Your brief" not in p
    assert "Neon Blast" in p and "neon cyberpunk poster" in p
    assert re.search(r"Design direction.*warm minimal.*Avoid.*warm minimal", p, re.S) is None, p


def test_avoid_line_lists_rejected_titles():
    rejected = [{"title": "Neon Blast", "brief": "neon cyberpunk poster"},
                {"title": "Dark Luxe", "style": "black and gold"}]
    p = studio.studio_prompt(FIELDS, "Warm", rejected, "", [], "post")
    assert "Neon Blast" in p and "Dark Luxe" in p
    assert "neon cyberpunk poster" in p


def test_variants_skip_rejected_titles():
    bad = [ALTERNATIVES[0][0], ALTERNATIVES[1][0]]
    vs = studio.variants(bad)
    assert len(vs) == 3
    titles = [v["title"] for v in vs]
    assert titles[0] == "Your brief"
    for b in bad:
        assert b not in titles
    assert len(set(titles)) == 3


def _make_url(size):
    name = f"studio-test-{uuid.uuid4().hex}.png"
    Image.new("RGB", size, (90, 140, 200)).save(MEDIA_DIR / name)
    return f"/media/{name}"


def test_to_size_exact_for_all_presets():
    import pathlib
    for src in [(1600, 1600), (1024, 1792), (900, 900)]:
        for preset, cfg in studio.PRESETS.items():
            url = _make_url(src)
            try:
                out = studio.to_size(url, (cfg["w"], cfg["h"]))
                with Image.open(pathlib.Path(MEDIA_DIR) / out.rsplit("/", 1)[-1]) as im:
                    assert im.size == (cfg["w"], cfg["h"]), (src, preset, im.size)
            finally:
                try:
                    (MEDIA_DIR / url.rsplit("/", 1)[-1]).unlink()
                except OSError:
                    pass


def test_prompt_capped_at_3900():
    p = studio.studio_prompt(FIELDS, "Warm", [], "sale " * 2000,
                             list(studio.CHIPS), "flyer")
    assert len(p) <= 3900


def test_build_prompt_shape_default_and_overrides():
    brief = {"business_name": "Acme"}
    default = providers.build_prompt(brief)
    assert default.endswith("Square 1:1 social media marketing post. Clean, professional layout.")
    story = providers.build_prompt(brief, shape="Portrait 9:16 social media story")
    assert story.endswith("Portrait 9:16 social media story.")
    assert "Square 1:1" not in story
    flyer = providers.build_prompt(brief, shape="Portrait A5 flyer")
    assert flyer.endswith("Portrait A5 flyer.")
    preset_story = providers.build_prompt(brief, shape="story")
    assert preset_story.endswith("Portrait 9:16 social media story.")


def test_presets_and_chips_shape():
    assert studio.PRESETS["post"]["w"] == 1080 and studio.PRESETS["post"]["h"] == 1080
    assert studio.PRESETS["post"]["hint"] == "1024x1024"
    assert studio.PRESETS["story"]["hint"] == "1080x1920"
    assert studio.PRESETS["flyer"]["w"] == 1240 and studio.PRESETS["flyer"]["h"] == 1754
    assert studio.PRESETS["flyer"]["hint"] == "1240x1754"
    for cid in ("add_logo", "less_text", "story_size", "match_photos", "festive", "bolder_headline"):
        assert studio.CHIPS[cid]["label"] and studio.CHIPS[cid]["text"]
    p = studio.studio_prompt(FIELDS, "Warm", [], "", ["festive", "bolder_headline"], "flyer")
    assert "Portrait A5 flyer" in p
    assert studio.CHIPS["festive"]["text"] in p
