import { useEffect, useState } from "react";
import type { StaffClient } from "./api";
import type { RejectedLookRound, StudioDraft, StudioGet, StudioSizePreset } from "./types";

interface Props {
  client: StaffClient;
  clientId: string;
  onOpen: (url: string) => void;
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : "That didn't go through. Please try again.");

function DraftCard({
  d,
  client,
  clientId,
  busy,
  onChange,
  onOpen,
  onRemixed,
}: {
  d: StudioDraft;
  client: StaffClient;
  clientId: string;
  busy: boolean;
  onChange: (d: StudioDraft) => void;
  onOpen: (url: string) => void;
  onRemixed: (runId: string, added: StudioDraft[], remaining: number) => void;
}) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [working, setWorking] = useState(false);
  const sent = !!d.sent_at;
  const failed = d.status !== "ok";
  const ratio = d.width && d.height ? `${d.width} / ${d.height}` : "1 / 1";

  const act = async (fn: () => Promise<StudioDraft>, failDefault: string) => {
    setWorking(true);
    setErr("");
    try {
      onChange(await fn());
    } catch (e) {
      console.error(e);
      setErr(msgOf(e) || failDefault);
    } finally {
      setWorking(false);
    }
  };

  const remix = async () => {
    setWorking(true);
    setErr("");
    try {
      const r = await client.remixDraft(clientId, {
        source_id: d.id,
        source_kind: "draft",
        note: note.trim().slice(0, 300) || undefined,
      });
      setNote("");
      onRemixed(r.run_id, r.drafts, r.remaining);
    } catch (e) {
      console.error(e);
      setErr(msgOf(e));
    } finally {
      setWorking(false);
    }
  };

  return (
    <li className="studio-card" data-status={d.status}>
      {failed ? (
        <div className="studio-failed" role="alert">
          <strong>{d.style_title || "Draft failed"}</strong>
          <span>{d.error || "Generation failed. Please try again."}</span>
        </div>
      ) : (
        <>
          {d.url && (
            <button type="button" className="studio-img" onClick={() => d.url && onOpen(d.url)} aria-label={`Enlarge draft ${d.style_title || d.id}`}>
              <img src={d.url} alt={d.style_title || "Studio draft"} loading="lazy" style={{ aspectRatio: ratio }} />
            </button>
          )}
          <div className="studio-meta">
            <strong>{d.style_title || "Studio draft"}</strong>
            <span className="studio-sub">
              {d.author || "staff"}
              {d.pinned_to === "client" ? " · Pinned to client" : ""}
              {d.pinned_to === "consult" ? " · Pinned to consult" : ""}
            </span>
          </div>
          <div className="studio-row">
            <button
              type="button"
              className="btn studio-btn"
              aria-pressed={d.starred}
              disabled={working || busy}
              onClick={() => act(() => client.starDraft(clientId, d.id, !d.starred), "Couldn't update the favourite.")}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill={d.starred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
                <path
                  d="M8 1.6l1.9 4 4.4.6-3.2 3.1.8 4.4L8 11.7l-3.9 2 .8-4.4-3.2-3.1 4.4-.6z"
                  strokeLinejoin="round"
                />
              </svg>
              {d.starred ? "Favourited" : "Favourite"}
            </button>
            <button type="button" className="btn studio-btn" disabled={working || busy || sent} onClick={remix}>
              More like this
            </button>
          </div>
          <div className="studio-row">
            <label className="studio-note" htmlFor={`note-${d.id}`}>
              <span className="staff-empty">Remix note (optional)</span>
              <span className="studio-note-row">
                <input
                  id={`note-${d.id}`}
                  type="text"
                  value={note}
                  maxLength={300}
                  disabled={working || busy || sent}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. warmer background, larger logo"
                />
                <button type="button" className="btn studio-btn" disabled={working || busy || sent} onClick={remix}>
                  Remix
                </button>
              </span>
            </label>
          </div>
          <div className="studio-row">
            <button
              type="button"
              className="btn studio-btn"
              aria-pressed={d.pinned_to === "client"}
              disabled={working || busy}
              onClick={() => act(() => client.pinDraft(clientId, d.id, d.pinned_to === "client" ? null : "client"), "Couldn't update the pin.")}
            >
              {d.pinned_to === "client" ? "Unpin from client" : "Pin to client"}
            </button>
            <button
              type="button"
              className="btn studio-btn"
              aria-pressed={d.pinned_to === "consult"}
              disabled={working || busy}
              onClick={() => act(() => client.pinDraft(clientId, d.id, d.pinned_to === "consult" ? null : "consult"), "Couldn't update the pin.")}
            >
              {d.pinned_to === "consult" ? "Unpin from consult" : "Pin to consult"}
            </button>
          </div>
          <div className="studio-row">
            {sent ? (
              <span className="studio-sent">Sent to client</span>
            ) : (
              <button
                type="button"
                className="btn primary studio-btn"
                disabled={working || busy}
                onClick={() => act(() => client.sendDraft(clientId, d.id), "Couldn't send the draft.")}
              >
                Send to client
              </button>
            )}
          </div>
          {err && (
            <p className="field-error" role="alert">
              {err}
            </p>
          )}
        </>
      )}
    </li>
  );
}

