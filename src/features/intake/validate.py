"""Sense checks for the 11 onboarding fields. One place for PDF, form, chat and resume-link values.

check(key, value) -> None when the value makes sense, else {"message", "example"}.
"""
import re

# ---------- examples shown when a value is rejected ----------
EXAMPLES = {
    "business_name": ["Slice & Stone Pizzeria Pte Ltd"],
    "business_type": ["Restaurant"],
    "industry": ["Food and Beverage"],
    "business_website": ["slicestone.sg"],
    "contact_name": ["Tan Mei Ling"],
    "title_position": ["Owner"],
    "email": ["name@business.com"],
    "phone_number": ["+65 6123 4567"],
    "design_preferences": ["warm and rustic"],
    "expected_annual_revenue": ["S$250,000"],
    "requirements_notes": ["A post for our new truffle pizza"],
}
WHAT = {
    "business_name": "a business name", "business_type": "a business type", "industry": "an industry",
    "business_website": "a website address", "contact_name": "a person's name",
    "title_position": "a job title", "email": "an email address", "phone_number": "a phone number",
    "design_preferences": "a design preference", "expected_annual_revenue": "an amount",
    "requirements_notes": "a description of what you need",
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


def works(key):
    """'Something like "Restaurant" works.'"""
    ex = (EXAMPLES.get(key) or [""])[0]
    return f'Something like "{ex}" works.' if ex else ""


def too_long(key):
    return f"that's a bit long. Please keep it under {LIMITS.get(key, 2000)} characters."


def _issue(key, v):
    """Return a short, friendly reason, or None if fine. (Checks unchanged; only the wording is short.)"""
    what = WHAT.get(key, "a valid value")
    eg = works(key)
    nope = f"That isn't {what}. {eg}"
    if len(v) > LIMITS.get(key, 2000):
        return "T" + too_long(key)[1:]
    if key in ("business_name", "contact_name", "business_type", "industry", "title_position"):
        if _letters(v) == 0:
            return nope
        if len(v) < 2:
            return f"That's a bit short for {what}. {eg}"
        if key == "contact_name" and (re.search(r"\d|@", v) or not re.fullmatch(r"[^\W\d_][\w .,'’()-]*", v)):
            return nope
        if key != "business_name" and _letters(v) * 2 < len(re.sub(r"\s", "", v)):
            return nope
        if key != "business_name" and _word_issue(v, need_real=False):
            return nope
        return None
    if key == "email":
        return None if EMAIL_RE.match(v) and ".." not in v else nope
    if key == "phone_number":
        if not PHONE_RE.match(v):
            return nope
        n = len(re.sub(r"\D", "", v))
        if n < 7 or n > 15:
            return f"A phone number needs 7 to 15 digits. {eg}"
        return None
    if key == "business_website":
        return None if URL_RE.match(v) else nope
    if key == "expected_annual_revenue":
        n = parse_amount(v)
        if n is None or n < 0:
            return nope
        return None
    if key in ("design_preferences", "requirements_notes"):
        w = _word_issue(v)
        if w:
            return f"That doesn't read like {what}. {eg}"
        return None
    return None


def check(key, value):
    """None if the value makes sense for this field, else {message, example}."""
    v = str(value).strip()
    if not v:
        return None
    msg = _issue(key, v)
    return {"message": msg, "example": example_text(key)} if msg else None


COUNT = {1: "one fix", 2: "two fixes", 3: "three fixes", 4: "four fixes", 5: "five fixes"}


def _clip(v, n=40):
    v = " ".join(str(v).split())
    return v if len(v) <= n else v[:n - 1].rstrip() + "…"


def fix_line(key, label, value, problem):
    """• Business type: "123" isn't a business type. Something like "Restaurant" works."""
    if len(str(value).strip()) > LIMITS.get(key, 2000):
        return f"• {label}: {too_long(key)}"
    return f'• {label}: "{_clip(value)}" isn\'t {WHAT.get(key, "a valid value")}. {works(key)}'.rstrip()


def missing_line(key, label):
    return f"• {label}: I couldn't find one. {works(key)}".rstrip()


def fix_message(lines):
    """I just need two fixes:\n\n• ...\n• ...\n\nJust type the corrections here."""
    n = len(lines)
    head = f"I just need {COUNT.get(n, 'a few fixes')}:"
    tail = "Just type the correction here." if n == 1 else "Just type the corrections here."
    return head + "\n\n" + "\n".join(lines) + "\n\n" + tail
