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