/** Image studio: staff brief, generated drafts, pins and send-to-client. */
export default function StudioPanel({ client, clientId, onOpen }: Props) {
  const [data, setData] = useState<StudioGet | null>(null);
  const [rejected, setRejected] = useState<RejectedLookRound[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [runErr, setRunErr] = useState("");
  const [prompt, setPrompt] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [preset, setPreset] = useState<StudioSizePreset>("post");
  const [running, setRunning] = useState(false);
  const [remixNote, setRemixNote] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    setData(null);
    setLoadErr("");
    client
      .studio(clientId)
      .then((x) => alive && setData(x))
      .catch((e: unknown) => alive && (console.error(e), setLoadErr("Couldn't load the studio. Please try again.")));
    client
      .rejectedLooks(clientId)
      .then((r) => alive && setRejected(r))
      .catch((e: unknown) => alive && (console.error(e), setRejected([])));
    return () => {
      alive = false;
    };
  }, [client, clientId]);

  if (loadErr)
    return (
      <div className="staff-section">
        <p className="field-error" role="alert">
          {loadErr}
        </p>
      </div>
    );
  if (!data) return <p className="staff-empty">Loading studio…</p>;

  const remaining = data.remaining;
  const canGenerate = remaining >= 3 && !running;
  const briefEntries = Object.entries(data.brief || {});

  const applyRun = (added: StudioDraft[], left: number) => {
    setData((p) => (p ? { ...p, drafts: [...p.drafts, ...added], used: p.cap - left, remaining: left } : p));
  };

  const generate = async () => {
    setRunning(true);
    setRunErr("");
    try {
      const r = await client.generateDrafts(clientId, {
        marketer_prompt: prompt.trim().slice(0, 500) || undefined,
        chips,
        preset,
      });
      applyRun(r.drafts, r.remaining);
    } catch (e) {
      console.error(e);
      setRunErr(msgOf(e));
    } finally {
      setRunning(false);
    }
  };

  const remixLook = async (lookId: string) => {
    setRunning(true);
    setRunErr("");
    try {
      const r = await client.remixDraft(clientId, {
        source_id: lookId,
        source_kind: "look",
        note: (remixNote[lookId] || "").trim().slice(0, 300) || undefined,
      });
      setRemixNote((p) => ({ ...p, [lookId]: "" }));
      applyRun(r.drafts, r.remaining);
    } catch (e) {
      console.error(e);
      setRunErr(msgOf(e));
    } finally {
      setRunning(false);
    }
  };

  const toggleChip = (id: string) => setChips((p) => (p.includes(id) ? p.filter((c) => c !== id) : [...p, id]));

  return (
    <div className="studio">
      <div className="staff-section">
        <h3>Brief (read only)</h3>
        {briefEntries.length ? (
          <dl className="staff-kv">
            {briefEntries.map(([k, v]) => (
              <div key={k} className="staff-kv-row">
                <dt>{k.replace(/_/g, " ")}:</dt>
                <dd>{v || <span className="staff-empty">Not given</span>}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="staff-empty">No brief details yet.</p>
        )}
      </div>

      <div className="staff-section">
        <h3>New drafts</h3>
        <div className="field">
          <label htmlFor={`studio-prompt-${clientId}`}>Design direction (optional, up to 500 characters)</label>
          <textarea
            id={`studio-prompt-${clientId}`}
            rows={3}
            value={prompt}
            maxLength={500}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. warm kopitiam feel, emphasise the weekend offer"
          />
          <span className="staff-hint">
            {prompt.length}/500 characters
          </span>
        </div>
        {data.chips.length ? (
          <div className="studio-chips" role="group" aria-label="Prompt helpers">
            {data.chips.map((c) => (
              <button
                key={c.id}
                type="button"
                className={"studio-chip" + (chips.includes(c.id) ? " on" : "")}
                aria-pressed={chips.includes(c.id)}
                title={c.text}
                onClick={() => toggleChip(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : null}
        <fieldset className="studio-presets">
          <legend>Size</legend>
          <div className="studio-preset-row" role="radiogroup" aria-label="Size">
            {data.presets.map((p) => (
              <label key={p.id} className={"studio-preset" + (preset === p.id ? " on" : "")}>
                <input type="radio" name={`studio-preset-${clientId}`} checked={preset === p.id} onChange={() => setPreset(p.id as StudioSizePreset)} />
                {p.label} ({p.w}×{p.h})
              </label>
            ))}
          </div>
        </fieldset>
        <div className="staff-actions">
          <span className="staff-hint" aria-live="polite">
            {remaining} of {data.cap} drafts left
          </span>
          <button type="button" className="btn primary" disabled={!canGenerate} onClick={generate}>
            {running ? "Making drafts…" : "Generate 3 drafts"}
          </button>
        </div>
        {running && (
          <p className="staff-empty" role="status" aria-live="polite">
            Making drafts… this can take a minute.
          </p>
        )}
        {runErr && (
          <p className="field-error" role="alert">
            {runErr}
          </p>
        )}
      </div>

      <div className="staff-section">
        <h3>Drafts</h3>
        {data.drafts.length ? (
          <ul className="studio-grid">
            {data.drafts.map((d) => (
              <DraftCard
                key={d.id}
                d={d}
                client={client}
                clientId={clientId}
                busy={running}
                onChange={(u) => setData((p) => (p ? { ...p, drafts: p.drafts.map((x) => (x.id === u.id ? u : x)) } : p))}
                onOpen={onOpen}
                onRemixed={(runId, added, left) => {
                  void runId;
                  applyRun(added, left);
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="staff-empty">No drafts yet. Generate the first three above.</p>
        )}
      </div>

      {!!rejected?.length && (
        <div className="staff-section">
          <h3>Looks the client did not pick</h3>
          {rejected.map((g) => (
            <div key={g.round} className="staff-rejected-round">
              <p className="staff-rejected-title">Round {g.round}</p>
              <ul className="studio-grid">
                {g.options.map((o) => (
                  <li key={o.id} className="studio-card">
                    <button type="button" className="studio-img" onClick={() => onOpen(o.url)} aria-label={`Enlarge rejected look ${o.title || o.id}`}>
                      <img src={o.url} alt={o.alt || o.title || `Rejected look ${o.id}`} loading="lazy" style={{ aspectRatio: "1 / 1" }} />
                    </button>
                    <div className="studio-meta">
                      <strong>{o.title || "Rejected look"}</strong>
                    </div>
                    <div className="studio-row">
                      <label className="studio-note" htmlFor={`remix-look-${o.id}`}>
                        <span className="staff-empty">Remix note (optional)</span>
                        <span className="studio-note-row">
                          <input
                            id={`remix-look-${o.id}`}
                            type="text"
                            value={remixNote[o.id] || ""}
                            maxLength={300}
                            disabled={running || remaining < 1}
                            onChange={(e) => setRemixNote((p) => ({ ...p, [o.id]: e.target.value }))}
                            placeholder="e.g. keep the colours, change the layout"
                          />
                          <button type="button" className="btn studio-btn" disabled={running || remaining < 1} onClick={() => remixLook(o.id)}>
                            Remix
                          </button>
                        </span>
                      </label>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
