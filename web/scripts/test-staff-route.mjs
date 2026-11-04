// Single staff address: legacy designer addresses redirect, role picks the view. Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));
try {
  const { designerRedirect, pickStaffView } = await server.ssrLoadModule("/src/staff/route.ts");

  // Legacy designer addresses redirect to the matching staff address, keeping the query.
  pass("hash designer redirects to hash staff", designerRedirect("#/designer", "/", "") === "/#/staff");
  pass("hash redirect keeps the query", designerRedirect("#/designer", "/", "?mock=1") === "/?mock=1#/staff");
  pass("hash redirect keeps extra query", designerRedirect("#/designer", "/", "?mock=1&role=designer") === "/?mock=1&role=designer#/staff");
  pass("hash redirect keeps subpaths", designerRedirect("#/designer/foo", "/", "") === "/#/staff/foo");
  pass("path designer redirects to path staff", designerRedirect("", "/designer", "") === "/staff");
  pass("path redirect keeps the query", designerRedirect("", "/designer", "?mock=1") === "/staff?mock=1");
  pass("path redirect keeps extra query", designerRedirect("", "/designer", "?mock=1&x=2") === "/staff?mock=1&x=2");
  pass("path redirect tolerates trailing slash", designerRedirect("", "/designer/", "?mock=1") === "/staff?mock=1");
  pass("staff hash has no redirect", designerRedirect("#/staff", "/", "") === null);
  pass("staff path has no redirect", designerRedirect("", "/staff", "") === null);
  pass("client root has no redirect", designerRedirect("", "/", "") === null);
  pass("review path has no redirect", designerRedirect("#/review", "/review", "") === null);

  // Role picks the view; ?mock=1&role=designer previews the designer view (mock only).
  pass("staff role sees staff", pickStaffView("staff", "") === "staff");
  pass("designer role sees designer", pickStaffView("designer", "") === "designer");
  pass("designer role keeps designer in mock", pickStaffView("designer", "?mock=1") === "designer");
  pass("mock preview shows designer before sign-in", pickStaffView(null, "?mock=1&role=designer") === "designer");
  pass("mock preview needs mock mode", pickStaffView(null, "?role=designer") === "staff");
  pass("mock without preview stays staff", pickStaffView(null, "?mock=1") === "staff");
  pass("mock preview does not leak to staff role default", pickStaffView("staff", "?mock=1&role=designer") === "designer");

  // Wiring: main.tsx redirects legacy designer addresses and renders one staff page.
  const mainSrc = readFileSync(join(root, "src", "main.tsx"), "utf8");
  pass("main uses the redirect helper", /designerRedirect/.test(mainSrc) && /location\.replace\(redirect\)/.test(mainSrc));
  pass("main keeps no designer route", !/DesignerPage/.test(mainSrc) && !/#\/designer/.test(mainSrc));

  // Headers: app name plus the mock demo badge only, no switch links or review tag.
  for (const f of ["StaffPage.tsx", "DesignerPage.tsx"]) {
    const src = readFileSync(join(root, "src", "staff", f), "utf8");
    pass(`${f} header has no nav link`, !/staff-nav/.test(src) && !/<a /.test(src));
    pass(`${f} header has no review tag`, !/staff-tag/.test(src) && !/>Staff review</.test(src));
    pass(`${f} keeps the demo badge`, /badge-demo/.test(src) && /demoBadge/.test(src));
    pass(`${f} keeps a sign-in gate`, /PasscodeGate/.test(src));
  }
  const staffPageSrc = readFileSync(join(root, "src", "staff", "StaffPage.tsx"), "utf8");
  pass("designer role renders the designer view inline", /r\.role === "designer"/.test(staffPageSrc) && /<DesignerPage/.test(staffPageSrc));
  pass("goDesigner stays on the same address", /export function goDesigner/.test(staffPageSrc) && !/designer/.test(staffPageSrc.match(/export function goDesigner[\s\S]*?\n\}/)[0].replace("goDesigner", "")));

  // Dead helpers and styles are gone.
  pass("no designer href helpers", !/designerHref|staffHref/.test(staffPageSrc) &&
    !/designerHref|staffHref/.test(readFileSync(join(root, "src", "staff", "DesignerPage.tsx"), "utf8")));
  const css = readFileSync(join(root, "src", "theme.css"), "utf8");
  pass("no dead nav/tag css", !/\.staff-nav/.test(css) && !/\.staff-tag/.test(css));
} finally {
  await server.close();
}
console.log(`staff route OK (${n} checks)`);
