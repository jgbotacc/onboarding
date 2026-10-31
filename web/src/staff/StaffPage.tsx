import { useEffect, useRef, useState } from "react";
import { MAX_ROUNDS } from "../types";
import { connectStaff, type StaffClient } from "./api";
import { FIELDS, type FieldKey } from "./fields";
import { statusLabel, type Decision, type DecisionResult, type EmailInfo, type StaffDetail, type StaffRow } from "./types";
import "./staff.css";

const ASSET = import.meta.env.BASE_URL;
const FINAL = ["approved", "rejected"];

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-SG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const emailText = (e?: EmailInfo | null) => {
  if (!e || !e.status) return "";
  const raw = String(e.status);
  const s = raw === "sent_demo" ? "Sent (demo)" : raw === "sent" ? "Sent" : raw.split(",")[0];
  const to = e.to || e.recipient;
  return `Email: ${s}${to ? ` to ${to}` : ""}`;
};

const DECISION_COPY: Record<Decision, { done: string; toast: string }> = {
  approve: { done: "Approved", toast: "approved" },
  reject: { done: "Rejected", toast: "rejected" },
  more_info: { done: "More information requested", toast: "asked for more information" },
};

function Pill({ status }: { status: string }) {
  return (
    <span className="pill staff-pill" data-status={status}>
      {statusLabel(status)}
    </span>
  );
}

function ImageGrid({ urls, label, onOpen }: { urls: string[]; label: string; onOpen: (u: string) => void }) {
  if (!urls.length) return <p className="staff-empty">None</p>;
  return (
    <div className="staff-imgs">
      {urls.map((u, i) => (
        <button type="button" key={i} className="staff-img" onClick={() => onOpen(u)} aria-label={`Enlarge ${label} ${i + 1}`}>
          <img src={u} alt={`${label} ${i + 1}`} loading="lazy" />
        </button>
      ))}
    </div>
  );
}

interface DetailProps {
  client: StaffClient;
  row: StaffRow;
  onDecided: (id: string, status: string, msg: string) => void;
  onOpen: (u: string) => void;
}

