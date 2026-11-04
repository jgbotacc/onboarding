// Case view model: stages and steps derived from the client detail API only.
// No new backend. Stages shown are the six that exist on main.
import { stepName } from "./format";
import type { AuditEntry, StaffDetail, StudioDraft } from "./types";

export type StageId = "intake" | "reading" | "brief" | "drafts" | "approval" | "done";

export const STAGES: { id: StageId; label: string }[] = [
  { id: "intake", label: "Intake chat" },
  { id: "reading", label: "Document and photo reading" },
  { id: "brief", label: "Brand brief" },
  { id: "drafts", label: "Image drafts" },
  { id: "approval", label: "Client approval" },
  { id: "done", label: "Done" },
];

export type StepStatus = "done" | "active" | "waiting" | "queued";
export type StageStatus = "done" | "current" | "waiting" | "queued";

/** The three case-view stages: onboarding chat, drafts under review, sent to designers. */
export type CasePhase = "onboarding" | "drafts" | "sent";

export const PHASES: { id: CasePhase; label: string }[] = [
  { id: "onboarding", label: "Onboarding" },
  { id: "drafts", label: "Drafts under review" },
  { id: "sent", label: "Sent to designers" },
];

/** Queue-row approximation of {@link casePhase} from list-level fields only:
 *  sent once handed off, onboarding while still gathering details, drafts
 *  under review otherwise. No detail fetch; the open case resolves exactly. */
export function rowPhase(row: { status: string; sent_to_designers_at?: string | null }): CasePhase {
  if (row.sent_to_designers_at) return "sent";
  if (row.status === "handed_off" || row.status === "approved") return "sent";
  if (row.status === "need_document" || row.status === "registering" ||
    row.status === "missing_info" || row.status === "needs_info") return "onboarding";
  return "drafts";
}

/** Which stage the case is in: sent once handed off, onboarding before any
 *  drafts/looks exist, drafts under review otherwise. */
export function casePhase(d: StaffDetail, studio?: StudioDraft[]): CasePhase {
  if (d.sent_to_designers_at) return "sent";
  const hasWork = (d.looks?.length || 0) > 0 || (studio?.length || 0) > 0 ||
    (d.images?.length || 0) > 0 || !!d.consult || (d.decisions?.length || 0) > 0;
  return hasWork ? "drafts" : "onboarding";
}

/** Full chat history, oldest first. */
export function orderedTranscript(d: StaffDetail) {
  return [...(d.transcript || [])].sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}

export interface ChatEntry {
  role: "client" | "assistant";
  text: string;
  at: string | null;
}

/**
 * Onboarding chat: typed transcript turns plus the client's non-typed turns
 * (file uploads, form submits, look picks) derived from the audit rows,
 * documents and selected looks. Oldest first. Stored transcript roles are
 * "bot" and "client" only: "bot" reads as Assistant, "client" as Client.
 */
export function chatEntries(d: StaffDetail): ChatEntry[] {
  const entries: ChatEntry[] = [];
  for (const m of d.transcript || []) {
    entries.push({ role: m.role === "client" ? "client" : "assistant", text: m.text || "", at: m.at || null });
  }
  const looks = d.looks || [];
  const lookById = new Map(looks.map((l) => [l.id, l]));
  const pickCovered = new Set<string>();
  const docName = (id: string, details: unknown) => {
    const fromDetails = (details as { filename?: unknown } | null)?.filename;
    return d.documents?.[id]?.filename ||
      (typeof fromDetails === "string" && fromDetails) ||
      id || "a file";
  };
  for (const a of d.audit || []) {
    const action = String(a.action || "");
    const at = a.at || null;
    if (action === "document_uploaded") {
      const id = String(a.target || "");
      entries.push({ role: "client", text: `Uploaded ${docName(id, a.details)}`, at });
    } else if (action === "document_removed") {
      const id = String(a.target || "");
      entries.push({ role: "client", text: `Removed ${docName(id, a.details)}`, at });
    } else if (action === "details_confirmed") {
      const raw = (a.details as { fields?: unknown } | null)?.fields;
      const fields = Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
      entries.push({ role: "client", text: fields.length ? `Confirmed ${fields.join(", ")}` : "Confirmed the form", at });
    } else if (action === "look_selected") {
      const raw = (a.details as { ids?: unknown } | null)?.ids;
      const ids = Array.isArray(raw) ? raw.map(String) : (a.target ? [String(a.target)] : []);
      for (const id of ids) {
        pickCovered.add(id);
        entries.push({ role: "client", text: `Picked ${lookById.get(id)?.title || "a design"}`, at });
      }
    }
  }
  for (const l of looks) {
    if (l.selected && !pickCovered.has(l.id)) {
      entries.push({ role: "client", text: `Picked ${l.title || "a design"}`, at: l.at || null });
    }
  }
  // Entries without a timestamp go last; everything else oldest first.
  entries.sort((x, y) => (x.at ?? "￿").localeCompare(y.at ?? "￿"));
  return entries;
}

