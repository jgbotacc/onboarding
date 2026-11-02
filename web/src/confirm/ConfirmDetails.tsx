import { useRef, useState } from "react";
import type { Client } from "../api";
import { t, type Lang } from "../i18n";
import type { ApiResponse, ExtractedField, RetakeInfo } from "../types";
import ListenButton from "../speech/ListenButton";

/** NRIC/FIN shape: never shown, matching Docs/UI-API-CONTRACT.md. */
const NRIC_RE = /[STFGM]\d{7}[A-Z]/;

const isHiddenField = (f: ExtractedField): boolean =>
  /^(nric|fin)$/i.test((f.field || "").trim()) || NRIC_RE.test((f.value || "").trim());

interface ConfirmDetailsProps {
  extracted?: ExtractedField[] | null;
  retake?: RetakeInfo | null;
  lang: Lang;
  client: Client;
  /** True while an older reply or another request owns the chat. */
  disabled?: boolean;
  trace?: (ok: boolean, ms: number) => void | Promise<void>;
  onReply: (r: ApiResponse) => void;
  onError: (e: unknown) => void;
  idPrefix?: string;
}

/**
 * Confirm card for a document reply. Shows each extracted field with a
 * Listen button and an inline editor, then Confirm (client.confirmExtracted)
 * or Remove file (client.removeUpload). A retake reply shows a short notice
 * with a Retake photo button (camera capture on mobile).
 */
export default function ConfirmDetails({
  extracted,
  retake,
  lang,
  client,
  disabled,
  trace,
  onReply,
  onError,
  idPrefix = "confirm",
}: ConfirmDetailsProps) {
  const visible = (extracted || []).filter((f) => !isHiddenField(f));
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(visible.map((f) => [f.field, f.value])),
  );
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);

  if (!visible.length && !retake) return null;

  const locked = !!disabled || busy;

  const run = async (p: () => Promise<ApiResponse>) => {
    if (locked) return;
    setBusy(true);
    try {
      onReply(await p());
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => run(() => client.confirmExtracted({ ...values }));
  const remove = () => run(() => client.removeUpload());
  const sendFiles = (files: FileList | null) => {
    if (!files || !files.length) return;
    void run(() => client.upload(Array.from(files)));
  };

  return (
    <section className="confirm-details" aria-label={t(lang, "confirm.title")}>
      {visible.length > 0 && (
        <>
          <div className="confirm-fields">
            {visible.map((f) => {
              const label = f.label || f.field;
              const value = values[f.field] ?? f.value;
              const inputId = `${idPrefix}-input-${f.field}`;
              return (
                <div className="confirm-field" key={f.field}>
                  <label className="confirm-label" htmlFor={inputId}>{label}</label>
                  <div className="confirm-edit">
                    <textarea
                      id={inputId}
                      value={values[f.field] ?? ""}
                      rows={1}
                      disabled={locked}
                      aria-label={t(lang, "confirm.edit", { label })}
                      ref={(el) => {
                        if (el) {
                          el.style.height = "auto";
                          el.style.height = el.scrollHeight + "px";
                        }
                      }}
                      onInput={(e) => {
                        const el = e.currentTarget;
                        el.style.height = "auto";
                        el.style.height = el.scrollHeight + "px";
                      }}
                      onChange={(e) => setValues((prev) => ({ ...prev, [f.field]: e.target.value }))}
                    />
                    <ListenButton id={`${idPrefix}-listen-${f.field}`} text={`${label}: ${value}`} lang={lang} trace={trace} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="confirm-actions">
            <button type="button" className="btn primary" disabled={locked} onClick={confirm}>
              {t(lang, "confirm.confirm")}
            </button>
            <button type="button" className="btn" disabled={locked} onClick={remove}>
              {t(lang, "confirm.remove")}
            </button>
            <button type="button" className="btn" disabled={locked} onClick={() => uploadRef.current?.click()}>
              {t(lang, "confirm.upload")}
            </button>
            <input
              ref={uploadRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              hidden
              onChange={(e) => {
                sendFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </>
      )}
      {retake && (
        <div className="retake">
          <p className="retake-notice">{t(lang, "confirm.retakeNotice")}</p>
          <button type="button" className="btn primary" disabled={locked} onClick={() => cameraRef.current?.click()}>
            {t(lang, "confirm.retake")}
          </button>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              sendFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </section>
  );
}
