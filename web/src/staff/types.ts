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
}

/** GET /api/staff/clients/:id */
export interface StaffDetail {
  id: string;
  fields: Partial<FormFields>;
  images: string[];
  reference_images: string[];
  status: string;
  round: number;
  /** Emails sent for this client so far (oldest first). */
  outbox?: EmailInfo[];
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
