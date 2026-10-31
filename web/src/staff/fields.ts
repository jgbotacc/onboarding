import type { FormFields } from "../types";

export type FieldKey = keyof FormFields;

/** The 11 registration form keys, in form order, with their display labels. */
export const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "business_name", label: "Business Name" },
  { key: "business_type", label: "Business Type" },
  { key: "industry", label: "Industry" },
  { key: "business_website", label: "Business Website" },
  { key: "contact_name", label: "Contact Name" },
  { key: "title_position", label: "Title/Position" },
  { key: "email", label: "Email" },
  { key: "phone_number", label: "Phone Number" },
  { key: "design_preferences", label: "Design Preferences" },
  { key: "expected_annual_revenue", label: "Expected Annual Revenue" },
  { key: "requirements_notes", label: "Requirements / Notes" },
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
