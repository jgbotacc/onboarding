// Front-end-only checks for src/voice/logic.ts and the voice.* i18n keys. Run: npm test
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
const en = (await server.ssrLoadModule("/src/i18n/en.ts")).default;
const zh = (await server.ssrLoadModule("/src/i18n/zh.ts")).default;
const ms = (await server.ssrLoadModule("/src/i18n/ms.ts")).default;
const ta = (await server.ssrLoadModule("/src/i18n/ta.ts")).default;
const voice = await server.ssrLoadModule("/src/voice/logic.ts");
const { VOICE_STEPS, parseYesNo, parseLookChoice, spokenEmail, readBack, lookLines } = voice;
let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));

try {
  // Steps: four questions in order, only the last one skippable.
  pass("four steps", VOICE_STEPS.length === 4);
  n++;
  assert.deepEqual(
    VOICE_STEPS.map((s) => s.field),
    ["business_name", "contact_name", "email", "design_preferences"],
    "step order",
  );
  pass("only last skippable", VOICE_STEPS.every((s, i) => s.skippable === (i === 3)));
  for (const s of VOICE_STEPS) {
    n++;
    assert.ok(typeof en[s.key] === "string" && en[s.key].length > 0, `${s.key} has text`);
  }

  // Yes/no in every language, plus English everywhere.
  const yesCases = {
    en: ["yes", "Yeah!", "sure", "OK"],
    zh: ["是", "对", "好", "没错", "可以"],
    ms: ["ya", "betul", "boleh"],
    ta: ["ஆம்", "ஆமாம்", "சரி"],
  };
  const noCases = {
    en: ["no", "Nope.", "nah", "wrong"],
    zh: ["不", "不是", "不对", "错"],
    ms: ["tidak", "bukan", "salah"],
    ta: ["இல்லை", "வேண்டாம்", "தவறு"],
  };
  for (const lang of Object.keys(yesCases)) {
    for (const w of yesCases[lang]) {
      n++;
      assert.equal(parseYesNo(w, lang), "yes", `${lang} yes: ${w}`);
    }
    for (const w of noCases[lang]) {
      n++;
      assert.equal(parseYesNo(w, lang), "no", `${lang} no: ${w}`);
    }
    n++;
    assert.equal(parseYesNo("yes", lang), "yes", `${lang} hears English yes`);
    n++;
    assert.equal(parseYesNo("no", lang), "no", `${lang} hears English no`);
    n++;
    assert.equal(parseYesNo("maybe tomorrow", lang), null, `${lang} null on other words`);
  }
  pass("empty is null", parseYesNo("  ", "en") === null);

  // Look choice in every language.
  const numCases = {
    en: [["one", 0], ["two", 1], ["three", 2], ["first", 0], ["second", 1], ["third", 2]],
    zh: [["一", 0], ["二", 1], ["两", 1], ["三", 2], ["第二个", 1]],
    ms: [["satu", 0], ["dua", 1], ["tiga", 2]],
    ta: [["ஒன்று", 0], ["இரண்டு", 1], ["மூன்று", 2]],
  };
  for (const lang of Object.keys(numCases)) {
    for (const [w, want] of numCases[lang]) {
      n++;
      assert.equal(parseLookChoice(w, lang, 3), want, `${lang} picks ${w}`);
    }
    n++;
    assert.equal(parseLookChoice("2", lang, 3), 1, `${lang} hears digit 2`);
    n++;
    assert.equal(parseLookChoice("5", lang, 3), null, `${lang} ignores 5 of 3`);
  }
  const skipCases = { en: ["skip", "next"], zh: ["跳过"], ms: ["langkau"], ta: ["தவிர்"] };
  for (const lang of Object.keys(skipCases)) {
    for (const w of skipCases[lang]) {
      n++;
      assert.equal(parseLookChoice(w, lang, 3), "skip", `${lang} skips on ${w}`);
    }
    n++;
    assert.equal(parseLookChoice("skip", lang, 3), "skip", `${lang} hears English skip`);
    n++;
    assert.equal(parseLookChoice("hmm, let me think", lang, 3), null, `${lang} null on chat`);
  }
  pass("count 2 hides third", parseLookChoice("three", "en", 2) === null);

  // Spoken email.
  n++;
  assert.equal(spokenEmail("jo at shop dot com"), "jo@shop.com", "at/dot");
  n++;
  assert.equal(spokenEmail("jo at shop dot sg"), "jo@shop.sg", "dot sg");
  n++;
  assert.equal(spokenEmail("my name underscore jo dash lee at shop dot com"), "myname_jo-lee@shop.com", "underscore and dash");
  n++;
  assert.equal(spokenEmail("Jo@Shop.com"), "Jo@Shop.com", "typed email unchanged");

  // Read-back and look lines carry the heard text and the alts.
  for (const [name, dict] of [["en", en], ["zh", zh], ["ms", ms], ["ta", ta]]) {
    const lang = name;
    n++;
    assert.ok(readBack(lang, "Acme").includes("Acme"), `${name} readBack keeps text`);
    n++;
    assert.ok(readBack(lang, "Acme") !== dict["voice.confirm"], `${name} readBack fills {text}`);
    const lines = lookLines(lang, [{ alt: "Warm" }, { alt: "Bold" }]);
    n++;
    assert.equal(lines.length, 3, `${name} two options plus choose line`);
    n++;
    assert.ok(lines[0].includes("Warm") && lines[1].includes("Bold"), `${name} look lines keep alts`);
  }
  n++;
  assert.equal(readBack("en", "Acme"), "I heard: Acme. Is that right? Say yes or no.", "en readBack text");
  {
    const lines = lookLines("en", [{ alt: "Warm" }, { alt: "Bold" }, { alt: "Calm" }]);
    n++;
    assert.deepEqual(
      lines,
      ["Option one: Warm.", "Option two: Bold.", "Option three: Calm.", "Say one, two or three, or say skip."],
      "en look lines text",
    );
  }

  // Every voice.* key exists and is non-empty in all four languages.
  const keys = Object.keys(en).filter((k) => k.startsWith("voice."));
  pass("voice.looksIntro exists", keys.includes("voice.looksIntro"));
  for (const [name, dict] of [["zh", zh], ["ms", ms], ["ta", ta]]) {
    n++;
    assert.deepEqual(
      Object.keys(dict).filter((k) => k.startsWith("voice.")).sort(),
      [...keys].sort(),
      `${name} voice keys match en`,
    );
    for (const k of keys) {
      n++;
      assert.ok(typeof dict[k] === "string" && dict[k].trim() !== "", `${name}.${k} missing or empty`);
    }
    const extra = Object.keys(dict).filter((k) => !(k in en));
    n++;
    assert.deepEqual(extra, [], `${name} has extra keys: ${extra.join(", ")}`);
  }

  console.log(`voice: ${n} checks passed`);
} finally {
  await server.close();
}
