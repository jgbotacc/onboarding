import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getStaffKey, type StaffClient } from "./api";
import { actorRole, buildCase, casePhase, chatEntries, DRAFTS_SET_LABELS, draftsInPlay, maskSensitive, openDuration, PHASES, type CasePhase, type CaseStep } from "./caseView";
import { formatDate } from "./format";
import { statusLabel, type MismatchFlag, type StaffDetail, type StaffRow, type StudioDraft } from "./types";

const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const stepLabel = (s: CaseStep) =>
  s.status === "waiting" ? (s.waitingOn === "staff" ? "waiting for staff" : "waiting on client")
  : s.status === "done" ? "done"
  : s.status === "active" ? "in progress" : "queued";

function StepCard({ step, active, onOpen }: { step: CaseStep; active: boolean; onOpen: (s: CaseStep) => void }) {
  return (
    <button
      type="button"
      className={"cv-card" + (active ? " on" : "")}
      data-status={step.status}
      aria-current={active ? "true" : undefined}
      onClick={() => onOpen(step)}
    >
      {step.handoff && <span className="cv-handoff">{step.handoff}</span>}
      <span className="cv-time">{fmtTime(step.at)}</span>
      <span className="cv-title">{maskSensitive(step.title)}</span>
      <span className="cv-state">{stepLabel(step)}</span>
    </button>
  );
}

const emailLine = (email?: { status?: string; to?: string | null } | null) => {
  if (!email || !email.status) return "";
  const head = String(email.status).split(",")[0].trim();
  if (/^sent/i.test(head)) return `Email sent${email.to ? ` to ${email.to}` : ""}.`;
  return `Email: ${head.replace(/_/g, " ")}.`;
};

const FACT_KEYS = ["business_name", "business_type", "industry", "design_preferences", "requirements_notes", "expected_annual_revenue"] as const;

/** Document-only answers shown beside the intake facts when present or flagged. */
const DOC_FACT_LABELS: Record<string, string> = { uen: "UEN", registered_address: "Registered address" };

/** Short amber tag naming what the document said; full context in the title. */
function CaseFlag({ flag }: { flag: MismatchFlag }) {
  return (
    <span
      className="cv-flag"
      title={`Intake: ${flag.intake}; document ${flag.source} says: ${flag.document}`}
    >
      Differs from document: {flag.document}
    </span>
  );
}

/** Open a kept original in a new tab. The staff route needs x-staff-key, so a
 * plain link won't do: fetch with the passcode and open the bytes as a blob URL. */
