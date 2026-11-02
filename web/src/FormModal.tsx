import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CloseIcon, ImageIcon } from "./icons";
import { EMPTY_FORM, type FieldIssue, type FormFields } from "./types";
import { validateField } from "./validation"; // [field-validation]
import { fieldLabel, t, type I18nKey, type Lang } from "./i18n";

type Key = keyof FormFields;
interface FieldDef {
  key: Key;
  type?: "text" | "email" | "url" | "tel" | "textarea";
  required?: boolean;
  autoComplete?: string;
  full?: boolean;
}
interface SectionDef {
  title: I18nKey;
  fields: FieldDef[];
}

const SECTIONS: SectionDef[] = [
  {
    title: "section.business",
    fields: [
      { key: "business_name", required: true, autoComplete: "organization" },
      { key: "business_type" },
      { key: "industry" },
      { key: "business_website", type: "url", autoComplete: "url" },
    ],
  },
  {
    title: "section.contact",
    fields: [
      { key: "contact_name", required: true, autoComplete: "name" },
      { key: "title_position", autoComplete: "organization-title" },
      { key: "email", type: "email", required: true, autoComplete: "email" },
      { key: "phone_number", type: "tel", autoComplete: "tel" },
    ],
  },
  {
    title: "section.style",
    fields: [
      { key: "design_preferences" },
      { key: "expected_annual_revenue" },
    ],
  },
  {
    title: "section.else",
    fields: [{ key: "requirements_notes", type: "textarea", full: true }],
  },
];

// [field-validation] Instant checks (message + example) from ./validation; server `invalid` always wins.
type Issue = { message: string; example?: string; server?: boolean };
const ALL_FIELDS = SECTIONS.flatMap((s) => s.fields);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
/** Server may name a field by key or English label, whatever the UI language. */
const issueKey = (field: string): Key | undefined =>
  ALL_FIELDS.find((f) => f.key === field || norm(fieldLabel("en", f.key)) === norm(field) || norm(f.key) === norm(field))?.key;

interface Props {
  lang: Lang;
  onCancel: () => void;
  /** [field-validation] Resolve with the server's `invalid` list to keep the form open with those errors. */
  onSubmit: (fields: FormFields, images: File[]) => void | FieldIssue[] | Promise<void | FieldIssue[] | undefined>;
  /** Resume mode: show only these fields (others stay as saved server side). */
  only?: Key[];
  /** Resume mode: staff note shown above the fields. */
  intro?: string;
}

const MAX_IMAGES = 6;
const isImage = (f: File) => /\.(jpe?g|png)$/i.test(f.name) || f.type === "image/jpeg" || f.type === "image/png";

/** Optional reference images: thumbnails with remove buttons. Sent to /api/upload before the form. */
function RefImages({ files, onChange, lang }: { files: File[]; onChange: (f: File[]) => void; lang: Lang }) {
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
    if (ok.length < all.length) msgs.push(t(lang, "refOnly"));
    if (ok.length > room) msgs.push(t(lang, "refMax", { max: MAX_IMAGES }));
    setNote(msgs.join(" "));
    if (room > 0 && ok.length) onChange([...files, ...ok.slice(0, room)]);
  };

  return (
    <div className="field full">
      <label htmlFor="f_ref_images">{t(lang, "refLabel")}</label>
      <p className="field-hint" id="f_ref_images_hint">
        {t(lang, "refHint")}
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
              aria-label={t(lang, "removeFile", { name: f.name })}
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
            <span>{files.length ? t(lang, "refAddMore") : t(lang, "refAdd")}</span>
          </button>
        )}
      </div>
      {note && <div className="field-error">{note}</div>}
    </div>
  );
}

