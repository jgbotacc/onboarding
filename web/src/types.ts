import en from "./i18n/en";

export type Lang = "en" | "zh" | "ms" | "ta";

export type Status =
  | "registering"
  | "missing_info"
  | "confirm_details"
  | "choosing_look"
  | "generating"
  | "awaiting_review"
  | "accepted"
  | "handed_off";

export interface LookOption {
  id: string;
  url: string;
  /** Short description in the client's language (PRD name: `title`). */
  alt: string;
  /** True for staff-sent looks (PRD: `suggested: true`). */
  suggested?: boolean;
}

/** Read-only staff suggestion shown after the picker (session `suggested_looks`). */
export interface SuggestedLook {
  id: string;
  url: string;
  /** Short description (backend PRD name: `title`; normalized to `alt` too). */
  alt: string;
  title?: string;
  suggested?: boolean;
}

export interface Looks {
  round: number;
  max_rounds: number;
  options: LookOption[];
  prompt?: string;
}

export interface ExtractedField {
  field: string;
  label: string;
  value: string;
}

export interface RetakeInfo {
  reason: string;
}

export interface ConsultInfo {
  status: string;
  submitted?: Record<string, string>;
  next_steps?: string[];
  id?: string;
}

export type TraceKind = "listen" | "mic";

/** UI ↔ API contract (`Docs/UI-API-CONTRACT.md`): every client reply shape. */
export interface ChatReply {
  reply: string;
  /** True only on the reference-images step (need_direction with refs pending). */
  refsStep?: boolean;
  lang?: Lang | string;
  /** English source of `reply`; POST /api/translate re-translates it on language switch. */
  source?: string;
  /** New step name; falls back to `status` when the backend sends only v1 `status`. */
  step?: string;
  status: Status | string;
  images: string[];
  missing: string[];
  round: number;
  /** [field-validation] Values the server rejected; the reply asks to re-enter them with an example. */
  invalid?: FieldIssue[];
  looks?: Looks | null;
  suggested_looks?: SuggestedLook[] | null;
  extracted?: ExtractedField[] | null;
  retake?: RetakeInfo | null;
  consult?: ConsultInfo | null;
}

/** v1 name for {@link ChatReply}; kept so existing UI keeps compiling. */
export type ApiResponse = ChatReply;

/** [field-validation] One rejected field: `field` is the form key (a label is tolerated). */
export interface FieldIssue {
  field: string;
  label?: string;
  message: string;
  example?: string;
}

export const MAX_ROUNDS = 3;

/** English status labels, derived from the i18n dict. The client UI uses statusLabel() for the active language. */
export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(en)
    .filter(([k]) => k.startsWith("status."))
    .map(([k, v]) => [k.slice("status.".length), v]),
);

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
