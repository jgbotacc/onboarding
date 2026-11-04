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

// App renders exactly one message-level Listen per assistant message: one in
// the welcome branch, one in the standard branch. Both read the shown
// (translated on language switch) message text.
const appListens = [...app.matchAll(/<ListenButton\b[^>]*>/g)].map((m) => m[0]);
pass("App has exactly two message-level Listens", appListens.length === 2);
pass("both read the shown message text", appListens.every((s) => /text=\{m\.text\}/.test(s)));
pass("both keyed per message", appListens.every((s) => /id=\{"msg-" \+ m\.id\}/.test(s)));

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
