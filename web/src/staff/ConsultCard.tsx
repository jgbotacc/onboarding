import { useEffect, useState } from "react";
import type { StaffClient } from "./api";
import type { Consult } from "./types";

interface CardProps {
  client: StaffClient;
  consult: Consult;
  onApproved: (c: Consult) => void;
}

function ConsultCard({ client, consult, onApproved }: CardProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const entries = Object.entries(consult.submitted || {});
  const approved = consult.status === "approved";

  const approve = async () => {
    setBusy(true);
    setFailed("");
    try {
      const updated = await client.approveConsult(consult.id);
      onApproved(updated);
    } catch (e) {
      console.error(e);
      setFailed("That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="staff-consult" data-status={consult.status}>
      <div className="staff-consult-head">
        <strong>{consult.business_name || "No business name"}</strong>
        <span className="staff-consult-status">{approved ? "Approved" : "Waiting for approval"}</span>
      </div>
      {entries.length ? (
        <dl className="staff-kv">
          {entries.map(([label, value]) => (
            <div key={label} className="staff-kv-row">
              <dt>{label}:</dt>
              <dd>{value || <span className="staff-empty">Not given</span>}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="staff-empty">Nothing submitted yet.</p>
      )}
      {consult.next_steps?.length ? (
        <div className="staff-consult-steps">
          <p className="staff-consult-label">Next steps</p>
          <ul>
            {consult.next_steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {failed && (
        <p className="field-error" role="alert">
          {failed}
        </p>
      )}
      <div className="staff-actions">
        {approved ? (
          <span className="staff-hint">Handed off{consult.decided_at ? ` on ${consult.decided_at}` : ""}.</span>
        ) : (
          <>
            <span className="staff-hint">Approving books the consult hand-off.</span>
            <button type="button" className="btn primary" disabled={busy} onClick={approve}>
              Approve hand-off
            </button>
          </>
        )}
      </div>
    </div>
  );
}

interface ListProps {
  client: StaffClient;
  clientId?: string;
}

/** Consult cards from GET /api/staff/consults. Narrows to one client when clientId is set. */
export default function ConsultList({ client, clientId }: ListProps) {
  const [items, setItems] = useState<Consult[] | null>(null);

  useEffect(() => {
    let alive = true;
    client
      .consults()
      .then((r) => alive && setItems(r))
      .catch((e: Error) => alive && (console.error(e), setItems([])));
    return () => {
      alive = false;
    };
  }, [client]);

  if (!items || !items.length) return null;
  const shown = clientId ? items.filter((c) => c.client_id === clientId) : items;
  if (!shown.length) return null;

  return (
    <div className="staff-section">
      <h3>Consult hand-off{shown.length === items.length ? "s" : ""}</h3>
      <div className="staff-consult-list">
        {shown.map((c) => (
          <ConsultCard
            key={c.id}
            client={client}
            consult={c}
            onApproved={(u) => setItems((p) => (p || []).map((x) => (x.id === u.id ? u : x)))}
          />
        ))}
      </div>
    </div>
  );
}
