// Final accepted message as a popup (not a bubble) + review row with only "Looks good". Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const app = readFileSync(join(root, "src", "App.tsx"), "utf8");
const picker = readFileSync(join(root, "src", "looks", "LooksPicker.tsx"), "utf8");
const css = readFileSync(join(root, "src", "styles.css"), "utf8");

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));
try {
  // The popup is detected from the session status from the API, never matched on English text.
  pass("popup finds the accepted reply by status", /m\.role === "assistant" && m\.status === "accepted"/.test(app));
  pass("no English-text match for the final message", !/Great choice/.test(app) && !/Great, design direction accepted/.test(app));

  // The accepted reply is not shown as a chat bubble as well.
  pass("accepted reply hidden from bubbles", /m\.status === "accepted"\) return null/.test(app));

  // The accepted reply still goes through the normal message path, so it keeps
  // its source and follows the same translation as chat bubbles on switch.
  const renderAt = app.indexOf("const render = useCallback");
  const pushedAt = app.indexOf('push({ role: "assistant"', renderAt);
  pass("render block found", renderAt !== -1 && pushedAt !== -1);
  pass("render pushes every reply incl. accepted", !/accepted/.test(app.slice(renderAt, pushedAt)));
  pass("popup reads the stored (translated) message text", /<MsgText text=\{acceptedMsg\.text\}/.test(app));
  pass("popup renders in the client language", /id="acceptedTitle"[^>]*lang=\{lang\}/.test(app));

  // Popup content: Listen for the final text plus a translated close button.
  const popupAt = app.indexOf('id="acceptedPopup"');
  pass("popup block found", popupAt !== -1);
  const popup = app.slice(popupAt, popupAt + 1200);
  pass("popup keeps Listen", /<ListenButton[^>]*text=\{acceptedMsg\.text\}/.test(popup));
  pass("popup close button is translated", popup.includes('t(lang, "close")'));

  // Popup access: dialog semantics, focus moves in, Escape closes.
  pass("popup role dialog", /role="dialog"/.test(popup));
  pass("popup aria-modal", /aria-modal="true"/.test(popup));
  pass("focus moves into the popup", /acceptedCloseRef\.current\?\.focus\(\)/.test(app));
  pass("Escape closes the popup", /e\.key === "Escape"[\s\S]{0,120}closeAccepted\(\)/.test(app));

  // Close label exists and is translated in every language.
  const en = (await server.ssrLoadModule("/src/i18n/en.ts")).default;
  const zh = (await server.ssrLoadModule("/src/i18n/zh.ts")).default;
  const ms = (await server.ssrLoadModule("/src/i18n/ms.ts")).default;
  const ta = (await server.ssrLoadModule("/src/i18n/ta.ts")).default;
  pass("en close label", en.close === "Close");
  for (const [name, dict] of [["zh", zh], ["ms", ms], ["ta", ta]]) {
    pass(`${name} close label translated`, typeof dict.close === "string" && dict.close.trim() !== "" && dict.close !== en.close);
  }

  // Popup look: large centred dialog with big, easy-to-read text.
  pass("popup centres its content", /\.accepted-modal\s*\{[^}]*text-align:\s*center/.test(css));
  const px = /\.accepted-text\s*\{[^}]*font-size:\s*([\d.]+)rem/.exec(css)?.[1];
  pass("popup text is big (>= 1.25rem)", Number(px) >= 1.25);

  // Review row: only "Looks good", keeping its accept behaviour.
  pass("review keeps Looks good", app.includes('t(lang, "looksGood")'));
  pass("Looks good still accepts", /client\.review\(true, ""\)/.test(app));
  const reviewAt = app.indexOf('className="review"');
  pass("review block found", reviewAt !== -1);
  const review = app.slice(reviewAt, reviewAt + 600);
  pass("review row has one button", (review.match(/<button/g) || []).length === 1);
  pass("Ask for changes is gone", !/askChanges/.test(app) && !/startFeedback/.test(app) && !/feedbackMode/.test(app));

  // The looks picker keeps both of its buttons untouched.
  pass("picker keeps Use these", picker.includes("looks.useThese"));
  pass("picker keeps Show me new ones / consult", picker.includes("looks.skipNew") && picker.includes("looks.consult"));

  // Unused feedback strings are removed from every language.
  for (const [name, dict] of [["en", en], ["zh", zh], ["ms", ms], ["ta", ta]]) {
    pass(`${name} drops unused feedback strings`, !("askChanges" in dict) && !("feedbackPrompt" in dict) && !("feedbackHint" in dict));
  }

  // Wired in: the check runs in npm test.
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pass("npm test runs accepted-popup checks", String(pkg.scripts?.test || "").includes("test-accepted-popup"));

  console.log(`accepted-popup: ${n} checks passed`);
} finally {
  await server.close();
}
