"""Look drafts render in distinct themes with no model call (placeholder renderer)."""
from PIL import Image, ImageChops

from src.features.imagegen.providers import PlaceholderProvider, parse_colours
from src.features.looks import brief as looks_brief
from src.shared import meta
from src.shared.config import MEDIA_DIR

FIELDS = {"business_name": "Acme Cafe", "business_type": "Cafe", "industry": "F&B",
          "design_preferences": "tomato red and cream",
          "brand_colours": "tomato red and cream"}


def _provider_brief(ctx, title, direction):
    return dict(ctx, look_title=title, direction=direction,
                business_name=FIELDS["business_name"],
                business_type=FIELDS["business_type"], industry=FIELDS["industry"],
                brand_colours=FIELDS["brand_colours"])


def _render(monkeypatch, direction_text, title):
    monkeypatch.setattr(meta, "enabled", lambda: False)
    def _no_model(*a, **k):
        raise AssertionError("no model call allowed in the placeholder renderer")
    monkeypatch.setattr(meta, "chat_json", _no_model)
    ctx = looks_brief.design_context(dict(FIELDS), direction_text, None)
    return PlaceholderProvider().generate(_provider_brief(ctx, title, direction_text), [], 1)


def _load(url):
    im = Image.open(MEDIA_DIR / url.rsplit("/", 1)[-1]).convert("RGB")
    return im


def _cleanup(urls):
    for u in urls:
        try:
            (MEDIA_DIR / u.rsplit("/", 1)[-1]).unlink()
        except OSError:
            pass


def test_parse_colours_reads_tomato_red_and_cream():
    cols = parse_colours("tomato red and cream")
    assert "#ff6347" in cols and "#f3e9d2" in cols


def test_three_looks_get_different_palettes_and_headers(monkeypatch):
    monkeypatch.setattr(meta, "enabled", lambda: False)
    seen = {}
    def _no_model(*a, **k):
        seen["called"] = True
        raise AssertionError("no model call allowed")
    monkeypatch.setattr(meta, "chat_json", _no_model)
    ctx = looks_brief.design_context(dict(FIELDS), FIELDS["design_preferences"], None)
    briefs = looks_brief.make_briefs(ctx, [], 1)
    assert [b["title"] for b in briefs] == ["Your brief", "Bold and colourful", "Warm and friendly"]
    assert "called" not in seen
    urls = []
    try:
        for i, b in enumerate(briefs):
            direction = ctx["direction"] if i == 0 else b["style"]
            urls += PlaceholderProvider().generate(_provider_brief(ctx, b["title"], direction), [], 1)
        assert all(u.startswith("/media/") and u.endswith(".png") for u in urls)
        imgs = [_load(u) for u in urls]
        assert all(im.size == (1080, 1080) for im in imgs)
        for a in range(3):
            for c in range(a + 1, 3):
                assert ImageChops.difference(imgs[a], imgs[c]).getbbox() is not None
        headers = {imgs[i].getpixel((540, 260)) for i in range(3)}
        assert len(headers) == 3
    finally:
        _cleanup(urls)


def test_your_brief_uses_client_colours_and_labels(monkeypatch):
    urls = []
    try:
        urls += _render(monkeypatch, FIELDS["design_preferences"], "Your brief")
        im = _load(urls[0])
        assert im.getpixel((1000, 70)) == (255, 99, 71)  # tomato header from client colours
        ctx = looks_brief.design_context(dict(FIELDS), FIELDS["design_preferences"], None)
        r2 = PlaceholderProvider().generate(
            dict(_provider_brief(ctx, "Your brief", FIELDS["design_preferences"])), [], 2)
        urls += r2
        assert ImageChops.difference(im, _load(r2[0])).getbbox() is not None  # round label drawn
    finally:
        _cleanup(urls)
