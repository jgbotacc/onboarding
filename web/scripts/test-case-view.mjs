// Case view derivation + mock coverage. Run: npm test
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
  const { buildCase, maskSensitive, actorRole, STAGES } = await server.ssrLoadModule("/src/staff/caseView.ts");
  const { createStaffMock } = await server.ssrLoadModule("/src/staff/mock.ts");

  pass("six stages, no brand board or share link", STAGES.length === 6 &&
    STAGES.map((s) => s.id).join(",") === "intake,reading,brief,drafts,approval,done");

  const m = createStaffMock();
  for (const id of ["c-kopi01", "c-bloom02", "c-forge03"]) {
    const d = await m.detail(id);
    pass(`${id} has case view inputs`, Array.isArray(d.transcript) && Array.isArray(d.audit) &&
      !!d.documents && Array.isArray(d.looks) && "consult" in d && Array.isArray(d.traces));
  }

  const bloom = await m.detail("c-bloom02");
  const studio = await m.studio("c-bloom02");
  const c = buildCase(bloom, studio.drafts);
  pass("bloom current stage is brief", c.stages.find((s) => s.id === "brief").status === "waiting");
  pass("bloom later lanes queued", ["drafts", "approval", "done"].every((id) => c.stages.find((s) => s.id === id).status === "queued"));
  pass("bloom steps chronological", c.steps.every((s, i, a) => i === 0 || (a[i - 1].at || "") <= (s.at || "")));
  pass("bloom latest waits on client", c.steps[c.steps.length - 1].waiting === true &&
    c.steps[c.steps.length - 1].waitingOn === "client");
  pass("bloom consult step in brief lane", c.stages.find((s) => s.id === "brief").steps.some((s) => s.id === "consult"));
  pass("bloom audit attached", c.steps.some((s) => s.audit.length > 0));
  pass("bloom docs steps", c.stages.find((s) => s.id === "reading").steps.length >= 2);

  const kopi = await m.detail("c-kopi01");
  const k = buildCase(kopi, []);
  pass("kopi done lane filled", k.stages.find((s) => s.id === "done").steps.length === 1);
  pass("kopi current is done step", k.currentStepId === "done");

  pass("maskSensitive hides NRIC", maskSensitive("S1234567A Tan") === "••••••• Tan");
  pass("actorRole hides team names", actorRole("staff:mei") === "Staff" && actorRole("client") === "Client" &&
    actorRole("system") === "System");
} finally {
  await server.close();
}
console.log(`case-view mock OK (${n} checks)`);
