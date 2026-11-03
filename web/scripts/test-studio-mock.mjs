// Staff studio mock checks (no story_size chip, distinct draft titles per run). Run: npm test
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
  const { createStaffMock } = await server.ssrLoadModule("/src/staff/mock.ts");
  pass("createStaffMock exported", typeof createStaffMock === "function");

  const m = createStaffMock();
  const g = await m.studio("c-kopi01");
  pass("chips exclude story_size", !g.chips.some((c) => c.id === "story_size"));
  pass("five chips", g.chips.length === 5);

  // Every run yields 3 drafts with distinct style titles, unknown chips dropped.
  for (let run = 0; run < 3; run++) {
    const r = await m.generateDrafts("c-kopi01", { chips: ["story_size", "nope", "festive"], preset: "post" });
    pass(`run ${run} three drafts`, r.drafts.length === 3);
    const titles = r.drafts.map((d) => d.style_title);
    pass(`run ${run} distinct titles`, new Set(titles).size === 3);
    pass(`run ${run} unknown chips dropped`, r.drafts.every((d) => !d.chips.includes("story_size") && !d.chips.includes("nope")));
  }

  console.log(`studio-mock: ${n} checks passed`);
} finally {
  await server.close();
}