export default function FormModal({ lang, onCancel, onSubmit, only, intro }: Props) {
  const resume = !!only?.length;
  const [values, setValues] = useState<FormFields>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Partial<Record<Key, Issue>>>({});
  const [otherIssues, setOtherIssues] = useState<FieldIssue[]>([]); // [field-validation] server issues for unknown fields
  const [submitting, setSubmitting] = useState(false);
  // [field-validation] Resume form: also show any field the server rejected, even if staff didn't flag it.
  const [extra, setExtra] = useState<Key[]>([]);
  const sections = resume
    ? SECTIONS.map((s) => ({ ...s, fields: s.fields.filter((f) => only!.includes(f.key) || extra.includes(f.key)) })).filter((s) => s.fields.length)
    : SECTIONS;
  const visible = sections.flatMap((s) => s.fields);
  const [images, setImages] = useState<File[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  const labelOf = (key: Key) => fieldLabel(lang, key);
  const validate = (f: FieldDef, raw: string): Issue | undefined => validateField(f.key, raw, labelOf(f.key), f.required, lang) || undefined;

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

  // [field-validation] Editing a field clears its error; blur re-checks it.
  const set = (f: FieldDef, v: string) => {
    setValues((p) => ({ ...p, [f.key]: v }));
    if (errors[f.key]) setErrors((p) => ({ ...p, [f.key]: undefined }));
  };
  const blur = (f: FieldDef) => {
    // Keep a server error until the value is edited.
    setErrors((p) => (p[f.key]?.server ? p : { ...p, [f.key]: validate(f, values[f.key]) }));
  };

  const focusFirst = (keys: Key[]) => {
    // Wait a frame so newly shown fields (resume form) are in the DOM.
    requestAnimationFrame(() => {
      const order = ALL_FIELDS.map((f) => f.key).filter((k) => keys.includes(k));
      const el = order.length ? dialogRef.current?.querySelector<HTMLElement>(`[name="${order[0]}"]`) : dialogRef.current?.querySelector<HTMLElement>(".form-alert");
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const next: Partial<Record<Key, Issue>> = {};
    visible.forEach((f) => {
      const m = validate(f, values[f.key]);
      if (m) next[f.key] = m;
    });
    setErrors(next);
    setOtherIssues([]);
    const bad = visible.filter((f) => next[f.key]).map((f) => f.key);
    if (bad.length) {
      focusFirst(bad);
      return;
    }
    const trimmed = { ...values };
    (Object.keys(trimmed) as Key[]).forEach((k) => (trimmed[k] = trimmed[k].trim()));
    setSubmitting(true);
    let invalid: FieldIssue[] = [];
    try {
      invalid = (await onSubmit(trimmed, images)) || [];
    } finally {
      setSubmitting(false);
    }
    if (!invalid.length) return;
    // [field-validation] Server rejected some values: keep the form open, show message + example per field.
    const fromServer: Partial<Record<Key, Issue>> = {};
    const unknown: FieldIssue[] = [];
    invalid.forEach((i) => {
      const k = issueKey(i.field);
      if (k) fromServer[k] = { message: i.message, example: i.example, server: true };
      else unknown.push(i);
    });
    const keys = Object.keys(fromServer) as Key[];
    if (resume) setExtra((p) => [...p, ...keys.filter((k) => !only!.includes(k) && !p.includes(k))]);
    setErrors(fromServer);
    setOtherIssues(unknown);
    focusFirst(keys);
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
              <h2 id="formModalTitle">{t(lang, resume ? "updatedDetails" : "formTitle")}</h2>
              <p id="formModalDesc">
                {t(lang, resume ? "formDescUpdate" : "formDesc")}
              </p>
            </div>
            <button type="button" className="icon-btn" aria-label={t(lang, "closeForm")} onClick={onCancel}>
              <CloseIcon />
            </button>
          </div>
          <div className="modal-body">
            {resume && intro && <p className="form-intro">{intro}</p>}
            {otherIssues.length > 0 && (
              <div className="form-alert field-error" role="alert" tabIndex={-1}>
                {otherIssues.map((i) => (
                  <div key={i.field}>
                    <strong>{i.label || i.field}:</strong> {i.message}
                    {i.example && !i.message.includes(i.example) && <span className="field-example"> {t(lang, "forExample", { example: i.example })}</span>}
                  </div>
                ))}
              </div>
            )}
            {sections.map((s) => (
              <fieldset key={s.title} className="form-section">
                <legend>{t(lang, s.title)}</legend>
                <div className="form-grid">
                  {s.fields.map((f) => {
                    const id = "f_" + f.key;
                    const err = errors[f.key];
                    // [field-validation] Skip the example if the server message already quotes it.
                    const ex = err?.example && !err.message.includes(err.example) ? err.example : "";
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
                          {labelOf(f.key)}
                          {f.required && <span className="req" aria-hidden="true"> *</span>}
                        </label>
                        {f.type === "textarea" ? (
                          <textarea {...common} rows={4} onChange={(e) => set(f, e.target.value)} />
                        ) : (
                          <input {...common} type={f.type || "text"} onChange={(e) => set(f, e.target.value)} />
                        )}
                        {err && (
                          <div className="field-error" id={id + "_err"} role="alert">
                            <span>{err.message}</span>
                            {ex && <span className="field-example">{t(lang, "forExample", { example: ex })}</span>}
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
              <legend>{t(lang, "section.refs")}</legend>
              <div className="form-grid">
                <RefImages files={images} onChange={setImages} lang={lang} />
              </div>
            </fieldset>
            )}
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onCancel}>
              {t(lang, "cancel")}
            </button>
            <button type="submit" className="btn primary" id="formSubmit" disabled={submitting} aria-busy={submitting || undefined}>
              {submitting ? t(lang, "checking") : t(lang, "submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
