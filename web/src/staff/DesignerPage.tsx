import { useEffect, useState } from "react";
import { connectDesigner, setOnAuthFail, setStaffKey, type StaffClient, type StaffRole } from "./api";
import { maskSensitive } from "./caseView";
import { PasscodeGate } from "./StaffPage";
import Header from "../Header";
import type { DesignerRow } from "./types";
import "./staff.css";

const staffHref = () => (window.location.hash.startsWith("#/") ? "#/staff" : "/staff");

const cell = (v: string | null) => (v && v.trim() ? maskSensitive(v) : "—");

function DesignerRowView({ client, row, onUploaded }: {
  client: StaffClient; row: DesignerRow; onUploaded: (id: string, urls: string[]) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const done = row.final_status === "Done";

  const download = async () => {
    setBusy(true);
    setErr("");
    try {
      const blob = await client.downloadZip(row.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `case-${row.id}-images.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      console.error(e);
      setErr("Couldn't download the images. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!files.length) return;
    setBusy(true);
    setErr("");
    try {
      const res = await client.uploadFinals(row.id, files);
      setFiles([]);
      onUploaded(row.id, res.final_images);
    } catch (e) {
      console.error(e);
      setErr("That upload didn't go through. JPG or PNG, up to 10 files, 10 MB each.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td>{cell(row.business_name)}</td>
      <td>{cell(row.business_type)}</td>
      <td>{cell(row.industry)}</td>
      <td>{cell(row.design_preferences)}</td>
      <td>{cell(row.requirements_notes)}</td>
      <td>{cell(row.brand_colours)}</td>
      <td>{cell(row.chosen_look)}</td>
      <td>
        <button type="button" className="btn staff-btn-inline" disabled={busy} onClick={download}>
          Download images
        </button>
      </td>
      <td>
        <div className="designer-upload">
          <input
            type="file"
            accept="image/jpeg,image/png"
            multiple
            aria-label={`Final images for ${row.business_name || row.id}`}
            onChange={(e) => setFiles([...(e.target.files || [])])}
          />
          <button type="button" className="btn staff-btn-inline" disabled={busy || !files.length} onClick={upload}>
            Upload final images
          </button>
        </div>
        {row.final_images.length > 0 ? (
          <div className="designer-finals">
            <div className="staff-imgs">
              {row.final_images.map((u, i) => (
                <span key={i} className="staff-img designer-thumb">
                  <img src={u} alt={`Final image ${i + 1}`} loading="lazy" />
                </span>
              ))}
            </div>
            <span className="staff-count">{row.final_images.length} final image{row.final_images.length === 1 ? "" : "s"}</span>
          </div>
        ) : (
          <span className="staff-empty">None yet</span>
        )}
        {err && <p className="field-error" role="alert">{err}</p>}
      </td>
      <td>
        <span className="pill staff-pill" data-status={done ? "approved" : "pending_review"}>
          {row.final_status}
        </span>
      </td>
    </tr>
  );
}

export default function DesignerPage() {
  const [client, setClient] = useState<StaffClient | null>(null);
  const [rows, setRows] = useState<DesignerRow[] | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [gate, setGate] = useState<{ error: string } | null>(null);

  const load = () =>
    connectDesigner().then(async (r) => {
      if (r.client) {
        setClient(r.client);
        setRows(r.rows);
        setRole(r.role);
        setGate(null);
      } else {
        setClient(null);
        setGate({ error: !r.auth ? "" : r.auth.status === 503 ? r.auth.message : "That passcode didn't work. Try again." });
      }
    });

  useEffect(() => {
    document.title = "Designer handoff · Client onboarding";
    setOnAuthFail((e) => {
      setClient(null);
      setRows(null);
      setRole(null);
      setGate({ error: e.status === 503 ? e.message : "You've been signed out. Enter the passcode again." });
    });
    load();
  }, []);

  const onUploaded = (id: string, urls: string[]) =>
    setRows((p) => (p || []).map((r) => (r.id === id ? { ...r, final_images: urls, final_status: "Done" } : r)));

  return (
    <div className="staff">
      <Header
        title="Designer handoff"
        label={<span className="staff-tag">Staff review</span>}
        right={
          <>
            {client?.mock && <span className="badge-demo" id="demoBadge">Demo (sample data)</span>}
            {role === "staff" && <a className="staff-nav" href={staffHref()}>Staff</a>}
          </>
        }
      />
      <main className="staff-main">
        {gate ? (
          <PasscodeGate error={gate.error} onSubmit={(k) => { setStaffKey(k); load(); }} />
        ) : (
          <div className="staff-column card">
            <div className="staff-title">
              <h2>Cases sent to designers</h2>
              <span className="staff-count">{rows ? `${rows.length} case${rows.length === 1 ? "" : "s"}` : "Loading…"}</span>
            </div>
            {rows && !rows.length && <p className="staff-empty">No cases sent to designers yet.</p>}
            {rows && rows.length > 0 && (
              <div className="staff-tablewrap">
                <table className="staff-traces table">
                  <thead>
                    <tr>
                      <th>Business name</th>
                      <th>Business type</th>
                      <th>Industry</th>
                      <th>Design preferences</th>
                      <th>Requirements notes</th>
                      <th>Brand colours</th>
                      <th>Chosen look</th>
                      <th>Download images</th>
                      <th>Upload final images</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {client && rows.map((r) => (
                      <DesignerRowView key={r.id} client={client} row={r} onUploaded={onUploaded} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
