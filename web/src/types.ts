export type Status =
  | "registering"
  | "missing_info"
  | "generating"
  | "awaiting_review"
  | "accepted"
  | "handed_off";

export interface ApiResponse {
  reply: string;
  images: string[];
  status: Status | string;
  missing: string[];
  round: number;
  /** [field-validation] Values the server rejected; the reply asks to re-enter them with an example. */
  invalid?: FieldIssue[];
}

/** [field-validation] One rejected field: `field` is the form key (a label is tolerated). */
export interface FieldIssue {
  field: string;
  label?: string;
  message: string;
  example?: string;
}

export const MAX_ROUNDS = 3;

export const STATUS_LABELS: Record<string, string> = {
  registering: "Registering",
  missing_info: "Missing info",
  generating: "Generating",
  awaiting_review: "Awaiting review",
  accepted: "Accepted",
  handed_off: "Handed off",
  // Staff review statuses
  needs_info: "More info needed",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Not approved",
  // [resume-410] Resume link states
  link_used: "Details submitted",
  link_invalid: "Link expired",
};

export interface FormFields {
  business_name: string;
  business_type: string;
  industry: string;
  business_website: string;
  contact_name: string;
  title_position: string;
  email: string;
  phone_number: string;
  design_preferences: string;
  expected_annual_revenue: string;
  requirements_notes: string;
}

export const EMPTY_FORM: FormFields = {
  business_name: "",
  business_type: "",
  industry: "",
  business_website: "",
  contact_name: "",
  title_position: "",
  email: "",
  phone_number: "",
  design_preferences: "",
  expected_annual_revenue: "",
  requirements_notes: "",
};
