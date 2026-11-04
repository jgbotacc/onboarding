// Case view derivation + mock coverage. Run: npm test
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));
try {
  const { buildCase, maskSensitive, actorRole, STAGES, PHASES, casePhase, chatEntries, draftsInPlay, DRAFTS_SET_LABELS } = await server.ssrLoadModule("/src/staff/caseView.ts");
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
  pass("reading lane uses queue names", c.stages.find((s) => s.id === "reading").steps.some((s) => s.title === "Read document"));
  pass("brief lane uses queue names", c.stages.find((s) => s.id === "brief").steps.some((s) => s.title.startsWith("Image brief")));
  pass("no raw step ids in titles", c.steps.every((s) => !s.title.includes("read_document") && !s.title.includes("image_brief")));
  pass("handoff on new-stage cards", c.steps.some((s) => typeof s.handoff === "string" && /^[a-z ]+ sent to [a-z ]+$/.test(s.handoff)));
  pass("handoff has no team names", c.steps.every((s) => !s.handoff || (!/staff:|bot|team/i.test(s.handoff))));
  pass("no cost or S$ in case model", !/S\$|SGD|cost_sgd/i.test(JSON.stringify(c)));

  const kopi = await m.detail("c-kopi01");
  const k = buildCase(kopi, []);
  pass("kopi done lane filled", k.stages.find((s) => s.id === "done").steps.length === 1);
  pass("kopi current is done step", k.currentStepId === "done");

  pass("maskSensitive hides NRIC", maskSensitive("S1234567A Tan") === "••••••• Tan");
  pass("actorRole hides team names", actorRole("staff:mei") === "Staff" && actorRole("client") === "Client" &&
    actorRole("system") === "System");

  // The three stages and their default tab per case.
  pass("three phases in order", PHASES.map((p) => p.id).join(",") === "onboarding,drafts,sent" &&
    PHASES.map((p) => p.label).join(",") === "Onboarding,Drafts under review,Sent to designers");
  const empty = { sent_to_designers_at: null, looks: [], images: [], consult: null, decisions: [] };
  pass("empty case defaults to onboarding", casePhase(empty, []) === "onboarding");
  pass("bloom defaults to drafts", casePhase(bloom, studio.drafts) === "drafts");
  const forge = await m.detail("c-forge03");
  pass("forge defaults to sent", casePhase(forge, []) === "sent");

  // Onboarding chat: bot reads as Assistant, client turns interleaved oldest first.
  const kopiChat = chatEntries(kopi);
  pass("chat roles are client/assistant only", kopiChat.every((e) => e.role === "client" || e.role === "assistant"));
  pass("bot messages read as assistant", kopiChat.some((e) => e.role === "assistant" && /Welcome/.test(e.text)));
  pass("upload interleaved as client", kopiChat.some((e) => e.role === "client" && e.text === "Uploaded ACRA-profile.pdf"));
  pass("look pick interleaved as client", kopiChat.some((e) => e.role === "client" && e.text === "Picked Warm retro kopitiam post"));
  pass("chat oldest first", kopiChat.every((e, i, a) => i === 0 || (a[i - 1].at || "￿") <= (e.at || "￿")));
  const bloomChat = chatEntries(bloom);
  pass("bloom uploads interleaved", bloomChat.filter((e) => e.role === "client" && e.text.startsWith("Uploaded ")).length === 2);

  // Sent tab: drafts in play with the set labelled, falling back when nothing picked.
  const kopiPlay = draftsInPlay(kopi, [], []);
  pass("kopi shows picked drafts", kopiPlay.set === "picked" && kopiPlay.items.length === 1 && DRAFTS_SET_LABELS[kopiPlay.set] === "Picked drafts");
  const sampleShort = await m.shortlist("c-sample04");
  const sample = await m.detail("c-sample04");
  const samplePlay = draftsInPlay(sample, [], sampleShort.drafts);
  pass("sample falls back to shortlist", samplePlay.set === "shortlist" && samplePlay.items.length === 2);
  const bloomPlay = draftsInPlay(bloom, studio.drafts, []);
  pass("bloom falls back to latest round", bloomPlay.set === "latest" && bloomPlay.items.length === 1 && /Round 2/.test(bloomPlay.items[0].label));
  pass("empty case has no drafts", draftsInPlay(empty, [], []).set === "none");

  // Case view renders the tabs, the Client/Assistant labels and the labelled set.
  const caseViewSrc = readFileSync(join(root, "src", "staff", "CaseView.tsx"), "utf8");
  const staffPageSrc = readFileSync(join(root, "src", "staff", "StaffPage.tsx"), "utf8");
  const css = readFileSync(join(root, "src", "staff", "staff.css"), "utf8");
  pass("case view renders phase tabs", /PHASES\.map/.test(caseViewSrc));
  pass("client vs assistant labels", /"Client"/.test(caseViewSrc) && /"Assistant"/.test(caseViewSrc) &&
    /cv-who/.test(caseViewSrc) && /cv-client/.test(caseViewSrc) && /cv-assistant/.test(caseViewSrc));
  pass("client bubbles on the right", /\.cv-bubble\.cv-client\s*\{[^}]*flex-end/.test(css));
  pass("assistant bubbles on the left", /\.cv-bubble\.cv-assistant\s*\{[^}]*flex-start/.test(css));
  pass("sent tab labels the set", /DRAFTS_SET_LABELS/.test(caseViewSrc));

  // The full-details toggle lives on the drafts tab only (phase passed up).
  pass("case view reports its phase", /onPhase\?\.\(phase\)/.test(caseViewSrc) && /\{fullDetails\}/.test(caseViewSrc));
  pass("toggle only on drafts tab", /onPhase=\{/.test(staffPageSrc) &&
    /cvPhase\.phase === "drafts"/.test(staffPageSrc) && /fullDetails=\{/.test(staffPageSrc));

  // No assistant-brand or model id text in staff/client render paths
  // (type comments about backend-kept fields are excluded).
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const banned = [/\bmuse\b/i, /claude/i, /gpt[-_ ]?\d/i, /gemini/i, /llama/i, /\bbedrock\b/i, /anthropic/i, /openai/i, /sonnet/i];
  for (const f of walk(join(root, "src"))) {
    const raw = readFileSync(f, "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const re of banned) pass(`${f} has no ${re}`, !re.test(code));
  }
} finally {
  await server.close();
}
console.log(`case-view mock OK (${n} checks)`);
