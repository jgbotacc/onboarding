import { useEffect, useMemo, useState } from "react";
import type { StaffClient } from "./api";
import { casePhase, chatEntries, DRAFTS_SET_LABELS, draftsInPlay, maskSensitive, PHASES, type CasePhase } from "./caseView";
import ClientInfo from "./ClientInfo";
import { formatDate } from "./format";
import { statusLabel, type StaffDetail, type StaffRow, type StudioDraft } from "./types";
import StudioPanel from "./StudioPanel";

const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const HINTS: Record<CasePhase, string> = {
  onboarding: "Clients still chatting with the assistant. They move to Drafts under review on their own once drafts start.",
  drafts: "Tell the assistant what to change, pick a draft, then send it to the designers.",
  sent: "Handed over. Designers pick these up on their page.",
};

export default function CaseView({ client, row, onBack, onOpen, onSent, initialPhase }: {
  client: StaffClient; row: StaffRow; onBack: () => void; onOpen: (u: string) => void;
  onDecided: (id: string, status: string, msg: string) => void;
  onSent?: (id: string, sentAt: string) => void;
  initialPhase?: CasePhase | null;
}) {
  const [d, setD] = useState<StaffDetail | null>(null);
  const [drafts, setDrafts] = useState<StudioDraft[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [actErr, setActErr] = useState("");
  const [phaseOverride, setPhaseOverride] = useState<CasePhase | null>(initialPhase ?? null);
  const [showChat, setShowChat] = useState(false);

  // Final-edit handoff: marks the case sent to designers, then shows stage 3.
  const sendToDesigners = async () => {
    setBusy(true);
    setActErr("");
    try {
      const res = await client.sendToDesigners(row.id);
      const ts = res.sent_to_designers_at;
      setD((prev) => (prev ? { ...prev, sent_to_designers_at: ts } : prev));
      setPhaseOverride(null);
      onSent?.(row.id, ts);
    } catch (e) {
      console.error(e);
      setActErr("That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let alive = true;
    client.detail(row.id)
      .then((x) => alive && setD(x))
      .catch((e: Error) => alive && (console.error(e), setErr("Couldn't load this case. Please try again.")));
    client.studio(row.id).then((g) => alive && setDrafts(g.drafts || [])).catch(() => {});
    return () => { alive = false; };
  }, [client, row.id]);

  const entries = useMemo(() => (d ? chatEntries(d) : []), [d]);
  const play = useMemo(() => (d ? draftsInPlay(d, drafts, []) : { set: "none" as const, items: [] as { id: string; url: string; label: string }[] }), [d, drafts]);
  const phase: CasePhase = phaseOverride ?? (d ? casePhase(d, drafts) : "drafts");

  if (err) return <div className="cv"><p className="field-error">{err}</p><button type="button" className="btn" onClick={onBack}>Back to the list</button></div>;
  if (!d) return <div className="cv"><p className="staff-empty">Loading case…</p></div>;

  const name = d.fields.business_name || row.business_name || "Client";
  const sentAt = d.sent_to_designers_at || null;

  return (
    <div className="cv">
      <div className="cv-head">
        <button type="button" className="btn cv-back" onClick={onBack} aria-label="Back to the client list">← Back</button>
        <h2 className="cv-name">{maskSensitive(name)}</h2>
        <span className="pill staff-pill" data-status={row.status}>{statusLabel(row.status)}</span>
      </div>

      <div className="staff-tabs cv-tabs" role="tablist" aria-label="Case stages">
        {PHASES.map((p) => {
          const suffix = p.id === "onboarding" && entries.length ? ` (${entries.length})`
            : p.id === "drafts" && drafts.length ? ` (${drafts.length})` : "";
          const tick = p.id === "sent" && sentAt ? " ✓" : "";
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={phase === p.id}
              aria-controls={`panel-${p.id}-${row.id}`}
              id={`tab-${p.id}-${row.id}`}
              className={"staff-tab" + (phase === p.id ? " on" : "")}
              onClick={() => setPhaseOverride(p.id)}
            >
              {p.label}{suffix}{tick}
            </button>
          );
        })}
      </div>

      {phase === "onboarding" && (
        <div id={`panel-onboarding-${row.id}`} role="tabpanel" aria-labelledby={`tab-onboarding-${row.id}`} aria-label="Onboarding chat">
          <p className="cv-hint">{HINTS.onboarding}</p>
          <p className="cv-chatline">
            <span>Chat history: {entries.length} message{entries.length === 1 ? "" : "s"}, last at {entries.length ? fmtTime(entries[entries.length - 1].at) : "—"}</span>
            <button type="button" className="btn cv-btn" aria-expanded={showChat} onClick={() => setShowChat((v) => !v)}>
              {showChat ? "Hide" : "Chat history"}
            </button>
          </p>
          {showChat && (
            entries.length === 0 ? <p className="staff-empty">No messages yet.</p> :
            <ul className="cv-chat">
              {entries.map((m, i) => (
                <li key={i} className={"cv-bubble" + (m.role === "client" ? " cv-client" : " cv-assistant")}>
                  <span className="cv-who">{m.role === "client" ? "Client" : "Assistant"}</span>
                  <span>{maskSensitive(m.text || "")}</span>
                  {m.at && <span className="cv-time">{fmtTime(m.at)}</span>}
                </li>
              ))}
            </ul>
          )}
          <ClientInfo detail={d} client={client} clientId={row.id} onOpen={onOpen} />
        </div>
      )}

      {phase === "drafts" && (
        <div id={`panel-drafts-${row.id}`} role="tabpanel" aria-labelledby={`tab-drafts-${row.id}`} aria-label="Drafts under review">
          <p className="cv-hint">{HINTS.drafts}</p>
          <StudioPanel client={client} clientId={row.id} onOpen={onOpen} />
          <div className="cv-actions cv-actions-end" role="group" aria-label="Case actions">
            <button type="button" className="btn primary cv-btn" disabled={busy || !!sentAt} onClick={sendToDesigners}>
              {sentAt ? "Sent to designers" : "Send to designers"}
            </button>
          </div>
          {actErr && <p className="field-error" role="alert">{actErr}</p>}
        </div>
      )}

      {phase === "sent" && (
        <div id={`panel-sent-${row.id}`} role="tabpanel" aria-labelledby={`tab-sent-${row.id}`} aria-label="Sent to designers">
          <p className="cv-hint">{HINTS.sent}</p>
          <div className="cv-sent">
            <h3>Sent to designers</h3>
            <p className="cv-meta">{sentAt ? `Sent ${formatDate(sentAt)}.` : "Not sent yet."} Final edits happen outside this review.</p>
            <h4>{play.set === "none" ? "Drafts" : DRAFTS_SET_LABELS[play.set]}</h4>
            {play.items.length === 0 && <p className="staff-empty">No drafts yet.</p>}
            {play.items.length > 0 && (
              <div className="staff-imgs">
                {play.items.map((l) => (
                  <button key={l.id} type="button" className="staff-img" onClick={() => onOpen(l.url)} aria-label={`Enlarge ${l.label}`}>
                    <img src={l.url} alt={l.label} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
