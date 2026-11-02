import { useState } from "react";
import type { Client } from "../api";
import { t, type Lang } from "../i18n";
import type { ApiResponse, Looks } from "../types";
import ListenButton from "../speech/ListenButton";
import { canUsePicked, hasLookOptions, isPicked, roundInfo, togglePicked } from "./picker";

interface LooksPickerProps {
  looks: Looks;
  lang: Lang;
  client: Client;
  /** True while an older round or another request owns the chat. */
  disabled?: boolean;
  trace?: (ok: boolean, ms: number) => void | Promise<void>;
  onReply: (r: ApiResponse) => void;
  onError: (e: unknown) => void;
  idPrefix?: string;
}

/**
 * One round of look options as selectable cards.
 * Each card wraps a native checkbox (checkbox semantics, keyboard operable
 * with visible focus), so the client can pick one or more looks.
 */
export default function LooksPicker({ looks, lang, client, disabled, trace, onReply, onError, idPrefix = "looks" }: LooksPickerProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (!hasLookOptions(looks)) return null;

  const { round, max } = roundInfo(looks);
  const locked = !!disabled || busy;
  const prompt = t(lang, "looks.prompt");
  const labelId = `${idPrefix}-prompt`;

  const choose = async (ids: string[]) => {
    if (locked || !canUsePicked(ids)) return;
    setBusy(true);
    try {
      onReply(await client.pickLooks(ids));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (locked) return;
    setBusy(true);
    try {
      onReply(await client.skipLooks());
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={"looks" + (locked ? " is-disabled" : "")} aria-labelledby={labelId}>
      <p className="looks-prompt" id={labelId}>
        {prompt}
      </p>
      <ListenButton id={`${idPrefix}-listen`} text={prompt} lang={lang} trace={trace} />
      <p className="looks-round">{t(lang, "looks.round", { round, max })}</p>
      <div className="look-grid" role="group" aria-label={prompt}>
        {looks.options.map((o, i) => {
          const selected = isPicked(picked, o.id);
          const name = o.alt || t(lang, "looks.option", { n: i + 1 });
          return (
            <label key={o.id} className={"look-card" + (selected ? " selected" : "")}>
              <input
                type="checkbox"
                className="look-check"
                checked={selected}
                disabled={locked}
                onChange={() => setPicked((prev) => togglePicked(prev, o.id))}
                aria-label={name}
              />
              <img src={o.url} alt={name} loading="lazy" />
              <span className="look-caption">{name}</span>
              {selected && <span className="look-badge">{t(lang, "looks.selected")}</span>}
            </label>
          );
        })}
      </div>
      <div className="look-actions">
        <button type="button" className="btn primary" disabled={locked || !canUsePicked(picked)} onClick={() => void choose(picked)}>
          {t(lang, "looks.useThese")}
        </button>
        <button type="button" className="btn" disabled={locked} onClick={() => void skip()}>
          {t(lang, "looks.skipNew")}
        </button>
      </div>
    </section>
  );
}
