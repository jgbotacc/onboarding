"""PDF parsing + field extraction. Regex/heuristics by default; LLM only if a key is set."""
import io
import json
import os
import re

from pypdf import PdfReader

KEY_PATTERNS = {
    "company_name": r"(?:company(?: name)?|business(?: name)?|name of business)\s*[:\-]\s*(.+)",
    "address": r"(?:address|location)\s*[:\-]\s*(.+)",
    "industry": r"(?:industry|sector|business type)\s*[:\-]\s*(.+)",
    "tagline": r"(?:tagline|slogan)\s*[:\-]\s*(.+)",
    "brand_colours": r"(?:brand colou?rs?|colou?rs?)\s*[:\-]\s*(.+)",
}
EMAIL = r"[\w.+-]+@[\w-]+\.[\w.-]+"
PHONE = r"(?:\+?\d[\d\s-]{6,}\d)"


def pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((p.extract_text() or "") for p in reader.pages)


def regex_extract(text: str) -> dict:
    out = {}
    for key, pat in KEY_PATTERNS.items():
        m = re.search(pat, text, re.IGNORECASE)
        if m and m.group(1).strip():
            out[key] = m.group(1).strip()
    contacts = re.findall(EMAIL, text) + [p.strip() for p in re.findall(PHONE, text)]
    if contacts:
        out["contact"] = ", ".join(dict.fromkeys(contacts))
    if "company_name" not in out:
        m = re.search(r"\b([A-Z][\w&' ]+ (?:Pte\.? Ltd\.?|LLC|Ltd\.?|Inc\.?|Co\.))", text)
        if m:
            out["company_name"] = m.group(1).strip()
    return out


def llm_extract(text: str) -> dict | None:
    """Optional: OpenAI-compatible extraction when OPENAI_API_KEY is set. Never raises."""
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return None
    try:
        import httpx
        prompt = ("Extract JSON with keys company_name,address,contact,industry,tagline,brand_colours "
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
