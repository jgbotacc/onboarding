"""Task 2: general business document + photo reading. No network: Meta disabled or patched."""
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from src.features.intake import document, extract, photo
from src.shared import meta
from src.shared.config import LABELS

FIX = Path("tests/fixtures")


@pytest.fixture(autouse=True)
def _no_meta(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    assert not meta.enabled()


def _acra_pdf_text() -> str:
    return extract.pdf_text((FIX / "acra_fake.pdf").read_bytes())


def _acra_layout_text() -> str:
    return (FIX / "acra_fake.txt").read_text()


def _sharp_image() -> Image.Image:
    im = Image.new("RGB", (1200, 1600), "white")
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.load_default(size=48)
    except TypeError:  # older Pillow
        font = ImageFont.load_default()
    for i in range(40):
        d.text((60, 40 + i * 38), f"LINE {i + 1:02d} LUMEN KOPI BUSINESS PROFILE 202498765K",
               fill="black", font=font)
    return im


def _png(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return buf.getvalue()


def _check_acra_fields(f: dict):
    assert f["business_name"].lower() == "lumen kopi pte. ltd."
    assert f["uen"] == "202498765K"
    assert f["industry"].startswith("Cafes and coffee houses") and "56122" not in f["industry"]
    assert "#02-15" in f["registered_address"] and "098765" in f["registered_address"]
    assert f["contact_name"].lower() == "tan mei ling"
    assert f["title_position"] == "Director"


@pytest.mark.parametrize("text_fn", [_acra_pdf_text, _acra_layout_text], ids=["pypdf", "layout"])
def test_parse_acra_both_layouts(text_fn):
    _check_acra_fields(document.parse_acra(text_fn()))


def test_read_document_acra_no_nric():
    out = document.read_document(_acra_pdf_text())
    assert out["kind"] == "acra"
    s = json.dumps(out)
    assert "S1234567D" not in s and "S7654321A" not in s
    f = out["fields"]
    assert f["business_name"].lower() == "lumen kopi pte. ltd."
    assert f["uen"] == "202498765K"
    assert f["contact_name"].lower() == "tan mei ling"
    assert f["title_position"] == "Director"
    # comma-written street/unit is masked; postal in parens is kept per guard rule
    assert f["registered_address"] == "[removed] (098765)"
    assert "address" in out["removed"]


def test_read_document_removed_nric(monkeypatch):
    monkeypatch.setattr(document, "llm_fields", lambda text, session_id=None: {
        "phone_number": "S1234567D", "contact_name": "Jo Tan S7654321A",
        "email": "jo@example.com"})
    out = document.read_document("A short brochure about our cafe. Visit us for great kopi!")
    assert out["kind"] == "other"
    assert out["removed"] == ["nric"]
    assert "phone_number" not in out["fields"]  # value IS an NRIC: dropped
    assert out["fields"]["contact_name"] == "Jo Tan [removed]"  # contains one: masked
    assert out["fields"]["email"] == "jo@example.com"
    assert "S1234567D" not in json.dumps(out) and "S7654321A" not in json.dumps(out)


def test_is_registration_form(tmp_path):
    sample = tmp_path / "sample.pdf"
    subprocess.run([sys.executable, "scripts/make_sample_pdf.py", str(sample)], check=True)
    v1 = extract.pdf_text(sample.read_bytes())
    assert document.is_registration_form(v1)
    assert document.read_document(v1)["kind"] == "form"
    assert not document.is_registration_form(_acra_pdf_text())
    assert not document.is_registration_form(_acra_layout_text())


def test_llm_fields_prompt_only_doc_and_field_list(monkeypatch):
    seen = {}

    def fake(step, messages, **kw):
        seen.update(step=step, messages=messages, kw=kw)
        return {"business_name": "  X  ", "bogus": "y", "uen": ""}

    monkeypatch.setattr(meta, "chat_json", fake)
    assert document.llm_fields("DOCBODY 98765 hello", session_id="sess-secret-xyz") == {"business_name": "X"}
    assert seen["step"] == "doc_read" and seen["kw"]["session_id"] == "sess-secret-xyz"
    assert len(seen["messages"]) == 1
    prompt = seen["messages"][0]["content"]
    assert "DOCBODY 98765 hello" in prompt
    for k, label in LABELS.items():
        assert k in prompt and label in prompt
    assert "sess-secret-xyz" not in prompt  # no session data in the prompt


def test_llm_fields_disabled_returns_empty():
    assert document.llm_fields("anything") == {}


def test_quality():
    assert photo.quality(_sharp_image()) is None
    assert photo.quality(_sharp_image().filter(ImageFilter.GaussianBlur(radius=8))) == "blurry"
    assert photo.quality(Image.new("RGB", (300, 400), "white")) == "unreadable"


def test_read_photo_cropped(monkeypatch):
    seen = {}

    def fake(step, messages, **kw):
        seen.update(step=step, messages=messages, kw=kw)
        return {"readable": False, "problem": "cropped", "text": "", "fields": {}}

    monkeypatch.setattr(meta, "chat_json", fake)
    out = photo.read_photo(_png(_sharp_image()))
    assert (out["retake"], out["reason"], out["kind"]) == (True, "cropped", "photo")
    assert seen["step"] == "photo_read" and seen["kw"]["timeout"] == 90
    kinds = [p.get("type") for p in seen["messages"][0]["content"]]
    assert kinds == ["text", "image_url"]  # instruction + image only


def test_read_photo_no_reader_when_disabled():
    out = photo.read_photo(_png(_sharp_image()))
    assert out["retake"] is False and out["reason"] == "no_reader"
    assert out["fields"] == {} and out["removed"] == []


def test_read_photo_quality_gate_before_model(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("model must not be called")

    monkeypatch.setattr(meta, "chat_json", boom)
    out = photo.read_photo(_png(Image.new("RGB", (300, 400), "white")))
    assert (out["retake"], out["reason"]) == (True, "unreadable")


def test_heic_roundtrip():
    pytest.importorskip("pillow_heif")
    buf = io.BytesIO()
    _sharp_image().save(buf, format="HEIF")
    data = buf.getvalue()
    assert photo.is_heic(data) and not photo.is_heic(_png(_sharp_image()))
    assert photo.load_image(data).size == (1200, 1600)
