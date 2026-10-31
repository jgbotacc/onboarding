"""PDF parsing + field extraction. Regex/heuristics by default; LLM only if a key is set."""
import io
import json
import os
import re

from pypdf import PdfReader

from src.shared.config import LABELS

# 'Label: value' lines from the registration form, plus common aliases.
ALIASES = {
    "business_name": ["business name", "company name", "company", "business"],
    "business_type": ["business type", "type of business"],
    "industry": ["industry", "sector"],
    "business_website": ["business website", "website", "url"],
    "contact_name": ["contact name", "contact person", "name of contact"],
    "title_position": ["title/position", "title / position", "title", "position", "designation"],
    "email": ["email", "e-mail", "email address"],
    "phone_number": ["phone number", "phone", "mobile", "tel"],
    "design_preferences": ["design preferences", "design preference", "design direction", "style"],
    "expected_annual_revenue": ["expected annual revenue", "annual revenue", "revenue"],
    "requirements_notes": ["requirements / notes", "requirements/notes", "requirements", "notes"],
    "tagline": ["tagline", "slogan"],
    "brand_colours": ["brand colours", "brand colors", "colours", "colors"],
}
EMAIL = r"[\w.+-]+@[\w-]+\.[\w.-]+"
PHONE = r"(?:\+?\d[\d\s-]{6,}\d)"


def pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def regex_extract(text: str) -> dict:
    out = {}
    lines = [ln.strip() for ln in text.splitlines()]
    for key, names in ALIASES.items():
        names = sorted(set(names + [LABELS.get(key, key).lower()]), key=len, reverse=True)
        pat = r"^\s*(?:" + "|".join(re.escape(n) for n in names) + r")\s*\*?\s*[:\-]\s*(.+)$"
        for ln in lines:
            m = re.match(pat, ln, re.IGNORECASE)
            if m and m.group(1).strip() and key not in out:
                out[key] = m.group(1).strip()
    if "email" not in out and re.search(EMAIL, text):
        out["email"] = re.search(EMAIL, text).group(0)
    if "phone_number" not in out and re.search(PHONE, text):
        out["phone_number"] = re.search(PHONE, text).group(0).strip()
    if "business_name" not in out:
        m = re.search(r"\b([A-Z][\w&' ]+ (?:Pte\.? Ltd\.?|LLC|Ltd\.?|Inc\.?|Co\.))", text)
        if m:
            out["business_name"] = m.group(1).strip()
    return out


def llm_extract(text: str) -> dict | None:
    """Optional: OpenAI-compatible extraction when OPENAI_API_KEY is set. Never raises."""
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return None
    try:
        import httpx
        prompt = ("Extract JSON with keys " + ",".join(ALIASES) + " "
                  "(omit unknown) from this business document:\n" + text[:6000])
        r = httpx.post("https://api.openai.com/v1/chat/completions", timeout=30,
                       headers={"Authorization": f"Bearer {key}"},
                       json={"model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                             "response_format": {"type": "json_object"},
                             "messages": [{"role": "user", "content": prompt}]})
        return {k: v for k, v in json.loads(r.json()["choices"][0]["message"]["content"]).items() if v}
    except Exception as e:  # fall back to regex
        print(f"[extract] LLM extraction failed, using regex: {e}")
        return None


def extract_fields(text: str) -> dict:
    fields = regex_extract(text)
    llm = llm_extract(text)
    if llm:
        fields.update(llm)
    return fields
