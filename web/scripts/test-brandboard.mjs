// Brand board UI contract: client upload step + staff card, uploads only, no model names. Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));

const panel = read("src/StyleUpload.tsx");
const card = read("src/staff/BrandBoardCard.tsx");
const staffApi = read("src/staff/api.ts");
const staffMock = read("src/staff/mock.ts");
const page = read("src/staff/StaffPage.tsx");
const app = read("src/App.tsx");

// Client step: big plain buttons, photos only, all four languages via i18n keys.
for (const chunk of [panel, app]) {
  pass("brandboard i18n keys used", /brandboard\.title/.test(chunk));
}
pass("no URL input on client step", !/https?:|input.*url|type="url"/i.test(panel));
pass("images only", /\.jpg|image\/jpeg/.test(panel));
pass("big buttons", /btn-big/.test(panel));

// Staff card: photos, swatches + hex, words, summary, edit, approve/reject, masked.
for (const need of ["bb-photo", "bb-chip", "tone_words", "style_words", "summary", "Approve", "Reject", "maskSensitive"]) {
  pass(`staff card has ${need}`, card.includes(need));
}
pass("staff card hex shown", /#[0-9A-Fa-f]{6}|{hex}/.test(card));
pass("card wired to staff api", /board\(|editBoard|decideBoard/.test(card));
pass("staff api has board routes", /brand-board/.test(staffApi));
pass("staff mock has board", /decideBoard/.test(staffMock));

// No model names, costs, or ids on staff pages.
for (const [label, src] of [["page", page], ["card", card]]) {
  pass(`${label} shows no model names`, !/t\.model|{model}/.test(src));
  pass(`${label} has no cost`, !/cost_sgd|S\$/.test(src));
}

console.log(`brandboard: ${n} checks passed`);
