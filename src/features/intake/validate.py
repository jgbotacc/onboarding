"""Sense checks for the 11 onboarding fields. One place for PDF, form, chat and resume-link values.

check(key, value) -> None when the value makes sense, else {"message", "example"}.
"""
import re

# ---------- examples shown when a value is rejected ----------
EXAMPLES = {
    "business_name": ["Kopi Corner Pte Ltd", "Acme Studio"],
    "business_type": ["Café", "Retail shop", "Accounting firm"],
    "industry": ["Food & Beverage", "Retail", "Professional Services"],
    "business_website": ["kopicorner.sg", "https://www.kopicorner.sg"],
    "contact_name": ["Tan Mei Ling", "John Lee"],
    "title_position": ["Owner", "Marketing Manager"],
    "email": ["jo@kopicorner.sg"],
    "phone_number": ["+65 9123 4567", "(02) 9876-5432"],
    "design_preferences": ["warm, minimal, brown and cream"],
    "expected_annual_revenue": ["S$250,000", "five thousand dollars"],
    "requirements_notes": ["Need a logo and 5 Instagram posts by December"],
}
WHAT = {
    "business_name": "a business name", "business_type": "a business type", "industry": "an industry",
    "business_website": "a website address", "contact_name": "a person's name",
    "title_position": "a job title", "email": "an email address", "phone_number": "a phone number",
    "design_preferences": "a design preference", "expected_annual_revenue": "a revenue figure",
    "requirements_notes": "a description of your requirements",
}
LIMITS = {"business_name": 120, "contact_name": 80, "business_type": 80, "industry": 80, "title_position": 80,
          "business_website": 200, "email": 254, "phone_number": 30, "expected_annual_revenue": 80,
          "design_preferences": 2000, "requirements_notes": 4000}


def example_text(key, quote=False):
    ex = EXAMPLES.get(key, [])
    ex = [f"'{e}'" for e in ex] if quote else ex
    return ex[0] if len(ex) == 1 else ", ".join(ex[:-1]) + " or " + ex[-1] if ex else ""


def _letters(v):
    return sum(ch.isalpha() for ch in v)


# ---------- gibberish detection (no dictionary needed) ----------
KEY_ROWS = ("qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890")
VOWELS = set("aeiouyàáâäèéêëìíîïòóôöùúûü")


def _is_gibberish(word):
    w = word.lower()
    if len(w) < 3 or not w.isalpha() or not w.isascii():
        return False
    if any(w[i:i + 4] in row or w[i:i + 4] in row[::-1] for row in KEY_ROWS for i in range(len(w) - 3)):
        return True  # keyboard mash: asdf, qwer, lkjh
    if re.search(r"(.)\1{3,}", w):
        return True  # aaaa
    if len(w) >= 4 and not set(w) & VOWELS:
        return True  # xkcdq
    if re.search(r"[^aeiouy]{6,}", w):
        return True
    return False


def _words(v):
    return re.findall(r"[^\W\d_]+", v)


def _word_issue(v, need_real=True):
    """None if v reads as words. Acronyms (CTA, F&B) count as real."""
    words = _words(v)
    real = [w for w in words if (len(w) >= 2 or w.isupper()) and not _is_gibberish(w)]
    junk = [w for w in words if _is_gibberish(w)]
    if junk and len(junk) >= len(real):
        return "gibberish"
    if need_real and not real:
        return "no words"
    return None


# ---------- revenue: numbers, k/m suffixes, currencies, periods, number words ----------
SMALL = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen "
    "seventeen eighteen nineteen".split())}
SMALL.update({w: 10 * (i + 2) for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split())})
SMALL["fourty"] = 40
SCALES = {"thousand": 1e3, "k": 1e3, "grand": 1e3, "lakh": 1e5, "million": 1e6, "mil": 1e6, "m": 1e6, "mn": 1e6,
          "billion": 1e9, "bn": 1e9, "b": 1e9}
CURRENCY = (r"s\$|us\$|a\$|hk\$|nz\$|c\$|rm|\$|€|£|¥|₹|sgd|usd|aud|eur|gbp|myr|hkd|idr|inr|jpy|cny|rmb|"
            r"dollars?|bucks|euros?|pounds?|ringgit|rupees?|yen|yuan")
PERIOD = (r"(?:a|per|each|every|/)\s*(?:month|mth|mo|year|yr|annum|week|day)s?|monthly|yearly|annually|"
          r"p\.?\s?a\.?|p/a|pm|in revenue|revenue|of revenue|turnover|sales")
HEDGE = (r"about|around|approximately|approx\.?|roughly|circa|ca\.|estimated|est\.?|expected|projected|"
         r"maybe|probably|likely|over|under|above|below|up to|less than|more than|at least|nearly|almost|"
         r"close to|~|>|<|\+")
NUM_TOKEN = re.compile(r"^(\d[\d,]*(?:\.\d+)?|\.\d+)(k|m|mn|mil|b|bn)?$")


