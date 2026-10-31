import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CloseIcon } from "./icons";
import { EMPTY_FORM, type FormFields } from "./types";

type Key = keyof FormFields;
interface FieldDef {
  key: Key;
  label: string;
  type?: "text" | "email" | "url" | "tel" | "textarea";
  required?: boolean;
  autoComplete?: string;
  full?: boolean;
}
interface SectionDef {
  title: string;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    title: "Business information",
    fields: [
      { key: "business_name", label: "Business Name", required: true, autoComplete: "organization" },
      { key: "business_type", label: "Business Type" },
      { key: "industry", label: "Industry" },
      { key: "business_website", label: "Business Website", type: "url", autoComplete: "url" },
    ],
  },
  {
    title: "Primary contact",
    fields: [
      { key: "contact_name", label: "Contact Name", required: true, autoComplete: "name" },
      { key: "title_position", label: "Title/Position", autoComplete: "organization-title" },
      { key: "email", label: "Email", type: "email", required: true, autoComplete: "email" },
      { key: "phone_number", label: "Phone Number", type: "tel", autoComplete: "tel" },
    ],
  },
  {
    title: "Business profile",
    fields: [
      { key: "design_preferences", label: "Design Preferences" },
      { key: "expected_annual_revenue", label: "Expected Annual Revenue" },
    ],
  },
  {
    title: "Additional information",
    fields: [{ key: "requirements_notes", label: "Requirements / Notes", type: "textarea", full: true }],
  },
];
const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isUrl(v: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : "https://" + v);
    return u.hostname.includes(".");
  } catch {
    return false;
  }
}

function validate(f: FieldDef, raw: string): string {
  const v = raw.trim();
  if (f.required && !v) return `${f.label} is required.`;
  if (v && f.type === "email" && !EMAIL_RE.test(v)) return "Enter a valid email address, like name@company.com.";
  if (v && f.type === "url" && !isUrl(v)) return "Enter a valid website, like company.com.";
  return "";
}

interface Props {
  onCancel: () => void;
  onSubmit: (fields: FormFields) => void;
}

export default function FormModal({ onCancel, onSubmit }: Props) {
  const [values, setValues] = useState<FormFields>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<Key, boolean>>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>("input")?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      (restoreRef.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  const set = (f: FieldDef, v: string) => {
    setValues((p) => ({ ...p, [f.key]: v }));
    if (touched[f.key] || errors[f.key]) setErrors((p) => ({ ...p, [f.key]: validate(f, v) }));
  };
  const blur = (f: FieldDef) => {
    setTouched((p) => ({ ...p, [f.key]: true }));
    setErrors((p) => ({ ...p, [f.key]: validate(f, values[f.key]) }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Partial<Record<Key, string>> = {};
    ALL_FIELDS.forEach((f) => {
      const m = validate(f, values[f.key]);
      if (m) next[f.key] = m;
    });
    setErrors(next);
    const firstBad = ALL_FIELDS.find((f) => next[f.key]);
    if (firstBad) {
      dialogRef.current?.querySelector<HTMLElement>(`[name="${firstBad.key}"]`)?.focus();
      return;
    }
    const trimmed = { ...values };
    (Object.keys(trimmed) as Key[]).forEach((k) => (trimmed[k] = trimmed[k].trim()));
    onSubmit(trimmed);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const items = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="modal"
        id="formModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="formModalTitle"
        aria-describedby="formModalDesc"
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <form className="modal-form" onSubmit={submit} noValidate>
          <div className="modal-head">
            <div>
              <h2 id="formModalTitle">B2B Registration Form</h2>
              <p id="formModalDesc">Fields marked * are required.</p>
            </div>
            <button type="button" className="icon-btn" aria-label="Close form" onClick={onCancel}>
              <CloseIcon />
            </button>
          </div>
          <div className="modal-body">
            {SECTIONS.map((s) => (
              <fieldset key={s.title} className="form-section">
                <legend>{s.title}</legend>
                <div className="form-grid">
                  {s.fields.map((f) => {
                    const id = "f_" + f.key;
                    const err = errors[f.key];
                    const common = {
                      id,
                      name: f.key,
                      value: values[f.key],
                      "aria-invalid": err ? true : undefined,
                      "aria-describedby": err ? id + "_err" : undefined,
                      "aria-required": f.required || undefined,
                      autoComplete: f.autoComplete,
                      onBlur: () => blur(f),
                    };
                    return (
                      <div key={f.key} className={"field" + (f.full ? " full" : "") + (err ? " invalid" : "")}>
                        <label htmlFor={id}>
                          {f.label}
                          {f.required && <span className="req" aria-hidden="true"> *</span>}
                        </label>
                        {f.type === "textarea" ? (
                          <textarea {...common} rows={4} onChange={(e) => set(f, e.target.value)} />
                        ) : (
                          <input {...common} type={f.type || "text"} onChange={(e) => set(f, e.target.value)} />
                        )}
                        {err && (
                          <div className="field-error" id={id + "_err"}>
                            {err}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn primary" id="formSubmit">
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