export type DraftsSet = "picked" | "shortlist" | "latest" | "sent" | "none";

export interface DraftsInPlay {
  set: DraftsSet;
  items: { id: string; url: string; label: string }[];
}

export const DRAFTS_SET_LABELS: Record<Exclude<DraftsSet, "none">, string> = {
  picked: "Picked drafts",
  shortlist: "Studio shortlist",
  latest: "Latest round",
  sent: "Sent drafts",
};

/**
 * Drafts in play for the "Sent to designers" tab. Order of preference: looks
 * the client picked, else the studio shortlist, else the latest round's looks,
 * else sent studio drafts.
 */
export function draftsInPlay(d: StaffDetail, studio?: StudioDraft[], shortlist?: StudioDraft[]): DraftsInPlay {
  const looks = (d.looks || []).filter((l) => l.url);
  const picked = looks.filter((l) => l.selected);
  if (picked.length) {
    return { set: "picked", items: picked.map((l) => ({ id: l.id, url: l.url, label: l.title || "Picked draft" })) };
  }
  const short = (shortlist || []).filter((x) => x.url);
  if (short.length) {
    return { set: "shortlist", items: short.map((x) => ({ id: x.id, url: x.url as string, label: x.style_title || "Studio draft" })) };
  }
  if (looks.length) {
    const top = Math.max(...looks.map((l) => l.round ?? 0));
    const latest = looks.filter((l) => (l.round ?? 0) === top);
    return { set: "latest", items: latest.map((l) => ({ id: l.id, url: l.url, label: l.title || "Design draft" })) };
  }
  const sent = (studio || []).filter((x) => x.url && x.sent_at);
  if (sent.length) {
    return { set: "sent", items: sent.map((x) => ({ id: x.id, url: x.url as string, label: x.style_title || "Studio draft" })) };
  }
  return { set: "none", items: [] };
}

export interface CaseStep {
  id: string;
  stage: StageId;
  title: string;
  at: string | null;
  trigger: string;
  output: string;
  audit: AuditEntry[];
  waiting: boolean;
  waitingOn: "staff" | "client" | null;
  status: StepStatus;
  /** Plain-words handoff shown on the card that starts a new stage, e.g. "brand brief sent to image drafts". */
  handoff: string | null;
}

export interface CaseStage {
  id: StageId;
  label: string;
  status: StageStatus;
  steps: CaseStep[];
}

export interface CaseModel {
  stages: CaseStage[];
  steps: CaseStep[];
  currentStepId: string | null;
  openedAt: string | null;
  openMs: number | null;
}

const FINAL = ["approved", "rejected", "handed_off", "accepted"];
const STAFF_OWNED = ["pending_review", "generating", "need_direction", "registering", "need_document"];

const TRACE_STAGE: Record<string, StageId> = {
  read_document: "reading",
  photo_check: "reading",
  translate: "reading",
  image_brief: "brief",
  generate_image: "drafts",
  studio_image: "drafts",
};

