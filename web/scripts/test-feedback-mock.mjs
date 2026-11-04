// Staff client-feedback checks (PRD 4.8, Docs/UI-API-CONTRACT.md share links). Run: npm test
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
  for (const fn of ["createShare", "listShares", "revokeShare", "shortlist", "setShortlist"]) {
    pass(`mock.${fn} exported`, typeof m[fn] === "function");
  }

  // ?mock=1 carries clearly fake demo data.
  const rows = await m.list();
  const bakery = rows.find((r) => r.id === "c-sample04");
  pass("Sample Bakery listed", bakery?.business_name === "Sample Bakery (demo)");
  pass("Sample Bakery clearly fake contact", (bakery?.email || "").endsWith(".example.test"));

  // Seeded links: one live, one past, both with expiry and no secret.
  const seeded = await m.listShares("c-sample04");
  pass("two seeded links", seeded.length === 2);
  const live = seeded.find((s) => !s.revoked_at && new Date(s.expires_at).getTime() > Date.now());
  const past = seeded.find((s) => new Date(s.expires_at).getTime() <= Date.now());
  pass("one live link", !!live);
  pass("one past link with expiry", !!past?.expires_at);
  pass("seeded rows carry no token", !JSON.stringify(seeded).includes("mock-token") && !JSON.stringify(seeded).includes("#t="));

  // Created links use a fake host, carry the token in the fragment, and are listed without it.
  const created = await m.createShare("c-sample04", 7);
  pass("created link id", !!created.id);
  pass("created link fake host", created.url.startsWith("https://example.test/share#t="));
  pass("created link expiry ~7 days", Math.abs(new Date(created.expires_at).getTime() - (Date.now() + 7 * 86400000)) < 60000);
  const after = await m.listShares("c-sample04");
  pass("new link listed", after.some((s) => s.id === created.id));
  pass("listed links never include the token", !JSON.stringify(after).includes("#t="));

  // Lifetimes outside 1..30 days are rejected, like the backend ShareIn (ge=1, le=30).
  for (const bad of [0, 31]) {
    let threw = false;
    try {
      await m.createShare("c-sample04", bad);
    } catch {
      threw = true;
    }
    pass(`days=${bad} rejected`, threw);
  }

  // Revoke ends a link at once; unknown links and clients read 404.
  const revoked = await m.revokeShare("c-sample04", created.id);
  pass("revoke stamps revoked_at", revoked.id === created.id && !!revoked.revoked_at);
  pass("revoked link reads revoked", (await m.listShares("c-sample04")).find((s) => s.id === created.id)?.revoked_at === revoked.revoked_at);
  for (const [fn, args] of [
    ["revokeShare", ["c-sample04", "nope"]],
    ["revokeShare", ["nope", "nope"]],
    ["listShares", ["nope"]],
    ["shortlist", ["nope"]],
  ]) {
    let threw = false;
    try {
      await m[fn](...args);
    } catch (e) {
      threw = /404/.test(String(e && e.message));
    }
    pass(`${fn} ${args.join("/")} 404`, threw);
  }

  // Shortlist shows drafts plus every client tap kind, with the change-request note.
  const sl = await m.shortlist("c-sample04");
  pass("shortlist two drafts", sl.drafts.length === 2);
  const kinds = sl.feedback.map((f) => f.kind).sort();
  pass("feedback has all tap kinds", JSON.stringify(kinds) === JSON.stringify(["approve", "changes", "heart", "reject"]));
  const change = sl.feedback.find((f) => f.kind === "changes");
  pass("change request carries a note", !!change?.note && change.note.length > 0 && change.note.length <= 500);
  pass("other taps carry no note", sl.feedback.filter((f) => f.kind !== "changes").every((f) => f.note == null));

  // Staff add/remove round-trips on another client without touching the seed.
  const gen = await m.generateDrafts("c-kopi01", { preset: "post" });
  const did = gen.drafts[0].id;
  pass("shortlist starts empty", (await m.shortlist("c-kopi01")).drafts.length === 0);
  pass("add shortlists", (await m.setShortlist("c-kopi01", did, true)).drafts.length === 1);
  pass("remove unshortlists", (await m.setShortlist("c-kopi01", did, false)).drafts.length === 0);

  // Real adapter hits the PRD 4.8 staff routes.
  const apiSrc = readFileSync(join(root, "src", "staff", "api.ts"), "utf8");
  pass("POST studio/share", apiSrc.includes('"/studio/share"'));
  pass("GET studio/shares", apiSrc.includes('"/studio/shares"'));
  pass("POST shares/{tid}/revoke", apiSrc.includes('/revoke"'));
  pass("GET studio/shortlist", apiSrc.includes('"/studio/shortlist"'));
  pass("POST studio/shortlist/{did}", apiSrc.includes('/studio/shortlist/" + encodeURIComponent(draftId)'));

  // The one-time link is shown from memory only: never stored, never logged.
  const panelSrc = readFileSync(join(root, "src", "staff", "FeedbackPanel.tsx"), "utf8");
  pass("panel never touches localStorage", !panelSrc.includes("localStorage") && !panelSrc.includes("sessionStorage"));
  pass("panel never console.logs", !panelSrc.includes("console.log"));
  pass("panel copies via clipboard", panelSrc.includes("navigator.clipboard"));
  pass("studio embeds the feedback panel", readFileSync(join(root, "src", "staff", "StudioPanel.tsx"), "utf8").includes("FeedbackPanel"));

  console.log(`feedback-mock: ${n} checks passed`);
} finally {
  await server.close();
}
