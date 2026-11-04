import type { FormFields } from "../types";
import type { FieldKey } from "./fields";

export type Decision = "approve" | "reject" | "more_info";

/** GET /api/staff/clients -> StaffRow[] */
export interface StaffRow {
  id: string;
  business_name: string;
  contact_name: string;
  email: string;
  status: string;
  round: number;
  industry?: string | null;
  updated: string | null; // ISO 8601 (UTC), last activity
  image: string | null; // latest generated image URL
  sent_to_designers_at?: string | null;
}

/** One intake-vs-document difference (PRD 4.9.3.2). `source` is the document filename. */
export interface MismatchFlag {
  field: string;
  intake: string;
  document: string;
  source: string;
}

/** One uploaded document on the staff client detail. */
export interface StaffDocument {
  filename: string;
  status: string;
  openable: boolean;
}

/** GET /api/staff/clients/:id */
export interface StaffDetail {
  id: string;
  /** Intake answers; UEN and registered address are document-only answers (PRD 4.9). */
  fields: Partial<FormFields> & { uen?: string; registered_address?: string };
  images: string[];
  reference_images: string[];
  status: string;
  round: number;
  /** Intake-vs-document differences, derived at read time (staff only). */
  mismatch_flags: MismatchFlag[];
  /** Uploaded documents keyed by doc id; open each via GET /api/staff/clients/:id/documents/:docId. */
  documents: Record<string, StaffDocument>;
  /** Step traces feed the case lanes; the UI never shows a traces table or cost. */
  traces?: StepTrace[];
  /** Emails sent for this client so far (oldest first). */
  outbox?: EmailInfo[];
  /** Everything the case view is built from (all present on the real API). */
  transcript?: TranscriptMsg[];
  audit?: AuditEntry[];
  looks?: CaseLook[];
  consult?: Consult | null;
  decisions?: { decision: string; at?: string }[];
  /** Final-edit handoff timestamp; set by POST send-to-designers. */
  sent_to_designers_at?: string | null;
}

export interface TranscriptMsg {
  role: string;
  text: string;
  at?: string;
}

export interface AuditEntry {
  at?: string;
  actor?: string;
  action?: string;
  target?: string | null;
  details?: unknown;
}

export interface CaseLook {
  id: string;
  url: string;
  title?: string;
  brief?: string;
  round?: number;
  selected?: boolean;
  at?: string;
}

/** GET /api/staff/clients/:id/rejected-looks -> RejectedLookRound[] (every look not picked, grouped by round) */
export interface RejectedLookOption {
  id: string;
  url: string;
  alt: string;
  title?: string;
  brief?: string;
  at?: string;
}

export interface RejectedLookRound {
  round: number;
  options: RejectedLookOption[];
}

/** GET /api/staff/consults -> Consult[] */
export interface Consult {
  id: string;
  client_id: string;
  business_name: string;
  status: "pending_approval" | "approved";
  /** Everything already submitted, as { label: value }. */
  submitted: Record<string, string>;
  /** Unresolved next steps. */
  next_steps: string[];
  created: string;
  approved_by?: string | null;
  decided_at?: string | null;
}

/** Step trace recorded for a client. The backend keeps model and cost fields;
 * the staff UI never shows them. */
export interface StepTrace {
  step: string;
  /** Backend-kept model id; never rendered. */
  model?: string;
  ok: boolean;
  ms: number;
  cost_sgd: number;
  at?: string;
}

export interface EmailInfo {
  /** "Sent" | "Sent (demo)" | "Sent (demo), <provider> failed: ..." (also tolerates "sent" / "sent_demo"). */
  status: string;
  to?: string;
  recipient?: string;
  subject?: string;
  sent_at?: string;
}

/** POST /api/staff/clients/:id/decision -> DecisionResult */
export interface DecisionResult {
  ok?: boolean; // treated as success unless explicitly false
  status: string; // client status after the decision
  email?: EmailInfo;
  resume_url?: string | null; // more_info only
}

export interface DecisionBody {
  decision: Decision;
  fields: FieldKey[];
  note: string;
}

/** GET /api/staff/clients/:id/studio */
export interface StudioPreset {
  id: string;
  label: string;
  w: number;
  h: number;
}

export interface StudioChip {
  id: string;
  label: string;
  text: string;
}

export interface StudioAvoid {
  id: string;
  title: string;
  brief?: string | null;
  url?: string | null;
}

export type StudioDraftStatus = "reserved" | "ok" | "failed";
export type StudioSizePreset = "post" | "story" | "flyer";

export interface StudioDraft {
  id: string;
  run_id: string;
  parent_id?: string | null;
  parent_kind?: "draft" | "look" | null;
  preset: string;
  width: number;
  height: number;
  url: string | null;
  status: StudioDraftStatus;
  style_title?: string | null;
  marketer_prompt?: string | null;
  chips?: string[] | null;
  author?: string | null;
  starred: boolean;
  pinned_to?: "client" | "consult" | null;
  pinned_consult_id?: string | null;
  error?: string | null;
  sent_at?: string | null;
  created_at?: string | null;
}

export interface StudioGet {
  brief: Record<string, string>;
  avoid: StudioAvoid[];
  presets: StudioPreset[];
  chips: StudioChip[];
  drafts: StudioDraft[];
  cap: number;
  used: number;
  remaining: number;
}

/** POST .../studio/drafts and .../studio/remix */
export interface StudioRunResult {
  run_id: string;
  drafts: StudioDraft[];
  remaining: number;
}

export interface StudioDraftsBody {
  marketer_prompt?: string;
  chips?: string[];
  preset: StudioSizePreset;
}

export interface StudioRemixBody {
  source_id: string;
  source_kind: "draft" | "look";
  note?: string;
  preset?: StudioSizePreset;
}

/** POST /api/staff/clients/:id/studio/share -> shown once, never stored */
export interface ShareCreated {
  id: string;
  url: string;
  expires_at: string;
}

/** GET /api/staff/clients/:id/studio/shares -> live and past links (no tokens) */
export interface ShareLink {
  id: string;
  expires_at: string;
  revoked_at: string | null;
  used_at: string | null;
  created_by: string | null;
}

export type FeedbackKind = "heart" | "reject" | "approve" | "changes";

/** One client tap from the share page (change requests carry the client's note). */
export interface FeedbackEntry {
  draft_id: string;
  kind: FeedbackKind;
  note: string | null;
  actor: string;
  created_at: string;
}

/** GET /api/staff/clients/:id/studio/shortlist */
export interface ShortlistView {
  drafts: StudioDraft[];
  feedback: FeedbackEntry[];
}

export const STAFF_STATUS_LABELS: Record<string, string> = {
  need_document: "Getting started",
  registering: "Getting started",
  missing_info: "Needs details",
  need_direction: "Choosing a style",
  generating: "Making designs",
  awaiting_review: "Client reviewing",
  accepted: "Client accepted",
  handed_off: "With a designer",
  approved: "Approved",
  rejected: "Rejected",
  needs_info: "More info requested",
  pending_review: "Ready for review",
};

export const statusLabel = (s: string) => STAFF_STATUS_LABELS[s] || s.replace(/_/g, " ");
