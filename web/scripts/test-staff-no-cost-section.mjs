// Staff cost-section removal: no "Quality and cost" UI, summary stats,
// steps table, or metrics fetch in the web app. Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));

const page = readFileSync(join(root, "src", "staff", "StaffPage.tsx"), "utf8");
const caseView = readFileSync(join(root, "src", "staff", "CaseView.tsx"), "utf8");
const api = readFileSync(join(root, "src", "staff", "api.ts"), "utf8");
const types = readFileSync(join(root, "src", "staff", "types.ts"), "utf8");
const mock = readFileSync(join(root, "src", "staff", "mock.ts"), "utf8");

// The section itself is gone from the staff screen.
pass("no Quality and cost heading", !/Quality and cost/.test(page));
pass("no MetricsPanel", !/MetricsPanel/.test(page));
pass("no staff-kpi markup", !/staff-kpi/.test(page));
pass("no staff-metrics markup", !/staff-metrics/.test(page));
pass("no metrics call", !/\.metrics\(/.test(page));

// No metrics fetch or metrics types left in the web app.
for (const [label, src] of [["api", api], ["types", types], ["mock", mock], ["page", page]]) {
  pass(`${label} has no metrics endpoint`, !/staff\/metrics/.test(src));
  pass(`${label} has no StaffMetrics`, !/StaffMetrics/.test(src));
}

// The traces table keeps its fields but drops the cost column.
pass("traces table has no cost column", !/S\$ cost/.test(page));
pass("traces table has no cost_sgd", !/cost_sgd/.test(page));

// The client queue and everything else are untouched.
pass("queue kept", /Client queue/.test(page));
pass("consult list kept", /ConsultList/.test(page));
pass("studio kept", /StudioPanel/.test(caseView));
pass("no Step traces section", !/Step traces/.test(page));

console.log(`staff-no-cost-section: ${n} checks passed`);
