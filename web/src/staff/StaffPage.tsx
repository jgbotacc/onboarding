import { useEffect, useRef, useState } from "react";
import { connectStaff, setOnAuthFail, setStaffKey, StaffAuthError, type StaffClient } from "./api";
import ConsultList from "./ConsultCard";
import RejectedLooks from "./RejectedLooks";
import StudioPanel from "./StudioPanel";
import { FIELDS, type FieldKey } from "./fields";
import { statusLabel, type Decision, type DecisionResult, type EmailInfo, type StaffDetail, type StaffMetrics, type StaffRow } from "./types";
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
  const to = e.to || e.recipient;
  const head = raw.split(",")[0].trim();
  if (/^sent/i.test(head)) return `Email sent${to ? ` to ${to}` : ""}${/demo/i.test(head) ? " (demo)" : ""}.`;
  return `Email: ${head.replace(/_/g, " ")}.`;
};

const DECISION_COPY: Record<Decision, { done: string; toast: string }> = {
  approve: { done: "Approved", toast: "approved" },
  reject: { done: "Rejected", toast: "rejected" },
  more_info: { done: "Asked for more info", toast: "asked for more info" },
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
  const [tab, setTab] = useState<"details" | "studio">("details");

  useEffect(() => {
    let alive = true;
    client
      .detail(row.id)
      .then((x) => alive && setD(x))
      .catch((e: Error) => alive && (console.error(e), setErr("Couldn't load this client. Please try again.")));
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
      console.error(e);
      setFailed("That didn't go through. Please try again.");
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
      <div className="staff-tabs" role="tablist" aria-label="Client sections">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "details"}
          aria-controls={`panel-details-${row.id}`}
          id={`tab-details-${row.id}`}
          className={"staff-tab" + (tab === "details" ? " on" : "")}
          onClick={() => setTab("details")}
        >
          Details
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "studio"}
          aria-controls={`panel-studio-${row.id}`}
          id={`tab-studio-${row.id}`}
          className={"staff-tab" + (tab === "studio" ? " on" : "")}
          onClick={() => setTab("studio")}
        >
          Studio
        </button>
      </div>
      {tab === "studio" ? (
        <div id={`panel-studio-${row.id}`} role="tabpanel" aria-labelledby={`tab-studio-${row.id}`}>
          <StudioPanel client={client} clientId={row.id} onOpen={onOpen} />
        </div>
      ) : (
      <div id={`panel-details-${row.id}`} role="tabpanel" aria-labelledby={`tab-details-${row.id}`}>
      <div className="staff-contactcard">
        <div className="staff-cc-item">
          <span className="staff-cc-label">Contact</span>
          <span className="staff-cc-value">{d.fields.contact_name || "Not given"}</span>
        </div>
        <div className="staff-cc-item">
          <span className="staff-cc-label">Email</span>
          {d.fields.email ? (
            <a className="staff-cc-value" href={`mailto:${d.fields.email}`}>
              {d.fields.email}
            </a>
          ) : (
            <span className="staff-cc-value">Not given</span>
          )}
        </div>
      </div>

      <div className="staff-section">
        <h3>Business details</h3>
        <dl className="staff-kv">
          {FIELDS.map((f) => (
            <div key={f.key} className="staff-kv-row">
              <dt>{f.label}:</dt>
              <dd>{(d.fields[f.key] || "").trim() || <span className="staff-empty">Not given</span>}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="staff-section">
        <h3>Designs</h3>
        <ImageGrid urls={d.images} label="Design" onOpen={onOpen} />
      </div>
      <div className="staff-section">
        <h3>Reference images</h3>
        <ImageGrid urls={d.reference_images} label="Reference image" onOpen={onOpen} />
      </div>

      <RejectedLooks client={client} clientId={row.id} onOpen={onOpen} />
      <ConsultList client={client} clientId={row.id} />

      {d.traces?.length ? (
        <div className="staff-section">
          <h3>Step traces</h3>
          <div className="staff-tablewrap">
          <table className="staff-traces">
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Model</th>
                <th scope="col">OK</th>
                <th scope="col" className="num">Ms</th>
                <th scope="col" className="num">S$ cost</th>
              </tr>
            </thead>
            <tbody>
              {d.traces.map((t, i) => (
                <tr key={i} data-ok={t.ok}>
                  <td>{t.step}</td>
                  <td>{t.model}</td>
                  <td>{t.ok ? "Yes" : "No"}</td>
                  <td className="num">{t.ms}</td>
                  <td className="num">{t.cost_sgd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}

      {result && (
        <div className="staff-result" role="status" data-decision={result.decision}>
          <strong>{DECISION_COPY[result.decision].done}.</strong> {emailText(result.res.email)}
          {result.res.resume_url && (
            <div className="staff-result-sub">
              Update link: <a href={result.res.resume_url}>{result.res.resume_url}</a>
            </div>
          )}
        </div>
      )}
      {!result && d.outbox?.length ? (
        <div className="staff-result">Latest: {emailText(d.outbox[d.outbox.length - 1])}</div>
      ) : null}
      {!canDecide && !result && <div className="staff-result">Already decided: {statusLabel(status)}.</div>}
      {failed && <p className="field-error" role="alert">{failed}</p>}

      {canDecide && mode === "more_info" && (
        <div className="staff-panel" id={`moreInfo-${row.id}`}>
          <fieldset className="staff-ticks">
            <legend>What should {name} update?</legend>
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
            <span className="staff-hint">{ticked.length ? `${ticked.length} field${ticked.length === 1 ? "" : "s"} picked` : "Pick at least one"}</span>
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
              ? `Approve ${name}? We'll email them that their designs are approved.`
              : `Reject ${name}? We'll email them and stop their onboarding.`}
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
            Ask for more info
          </button>
          <button type="button" className="btn primary" onClick={() => setMode("confirm_approve")}>
            Approve
          </button>
        </div>
      )}
      </div>
      )}
    </div>
  );
}

/** [staff-key] Passcode screen shown before any staff data loads, and again after a 401. */
function PasscodeGate({ error, onSubmit }: { error: string; onSubmit: (key: string) => void }) {
  const [key, setKey] = useState("");
  return (
    <form
      className="staff-gate"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) onSubmit(key.trim());
      }}
    >
      <h2>Staff sign-in</h2>
      <p className="staff-empty">Enter the staff passcode to see submissions.</p>
      <label htmlFor="staffKey">Passcode</label>
      <input id="staffKey" type="password" autoComplete="current-password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={!key.trim()}>
        Continue
      </button>
    </form>
  );
}

function MetricsPanel({ client }: { client: StaffClient }) {
  const [m, setM] = useState<StaffMetrics | null>(null);

  useEffect(() => {
    let alive = true;
    client
      .metrics()
      .then((x) => alive && setM(x))
      .catch((e: Error) => alive && (console.error(e), setM(null)));
    return () => {
      alive = false;
    };
  }, [client]);

  if (!m) return null;
  const o = m.outcomes;
  return (
    <div className="staff-section staff-metrics">
      <h3>Quality and cost</h3>
      <div className="staff-kpi-row">
        <div className="staff-kpi">
          <span className="staff-kpi-value">{o.completed} of {o.sessions}</span>
          <span className="staff-kpi-label">Sessions completed ({Math.round(o.completion_rate * 100)}%)</span>
        </div>
        <div className="staff-kpi">
          <span className="staff-kpi-value">S${m.total_cost_sgd.toFixed(4)}</span>
          <span className="staff-kpi-label">Total model cost</span>
        </div>
        <div className="staff-kpi">
          <span className="staff-kpi-value">{o.avg_minutes_to_finish}</span>
          <span className="staff-kpi-label">Avg minutes to finish</span>
        </div>
      </div>
      <dl className="staff-kv">
        <div className="staff-kv-row"><dt>Avg fields needing fixes:</dt><dd>{o.avg_fields_needing_fixes}</dd></div>
        <div className="staff-kv-row"><dt>Avg rounds to pick:</dt><dd>{o.avg_rounds_to_pick}</dd></div>
        <div className="staff-kv-row"><dt>Consult rate:</dt><dd>{Math.round(o.consult_rate * 100)}%</dd></div>
      </dl>
      {m.steps?.length ? (
        <div className="staff-tablewrap">
        <table className="staff-traces">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Model</th>
              <th scope="col" className="num">Calls</th>
              <th scope="col" className="num">OK rate</th>
              <th scope="col" className="num">Avg ms</th>
              <th scope="col" className="num">S$ cost</th>
            </tr>
          </thead>
          <tbody>
            {m.steps.map((s, i) => (
              <tr key={i}>
                <td>{s.step}</td>
                <td>{s.model}</td>
                <td className="num">{s.calls}</td>
                <td className="num">{Math.round(s.ok_rate * 100)}%</td>
                <td className="num">{Math.round(s.avg_latency_ms)}</td>
                <td className="num">{s.cost_sgd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}
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
  const [gate, setGate] = useState<{ error: string } | null>(null);

  const load = () =>
    connectStaff().then((r) => {
      if (r.client) {
        setClient(r.client);
        setRows(r.rows);
        setGate(null);
      } else {
        setClient(null);
        setGate({ error: !r.auth ? "" : r.auth.status === 503 ? r.auth.message : "That passcode didn't work. Try again." });
      }
    });

  useEffect(() => {
    document.title = "Staff review · Client onboarding";
    setOnAuthFail((e: StaffAuthError) => {
      setClient(null);
      setOpen(null);
      setGate({ error: e.status === 503 ? e.message : "You've been signed out. Enter the passcode again." });
    });
    load();
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
        <h1>Client onboarding</h1>
        <span className="staff-tag">Staff review</span>
        {client?.mock && (
          <span className="badge-demo" id="demoBadge">
            Demo (sample data)
          </span>
        )}
      </header>
      <main className="staff-main">
        {gate ? (
          <PasscodeGate
            error={gate.error}
            onSubmit={(k) => {
              setStaffKey(k);
              load();
            }}
          />
        ) : (
        <div className="staff-column">
          <div className="staff-title">
            <h2>Client queue</h2>
            <span className="staff-count">{client ? `${rows.length} client${rows.length === 1 ? "" : "s"}` : "Loading…"}</span>
          </div>
          {client && !rows.length && <p className="staff-empty">No submissions yet.</p>}
          <ul className="staff-list">
            {rows.map((r, i) => {
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
                    <span className="staff-queue-num" aria-hidden="true">{i + 1}</span>
                    <span className="staff-thumb">{r.image ? <img src={r.image} alt="" /> : null}</span>
                    <span className="staff-who">
                      <span className="staff-name">{r.business_name || "No business name"}</span>
                      <span className="staff-contact">
                        {r.contact_name}
                        {r.email ? ` · ${r.email}` : ""}
                      </span>
                    </span>
                    <span className="staff-date">{r.updated ? fmtDate(r.updated) : ""}</span>
                    <span className="staff-dot" data-status={r.status} aria-hidden="true" />
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
          {client && <ConsultList client={client} />}
          {client && <MetricsPanel client={client} />}
        </div>
        )}
      </main>
      {toast && (
        <div className="staff-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Image preview">
          <img src={lightbox} alt="Enlarged image" />
        </div>
      )}
    </div>
  );
}
