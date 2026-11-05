// One Listen button per client-chat bot message. Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "..", "src", "App.tsx"), "utf8");
const picker = readFileSync(join(here, "..", "src", "looks", "LooksPicker.tsx"), "utf8");

let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));

// App renders one message-level Listen per chat bubble (welcome branch and
// standard branch) plus one for the accepted popup. All read the shown
// (translated on language switch) text.
const appListens = [...app.matchAll(/<ListenButton\b[^>]*>/g)].map((m) => m[0]);
pass("App has two bubble Listens plus the popup Listen", appListens.length === 3);
const bubbleListens = appListens.filter((s) => /text=\{m\.text\}/.test(s));
pass("both bubbles read the shown message text", bubbleListens.length === 2);
pass("bubbles keyed per message", bubbleListens.every((s) => /id=\{"msg-" \+ m\.id\}/.test(s)));
const popupListens = appListens.filter((s) => /acceptedMsg/.test(s));
pass("popup reads the accepted text", popupListens.length === 1 && /text=\{acceptedMsg\.text\}/.test(popupListens[0]));

// The look picker adds no second Listen and no duplicate question line;
// the message's own Listen covers the reply.
pass("picker renders no ListenButton", !/ListenButton/.test(picker));
pass("picker has no duplicate prompt line", !/looks-prompt/.test(picker));
pass("picker keeps an accessible name", /aria-label=\{prompt\}/.test(picker));
// No layout or colour change otherwise: round line, option grid, actions stay.
pass("picker keeps round line", /looks-round/.test(picker));
pass("picker keeps option grid", /look-grid/.test(picker));
pass("picker keeps actions", /look-actions/.test(picker));

// Consult and confirm cards add no message-level Listen of their own.
const consultAt = app.indexOf("consult-note");
pass("consult note block found", consultAt !== -1);
pass("consult note adds no Listen", !/ListenButton/.test(app.slice(Math.max(0, consultAt - 500), consultAt + 200)));
const confirmAt = app.indexOf("<ConfirmDetails");
pass("confirm card use found", confirmAt !== -1);
pass("confirm card adds no Listen", !/ListenButton/.test(app.slice(confirmAt, confirmAt + 600)));

console.log(`listen-once: ${n} checks passed`);
