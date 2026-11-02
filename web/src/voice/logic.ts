// Pure logic for the talk-only onboarding mode. No UI here, only parsing
// and prompt text so the voice flow stays easy to test.
import { t, type Lang } from "../i18n/index";

/** Questions the client answers out loud, one at a time, in order. */
export interface VoiceStep {
  field: "business_name" | "contact_name" | "email" | "design_preferences";
  key: "voice.q.business_name" | "voice.q.contact_name" | "voice.q.email" | "voice.q.design_preferences";
  /** Only the last step may be answered with "skip". */
  skippable: boolean;
}

export const VOICE_STEPS: VoiceStep[] = [
  { field: "business_name", key: "voice.q.business_name", skippable: false },
  { field: "contact_name", key: "voice.q.contact_name", skippable: false },
  { field: "email", key: "voice.q.email", skippable: false },
  { field: "design_preferences", key: "voice.q.design_preferences", skippable: true },
];

/** Spoken question for one step. */
export function stepQuestion(lang: Lang, step: VoiceStep): string {
  return t(lang, step.key);
}

// Normalise speech text: lower case, punctuation becomes spaces.
function clean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:…"“”'"‘’()，。！？；：、]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const YES_EN = new Set(["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "correct", "right", "agree"]);
const NO_EN = new Set(["no", "nope", "nah", "not", "wrong"]);

const YES_EXTRA: Record<Lang, string[]> = {
  en: [],
  zh: [],
  ms: ["ya", "betul", "boleh"],
  ta: ["ஆம்", "ஆமாம்", "சரி"],
};

const NO_EXTRA: Record<Lang, string[]> = {
  en: [],
  zh: [],
  ms: ["tidak", "bukan", "salah"],
  ta: ["இல்லை", "வேண்டாம்", "தவறு"],
};

/** "yes" | "no" | null. English words work in every language. */
export function parseYesNo(text: string, lang: Lang): "yes" | "no" | null {
  const norm = clean(text);
  if (!norm) return null;
  if (lang === "zh") {
    for (const w of norm.split(" ")) {
      if (YES_EN.has(w)) return "yes";
      if (NO_EN.has(w)) return "no";
    }
    // 没错 means "correct" even though it holds 错; check it before the no words.
    if (norm.includes("没错")) return "yes";
    if (norm.includes("不") || norm.includes("错")) return "no";
    if (norm.includes("可以") || norm.includes("是") || norm.includes("对") || norm.includes("好")) {
      return "yes";
    }
    return null;
  }
  const yes = new Set([...YES_EN, ...YES_EXTRA[lang]]);
  const no = new Set([...NO_EN, ...NO_EXTRA[lang]]);
  // First word that is a yes/no word wins, so "no, yes I mean" hears "yes".
  for (const w of norm.split(" ")) {
    if (yes.has(w)) return "yes";
    if (no.has(w)) return "no";
  }
  return null;
}

const SKIP_EN = ["skip", "next"];
const SKIP_EXTRA: Record<Lang, string[]> = {
  en: [],
  zh: ["跳过"],
  ms: ["langkau"],
  ta: ["தவிர்"],
};

const NUM_WORDS: Record<Lang, string[][]> = {
  en: [],
  zh: [["一"], ["二", "两"], ["三"]],
  ms: [["satu"], ["dua"], ["tiga"]],
  ta: [["ஒன்று"], ["இரண்டு"], ["மூன்று"]],
};

const NUM_EN = [["one", "first"], ["two", "second"], ["three", "third"]];

function latinWord(s: string, w: string): number {
  const m = s.match(new RegExp(`\\b${w}\\b`));
  return m && m.index !== undefined ? m.index : -1;
}

/**
 * 0-based option index, "skip" or null. Numbers above `count` are ignored.
 * English words work in every language.
 */
export function parseLookChoice(text: string, lang: Lang, count: number): number | "skip" | null {
  const norm = clean(text);
  if (!norm || count <= 0) return null;
  type Hit = { pos: number; value: number };
  const hits: Hit[] = [];
  for (const m of norm.matchAll(/\d+/g)) {
    const v = parseInt(m[0], 10) - 1;
    if (v >= 0 && v < count) hits.push({ pos: m.index ?? 0, value: v });
  }
  const langWords = NUM_WORDS[lang];
  const words: string[][] = NUM_EN.map((alts, i) => [...alts, ...(langWords[i] ?? [])]);
  words.forEach((alts, i) => {
    if (i >= count) return;
    for (const w of alts) {
      const pos = /[a-z]/.test(w) ? latinWord(norm, w) : norm.indexOf(w);
      if (pos >= 0) hits.push({ pos, value: i });
    }
  });
  hits.sort((a, b) => a.pos - b.pos);
  if (hits.length > 0) return hits[0].value;
  const skips = [...SKIP_EN, ...SKIP_EXTRA[lang]];
  for (const w of skips) {
    const found = /[a-z]/.test(w) ? latinWord(norm, w) >= 0 : norm.indexOf(w) >= 0;
    if (found) return "skip";
  }
  return null;
}

/**
 * Turns spoken email parts into an address ("jo at shop dot com" -> "jo@shop.com").
 * A typed address with @ is left unchanged.
 */
export function spokenEmail(text: string): string {
  const typed = text.trim();
  if (typed.includes("@") && !/\bat\b/i.test(typed)) return typed;
  const s = typed
    .toLowerCase()
    .replace(/\bunder\s*score\b/g, "_")
    .replace(/\bunderscore\b/g, "_")
    .replace(/\bdash\b/g, "-")
    .replace(/\bhyphen\b/g, "-")
    .replace(/\bat\b/g, "@")
    .replace(/\bdots?\b/g, ".")
    .replace(/\s+/g, "");
  return s.replace(/\.{2,}/g, ".");
}

/** "I heard: {text}. Is that right? Say yes or no." */
export function readBack(lang: Lang, text: string): string {
  return t(lang, "voice.confirm", { text });
}

const NUM_NAMES: Record<Lang, string[]> = {
  en: ["one", "two", "three"],
  zh: ["一", "二", "三"],
  ms: ["satu", "dua", "tiga"],
  ta: ["ஒன்று", "இரண்டு", "மூன்று"],
};

/** One line per look option, then the "say one, two or three" line. */
export function lookLines(lang: Lang, options: { alt: string }[]): string[] {
  const names = NUM_NAMES[lang];
  const lines = options.map((o, i) =>
    t(lang, "voice.option", { n: names[i] ?? String(i + 1), alt: o.alt }),
  );
  lines.push(t(lang, "voice.choose"));
  return lines;
}
