import type { FormFields } from "../types";

export type FieldKey = keyof FormFields;

/** The 11 registration form keys, in form order, with their display labels. */
export const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "business_name", label: "Business name" },
  { key: "business_type", label: "Business type" },
  { key: "industry", label: "Industry" },
  { key: "business_website", label: "Website" },
  { key: "contact_name", label: "Contact name" },
  { key: "title_position", label: "Job title" },
  { key: "email", label: "Email" },
  { key: "phone_number", label: "Phone number" },
  { key: "design_preferences", label: "Design preferences" },
  { key: "expected_annual_revenue", label: "Expected annual revenue" },
  { key: "requirements_notes", label: "Notes" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Map `missing` entries (keys or labels, any case) to form keys; unknown entries are dropped. */
export function toFieldKeys(missing: string[]): FieldKey[] {
  const out: FieldKey[] = [];
  for (const m of missing) {
    const n = norm(m);
    const f = FIELDS.find((x) => norm(x.key) === n || norm(x.label) === n);
    if (f && !out.includes(f.key)) out.push(f.key);
  }
  return out;
}
