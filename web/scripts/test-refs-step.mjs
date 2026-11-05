// Reference-images step: no text box, only upload or empty-send-to-skip. Run: npm test
// The step is keyed on the refsStep reply flag (not status alone), so the plain
// need_direction step that asks for a design direction keeps its text input.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "src", "App.tsx"), "utf8");
const types = readFileSync(join(here, "..", "src", "types.ts"), "utf8");
const i18n = Object.fromEntries(
  ["en", "ms", "zh", "ta"].map((l) => [l, readFileSync(join(here, "..", "src", "i18n", `${l}.ts`), "utf8")]),
);

let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));

// The reply flag reaches the UI: stored from the chat reply and typed on the contract.
pass("reply flag stored", /refsStep:\s*r\.refsStep === true/.test(src));
pass("reply flag typed", /refsStep\?: boolean/.test(types));

// The refs step is the flag, not status alone (status alone would also match the
// plain direction step, which must keep its text box).
pass("not keyed on status alone", !/const refsStep = status === "need_direction";/.test(src));
pass("refs step keyed on flag", /lastBot\.refsStep === true/.test(src) && /status === "need_direction" &&/.test(src));

// No text box on that step: the textarea only renders off the refs step.
pass("textarea dropped on refs step", /!refsStep && \(\s*<textarea/.test(src));

// Voice input feeds the text box, so it is hidden there too.
pass("mic hidden on refs step", /hidden=\{!micSupported \|\| refsStep\}/.test(src));

// Empty send on that step takes the existing skip path (same as typing "skip").
pass("empty send skips on refs step", /if \(!refsStep\) return;/.test(src) && /client\.chat\("skip"\)/.test(src));

// The send arrow stays enabled when empty (not gated on text or files).
pass("send arrow enabled when empty", /id="sendBtn"[\s\S]{0,300}disabled=\{busy \|\| !client \|\| closed\}/.test(src) || /disabled=\{busy \|\| !client \|\| closed\}[\s\S]{0,300}id="sendBtn"/.test(src));

// The paperclip upload stays on the refs step.
pass("attach kept on refs step", /id="attachBtn"/.test(src));

// Every other step keeps its text input exactly the same.
pass("textarea kept for other steps", /<textarea/.test(src) && /id="textInput"/.test(src));
pass(
  "composer hint has no feedback mode",
  /placeholder=\{closed \? t\(lang, "linkClosed"\) : t\(lang, "typeMessage"\)\}/.test(src),
);

// Mock/i18n refs text no longer says type skip: it says press the arrow to skip.
const gotRefs = (text) => text.split("\n").filter((line) => line.includes("mock.gotRefs"));
pass("en refs says arrow", gotRefs(i18n.en).some((l) => /press the arrow to skip/.test(l)));
pass("ms refs says arrow", gotRefs(i18n.ms).some((l) => /anak panah/.test(l)));
pass("zh refs says arrow", gotRefs(i18n.zh).some((l) => /按箭头跳过/.test(l)));
pass("ta refs says arrow", gotRefs(i18n.ta).some((l) => /அம்புக்குறி/.test(l)));
for (const [lang, text] of Object.entries(i18n)) {
  pass(`${lang} refs drops type-skip`, gotRefs(text).every((l) => !/taip|type \\"skip\\"|输入“跳过”|எழுதுங்கள்/.test(l)));
}

// Other steps' wording is untouched: the plain direction question still says type skip.
pass("en direction kept", /mock\.designAsk/.test(i18n.en) && /Or type \\"skip\\"/.test(i18n.en));
pass("ms direction kept", /Atau taip \\"skip\\"/.test(i18n.ms));
pass("zh direction kept", /输入“跳过”/.test(i18n.zh));
pass("ta direction kept", /\\"skip\\" என எழுதுங்கள்/.test(i18n.ta));

console.log(`refs-step: ${n} checks passed`);