async function openOriginal(clientId: string, docId: string, e: React.MouseEvent) {
  e.preventDefault();
  const url = `/api/staff/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(docId)}`;
  try {
    const r = await fetch(url, { headers: { "x-staff-key": getStaffKey() } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const blob = await r.blob();
    window.open(URL.createObjectURL(blob), "_blank", "noopener");
  } catch (err) {
    console.error(err);
  }
}

const docKind = (name: string) => {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "PDF";
  if (["jpg", "jpeg", "png", "heic", "heif", "webp"].includes(ext)) return "Image";
  return "File";
};

export default function CaseView({ client, row, onBack, onOpen, onDecided, onSent, onPhase, fullDetails }: {
  client: StaffClient; row: StaffRow; onBack: () => void; onOpen: (u: string) => void;
  onDecided: (id: string, status: string, msg: string) => void;
  onSent?: (id: string, sentAt: string) => void;
  onPhase?: (p: CasePhase) => void;
  fullDetails?: ReactNode;
}) {
  const [d, setD] = useState<StaffDetail | null>(null);
  const [drafts, setDrafts] = useState<StudioDraft[]>([]);
  const [shortlist, setShortlist] = useState<StudioDraft[]>([]);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<CaseStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState(false);
  const [actErr, setActErr] = useState("");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [phaseOverride, setPhaseOverride] = useState<CasePhase | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Same approve call the Full details panel uses.
  const approve = async () => {
    setBusy(true);
    setActErr("");
    try {
      const res = await client.decide(row.id, { decision: "approve", fields: [], note: "" });
      if (!res || res.ok === false) throw new Error("not saved");
      setDecided(true);
      onDecided(row.id, res.status, `${row.business_name || "Client"} approved. ${emailLine(res.email)}`.trim());
    } catch (e) {
      console.error(e);
      setActErr("That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Same share-link call the Client feedback link uses.
  const sendToClient = async () => {
    setBusy(true);
    setActErr("");
    try {
      const res = await client.createShare(row.id);
      setShareUrl(res.url);
    } catch (e) {
      console.error(e);
      setActErr("Couldn't make a client link. Please try again.");
    } finally {
      setBusy(false);
    }
  };

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
    client.shortlist(row.id).then((s) => alive && setShortlist(s.drafts || [])).catch(() => {});
    return () => { alive = false; };
  }, [client, row.id]);

  useEffect(() => {
    if (!sel) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sel]);

  const model = useMemo(() => (d ? buildCase(d, drafts) : null), [d, drafts]);
  const current = model?.steps.find((s) => s.id === model.currentStepId) || null;
  const curIdx = model && current ? model.steps.indexOf(current) + 1 : 0;
  const phase: CasePhase = phaseOverride ?? (d ? casePhase(d, drafts) : "drafts");
  const entries = useMemo(() => (d ? chatEntries(d) : []), [d]);
  const play = useMemo(() => (d ? draftsInPlay(d, drafts, shortlist) : { set: "none" as const, items: [] as { id: string; url: string; label: string }[] }), [d, drafts, shortlist]);

  useEffect(() => {
    onPhase?.(phase);
  }, [phase, onPhase]);

  if (err) return <div className="cv"><p className="field-error">{err}</p><button type="button" className="btn" onClick={onBack}>Back to the list</button></div>;
  if (!d || !model) return <div className="cv"><p className="staff-empty">Loading case…</p></div>;

  const name = d.fields.business_name || row.business_name || "Client";
  const facts = FACT_KEYS.map((k) => [k, String(d.fields[k as keyof typeof d.fields] || "")] as const)
    .filter(([, v]) => v.trim());
  const flagByField = new Map((d.mismatch_flags || []).map((f) => [f.field, f]));
  const docFacts = Object.keys(DOC_FACT_LABELS)
    .filter((k) => String(d.fields[k as keyof typeof d.fields] || "").trim() || flagByField.has(k))
    .map((k) => [k, String(d.fields[k as keyof typeof d.fields] || "")] as const);
  const docs = Object.entries(d.documents || {});
  const sentAt = d.sent_to_designers_at || null;

  return (
    <div className="cv">
      <div className="cv-head">
        <button type="button" className="btn cv-back" onClick={onBack} aria-label="Back to the client list">← Back</button>
        <h2 className="cv-name">{maskSensitive(name)}</h2>
        <span className="pill staff-pill" data-status={row.status}>{statusLabel(row.status)}</span>
        <span className="cv-meta">Open {openDuration(model.openMs)}</span>
        {current && <span className="cv-meta">Step {curIdx} of {model.steps.length} · {current.title}</span>}
      </div>

      <div className="staff-tabs cv-tabs" role="tablist" aria-label="Case stages">
        {PHASES.map((p) => (
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
            {p.label}
          </button>
        ))}
      </div>

      {phase === "onboarding" && (
        <div id={`panel-onboarding-${row.id}`} role="tabpanel" aria-labelledby={`tab-onboarding-${row.id}`} aria-label="Onboarding chat">
          {entries.length === 0 && <p className="staff-empty">No messages yet.</p>}
          <ul className="cv-chat">
            {entries.map((m, i) => (
              <li key={i} className={"cv-bubble" + (m.role === "client" ? " cv-client" : " cv-assistant")}>
                <span className="cv-who">{m.role === "client" ? "Client" : "Assistant"}</span>
                <span>{maskSensitive(m.text || "")}</span>
                {m.at && <span className="cv-time">{fmtTime(m.at)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === "drafts" && (
        <>
          <div className="cv-actions" role="group" aria-label="Case actions">
            <button type="button" className="btn primary cv-btn" disabled={busy || decided} onClick={approve}>
              Approve
            </button>
            <button
              type="button"
              className="btn cv-btn"
              disabled
              title="Pick fields in Full details and studio below"
            >
              Request changes
            </button>
            <button type="button" className="btn cv-btn" disabled={busy} onClick={sendToClient}>
              Send to client
            </button>
            <button type="button" className="btn cv-btn" disabled={busy || decided || !!sentAt} onClick={sendToDesigners}>
              {sentAt ? "Sent to designers" : "Send to designers"}
            </button>
          </div>
          {actErr && <p className="field-error" role="alert">{actErr}</p>}
          {shareUrl && (
            <p className="cv-share" role="status">
              Client link ready: <a href={shareUrl}>{shareUrl}</a>
            </p>
          )}

          <div className="cv-body" id={`panel-drafts-${row.id}`} role="tabpanel" aria-labelledby={`tab-drafts-${row.id}`}>
        <div className="cv-lanes" role="list" aria-label="Case stages">
          {model.stages.map((st) => (
            <section key={st.id} role="listitem" className="cv-lane" data-status={st.status} aria-label={`${st.label}: ${st.status}`}>
              <header className="cv-lane-head">
                <span className="cv-stage">{st.label}</span>
                <span className="cv-state">{st.status === "current" ? "in progress" : st.status}</span>
              </header>
              <div className="cv-steps">
                {st.steps.length === 0 && <p className="cv-empty">—</p>}
                {st.steps.map((s) => (
                  <StepCard key={s.id} step={s} active={s.id === model.currentStepId} onOpen={setSel} />
                ))}
              </div>
            </section>
          ))}
          <div className="cv-now" aria-hidden="true"><span>Now</span></div>
        </div>

        {sel && (
          <div className="cv-panel" role="dialog" aria-label={`Step: ${sel.title}`} ref={panelRef} tabIndex={-1}>
            <div className="cv-panel-head">
              <h3>{maskSensitive(sel.title)}</h3>
              <button type="button" className="btn cv-back" onClick={() => setSel(null)} aria-label="Close step details">×</button>
            </div>
            <p className="cv-meta">{fmtTime(sel.at)} · {stepLabel(sel)}</p>
            <h4>Started by</h4>
            <p>{maskSensitive(sel.trigger)}</p>
            <h4>Produced</h4>
            <p>{maskSensitive(sel.output)}</p>
            <h4>Audit log</h4>
            {sel.audit.length === 0 && <p className="staff-empty">No audit entries for this step.</p>}
            <ul className="cv-audit">
              {sel.audit.map((a, i) => (
                <li key={i}>
                  <span className="cv-time">{fmtTime(a.at || null)}</span>{" "}
                  {actorRole(a.actor)} · {maskSensitive(String(a.action || "").replace(/_/g, " "))}
                  {a.target ? ` · ${maskSensitive(String(a.target))}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        <aside className="cv-file" aria-label="Case file">
          <h3>Case file</h3>
          <h4>Facts</h4>
          {facts.length + docFacts.length === 0 && <p className="staff-empty">—</p>}
          <dl className="cv-facts">
            {facts.map(([k, v]) => {
              const flag = flagByField.get(k);
              return (
                <div key={k}><dt>{k.replace(/_/g, " ")}</dt><dd>{maskSensitive(v)}{flag && <CaseFlag flag={flag} />}</dd></div>
              );
            })}
            {docFacts.map(([k, v]) => {
              const flag = flagByField.get(k);
              return (
                <div key={k}><dt>{DOC_FACT_LABELS[k] || k}</dt><dd>{v ? maskSensitive(v) : <span className="staff-empty">Not given</span>}{flag && <CaseFlag flag={flag} />}</dd></div>
              );
            })}
          </dl>
          <h4>Documents</h4>
          {docs.length === 0 && <p className="staff-empty">None</p>}
          <ul className="cv-docs">
            {docs.map(([id, doc]) => {
              const name = doc.filename || id;
              return (
                <li key={id}>
                  {maskSensitive(name)} · {docKind(name)} ·{" "}
                  {doc.openable ? (
                    <span className="cv-doc-note">original kept, masked for model</span>
                  ) : (
                    <span className="cv-doc-note">{doc.status || "not openable"}</span>
                  )}
                  {doc.openable && (
                    <>
                      {" "}
                      <a
                        className="cv-doc-link"
                        href={`/api/staff/clients/${encodeURIComponent(row.id)}/documents/${encodeURIComponent(id)}`}
                        onClick={(e) => void openOriginal(row.id, id, e)}
                      >
                        Open original
                      </a>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <h4>Drafts</h4>
          {(d.images || []).length + drafts.filter((x) => x.url).length + (d.looks || []).filter((l) => l.url).length === 0 && (
            <p className="staff-empty">None yet</p>
          )}
          <div className="staff-imgs">
            {[...(d.looks || []).filter((l) => l.url).map((l) => ({ url: l.url, label: l.title || "Draft" })),
              ...drafts.filter((x) => x.url).map((x) => ({ url: x.url as string, label: x.style_title || "Studio draft" })),
            ].map((im, i) => (
              <button key={i} type="button" className="staff-img" onClick={() => onOpen(im.url)} aria-label={`Enlarge ${im.label}`}>
                <img src={im.url} alt={im.label} loading="lazy" />
              </button>
            ))}
          </div>
        </aside>
          </div>
          {fullDetails}
        </>
      )}

      {phase === "sent" && (
        <div id={`panel-sent-${row.id}`} role="tabpanel" aria-labelledby={`tab-sent-${row.id}`} aria-label="Sent to designers">
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
