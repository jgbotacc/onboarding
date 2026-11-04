import { useCallback, useEffect, useState } from "react";
import type { StaffClient } from "./api";
import type { FeedbackKind, ShareCreated, ShareLink, ShortlistView } from "./types";

const msgOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't go through. Please try again.");

const KIND_LABEL: Record<FeedbackKind, string> = {
  heart: "Hearted",
  reject: "Rejected",
  approve: "Approved",
  changes: "Asked for changes",
};

/** Reuses the queue pill tints: approved green, rejected red, changes accent. */
const KIND_STATUS: Record<FeedbackKind, string | undefined> = {
  heart: undefined,
  reject: "rejected",
  approve: "approved",
  changes: "needs_info",
};

const fmtDateTime = (iso: string | null) => {
  if (!iso) return "Not yet";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-SG", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const linkStatus = (s: ShareLink): "Live" | "Expired" | "Revoked" => {
  if (s.revoked_at) return "Revoked";
  const exp = new Date(s.expires_at).getTime();
  if (Number.isNaN(exp) || exp <= Date.now()) return "Expired";
  return "Live";
};

const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
};

/** Staff side of client feedback: share links plus the shortlist with the client's taps. */
export default function FeedbackPanel({ client, clientId }: { client: StaffClient; clientId: string }) {
  const [shares, setShares] = useState<ShareLink[] | null>(null);
  const [sharesErr, setSharesErr] = useState("");
  const [days, setDays] = useState("7");
  const [creating, setCreating] = useState(false);
  // The new link lives in memory only: shown once, never stored or logged.
  const [created, setCreated] = useState<ShareCreated | null>(null);
  const [createErr, setCreateErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [shortlist, setShortlist] = useState<ShortlistView | null>(null);
  const [shortlistErr, setShortlistErr] = useState("");

  const reloadShares = useCallback(() => {
    client.listShares(clientId).then(
      (r) => {
        setShares(r);
        setSharesErr("");
      },
      (e: unknown) => {
        console.error(e);
        setSharesErr("Couldn't load the share links. Please try again.");
      },
    );
  }, [client, clientId]);

  const reloadShortlist = useCallback(() => {
    client.shortlist(clientId).then(
      (r) => {
        setShortlist(r);
        setShortlistErr("");
      },
      (e: unknown) => {
        console.error(e);
        setShortlistErr("Couldn't load the shortlist. Please try again.");
      },
    );
  }, [client, clientId]);

  useEffect(() => {
    setShares(null);
    setShortlist(null);
    setCreated(null);
    setCopied(false);
    reloadShares();
    reloadShortlist();
  }, [client, clientId, reloadShares, reloadShortlist]);

  const create = async () => {
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      setCreateErr("Pick a lifetime between 1 and 30 days.");
      return;
    }
    setCreating(true);
    setCreateErr("");
    try {
      const res = await client.createShare(clientId, n);
      setCreated(res);
      setCopied(false);
      reloadShares();
    } catch (e) {
      console.error(e);
      setCreateErr(msgOf(e));
    } finally {
      setCreating(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    setCopied(await copyText(created.url));
  };

  const revoke = async (tokenId: string) => {
    setRevoking(tokenId);
    try {
      await client.revokeShare(clientId, tokenId);
      reloadShares();
    } catch (e) {
      console.error(e);
      setSharesErr(msgOf(e));
    } finally {
      setRevoking(null);
    }
  };

  const titleOf = (draftId: string) =>
    shortlist?.drafts.find((d) => d.id === draftId)?.style_title || "No longer on the shortlist";
  const feed = [...(shortlist?.feedback || [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <>
      <div className="staff-section">
        <h3>Client feedback link</h3>
        <p className="staff-empty">A no-login link for the client to heart, reject, approve or request changes.</p>
        <div className="staff-share-row">
          <label htmlFor={`share-days-${clientId}`}>Link lasts</label>
          <select id={`share-days-${clientId}`} value={days} disabled={creating} onChange={(e) => setDays(e.target.value)}>
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} day{d === 1 ? "" : "s"}
              </option>
            ))}
          </select>
          <button type="button" className="btn primary" disabled={creating} onClick={create}>
            {creating ? "Creating…" : "Create link"}
          </button>
        </div>
        {createErr && (
          <p className="field-error" role="alert">
            {createErr}
          </p>
        )}
        {created && (
          <div className="staff-panel" role="status" aria-label="New share link">
            <strong>Copy this link now. It won't be shown again.</strong>
            <span className="staff-share-urlrow">
              <input type="text" readOnly value={created.url} aria-label="New share link" onFocus={(e) => e.target.select()} />
              <button type="button" className="btn" onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </button>
            </span>
            <span className="staff-hint">Expires {fmtDateTime(created.expires_at)}.</span>
            <span className="staff-actions">
              <button type="button" className="btn" onClick={() => setCreated(null)}>
                Dismiss
              </button>
            </span>
          </div>
        )}
      </div>

      <div className="staff-section">
        <h3>Share links</h3>
        {sharesErr && (
          <p className="field-error" role="alert">
            {sharesErr}
          </p>
        )}
        {!shares ? (
          <p className="staff-empty">Loading links…</p>
        ) : !shares.length ? (
          <p className="staff-empty">No links yet. Create the first one above.</p>
        ) : (
          <div className="staff-tablewrap">
            <table className="staff-traces table">
              <thead>
                <tr>
                  <th scope="col">Created by</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Opened</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="staff-sr">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => {
                  const st = linkStatus(s);
                  return (
                    <tr key={s.id}>
                      <td>{s.created_by || "staff"}</td>
                      <td className="num">{fmtDateTime(s.expires_at)}</td>
                      <td>{s.used_at ? fmtDateTime(s.used_at) : "Not yet"}</td>
                      <td>{st}</td>
                      <td>
                        {st === "Live" ? (
                          <button
                            type="button"
                            className="btn btn-danger-outline staff-btn-inline"
                            disabled={revoking === s.id}
                            onClick={() => revoke(s.id)}
                          >
                            {revoking === s.id ? "Revoking…" : "Revoke"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="staff-section">
        <h3>Shortlist and client taps</h3>
        {shortlistErr && (
          <p className="field-error" role="alert">
            {shortlistErr}
          </p>
        )}
        {!shortlist ? (
          <p className="staff-empty">Loading shortlist…</p>
        ) : (
          <>
            {shortlist.drafts.length ? (
              <ul className="studio-grid">
                {shortlist.drafts.map((d) => (
                  <li key={d.id} className="studio-card">
                    {d.url && (
                      <span className="studio-img" aria-hidden="true">
                        <img src={d.url} alt="" loading="lazy" />
                      </span>
                    )}
                    <div className="studio-meta">
                      <strong>{d.style_title || "Shortlisted draft"}</strong>
                      <span className="studio-sub">{d.sent_at ? "Sent to client" : "Not sent"}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="staff-empty">Nothing shortlisted yet. Hearts from the client land here.</p>
            )}
            <h4 className="staff-feed-title">Client taps</h4>
            {feed.length ? (
              <div className="staff-tablewrap">
                <table className="staff-traces table">
                  <thead>
                    <tr>
                      <th scope="col">Draft</th>
                      <th scope="col">Tap</th>
                      <th scope="col">Note</th>
                      <th scope="col">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {feed.map((f, i) => (
                      <tr key={`${f.draft_id}-${f.created_at}-${i}`}>
                        <td>{titleOf(f.draft_id)}</td>
                        <td>
                          <span className="pill" data-status={KIND_STATUS[f.kind]}>
                            {KIND_LABEL[f.kind]}
                          </span>
                        </td>
                        <td className="staff-feed-note">{f.note || "—"}</td>
                        <td className="num">{fmtDateTime(f.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="staff-empty">No taps yet.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
