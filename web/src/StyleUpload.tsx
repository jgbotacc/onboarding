import { useRef, useState } from "react";
import type { Client, StyleBoard } from "./api";
import { t, type Lang } from "./i18n";

/** Client "Show us your style" step: upload up to 6 photos, nothing else (no links). */
export default function StyleUpload({ client, lang, onClose }: {
  client: Client | null;
  lang: Lang;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [board, setBoard] = useState<StyleBoard | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (list: FileList | null) => {
    if (!list) return;
    const imgs = [...list].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png)$/i.test(f.name));
    setFiles((prev) => [...prev, ...imgs].slice(0, 6));
    setError(imgs.length < list.length ? t(lang, "refOnly") : "");
  };

  const send = async () => {
    if (!client || !files.length || sending) return;
    setSending(true);
    setError("");
    try {
      const r = await client.styleUpload(files.slice(0, 6));
      setBoard(r.board);
      setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "sendFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="style-panel" role="dialog" aria-label={t(lang, "brandboard.title")}>
      <h2>{t(lang, "brandboard.title")}</h2>
      <p>{t(lang, "brandboard.body")}</p>
      {!board ? (
        <>
          <div className="style-choices">
            <button type="button" className="btn primary btn-big" onClick={() => inputRef.current?.click()} disabled={sending}>
              {t(lang, "brandboard.add")} ({files.length}/6)
            </button>
            <button type="button" className="btn primary btn-big" onClick={send} disabled={!files.length || sending}>
              {sending ? t(lang, "brandboard.sending") : t(lang, "brandboard.send")}
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            multiple
            hidden
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />
          {files.length > 6 && <p className="field-error">{t(lang, "brandboard.toomany")}</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <button type="button" className="btn" onClick={onClose}>
            {t(lang, "brandboard.close")}
          </button>
        </>
      ) : (
        <>
          <p role="status"><strong>{t(lang, "brandboard.done")}</strong></p>
          <p className="staff-empty">{t(lang, "brandboard.pending")}</p>
          {(board.colours?.length ?? 0) > 0 && (
            <div className="style-swatches">
              <span>{t(lang, "brandboard.colours")}: </span>
              {board.colours.map((hex) => (
                <span key={hex} className="swatch" title={hex}>
                  <span className="swatch-chip" style={{ background: hex }} aria-hidden="true" />
                  {hex}
                </span>
              ))}
            </div>
          )}
          {!!board.tone_words?.length && <p>{t(lang, "brandboard.tone")}: {board.tone_words.join(", ")}</p>}
          {!!board.style_words?.length && <p>{t(lang, "brandboard.style")}: {board.style_words.join(", ")}</p>}
          {!!board.summary && <p>{board.summary}</p>}
          <button type="button" className="btn primary btn-big" onClick={onClose}>
            {t(lang, "brandboard.close")}
          </button>
        </>
      )}
    </div>
  );
}