function Detail({ client, row, onDecided, onOpen }: DetailProps) {
  const [d, setD] = useState<StaffDetail | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"idle" | "confirm_approve" | "confirm_reject" | "more_info">("idle");
  const [ticked, setTicked] = useState<FieldKey[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ decision: Decision; res: DecisionResult } | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let alive = true;
    client
      .detail(row.id)
      .then((x) => alive && setD(x))
      .catch((e: Error) => alive && setErr(`Could not load this client (${e.message}).`));
    return () => {
      alive = false;
    };
  }, [client, row.id]);

  const decide = async (decision: Decision) => {
    setBusy(true);
    setFailed("");
    try {
      const res = await client.decide(row.id, { decision, fields: decision === "more_info" ? ticked : [], note: decision === "more_info" ? note.trim() : "" });
      if (!res || res.ok === false) throw new Error("not saved");
      setResult({ decision, res });
      setMode("idle");
      onDecided(row.id, res.status, `${row.business_name || "Client"} ${DECISION_COPY[decision].toast}. ${emailText(res.email)}`.trim());
    } catch (e) {
      setFailed(`That didn't go through (${(e as Error).message}). Please try again.`);
    } finally {
      setBusy(false);
    }
  };

  if (err) return <div className="staff-detail"><p className="field-error">{err}</p></div>;
  if (!d) return <div className="staff-detail"><p className="staff-empty">Loading…</p></div>;

  const status = result?.res.status || row.status;
  const canDecide = !result && !FINAL.includes(status);
  const name = d.fields.business_name || "this client";

  return (
    <div className="staff-detail">
      <div className="staff-contactcard">
        <div className="staff-cc-item">
          <span className="staff-cc-label">Contact</span>
          <span className="staff-cc-value">{d.fields.contact_name || "Not provided"}</span>
        </div>
        <div className="staff-cc-item">
          <span className="staff-cc-label">Email</span>
          {d.fields.email ? (
            <a className="staff-cc-value" href={`mailto:${d.fields.email}`}>
              {d.fields.email}
            </a>
          ) : (
            <span className="staff-cc-value">Not provided</span>
          )}
        </div>
        <div className="staff-cc-item">
          <span className="staff-cc-label">Round</span>
          <span className="staff-cc-value">
            {d.round} of {MAX_ROUNDS}
          </span>
        </div>
      </div>

      <div className="staff-section">
        <h3>Business details</h3>
        <dl className="staff-kv">
          {FIELDS.map((f) => (
            <div key={f.key} className="staff-kv-row">
              <dt>{f.label}:</dt>
              <dd>{(d.fields[f.key] || "").trim() || <span className="staff-empty">Not provided</span>}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="staff-section">
        <h3>Generated images</h3>
        <ImageGrid urls={d.images} label="Generated image" onOpen={onOpen} />
      </div>
      <div className="staff-section">
        <h3>Reference images</h3>
        <ImageGrid urls={d.reference_images} label="Reference image" onOpen={onOpen} />
      </div>

      {result && (
        <div className="staff-result" role="status" data-decision={result.decision}>
          <strong>{DECISION_COPY[result.decision].done}.</strong> {emailText(result.res.email)}
          {result.res.resume_url && (
            <div className="staff-result-sub">
              Resume link: <a href={result.res.resume_url}>{result.res.resume_url}</a>
            </div>
          )}
        </div>
      )}
      {!result && d.outbox?.length ? (
        <div className="staff-result">Last {emailText(d.outbox[d.outbox.length - 1])}</div>
      ) : null}
      {!canDecide && !result && <div className="staff-result">Decision already recorded: {statusLabel(status)}.</div>}
      {failed && <p className="field-error" role="alert">{failed}</p>}

      {canDecide && mode === "more_info" && (
        <div className="staff-panel" id={`moreInfo-${row.id}`}>
          <fieldset className="staff-ticks">
            <legend>Which fields should {name} fill in again?</legend>
            <div className="staff-tick-grid">
              {FIELDS.map((f) => (
                <label key={f.key} className="staff-tick">
                  <input
                    type="checkbox"
                    checked={ticked.includes(f.key)}
                    onChange={(e) => setTicked((p) => (e.target.checked ? [...p, f.key] : p.filter((k) => k !== f.key)))}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor={`note-${row.id}`}>Note to the client (optional)</label>
            <textarea id={`note-${row.id}`} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please share a working website link." />
          </div>
          <div className="staff-actions">
            <span className="staff-hint">{ticked.length ? `${ticked.length} field(s) selected` : "Select at least one field"}</span>
            <button type="button" className="btn" disabled={busy} onClick={() => setMode("idle")}>
              Cancel
            </button>
            <button type="button" className="btn primary" disabled={busy || !ticked.length} onClick={() => decide("more_info")}>
              Send request
            </button>
          </div>
        </div>
      )}

      {canDecide && (mode === "confirm_approve" || mode === "confirm_reject") && (
        <div className={"staff-confirm" + (mode === "confirm_reject" ? " danger" : "")} role="alertdialog" aria-label="Confirm decision">
          <span>
            {mode === "confirm_approve"
              ? `Approve ${name}? The client will be emailed that their designs are approved.`
              : `Reject ${name}? The client will be emailed and onboarding will stop.`}
          </span>
          <div className="staff-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => setMode("idle")}>
              Cancel
            </button>
            {mode === "confirm_approve" ? (
              <button type="button" className="btn primary" disabled={busy} onClick={() => decide("approve")}>
                Yes, approve
              </button>
            ) : (
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => decide("reject")}>
                Yes, reject
              </button>
            )}
          </div>
        </div>
      )}

      {canDecide && mode === "idle" && (
        <div className="staff-actions staff-actions-main">
          <button type="button" className="btn btn-danger-outline" onClick={() => setMode("confirm_reject")}>
            Reject
          </button>
          <button type="button" className="btn" onClick={() => setMode("more_info")}>
            I need more information
          </button>
          <button type="button" className="btn primary" onClick={() => setMode("confirm_approve")}>
            Approve
          </button>
        </div>
      )}
    </div>
  );
}

export default function StaffPage() {
  const [client, setClient] = useState<StaffClient | null>(null);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const toastTimer = useRef<number>(0);

  useEffect(() => {
    document.title = "Staff review · Client Onboarding";
    connectStaff().then(({ client, rows }) => {
      setClient(client);
      setRows(rows);
    });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLightbox(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onDecided = (id: string, status: string, msg: string) => {
    setRows((p) => p.map((r) => (r.id === id ? { ...r, status } : r)));
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 5000);
  };

  return (
    <div className="staff">
      <header className="header">
        <img className="header-avatar" src={ASSET + "agent-64.png"} alt="" aria-hidden="true" width={24} height={24} />
        <h1>Client Onboarding</h1>
        <span className="staff-tag">Staff review</span>
        {client?.mock && (
          <span className="badge-demo" id="demoBadge">
            Demo mode (mock data)
          </span>
        )}
      </header>
      <main className="staff-main">
        <div className="staff-column">
          <div className="staff-title">
            <h2>Submissions</h2>
            <span className="staff-count">{client ? `${rows.length} client${rows.length === 1 ? "" : "s"}` : "Loading…"}</span>
          </div>
          {client && !rows.length && <p className="staff-empty">No submissions yet.</p>}
          <ul className="staff-list">
            {rows.map((r) => {
              const isOpen = open === r.id;
              return (
                <li key={r.id} className={"staff-item" + (isOpen ? " open" : "")}>
                  <button
                    type="button"
                    className="staff-row"
                    aria-expanded={isOpen}
                    aria-controls={`detail-${r.id}`}
                    onClick={() => setOpen(isOpen ? null : r.id)}
                  >
                    <span className="staff-thumb">{r.image ? <img src={r.image} alt="" /> : null}</span>
                    <span className="staff-who">
                      <span className="staff-name">{r.business_name || "Unnamed business"}</span>
                      <span className="staff-contact">
                        {r.contact_name}
                        {r.email ? ` · ${r.email}` : ""}
                      </span>
                    </span>
                    <span className="staff-date">{r.updated ? fmtDate(r.updated) : ""}</span>
                    <Pill status={r.status} />
                    <svg className="staff-chev" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {isOpen && client && (
                    <div id={`detail-${r.id}`}>
                      <Detail client={client} row={r} onDecided={onDecided} onOpen={setLightbox} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </main>
      {toast && (
        <div className="staff-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Image pstaff">
          <img src={lightbox} alt="Enlarged image" />
        </div>
      )}
    </div>
  );
}
