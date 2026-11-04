import type { StaffClient } from "./api";
import { maskSensitive } from "./caseView";
import { FIELDS } from "./fields";
import RejectedLooks from "./RejectedLooks";
import type { StaffDetail } from "./types";

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

/** Client info gathered during onboarding: contact card, business details,
 *  designs, reference images and the looks the client did not pick.
 *  Field text may come from the chat, so it stays masked; NRIC never shows. */
export default function ClientInfo({ detail: d, client, clientId, onOpen }: {
  detail: StaffDetail;
  client: StaffClient;
  clientId: string;
  onOpen: (u: string) => void;
}) {
  return (
    <>
      <div className="staff-contactcard">
        <div className="staff-cc-item">
          <span className="staff-cc-label">Contact</span>
          <span className="staff-cc-value">{maskSensitive(d.fields.contact_name || "") || "Not given"}</span>
        </div>
        <div className="staff-cc-item">
          <span className="staff-cc-label">Email</span>
          {d.fields.email ? (
            <a className="staff-cc-value" href={`mailto:${d.fields.email}`}>
              {maskSensitive(d.fields.email)}
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
              <dd>{(d.fields[f.key] || "").trim() ? maskSensitive((d.fields[f.key] || "").trim()) : <span className="staff-empty">Not given</span>}</dd>
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

      <RejectedLooks client={client} clientId={clientId} onOpen={onOpen} />
    </>
  );
}
