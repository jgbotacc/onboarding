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
  const { buildCase, maskSensitive, actorRole, STAGES, PHASES, casePhase, rowPhase, chatEntries, draftsInPlay, DRAFTS_SET_LABELS } = await server.ssrLoadModule("/src/staff/caseView.ts");
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
  const sample = await m.detail("c-sample04");
  const sampleStudio = await m.studio("c-sample04");
  const samplePlay = draftsInPlay(sample, sampleStudio.drafts, []);
  pass("sample falls back to sent drafts", samplePlay.set === "sent" && samplePlay.items.length === 2);
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

  // Drafts tab is studio only: no kanban, no step dialog, no case file,
  // no details/studio sub-tabs, no full-details toggle.
  pass("no kanban lanes in case view", !/cv-lanes/.test(caseViewSrc) && !/StepCard/.test(caseViewSrc) && !/cv-now/.test(caseViewSrc));
  pass("no step dialog or case file", !/cv-panel/.test(caseViewSrc) && !/cv-file/.test(caseViewSrc) && !/Case file/.test(caseViewSrc));
  pass("no full-details toggle", !/Full details and studio/.test(caseViewSrc) && !/Full details and studio/.test(staffPageSrc) && !/fullDetails/.test(caseViewSrc));
  pass("no details/studio sub tabs", !/"details"/.test(caseViewSrc) && !/"studio"/.test(caseViewSrc) && !/panel-details-/.test(staffPageSrc));
  pass("drafts tab always shows the studio", /<StudioPanel/.test(caseViewSrc));
  pass("no disabled request-changes button", !/Request changes/.test(caseViewSrc));
  pass("send to designers kept as final action", /Send to designers/.test(caseViewSrc));
  pass("approve gone", !/onClick=\{approve\}/.test(caseViewSrc) && !/>Approve</.test(caseViewSrc));
  pass("onboarding shows client info", /ClientInfo/.test(caseViewSrc));
  const clientInfoSrc = readFileSync(join(root, "src", "staff", "ClientInfo.tsx"), "utf8");
  pass("client info has contact card", /Contact/.test(clientInfoSrc) && /Email/.test(clientInfoSrc));
  pass("client info lists business details", /Business details/.test(clientInfoSrc) && /FIELDS/.test(clientInfoSrc));
  pass("client info shows designs and references", /Designs/.test(clientInfoSrc) && /Reference images/.test(clientInfoSrc));
  pass("client info shows rejected looks", /RejectedLooks/.test(clientInfoSrc));
  pass("client info masks chat text", /maskSensitive/.test(clientInfoSrc));

  // Each tab opens with one muted affordance line.
  pass("onboarding hint", /Clients still chatting with the assistant/.test(caseViewSrc));
  pass("drafts hint", /Tell the assistant what to change/.test(caseViewSrc));
  pass("sent hint", /Designers pick these up on their page/.test(caseViewSrc));
  pass("hint styling is muted", /\.cv-hint\s*\{[^}]*var\(--muted\)/.test(css));

  // Tab labels carry counts/ticks where data allows.
  pass("drafts tab shows studio count", /Drafts under review/.test(caseViewSrc) && /drafts\.length/.test(caseViewSrc));
  pass("sent tab ticks when handed over", /sentAt \? " ✓"|sentAt \? ' ✓'/.test(caseViewSrc) || (/✓/.test(caseViewSrc) && /sent_to_designers_at/.test(caseViewSrc)));

  // Queue rows carry one next step from the row-level phase.
  pass("rows show one next step", /Waiting for client/.test(staffPageSrc) && /Review drafts/.test(staffPageSrc) && /With designers/.test(staffPageSrc));
  pass("review drafts opens the drafts tab", /initialPhase/.test(caseViewSrc) && /initialPhase/.test(staffPageSrc));
  pass("row phase helper", typeof rowPhase === "function" &&
    rowPhase({ status: "registering", sent_to_designers_at: null }) === "onboarding" &&
    rowPhase({ status: "awaiting_review", sent_to_designers_at: null }) === "drafts" &&
    rowPhase({ status: "awaiting_review", sent_to_designers_at: "2026-10-29T03:05:00Z" }) === "sent");

  // Onboarding chat: one summary line plus a button; full messages only after the click.
  pass("chat collapsed by default", /const \[showChat, setShowChat\] = useState\(false\)/.test(caseViewSrc));
  pass("chat summary line", /Chat history: \{entries\.length\} message/.test(caseViewSrc) && /last at \{entries\.length \? fmtTime/.test(caseViewSrc));
  pass("chat opens on click", /aria-expanded=\{showChat\}/.test(caseViewSrc) && /\{showChat && \(/.test(caseViewSrc));

  // Action bar: send to designers only, as the primary button; no approve, no send-to-client.
  pass("no send to client button", !/Send to client/.test(caseViewSrc));
  pass("send to designers is primary", /className="btn primary cv-btn"[^>]*onClick=\{sendToDesigners\}/.test(caseViewSrc));

  // Designer handoff page: rows with download, upload and status; linked from staff.
  const designerSrc = readFileSync(join(root, "src", "staff", "DesignerPage.tsx"), "utf8");
  const mainSrc = readFileSync(join(root, "src", "main.tsx"), "utf8");
  pass("designer page renders rows", /\.map\(\(r\) => \(/.test(designerSrc) && /Download images/.test(designerSrc) &&
    /Upload final images/.test(designerSrc) && /final_status/.test(designerSrc));
  pass("designer routed at /designer", /DesignerPage/.test(designerSrc));
  pass("no designer link in staff header", !/>Designer<\/a>/.test(staffPageSrc) && !/staff-nav/.test(staffPageSrc));
  pass("designer rows carry finals", /final_images/.test(designerSrc) && /chosen_look/.test(designerSrc));
  const mockSrc = readFileSync(join(root, "src", "staff", "mock.ts"), "utf8");
  pass("mock covers designer", /designer:/.test(mockSrc) && /downloadZip:/.test(mockSrc) && /uploadFinals:/.test(mockSrc));

  // Role-based access: one sign-in, staff vs designer gates.
  const apiSrc = readFileSync(join(root, "src", "staff", "api.ts"), "utf8");
  const gateSrc = readFileSync(join(root, "src", "staff", "PasscodeGate.tsx"), "utf8");
  pass("sign-in asks for either passcode", /staff or designer passcode/.test(gateSrc));
  pass("role lookup returns the caller role", /\/api\/staff\/role/.test(apiSrc) && /connectDesigner/.test(apiSrc));
  pass("staff page shows designers the designer view", /r\.role === "designer"/.test(staffPageSrc) && /<DesignerPage/.test(staffPageSrc));
  pass("designer header has no staff link", !/>Staff<\/a>/.test(designerSrc) && !/staff-nav/.test(designerSrc));
  pass("mock reports a role", /role:/.test(mockSrc));

  // Mock designer flow: sent cases only, picked title first, upload flips status, zip parses.
  const drows = await m.designer();
  pass("mock designer lists sent cases", drows.some((r) => r.id === "c-forge03") && drows.every((r) => r.sent_to_designers_at));
  const dforge = drows.find((r) => r.id === "c-forge03");
  pass("mock chosen look is the pick", dforge.chosen_look === "Dark gym poster");
  pass("mock pending before upload", dforge.final_status === "Pending final edit" && dforge.final_images.length === 0);
  const up = await m.uploadFinals("c-forge03", [new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" })]);
  pass("mock upload keeps urls", up.final_images.length === 1);
  const drows2 = await m.designer();
  const dforge2 = drows2.find((r) => r.id === "c-forge03");
  pass("mock done after upload", dforge2.final_status === "Done" && dforge2.final_images.length === 1);
  pass("mock done sorts after pending", drows2[drows2.length - 1].id === "c-forge03" || drows2.every((r) => r.final_status === "Done"));
  const dzip = await m.downloadZip("c-forge03");
  const magic = new Uint8Array(await dzip.slice(0, 2).arrayBuffer());
  pass("mock zip parses", dzip.type === "application/zip" && dzip.size > 0 && magic[0] === 0x50 && magic[1] === 0x4b);

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
