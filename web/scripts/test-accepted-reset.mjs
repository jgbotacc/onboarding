// Closing the final accepted popup starts a fresh session: stored session id is
// dropped, no server delete/close call runs, and the app reloads into the
// first-visit upload step. Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const app = readFileSync(join(root, "src", "App.tsx"), "utf8");
const apiSrc = readFileSync(join(root, "src", "api.ts"), "utf8");

// Minimal browser storage for the api module (session keys + kept language).
const session = new Map([
  ["onboardingSessionId", "s123"],
  ["onboardingSessionSecret", "sec456"],
]);
const local = new Map([["onboardingLang", "zh"]]);
const backing = (m) => ({
  getItem: (k) => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => void m.set(k, String(v)),
  removeItem: (k) => void m.delete(k),
});
globalThis.sessionStorage = backing(session);
globalThis.localStorage = backing(local);

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));
try {
  // The helper exists and really drops both stored session keys.
  const api = await server.ssrLoadModule("/src/api.ts");
  pass("clearClientSession exported", typeof api.clearClientSession === "function");
  const helperAt = apiSrc.indexOf("export function clearClientSession");
  pass("helper block found", helperAt !== -1);
  const helperEnd = apiSrc.indexOf("}", helperAt);
  pass("helper end found", helperEnd !== -1);
  const helper = apiSrc.slice(helperAt, helperEnd);
  pass("helper clears the session id key", helper.includes("SESSION_KEY"));
  pass("helper clears the session secret key", helper.includes("SECRET_KEY"));
  pass("helper keeps the language key alone", !helper.includes("LANG_KEY") && !helper.includes("localStorage") && !helper.includes("onboardingLang"));

  session.set("onboardingSessionId", "s123");
  session.set("onboardingSessionSecret", "sec456");
  local.set("onboardingLang", "zh");
  api.clearClientSession();
  pass("closing clears the stored session id", !session.has("onboardingSessionId"));
  pass("closing clears the stored session secret", !session.has("onboardingSessionSecret"));
  pass("closing keeps the chosen language", local.get("onboardingLang") === "zh");

  // The popup close path uses that helper (or drops the key directly).
  const at = app.indexOf("const closeAccepted");
  pass("closeAccepted block found", at !== -1);
  const end = app.indexOf("}, [acceptedMsg]);", at);
  pass("closeAccepted end found", end !== -1);
  const block = app.slice(at, end);
  pass(
    "close drops the stored session",
    block.includes("clearClientSession()") || /removeItem\(["']onboardingSessionId["']\)/.test(block),
  );
  pass("close keeps language storage alone", !/localStorage/.test(block) && !/onboardingLang/.test(block));

  // No server call touches the finished case on close.
  pass("close makes no fetch call", !/fetch\(/.test(block));
  pass("close calls no client API", !/client\./.test(block));
  pass("close hits no /api/ path", !/\/api\//.test(block));
  pass("close uses no delete helper", !/deleteJson/.test(block) && !/removeUpload/.test(block) && !/DELETE/.test(block));

  // Fresh start reuses the first-visit path: drop any one-time resume token,
  // then reload so connect() starts a new session with the greeting.
  pass("close drops the resume query", block.includes('delete("resume")'));
  pass(
    "close reloads into the first-visit init",
    /window\.location\.reload\(\)/.test(block) || /window\.location\.replace\(/.test(block),
  );
  pass("first load starts a session via connect", app.includes("connect()"));
  pass("first visit shows the greeting", app.includes('t(lang, "greeting")'));
  pass("start step offers Upload PDF", app.includes('id="choiceUpload"'));
  pass("start step offers Fill in a form", app.includes('id="choiceForm"'));

  // Both the button and Escape go through that same close path.
  pass("Close button resets", /id="acceptedClose"[\s\S]{0,200}onClick=\{closeAccepted\}/.test(app));
  pass("Escape resets", /e\.key === "Escape"[\s\S]{0,120}closeAccepted\(\)/.test(app));

  // Wired in: the check runs in npm test.
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pass("npm test runs accepted-reset checks", String(pkg.scripts?.test || "").includes("test-accepted-reset"));

  console.log(`accepted-reset: ${n} checks passed`);
} finally {
  await server.close();
}
