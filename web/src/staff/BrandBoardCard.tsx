import { useEffect, useState } from "react";
import type { StaffClient } from "./api";
import { maskSensitive } from "./caseView";
import type { BrandBoard } from "./types";

/** Staff style-board card: photos, swatches + hex, tone/style words, summary, edit, approve/reject. */
export default function BrandBoardCard({ client, clientId, initial, onOpen }: {
  client: StaffClient; clientId: string; initial?: BrandBoard | null; onOpen: (u: string) => void;
}) {
  const [board, setBoard] = useState<BrandBoard | null | undefined>(initial);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ colours: "", tone_words: "", style_words: "", summary: "" });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    client.board(clientId).then((r) => alive && setBoard(r.board)).catch(() => alive && setBoard(initial ?? null));
    return () => { alive = false; };
  }, [client, clientId]);

  if (board === undefined) return <p className="staff-empty">Loading style…</p>;
  if (!board) return null;

  const startEdit = () => {
    setForm({
      colours: (board.colours || []).join(", "),
      tone_words: (board.tone_words || []).join(", "),
      style_words: (board.style_words || []).join(", "),
      summary: board.summary || "",
    });
    setEditing(true);
    setErr("");
  };

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      const split = (s: string) => s.split(",").map((w) => w.trim()).filter(Boolean);
      const next = await client.editBoard(clientId, {
        colours: split(form.colours),
        tone_words: split(form.tone_words),
        style_words: split(form.style_words),
        summary: form.summary.trim(),
      });
      setBoard(next);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "approve" | "reject") => {
    setBusy(true);
    setErr("");
    try {
      const next = await client.decideBoard(clientId, decision, note.trim() || undefined);
      setBoard(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const pending = board.status === "pending_review";

  return (
    <section className="bb-card" aria-label="Style board">
      <h4>Style board</h4>
      <span className="pill" data-status={board.status}>{maskSensitive(board.status.replace(/_/g, " "))}</span>
      {(board.photos || []).length > 0 && (
        <div className="bb-photos">
          {board.photos.map((u, i) => (
            <button key={i} type="button" className="staff-img bb-photo" onClick={() => onOpen(u)} aria-label={`Enlarge style photo ${i + 1}`}>
              <img src={u} alt={`Style photo ${i + 1}`} loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {(board.colours || []).length > 0 && (
        <div className="bb-swatches" aria-label="Colours">
          {board.colours.map((hex) => (
            <span key={hex} className="bb-swatch">
              <span className="bb-chip" style={{ background: hex }} aria-hidden="true" />
              {hex}
            </span>
          ))}
        </div>
      )}
      {(board.tone_words || []).length > 0 && (
        <p className="bb-words"><strong>Feel:</strong> {maskSensitive(board.tone_words.join(", "))}</p>
      )}
      {(board.style_words || []).length > 0 && (
        <p className="bb-words"><strong>Style:</strong> {maskSensitive(board.style_words.join(", "))}</p>
      )}
      {!!board.summary && <p className="bb-summary">{maskSensitive(board.summary)}</p>}
      {err && <p className="field-error" role="alert">{err}</p>}
      {!editing ? (
        <div className="staff-actions">
          <button type="button" className="btn" disabled={busy} onClick={startEdit}>Edit</button>
          {pending && (
            <>
              <button type="button" className="btn primary" disabled={busy} onClick={() => decide("approve")}>Approve</button>
              <button type="button" className="btn btn-danger-outline" disabled={busy} onClick={() => decide("reject")}>Reject</button>
            </>
          )}
        </div>
      ) : (
        <div className="bb-edit">
          <label>Colours (hex, comma apart)<input value={form.colours} onChange={(e) => setForm({ ...form, colours: e.target.value })} /></label>
          <label>Feel (words, comma apart)<input value={form.tone_words} onChange={(e) => setForm({ ...form, tone_words: e.target.value })} /></label>
          <label>Style (words, comma apart)<input value={form.style_words} onChange={(e) => setForm({ ...form, style_words: e.target.value })} /></label>
          <label>Say it in one line<input value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} maxLength={300} /></label>
          <div className="staff-actions">
            <button type="button" className="btn primary" disabled={busy} onClick={save}>Save</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setEditing(false)}>Back</button>
          </div>
        </div>
      )}
      {pending && !editing && (
        <label className="bb-note">Note for the client (only sent on reject)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></label>
      )}
    </section>
  );
}