const short = (t: string, n = 60) => {
  const s = (t || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

/** Never show a team identity: staff names become a role. */
export const actorRole = (a?: string) => {
  const s = String(a || "").toLowerCase();
  if (s.startsWith("staff:")) return "Staff";
  if (s === "client") return "Client";
  return "System";
};

/** Belt-and-braces client-side mask (server already masks via guard.clean). */
export const maskSensitive = (t: string) =>
  String(t || "").replace(/[STFG]\d{7}[A-Z]/gi, "•••••••");

const byTime = (a: string | null, b: string | null) =>
  (a || "").localeCompare(b || "");

export function buildCase(d: StaffDetail, studio?: StudioDraft[], nowMs = Date.now()): CaseModel {
  const steps: CaseStep[] = [];
  const audit = d.audit || [];
  const auditFor = (target?: string | null, extra?: (a: AuditEntry) => boolean) =>
    audit.filter((a) => (target && a.target === target) || (extra ? extra(a) : false));

  for (const [i, m] of (d.transcript || []).entries()) {
    const who = m.role === "client" ? "Client" : "Assistant";
    steps.push({
      id: `chat-${i}`, stage: "intake",
      title: m.role === "client" ? `Client: ${short(m.text, 42) || "message"}` : `Reply: ${short(m.text, 42) || "message"}`,
      at: m.at || null, trigger: `${who} wrote in the intake chat.`, output: m.text || "—",
      audit: auditFor(null, (a) => !!m.at && a.at === m.at), waiting: false, waitingOn: null, status: "queued", handoff: null,
    });
  }

  for (const [docId, doc] of Object.entries(d.documents || {})) {
    const up = audit.find((a) => a.action === "document_uploaded" && a.target === docId);
    steps.push({
      id: `doc-${docId}`, stage: "reading",
      title: `Read ${doc.filename || docId}`,
      at: up?.at || null, trigger: "The client uploaded a file.", output: `Extracted details${d.fields.business_name ? ` for ${d.fields.business_name}` : ""}.`,
      audit: auditFor(docId), waiting: false, waitingOn: null, status: "queued", handoff: null,
    });
  }

  for (const [i, t] of (d.traces || []).entries()) {
    const stage = TRACE_STAGE[t.step];
    if (!stage || stage === "drafts") continue; // drafts traces join the look/draft steps
    steps.push({
      id: `trace-${i}`, stage,
      title: stepName(t.step) + (t.ok === false ? " (retry)" : ""),
      at: t.at || null, trigger: "Automatic step in the pipeline.",
      output: t.ok === false ? "Failed; retried." : `Finished in ${(t.ms / 1000).toFixed(1)}s.`,
      audit: auditFor(null, (a) => !!t.at && a.at === t.at), waiting: false, waitingOn: null, status: "queued", handoff: null,
    });
  }

  if (d.consult) {
    steps.push({
      id: "consult", stage: "brief",
      title: d.consult.status === "approved" ? "Brand consult approved" : "Brand consult sent",
      at: d.consult.decided_at || d.consult.created || null,
      trigger: "Design direction needed a human check.",
      output: (d.consult.next_steps || []).join("; ") || "—",
      audit: auditFor(d.consult.id), waiting: false, waitingOn: null, status: "queued", handoff: null,
    });
  }

  for (const l of d.looks || []) {
    steps.push({
      id: `look-${l.id}`, stage: "drafts",
      title: l.title || "Design draft",
      at: l.at || null,
      trigger: l.selected ? "Picked by the client." : `Generated for round ${l.round ?? "—"}.`,
      output: l.brief || "—",
      audit: [...auditFor(l.id), ...auditFor(null, (a) => !!l.at && a.at === l.at && /look_selected/.test(a.action || ""))],
      waiting: false, waitingOn: null, status: "queued", handoff: null,
    });
  }

  for (const s of studio || []) {
    if (!s.id || steps.some((x) => x.id === `draft-${s.id}` || x.id === `look-${s.id}`)) continue;
    steps.push({
      id: `draft-${s.id}`, stage: "drafts",
      title: s.style_title || "Studio draft",
      at: s.created_at || null,
      trigger: s.author && String(s.author).startsWith("staff:") ? "Made by staff in the studio." : "Generated draft.",
      output: s.marketer_prompt || s.style_title || "—",
      audit: auditFor(s.id), waiting: false, waitingOn: null, status: "queued", handoff: null,
    });
  }

  for (const [i, dec] of (d.decisions || []).entries()) {
    steps.push({
      id: `decision-${i}`, stage: "approval",
      title: `Decision: ${stepName(dec.decision)}`,
      at: dec.at || null, trigger: "Staff reviewed the case.", output: `Status became ${d.status}.`,
      audit: auditFor(null, (a) => !!dec.at && a.at === dec.at), waiting: false, waitingOn: null, status: "queued", handoff: null,
    });
  }
  const picked = audit.filter((a) => a.action === "look_selected");
  for (const [i, a] of picked.entries()) {
    if (steps.some((s) => s.audit.includes(a))) continue;
    steps.push({
      id: `pick-${i}`, stage: "approval", title: "Client picked a design",
      at: a.at || null, trigger: "The client chose from the options.", output: "Choice recorded.",
      audit: [a], waiting: false, waitingOn: null, status: "queued", handoff: null,
    });
  }
  if (FINAL.includes(d.status)) {
    const last = [...audit].reverse()[0]?.at || [...steps].map((s) => s.at || "").sort().pop() || null;
    steps.push({
      id: "done", stage: "done", title: `Case ${stepName(d.status)}`,
      at: last || null, trigger: "Final status reached.", output: "—", audit: [],
      waiting: false, waitingOn: null, status: "queued", handoff: null,
    });
  }

  steps.sort((a, b) => byTime(a.at, b.at));
  const times = steps.map((s) => s.at || "").filter(Boolean).sort();
  const openedAt = times[0] || null;

  const final = FINAL.includes(d.status);
  const latest = steps[steps.length - 1] || null;
  for (const s of steps) s.status = "done";
  let currentStepId: string | null = null;
  if (latest && !final) {
    latest.status = "waiting";
    latest.waiting = true;
    latest.waitingOn = STAFF_OWNED.includes(d.status) ? "staff" : "client";
    currentStepId = latest.id;
  } else if (latest) {
    latest.status = "active";
    currentStepId = latest.id;
  }

  const order = STAGES.map((s) => s.id);
  const curIdx = latest ? order.indexOf(latest.stage) : -1;
  const stages: CaseStage[] = STAGES.map((st, i) => {
    const inStage = steps.filter((s) => s.stage === st.id);
    const status: StageStatus =
      !inStage.length ? (i < curIdx ? "done" : "queued")
      : final || i < curIdx ? "done"
      : i === curIdx ? (latest?.waiting ? "waiting" : "current")
      : "queued";
    return { id: st.id, label: st.label, status, steps: inStage };
  });

  // Mark the card that starts each new stage with a plain-words handoff label.
  // No team or bot names: only the stage names, lowercased.
  stages.forEach((st, i) => {
    if (!st.steps.length || i === 0) return;
    const prev = [...stages.slice(0, i)].reverse().find((p) => p.steps.length);
    if (!prev) return;
    st.steps[0].handoff = `${prev.label.toLowerCase()} sent to ${st.label.toLowerCase()}`;
  });

  const end = latest?.at ? Date.parse(latest.at) : nowMs;
  const openMs = openedAt ? Math.max(0, (final ? end : nowMs) - Date.parse(openedAt)) : null;
  return { stages, steps, currentStepId, openedAt, openMs };
}

export const openDuration = (ms: number | null) => {
  if (ms == null) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 90) return `${s}s so far`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m so far`;
  return `${Math.floor(m / 60)}h ${m % 60}m so far`;
};
