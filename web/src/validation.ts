// [field-validation] Instant client-side sense checks for the registration form.
// Mirrors the server rules for obvious cases only; the server's `invalid` list always wins.
import type { FieldIssue, FormFields } from "./types";

export type { FieldIssue };
export type FieldKey = keyof FormFields;

const NUM_WORDS: Record<string, number> = {};
"zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen"
  .split(" ")
  .forEach((w, i) => (NUM_WORDS[w] = i));
"twenty thirty forty fifty sixty seventy eighty ninety".split(" ").forEach((w, i) => (NUM_WORDS[w] = 10 * (i + 2)));
const SCALES: Record<string, number> = {
  thousand: 1e3, k: 1e3, grand: 1e3, million: 1e6, mil: 1e6, mln: 1e6, m: 1e6, billion: 1e9, bn: 1e9, b: 1e9,
};
const FILLER = new Set(
  ("and a an about around approximately approx roughly maybe estimated est over under more less than up to per year years annum " +
    "annually yearly pa yr month monthly a-year dollars dollar bucks sgd usd myr rm eur euro euros gbp pounds aud singapore us s$ us$ $ € £ ~ - – / to")
    .split(" "),
);

/** "five thousand dollars" -> 5000, "about two million" -> 2000000, "$5k" -> 5000, "1.2m" -> 1200000.
 *  For ranges ("100k-200k") returns the first amount. Null when the text isn't an amount. */
export function parseAmount(text: string): number | null {
  const t = text
    .toLowerCase()
    .replace(/\b(?:s|us|a|au|nz|hk)\$/g, " $ ")
    .replace(/(\d),(?=\d{3})/g, "$1")
    .replace(/(\d)\s*(k|m|mil|mln|bn|b)\b/g, "$1 $2")
    .replace(/[~–]/g, " ")
    .replace(/([$€£])/g, " $1 ");
  const tokens = t.match(/s\$|us\$|[$€£]|\d+(?:\.\d+)?|[a-z]+(?:\.[a-z]+)*\.?|[-/]/g);
  if (!tokens) return null;
  let total = 0;
  let cur = 0;
  let seen = false;
  let real = false; // a digit, number word or full scale word ("a million"), not just "k"
  let first: number | null = null;
  const flush = () => {
    if (seen && first === null) first = total + cur;
  };
  for (const tok of tokens) {
    const w = tok.replace(/\.$/, "");
    if (/^\d/.test(w)) {
      if (seen && cur && !total) {
        // Second number after a complete one ("100k 200k") – treat as range end.
        flush();
        break;
      }
      cur += parseFloat(w);
      seen = real = true;
    } else if (w in NUM_WORDS) {
      cur += NUM_WORDS[w];
      seen = real = true;
    } else if (w === "hundred") {
      cur = (cur || 1) * 100;
      seen = real = true;
    } else if (w in SCALES) {
      total += (cur || 1) * SCALES[w];
      cur = 0;
      seen = true;
      if (w.length > 3) real = true;
    } else if (w === "-" || w === "to") {
      if (seen) {
        flush();
        break;
      }
    } else if (FILLER.has(w) || w === "p.a" || w === "pa") {
      continue;
    } else return null;
  }
  flush();
  return real && first !== null && first > 0 ? first : null;
}

const letters = (v: string) => (v.match(/\p{L}/gu) || []).length;
// Latin words of 5+ letters with no vowel ("zxcvb", "sdfgh") are keyboard mashing.
const hasVowelWord = (v: string) => !(v.match(/[a-z]{5,}/gi) || []).some((w) => !/[aeiouy]/i.test(w));
const junk = (v: string) => /^(.)\1{3,}$/i.test(v.replace(/\s/g, "")) || /^(asdf|qwer|test|xxx|n\/?a|none|null|nil|idk|-+)$/i.test(v);

function wordy(v: string, lo: number, hi: number): boolean {
  if (v.length < lo || v.length > hi) return false;
  if (/^[\d\W_]+$/u.test(v)) return false;
  if (letters(v) < 2 || !hasVowelWord(v) || junk(v)) return false;
  // Mostly letters: digits/symbols shouldn't outnumber letters.
  return letters(v) >= v.replace(/\s/g, "").length / 2;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const WEBSITE_RE = /^(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;

interface Rule {
  ok: (v: string) => boolean;
  message: string;
  example: string;
}

export const RULES: Record<FieldKey, Rule> = {
  business_name: {
    ok: (v) => v.length >= 2 && v.length <= 100 && letters(v) >= 1 && !/^[\d\W_]+$/u.test(v) && !junk(v),
    message: "That doesn't look like a business name. Please use your registered or trading name.",
    example: "Kopi Corner Pte Ltd",
  },
  business_type: {
    ok: (v) => wordy(v, 2, 60),
    message: "That doesn't look like a business type. Describe what kind of business it is in a word or two.",
    example: "Cafe, retail shop or IT consultancy",
  },
  industry: {
    ok: (v) => wordy(v, 2, 60),
    message: "That doesn't look like an industry. Use a word or two for your sector.",
    example: "Food & Beverage or Healthcare",
  },
  business_website: {
    ok: (v) => WEBSITE_RE.test(v),
    message: "That doesn't look like a website address. Include the domain ending, like .com or .sg.",
    example: "kopicorner.sg or https://www.kopicorner.sg",
  },
  contact_name: {
    ok: (v) => v.length >= 2 && v.length <= 80 && letters(v) >= 2 && !/\d/.test(v) && !junk(v),
    message: "That doesn't look like a person's name. Please use letters only.",
    example: "Tan Ah Hock",
  },
  title_position: {
    ok: (v) => wordy(v, 2, 60),
    message: "That doesn't look like a job title.",
    example: "Owner or Marketing Manager",
  },
  email: {
    ok: (v) => EMAIL_RE.test(v),
    message: "That doesn't look like an email address.",
    example: "hello@kopicorner.sg",
  },
  phone_number: {
    ok: (v) => !/[^\d+\s\-().]/.test(v) && /^\d{7,15}$/.test(v.replace(/[+\s\-().]/g, "")),
    message: "That doesn't look like a phone number. Use 7 to 15 digits, with an optional country code.",
    example: "+65 6123 4567",
  },
  design_preferences: {
    ok: (v) => letters(v) >= 3 && hasVowelWord(v) && !junk(v),
    message: "Please describe the look you'd like in a few words.",
    example: "warm retro kopitiam style, brown and cream colours",
  },
  expected_annual_revenue: {
    ok: (v) => parseAmount(v) !== null,
    message: "That doesn't look like an amount. Try a number or write it out in words.",
    example: "$120,000, about 120k or five thousand dollars",
  },
  requirements_notes: {
    ok: (v) => letters(v) >= 2,
    message: "Please write your notes in words.",
    example: "Instagram posts for our new branch opening",
  },
};

/** Null when the value is fine (empty optional fields are fine). */
export function validateField(key: FieldKey, raw: string, label = "", required = false): FieldIssue | null {
  const v = (raw || "").trim();
  if (!v) return required ? { field: key, label, message: `${label || "This field"} is required.`, example: RULES[key]?.example } : null;
  const r = RULES[key];
  if (!r || r.ok(v)) return null;
  return { field: key, label, message: r.message, example: r.example };
}
