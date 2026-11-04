// History re-translation on language switch. Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const appSrc = readFileSync(join(root, "src", "App.tsx"), "utf8");

// Minimal browser globals used by src/mock.ts.
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => void storage.set(k, String(v)),
  removeItem: (k) => void storage.delete(k),
};
globalThis.document = { documentElement: { lang: "en" } };

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));
try {
  const { pendingSources, seedTranslation, swapMessages } = await server.ssrLoadModule("/src/retranslate.ts");
  const { createMock } = await server.ssrLoadModule("/src/mock.ts");
  const { t } = await server.ssrLoadModule("/src/i18n/index.ts");

  // Mock: translate returns a tagged copy so the eye can see it worked.
  storage.set("onboardingLang", "en");
  const mock = createMock();
  pass("mock has translate", typeof mock.translate === "function");
  const tagged = await mock.translate(["Hello there"], "zh");
  pass("mock translate lang", tagged.lang === "zh");
  pass("mock translate tagged copy", tagged.texts.length === 1 && tagged.texts[0].includes("Hello there") && tagged.texts[0].includes("zh"));

  // App keeps each assistant message's source and re-translates on picker change.
  pass("Msg stores source", /source\?: string/.test(appSrc));
  pass("Msg stores i18nKey", /i18nKey\?: "(greeting|welcomeBack)"|"greeting" \| "welcomeBack"/.test(appSrc));
  pass("render keeps source", /source:\s*source \|\| undefined/.test(appSrc) || /r\.source \?\? r\.reply/.test(appSrc));
  pass("App seeds cache on reply", /seedTranslation\(transCache\.current/.test(appSrc));
  pass("picker switch calls client.translate", /client\s*\n?\s*\.translate\(needed,\s*lang\)/.test(appSrc));
  pass("switch uses in-memory source+lang cache", /transCache\s*=\s*useRef\(new Map<string,\s*string>\(\)\)/.test(appSrc));
  pass("built-ins re-render from i18n", /i18nKey/.test(appSrc) && /renderBuiltin/.test(appSrc));
  pass("uncached only, one call", /pendingSources\(messagesRef\.current,\s*lang,\s*transCache\.current\)/.test(appSrc));
  pass("failure keeps text", /\.catch\(\(\) => \{\s*\/\* keep the text on screen \*\//.test(appSrc));
  // Translating note: shown while a language switch re-translates history.
  pass("translating state", /const \[translating, setTranslating\] = useState\(false\)/.test(appSrc));
  pass("note shows on start", /setTranslating\(true\)[\s\S]*?\.translate\(needed,\s*lang\)/.test(appSrc));
  pass("note hides on success", /\.then\(\(res\) => \{[\s\S]*?setTranslating\(false\)/.test(appSrc));
  pass("note hides on failure", /\.catch\(\(\) => \{[\s\S]*?setTranslating\(false\)/.test(appSrc));
  pass("note renders in target language", /translating && \([\s\S]*?t\(lang, "translating"\)/.test(appSrc));
  pass("note is polite live region", /translating && \([\s\S]*?aria-live="polite"[\s\S]*?t\(lang, "translating"\)/.test(appSrc));
  pass("note reuses existing style", /translating && \([\s\S]*?className="hint"/.test(appSrc));
  for (const l of ["en", "zh", "ms", "ta"]) pass(`translating string (${l})`, typeof t(l, "translating") === "string" && t(l, "translating").trim() !== "" && t(l, "translating") !== "translating");
  pass("translating string per language", new Set(["en", "zh", "ms", "ta"].map((l) => t(l, "translating"))).size === 4);
  // Listen reads the shown (translated) text: both buttons pass the message text.
  const listenUses = [...appSrc.matchAll(/<ListenButton[^>]*text=\{([^}]+)\}/g)].map((m) => m[1].trim());
  pass("ListenButton reads message text", listenUses.length >= 2 && listenUses.every((t0) => t0 === "m.text"));

  // Switching translates prior assistant messages; client messages never change.
  const history = () => ([
    { role: "assistant", text: "Hi! Let's get you set up.", i18nKey: "greeting" },
    { role: "user", text: "Hello" },
    { role: "assistant", text: "What style do you like?", source: "What style do you like?" },
    { role: "error", text: "boom" },
  ]);
  const cache = new Map();
  const zhBuiltin = (k) => t("zh", k);
  // Seed like render() does: creation lang en.
  seedTranslation(cache, "What style do you like?", "en", "What style do you like?");
  const calls = [];
  const fakeClient = {
    translate: async (texts, lang) => {
      calls.push({ texts: texts.slice(), lang });
      return { lang, texts: texts.map((s) => `[${lang}] ${s}`) };
    },
  };
  // Switch to zh: one call for all uncached sources, in order.
  let needed = pendingSources(history(), "zh", cache);
  pass("one call for all uncached", JSON.stringify(needed) === JSON.stringify(["What style do you like?"]));
  const fetched = new Map();
  const res = await fakeClient.translate(needed, "zh");
  needed.forEach((s, i) => fetched.set(s, res.texts[i]));
  const zhShown = swapMessages(history(), "zh", cache, fetched, zhBuiltin);
  pass("assistant server line translated", zhShown[2].text === "[zh] What style do you like?");
  pass("built-in re-rendered from i18n", zhShown[0].text === t("zh", "greeting"));
  pass("client message untouched", zhShown[1].text === "Hello");
  pass("error untouched", zhShown[3].text === "boom");
  pass("only one translate call", calls.length === 1);

  // Switching back to a seen language hits the cache: no second call.
  pass("back to en needs nothing", pendingSources(zhShown, "en", cache).length === 0);
  const enShown = swapMessages(zhShown, "en", cache, new Map(), (k) => t("en", k));
  pass("back to en restores source text", enShown[2].text === "What style do you like?");
  pass("no second call on switch back", calls.length === 1);

  // Duplicate sources translate once.
  const dupes = [
    { role: "assistant", text: "Same", source: "Same" },
    { role: "assistant", text: "Same", source: "Same" },
  ];
  pass("duplicate sources one entry", JSON.stringify(pendingSources(dupes, "ms", new Map())) === JSON.stringify(["Same"]));

  // Failure keeps the original text on screen.
  const failing = { translate: async () => { throw new Error("down"); } };
  const before = [{ role: "assistant", text: "Keep me", source: "Keep me" }];
  let after = before;
  try {
    await failing.translate(["Keep me"], "ta");
  } catch {
    after = swapMessages(before, "ta", new Map(), new Map(), (k) => t("ta", k));
  }
  pass("failure keeps original", after[0].text === "Keep me");

  // Listen gets the translated text: the swapped text is what the button receives.
  pass("Listen text is the shown text", zhShown[2].text.includes("[zh]"));

  console.log(`retranslate: ${n} checks passed`);
} finally {
  await server.close();
}
