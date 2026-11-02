// A consult reply is text-only: no round images. Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "src", "App.tsx"), "utf8");

let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));

// Stored message drops images/looks when the reply carries consult.
pass("render drops images on consult", /r\.consult\s*\?\s*\[\]\s*:\s*r\.images/.test(src));
pass("render drops looks on consult", /r\.consult\s*\?\s*null\s*:\s*r\.looks/.test(src));

// Display never shows image grids or look options on a consult message.
pass("img-grid gated on no consult", /!m\.consult\s*&&\s*m\.images\.length/.test(src));
pass("looks gated on no consult", /!m\.consult\s*&&\s*\(m\.looks/.test(src));

console.log(`consult-text-only: ${n} checks passed`);
