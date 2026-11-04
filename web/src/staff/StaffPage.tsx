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
      <h2 className="staff-client-name">{d.fields.business_name || "No business name"}</h2>
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
          <table className="staff-traces">
            <thead>
              <tr>
                <th scope="col">Step</th>
                <th scope="col">Model</th>
                <th scope="col">OK</th>
                <th scope="col">Ms</th>
                <th scope="col">S$ cost</th>
              </tr>
            </thead>
            <tbody>
              {d.traces.map((t, i) => (
                <tr key={i} data-ok={t.ok}>
                  <td>{t.step}</td>
                  <td>{t.model}</td>
                  <td>{t.ok ? "Yes" : "No"}</td>
                  <td>{t.ms}</td>
                  <td>{t.cost_sgd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
      <dl className="staff-kv">
        <div className="staff-kv-row"><dt>Sessions:</dt><dd>{o.sessions}</dd></div>
        <div className="staff-kv-row"><dt>Completed:</dt><dd>{o.completed} ({Math.round(o.completion_rate * 100)}%)</dd></div>
        <div className="staff-kv-row"><dt>Avg minutes to finish:</dt><dd>{o.avg_minutes_to_finish}</dd></div>
        <div className="staff-kv-row"><dt>Avg fields needing fixes:</dt><dd>{o.avg_fields_needing_fixes}</dd></div>
        <div className="staff-kv-row"><dt>Avg rounds to pick:</dt><dd>{o.avg_rounds_to_pick}</dd></div>
        <div className="staff-kv-row"><dt>Consult rate:</dt><dd>{Math.round(o.consult_rate * 100)}%</dd></div>
        <div className="staff-kv-row"><dt>Total cost:</dt><dd>S${m.total_cost_sgd.toFixed(4)}</dd></div>
      </dl>
      {m.steps?.length ? (
        <table className="staff-traces staff-traces-metrics">
          <thead>
            <tr>
              <th scope="col">Step</th>
              <th scope="col">Model</th>
              <th scope="col">Calls</th>
              <th scope="col">OK rate</th>
              <th scope="col">Avg ms</th>
              <th scope="col">S$ cost</th>
            </tr>
          </thead>
          <tbody>
            {m.steps.map((s, i) => (
              <tr key={i}>
                <td>{s.step}</td>
                <td>{s.model}</td>
                <td>{s.calls}</td>
                <td>{Math.round(s.ok_rate * 100)}%</td>
                <td>{Math.round(s.avg_latency_ms)}</td>
                <td>{s.cost_sgd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

  // Longest-waiting client that still needs a decision, from the rows already loaded.
  const waiting = rows
    .filter((r) => !["approved", "rejected", "accepted", "handed_off"].includes(r.status))
    .sort((a, b) => String(a.updated || "").localeCompare(String(b.updated || "")));
  const longest = waiting.length ? waiting[0] : null;

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
          {client && <MetricsPanel client={client} />}
          {client && <ConsultList client={client} />}
          <div className="staff-title">
            <h2>Submissions</h2>
            <span className="staff-count">{client ? `${rows.length} client${rows.length === 1 ? "" : "s"}` : "Loading…"}</span>
          </div>
          {client && longest && (
            <p className="staff-summary">
              <strong>{longest.business_name || "No business name"}</strong> waiting longest, {statusLabel(longest.status).toLowerCase()}.
            </p>
          )}
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
                      <span className="staff-name">{r.business_name || "No business name"}</span>
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