def words_to_number(text):
    """'five thousand' -> 5000.0, 'two hundred and fifty k' -> 250000.0, '1.5 million' -> 1500000.0.
    Returns None unless every token is part of a number."""
    text = re.sub(r"(?<=\d),(?=\d{3})", "", text.lower())
    toks = [t for t in re.split(r"[\s\-]+", text.replace(",", " , ").strip()) if t]
    total, current, seen, i = 0.0, 0.0, False, 0
    while i < len(toks):
        t, nxt = toks[i], toks[i + 1] if i + 1 < len(toks) else None
        i += 1
        if t in ("and", ",", "&"):
            continue
        m = NUM_TOKEN.match(t)
        if t == "half" and nxt in ("a", "an"):
            current += 0.5
            i += 1
            continue
        if t in ("a", "an") and nxt:
            current += 1
            continue
        if t in SMALL:
            current += SMALL[t]
        elif t == "hundred":
            current = (current or 1) * 100
        elif t in SCALES and (seen or current or t in ("thousand", "million", "billion", "lakh")):
            total += (current or 1) * SCALES[t]
            current = 0
        elif m:
            val = float(m.group(1).replace(",", ""))
            if m.group(2):
                total += (current + val) * SCALES[m.group(2)]
                current = 0
            else:
                current += val
        else:
            return None
        seen = True
    return total + current if seen else None


def parse_amount(value):
    """Return the amount a revenue answer means, or None. Ranges return the lower bound."""
    v = " " + value.lower().strip() + " "
    v = re.sub(r"(\d)\s*(k|m|mn|mil|bn|b)\b", r"\1\2", v)
    for pat in (PERIOD, HEDGE, CURRENCY):
        v = re.sub(r"(?<![a-z])(?:" + pat + r")(?![a-z])", " ", v)
    v = re.sub(r"\s+", " ", v).strip(" .!?;:")
    if not v:
        return None
    parts = re.split(r"\s*(?:-|–|—|to)\s*(?=[\d.a-z])", v) if re.search(r"\d|[a-z]", v) else [v]
    nums = [words_to_number(p) for p in parts if p.strip()]
    if not nums or any(n is None for n in nums):
        return None
    return nums[0]


# ---------- per-field checks ----------
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")
URL_RE = re.compile(r"^(?:https?://)?(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?::\d{2,5})?"
                    r"(?:[/?#]\S*)?$", re.I)
PHONE_RE = re.compile(r"^\+?[\d\s\-().]+$")


def _issue(key, v):
    """Return a short reason string, or None if fine."""
    what = WHAT.get(key, "a valid value")
    if len(v) > LIMITS.get(key, 2000):
        return f"That's too long for {what}."
    if key in ("business_name", "contact_name", "business_type", "industry", "title_position"):
        if _letters(v) == 0:
            return f"That doesn't look like {what}. It needs letters, not just numbers or symbols."
        if len(v) < 2:
            return f"That's too short for {what}."
        if key == "contact_name" and (re.search(r"\d|@", v) or not re.fullmatch(r"[^\W\d_][\w .,'’()-]*", v)):
            return "That doesn't look like a person's name. Use letters only."
        if key != "business_name" and _letters(v) * 2 < len(re.sub(r"\s", "", v)):
            return f"That doesn't look like {what}. It's mostly numbers or symbols."
        if key != "business_name" and _word_issue(v, need_real=False):
            return f"That doesn't look like {what}. It should be real words."
        return None
    if key == "email":
        return None if EMAIL_RE.match(v) and ".." not in v else "That doesn't look like a valid email address."
    if key == "phone_number":
        if not PHONE_RE.match(v):
            return "That doesn't look like a phone number. Use digits, with optional +, spaces, dashes or brackets."
        n = len(re.sub(r"\D", "", v))
        if n < 7:
            return "That phone number is too short. It needs 7 to 15 digits."
        if n > 15:
            return "That phone number is too long. It needs 7 to 15 digits."
        return None
    if key == "business_website":
        return None if URL_RE.match(v) else "That doesn't look like a website address."
    if key == "expected_annual_revenue":
        n = parse_amount(v)
        if n is None or n < 0:
            return "That doesn't look like a revenue figure. It should be an amount, in digits or words."
        return None
    if key in ("design_preferences", "requirements_notes"):
        w = _word_issue(v)
        if w:
            return f"That doesn't look like {what}. Please describe it in words."
        return None
    return None


def check(key, value):
    """None if the value makes sense for this field, else {message, example}."""
    v = str(value).strip()
    if not v:
        return None
    msg = _issue(key, v)
    return {"message": msg, "example": example_text(key)} if msg else None


FIX_HEADER = "A few details need fixing:"


def _clip(v, n=40):
    v = " ".join(str(v).split())
    return v if len(v) <= n else v[:n - 1].rstrip() + "…"


def fix_line(key, label, value, problem):
    """One short chat line for an invalid value: Business type: "123" isn't a business type (e.g. Café)."""
    ex = (EXAMPLES.get(key) or [""])[0]
    eg = f" (e.g. {ex})" if ex else ""
    if problem and problem.get("message", "").startswith("That's too long"):
        return f"{label}: too long (max {LIMITS.get(key, 2000)} characters)."
    return f'{label}: "{_clip(value)}" isn\'t {WHAT.get(key, "a valid value")}{eg}.'


def missing_line(label):
    return f"{label}: missing."


def fix_message(lines):
    """One line on its own; several under a short header."""
    return lines[0] if len(lines) == 1 else "\n".join([FIX_HEADER, *lines])
