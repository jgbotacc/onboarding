// Mismatch flags + document list (?mock=1, PRD 4.9.3.3). Run: npm test
import assert from "node:assert/strict";
import { createServer } from "vite";
import { readFileSync } from "node:fs";
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
  const d = await m.detail("c-kopi01");
  pass("flags array", Array.isArray(d.mismatch_flags));
  pass("at least two flags", d.mismatch_flags.length >= 2);
  pass(
    "flag shape",
    d.mismatch_flags.every(
      (f) => typeof f.field === "string" && f.field && typeof f.intake === "string" && f.intake &&
        typeof f.document === "string" && f.document && typeof f.source === "string" && f.source,
    ),
  );
  pass("flags clearly fake", d.mismatch_flags.every((f) => /demo/i.test(f.intake + f.document + f.source)));
  pass(
    "business-name and registration-number flags",
    d.mismatch_flags.some((f) => f.field === "business_name") &&
    d.mismatch_flags.some((f) => f.field === "uen"),
  );
  pass("documents map", d.documents && typeof d.documents === "object" && Object.keys(d.documents).length >= 2);
  pass(
    "document shape",
    Object.values(d.documents).every(
      (x) => typeof x.filename === "string" && x.filename && typeof x.status === "string" && typeof x.openable === "boolean",
    ),
  );
  pass("an openable document", Object.values(d.documents).some((x) => x.openable));

  const types = readFileSync(join(root, "src", "staff", "types.ts"), "utf8");
  pass("types declare MismatchFlag", /interface MismatchFlag/.test(types));
  pass("detail has mismatch_flags", /mismatch_flags:\s*MismatchFlag\[\]/.test(types));
  pass("detail has documents", /documents:\s*Record<string,\s*StaffDocument>/.test(types));

  // Flags and the documents list live in the Case file panel (cv-file) of the
  // Drafts under review tab in CaseView.tsx; the Full details view in
  // StaffPage.tsx keeps its own copy behind the drafts-tab toggle.
  const view = readFileSync(join(root, "src", "staff", "CaseView.tsx"), "utf8");
  pass("case file renders flag tags", /mismatch_flags/.test(view) && /Differs from document/.test(view));
  pass("flags are amber tags", /cv-flag/.test(view));
  pass("case file lists documents", /cv-docs/.test(view) && /d\.documents/.test(view) && /Open original/.test(view));
  pass(
    "open link uses staff route",
    /\/api\/staff\/clients\//.test(view) && /\/documents\//.test(view) && /x-staff-key/.test(view),
  );
  pass(
    "case file lives in the drafts tab",
    view.indexOf('phase === "drafts"') !== -1 &&
    view.indexOf('phase === "drafts"') < view.indexOf("cv-file"),
  );

  console.log(`mismatch-mock: ${n} checks passed`);
} finally {
  await server.close();
}
