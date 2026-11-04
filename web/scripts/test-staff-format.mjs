// Staff label checks: plain step names and readable local dates. Run: npm test
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));
try {
  const { stepName, formatDate } = await server.ssrLoadModule("/src/staff/format.ts");
  pass("stepName exported", typeof stepName === "function");
  pass("formatDate exported", typeof formatDate === "function");

  // Named plain labels keep their meaning.
  pass("read_document", stepName("read_document") === "Read document");
  pass("image_brief", stepName("image_brief") === "Image brief");
  pass("generate_image", stepName("generate_image") === "Create image");
  pass("translate", stepName("translate") === "Translate");

  // Unknown steps fall back to a tidied raw name, never blank or raw snake_case.
  pass("unknown fallback", stepName("some_new_step") === "Some new step");
  pass("fallback hyphen", stepName("photoshop-export") === "Photoshop export");
  pass("fallback empty", stepName("") === "–");
  pass("fallback blank", stepName("   ") === "–");
  const every = ["read_document", "image_brief", "generate_image", "translate", "some_new_step", ""];
  pass("no underscores leak", every.every((s) => !stepName(s).includes("_")));

  // Readable local date, e.g. "29 Oct, 2:40 pm".
  const d = formatDate("2026-10-29T06:40:00Z");
  pass("date shape", /^\d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} (am|pm)$/.test(d));
  pass("no year", !/\d{4}/.test(d));

  // Bad or empty values show a dash, never "Invalid Date".
  for (const bad of ["", "   ", "not a date", null, undefined, "2026-13-99"]) {
    const out = formatDate(bad);
    pass(`dash for ${JSON.stringify(bad)}`, out === "–" && !/invalid/i.test(out));
  }

  console.log(`staff-format: ${n} checks passed`);
} finally {
  await server.close();
}
