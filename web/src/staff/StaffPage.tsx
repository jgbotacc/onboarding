import { useEffect, useRef, useState } from "react";
import { connectStaff, setOnAuthFail, setStaffKey, StaffAuthError, type StaffClient } from "./api";
import CaseView from "./CaseView";
import ConsultList from "./ConsultCard";
import DesignerPage from "./DesignerPage";
import Header from "../Header";
import { PasscodeGate } from "./PasscodeGate";
import { rowPhase, type CasePhase } from "./caseView";
import { pickStaffView } from "./route";
import { statusLabel, type StaffRow } from "./types";
import { formatDate } from "./format";
import "./staff.css";

function Pill({ status }: { status: string }) {
  return (
    <span className="pill staff-pill" data-status={status}>
      {statusLabel(status)}
    </span>
  );
}

/** The staff address shows the designer view for designer passcodes, so this
 * just reloads the same address instead of navigating to a designer address. */
export function goDesigner() {
  window.location.reload();
}

export default function StaffPage() {
  const [client, setClient] = useState<StaffClient | null>(null);
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  // Tab the open row starts on; set by the queue's "Review drafts" next step.
  const [openPhase, setOpenPhase] = useState<CasePhase | null>(null);
  const [toast, setToast] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const toastTimer = useRef<number>(0);
  const [gate, setGate] = useState<{ error: string } | null>(null);
  // Designer passcodes stay on the staff address and see the designer view.
  const [designerView, setDesignerView] = useState(() => pickStaffView(null, window.location.search) === "designer");

  const load = () =>
    connectStaff().then((r) => {
      if (!r.client && r.role === "designer") {
        setDesignerView(true);
        return;
      }
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

  const onSent = (id: string, sentAt: string) => {
    setRows((p) => p.map((r) => (r.id === id ? { ...r, sent_to_designers_at: sentAt } : r)));
    setToast("Sent to designers.");
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 5000);
  };

  if (designerView) return <DesignerPage />;

  return (
    <div className="staff">
      <Header
        title="Client onboarding"
        right={
          client?.mock ? (
            <span className="badge-demo" id="demoBadge">
              Demo (sample data)
            </span>
          ) : null
        }
      />
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
        <div className="staff-column card">
          <div className="staff-title">
            <h2>Client queue</h2>
            <span className="staff-count">{client ? `${rows.length} client${rows.length === 1 ? "" : "s"}` : "Loading…"}</span>
          </div>
          {client && !rows.length && <p className="staff-empty">No submissions yet.</p>}
          <ul className="staff-list">
            {rows.map((r, i) => {
              const isOpen = open === r.id;
              const next = rowPhase(r);
              return (
                <li key={r.id} className={"staff-item" + (isOpen ? " open" : "")}>
                  <button
                    type="button"
                    className="staff-row"
                    aria-expanded={isOpen}
                    aria-controls={`detail-${r.id}`}
                    onClick={() => { setOpen(isOpen ? null : r.id); setOpenPhase(null); }}
                  >
                    <span className="staff-queue-num" aria-hidden="true">{i + 1}</span>
                    <span className="staff-thumb">{r.image ? <img src={r.image} alt="" /> : null}</span>
                    <span className="staff-who">
                      <span className="staff-name">{r.business_name || "No business name"}</span>
                      <span className="staff-contact">
                        {r.contact_name}
                        {r.email ? ` · ${r.email}` : ""}
                        {r.sent_to_designers_at ? " · Sent to designers" : ""}
                      </span>
                    </span>
                    <span className="staff-date">{formatDate(r.updated)}</span>
                    <span className="staff-dot" data-status={r.status} aria-hidden="true" />
                    <Pill status={r.status} />
                    <svg className="staff-chev" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                      <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <div className="staff-next">
                    {next === "drafts" ? (
                      <button type="button" className="btn staff-next-btn" onClick={() => { setOpen(r.id); setOpenPhase("drafts"); }}>
                        Review drafts
                      </button>
                    ) : next === "sent" ? (
                      <span className="staff-next-muted">With designers</span>
                    ) : (
                      <span className="staff-next-muted">Waiting for client</span>
                    )}
                  </div>
                  {isOpen && client && (
                    <div id={`detail-${r.id}`}>
                      <CaseView
                        key={`${r.id}:${openPhase ?? "auto"}`}
                        client={client}
                        row={r}
                        onBack={() => { setOpen(null); setOpenPhase(null); }}
                        onOpen={setLightbox}
                        onDecided={onDecided}
                        onSent={onSent}
                        initialPhase={openPhase}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {client && <ConsultList client={client} />}
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
