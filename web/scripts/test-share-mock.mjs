// Share-page checks (PRD 4.8 public routes: token in the x-share-token header only).
// Run: npm test
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
  const { createShareMock } = await server.ssrLoadModule("/src/share/mock.ts");
  pass("createShareMock exported", typeof createShareMock === "function");

  // ?mock=1 renders without a backend: clearly fake Sample Bakery data.
  const m = createShareMock();
  pass("mock client flagged", m.mock === true);
  const s = await m.get("anything");
  pass("Sample Bakery business", (s.business_name || "").includes("Sample Bakery"));
  pass("two or more drafts", Array.isArray(s.drafts) && s.drafts.length >= 2);
  pass("draft shape", s.drafts.every((d) => d.id && d.url && d.title));
  pass(
    "fake images only",
    s.drafts.every((d) => d.url.startsWith("data:") || d.url.includes("example.test") || d.url.includes("placeholder")),
  );
  pass("shortlist listed", Array.isArray(s.shortlist) && s.shortlist.length >= 1);
  pass("undecided at first", s.decided === null);

  // Heart adds to the shortlist, reject takes it back off.
  const plain = s.drafts.find((d) => !d.liked) || s.drafts[0];
  const hearted = await m.feedback("anything", { draft_id: plain.id, kind: "heart" });
  pass("heart shortlists", hearted.ok === true && hearted.shortlist.includes(plain.id));
  pass("liked flag follows", (await m.get("anything")).drafts.find((d) => d.id === plain.id)?.liked === true);
  const rejected = await m.feedback("anything", { draft_id: plain.id, kind: "reject" });
  pass("reject unshortlists", !rejected.shortlist.includes(plain.id));

  // Approve decides the link; a change request needs a short note (<=500 chars).
  for (const bad of [{ draft_id: plain.id, kind: "changes" }, { draft_id: plain.id, kind: "changes", note: "  " }]) {
    let threw = false;
    try {
      await m.feedback("anything", bad);
    } catch {
      threw = true;
    }
    pass("note required for changes", threw);
  }
  let longThrew = false;
  try {
    await m.feedback("anything", { draft_id: plain.id, kind: "changes", note: "x".repeat(501) });
  } catch {
    longThrew = true;
  }
  pass("note over 500 rejected", longThrew);
  await m.feedback("anything", { draft_id: plain.id, kind: "changes", note: "Please make the headline bigger." });
  pass("changes decides", (await m.get("anything")).decided?.kind === "changes");
  await m.feedback("anything", { draft_id: plain.id, kind: "approve" });
  pass("approve decides", (await m.get("anything")).decided?.kind === "approve");

  // Unknown drafts read 404, like the backend.
  let unknownThrew = false;
  try {
    await m.feedback("anything", { draft_id: "nope", kind: "heart" });
  } catch (e) {
    unknownThrew = /404/.test(String(e && e.message));
  }
  pass("unknown draft 404", unknownThrew);

  // Demo link states: expired reads 410, revoked reads 404.
  for (const [token, status] of [["expired", 410], ["revoked", 404]]) {
    let err = null;
    try {
      await m.get(token);
    } catch (e) {
      err = e;
    }
    pass(`${token} reads ${status}`, err?.status === status);
  }

  // The token travels in the x-share-token header only: never in a URL, never stored.
  const apiSrc = readFileSync(join(root, "src", "share", "api.ts"), "utf8");
  pass("header x-share-token", apiSrc.includes('"x-share-token"'));
  pass("no token query or path", !/share\?.*token/i.test(apiSrc) && !/share\/\$\{?token/i.test(apiSrc));
  pass("no token storage", !apiSrc.includes("localStorage") && !apiSrc.includes("sessionStorage"));
  pass("404/410 typed", apiSrc.includes("ShareLinkError") && apiSrc.includes("410"));

  // The page reads the token from the fragment (#t=) browsers never send, and covers
  // every link state: missing, invalid (404), expired (410), decided, saving errors.
  const pageSrc = readFileSync(join(root, "src", "share", "SharePage.tsx"), "utf8");
  pass("reads #t= fragment", /#t=/.test(pageSrc));
  pass("no token storage", !pageSrc.includes("localStorage") && !pageSrc.includes("sessionStorage"));
  pass("missing-link state", /looks incomplete/.test(pageSrc));
  pass("invalid-link state", /no longer valid/.test(pageSrc));
  pass("expired-link state", /has expired/.test(pageSrc));
  pass("decided state", /you've approved a design/i.test(pageSrc));
  pass("saving-error state", /didn't go through/.test(pageSrc));
  pass("shortlist shown", /shortlist/i.test(pageSrc));
  pass("approve flow", /Approve this design/.test(pageSrc));
  pass("change-request note", /What should we change/.test(pageSrc) && /500/.test(pageSrc));
  pass("polls every 15 s", /15000/.test(pageSrc));

  // Design C token set: .share declares the same custom properties with the same
  // values as .staff, and no other rule repeats a colour as a hex value.
  const vars = (css, sel) => {
    const body = new RegExp(`${sel}\\s*\\{([^}]*)\\}`).exec(css)?.[1] || "";
    return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
  };
  const staffCss = readFileSync(join(root, "src", "staff", "staff.css"), "utf8");
  const shareCss = readFileSync(join(root, "src", "share", "share.css"), "utf8");
  const staffVars = vars(staffCss, "\\.staff");
  const shareVars = vars(shareCss, "\\.share");
  pass("token names match", JSON.stringify(Object.keys(shareVars).sort()) === JSON.stringify(Object.keys(staffVars).sort()));
  pass(
    "token values match",
    Object.entries(staffVars).every(([k, v]) => shareVars[k] === v),
  );
  const staffHex = new Set([...staffCss.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((x) => x[0].toLowerCase()));
  const tokenBlock = /\.share\s*\{[^}]*\}/.exec(shareCss)?.[0] || "";
  const restHex = [...shareCss.replace(tokenBlock, "").matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((x) => x[0].toLowerCase());
  pass("no new colours outside the token set", restHex.every((h) => staffHex.has(h)));

  // Wired in: /share route renders the page, and the check runs in npm test.
  const mainSrc = readFileSync(join(root, "src", "main.tsx"), "utf8");
  pass("/share route", mainSrc.includes("SharePage") && /\/share/.test(mainSrc));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pass("npm test runs share checks", String(pkg.scripts?.test || "").includes("test-share-mock"));

  console.log(`share-mock: ${n} checks passed`);
} finally {
  await server.close();
}
