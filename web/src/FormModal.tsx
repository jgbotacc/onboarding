import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CloseIcon, ImageIcon } from "./icons";
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
  onSubmit: (fields: FormFields, images: File[]) => void;
  /** Resume mode: show only these fields (others stay as saved server side). */
  only?: Key[];
  /** Resume mode: staff note shown above the fields. */
  intro?: string;
}

const MAX_IMAGES = 6;
const isImage = (f: File) => /\.(jpe?g|png)$/i.test(f.name) || f.type === "image/jpeg" || f.type === "image/png";

/** Optional reference images: thumbnails with remove buttons. Sent to /api/upload before the form. */
function RefImages({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const add = (list: FileList | null) => {
    if (!list) return;
    const all = Array.from(list);
    const ok = all.filter(isImage);
    const room = MAX_IMAGES - files.length;
    const msgs: string[] = [];
    if (ok.length < all.length) msgs.push("Only JPG and PNG images are supported.");
    if (ok.length > room) msgs.push(`Up to ${MAX_IMAGES} images.`);
    setNote(msgs.join(" "));
    if (room > 0 && ok.length) onChange([...files, ...ok.slice(0, room)]);
  };

  return (
    <div className="field full">
      <label htmlFor="f_ref_images">Reference images (optional)</label>
      <p className="field-hint" id="f_ref_images_hint">
        JPG or PNG examples of styles you like. We use them as style references for your first designs.
      </p>
      <input
        ref={inputRef}
        id="f_ref_images"
        type="file"
        accept="image/jpeg,image/png"
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="ref-grid">
        {files.map((f, i) => (
          <div className="ref-thumb" key={f.name + i}>
            <img src={urls[i]} alt={f.name} />
            <button
              type="button"
              className="ref-remove"
              aria-label={"Remove " + f.name}
              onClick={() => onChange(files.filter((_, j) => j !== i))}
            >
              <CloseIcon />
            </button>
          </div>
        ))}
        {files.length < MAX_IMAGES && (
          <button
            type="button"
            className="ref-add"
            id="refAddBtn"
            aria-describedby="f_ref_images_hint"
            onClick={() => inputRef.current?.click()}
          >
            <ImageIcon />
            <span>{files.length ? "Add more" : "Add images"}</span>
          </button>
        )}
      </div>
      {note && <div className="field-error">{note}</div>}
    </div>
  );
}

export default function FormModal({ onCancel, onSubmit, only, intro }: Props) {
  const resume = !!only?.length;
  const sections = resume
    ? SECTIONS.map((s) => ({ ...s, fields: s.fields.filter((f) => only!.includes(f.key)) })).filter((s) => s.fields.length)
    : SECTIONS;
  const visible = sections.flatMap((s) => s.fields);
  const [values, setValues] = useState<FormFields>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});
  const [images, setImages] = useState<File[]>([]);
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
    visible.forEach((f) => {
      const m = validate(f, values[f.key]);
      if (m) next[f.key] = m;
    });
    setErrors(next);
    const firstBad = visible.find((f) => next[f.key]);
    if (firstBad) {
      dialogRef.current?.querySelector<HTMLElement>(`[name="${firstBad.key}"]`)?.focus();
      return;
    }
    const trimmed = { ...values };
    (Object.keys(trimmed) as Key[]).forEach((k) => (trimmed[k] = trimmed[k].trim()));
    onSubmit(trimmed, images);
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
              <h2 id="formModalTitle">{resume ? "Update your details" : "B2B Registration Form"}</h2>
              <p id="formModalDesc">
                {resume ? "Our team asked you to fill in these fields again. Everything else is already saved." : "Fields marked * are required."}
              </p>
            </div>
            <button type="button" className="icon-btn" aria-label="Close form" onClick={onCancel}>
              <CloseIcon />
            </button>
          </div>
          <div className="modal-body">
            {resume && intro && <p className="form-intro">{intro}</p>}
            {sections.map((s) => (
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
            {!resume && (
            <fieldset className="form-section">
              <legend>Design references</legend>
              <div className="form-grid">
                <RefImages files={images} onChange={setImages} />
              </div>
            </fieldset>
            )}
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
