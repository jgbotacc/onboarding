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
  submitted_at: string; // ISO 8601
  thumb: string | null; // latest generated image URL
}

/** GET /api/staff/clients/:id */
export interface StaffDetail {
  id: string;
  fields: Partial<FormFields>;
  images: string[];
  reference_images: string[];
  status: string;
  round: number;
}

/** POST /api/staff/clients/:id/decision -> DecisionResult */
export interface DecisionResult {
  ok: boolean;
  status: string;
  email?: { status: "sent" | "sent_demo" | string; to?: string; resume_url?: string; error?: string };
}

export interface DecisionBody {
  decision: Decision;
  fields: FieldKey[];
  note: string;
}

export const STAFF_STATUS_LABELS: Record<string, string> = {
  need_document: "Registering",
  registering: "Registering",
  missing_info: "Missing info",
  need_direction: "Needs direction",
  generating: "Generating",
  awaiting_review: "Awaiting client review",
  accepted: "Client accepted",
  handed_off: "Handed off",
  approved: "Approved",
  rejected: "Rejected",
  more_info_requested: "More info requested",
};

export const statusLabel = (s: string) => STAFF_STATUS_LABELS[s] || s.replace(/_/g, " ");
