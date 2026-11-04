// Public share page: the client opens /share#t=<token> (no login), sees the drafts our
// team sent, hearts or rejects each one, reviews their shortlist, then approves one
// design or asks for changes with a short note.
import { useCallback, useEffect, useState } from "react";
import { isShareMock, realShareClient, ShareLinkError, tokenFromFragment, type ShareClient, type ShareDraft, type ShareState } from "./api";
import { createShareMock } from "./mock";
import "./share.css";

type Phase = "loading" | "ready" | "missing" | "invalid" | "expired";

const SAVE_FAILED = "That didn't go through. Please try again.";

function clientFor(): ShareClient {
  return isShareMock() ? createShareMock() : realShareClient;
}

function friendlyDraft(d: ShareDraft, n: number): string {
  return d.title?.trim() || `Design ${n + 1}`;
}

export default function SharePage() {
  const [client] = useState<ShareClient>(clientFor);
  const [token, setToken] = useState(() => tokenFromFragment());
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<ShareState | null>(null);
  const [passed, setPassed] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [changeDraft, setChangeDraft] = useState("");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const [noteSent, setNoteSent] = useState(false);

  const load = useCallback(
    async (t: string) => {
      if (!t) {
        setPhase("missing");
        setData(null);
        return;
      }
      try {
        const s = await client.get(t);
        setData(s);
        setPhase("ready");
      } catch (e) {
        if (e instanceof ShareLinkError) {
          setPhase(e.status === 410 ? "expired" : "invalid");
          setData(null);
        } else {
          console.error(e);
          setSaveError(SAVE_FAILED);
          setPhase((p) => (p === "loading" ? "missing" : p));
        }
      }
    },
    [client],
  );

  // The fragment can change without a reload (mock links); pick the new token up.
  useEffect(() => {
    document.title = "Your designs · Client onboarding";
    const onHash = () => {
      setToken(tokenFromFragment());
      setArmed(null);
      setSaveError("");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    setPhase("loading");
    setData(null);
    setPassed([]);
    setArmed(null);
    setSaveError("");
    setNote("");
    setNoteError("");
    setNoteSent(false);
    void load(token);
  }, [token, load]);

  // Staff can send more drafts while the page is open: refresh live data every 15 s
  // (same rhythm as the client picker). Never polls in mock mode; a failed poll that
  // reports an ended link moves the page to that state, anything else is ignored.
  useEffect(() => {
    if (phase !== "ready" || client.mock || !token) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const s = await client.get(token);
        if (!stopped) setData(s);
      } catch (e) {
        if (stopped) return;
        if (e instanceof ShareLinkError) {
          setPhase(e.status === 410 ? "expired" : "invalid");
          setData(null);
        }
      }
    };
    const timer = window.setInterval(() => void tick(), 15000);
    window.addEventListener("focus", () => void tick());
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [phase, client, token]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setZoom(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const react = async (draftId: string, kind: "heart" | "reject") => {
    if (busy || !token) return;
    setBusy(draftId + kind);
    setSaveError("");
    try {
      const r = await client.feedback(token, { draft_id: draftId, kind });
      setData((d) => (d ? { ...d, drafts: d.drafts.map((x) => ({ ...x, liked: r.shortlist.includes(x.id) })), shortlist: r.shortlist } : d));
      setPassed((p) => (kind === "reject" ? [...new Set([...p, draftId])] : p.filter((id) => id !== draftId)));
    } catch (e) {
      console.error(e);
      setSaveError(e instanceof ShareLinkError ? e.message : SAVE_FAILED);
    } finally {
      setBusy(null);
    }
  };

  const approve = async (draftId: string) => {
    if (busy || !token) return;
    if (armed !== draftId) {
      setArmed(draftId);
      setSaveError("");
      return;
    }
    setBusy(draftId + "approve");
    setSaveError("");
    try {
      await client.feedback(token, { draft_id: draftId, kind: "approve" });
      setArmed(null);
      const s = await client.get(token);
      setData(s);
    } catch (e) {
      console.error(e);
      setSaveError(e instanceof ShareLinkError ? e.message : SAVE_FAILED);
    } finally {
      setBusy(null);
    }
  };

  const sendChanges = async () => {
    if (busy || !token || !data) return;
    const target = data.drafts.find((d) => d.id === changeDraft) || data.drafts[0];
    if (!target) return;
    const text = note.trim();
    if (!text) {
      setNoteError("Please add a short note so our team knows what to change.");
      return;
    }
    if (text.length > 500) {
      setNoteError("Please keep your note under 500 characters.");
      return;
    }
    setBusy("changes");
    setSaveError("");
    setNoteError("");
    try {
      await client.feedback(token, { draft_id: target.id, kind: "changes", note: text });
      const s = await client.get(token);
      setData(s);
      setNote("");
      setNoteSent(true);
    } catch (e) {
      console.error(e);
      setSaveError(e instanceof ShareLinkError ? e.message : SAVE_FAILED);
    } finally {
      setBusy(null);
    }
  };

  const decided = data?.decided || null;
  const approved = decided?.kind === "approve";
  const shortlisted = (data?.drafts || []).filter((d) => d.liked);
  const changeTarget = data?.drafts.find((d) => d.id === changeDraft) || data?.drafts[0];

  return (
    <div className="share">
      <header className="share-header">
        <div className="share-head-inner">
          <div>
            <p className="share-kicker">Your designs{data?.business_name ? ` · ${data.business_name}` : ""}</p>
            <h1>{data?.business_name ? `Designs for ${data.business_name}` : "Your designs"}</h1>
            <p className="share-sub">No sign-in needed — this private link opens your designs. Tap the heart on the ones you love.</p>
          </div>
          {client.mock && <span className="share-demo">Demo (sample data)</span>}
        </div>
      </header>

      <main className="share-main">
        {phase === "loading" && <p className="share-empty">Loading your designs…</p>}

        {phase === "missing" && (
          <section className="share-state" aria-live="polite">
            <h2>This link looks incomplete</h2>
            <p>We couldn't find your private link. Please open the full link our team sent you.</p>
          </section>
        )}

        {phase === "invalid" && (
          <section className="share-state" aria-live="polite">
            <h2>This link is no longer valid</h2>
            <p>It may have been replaced or switched off. Please ask our team for a new one.</p>
          </section>
        )}

        {phase === "expired" && (
          <section className="share-state" aria-live="polite">
            <h2>This link has expired</h2>
            <p>Links last 7 days. Please ask our team for a new one and we'll send it right over.</p>
          </section>
        )}

        {phase === "ready" && data && (
          <>
            {approved && (
              <section className="share-decided" role="status">
                <h2>Thank you — you've approved a design.</h2>
                <p>Our team will take it from here and be in touch soon. Nothing else you need to do.</p>
              </section>
            )}
            {!approved && decided?.kind === "changes" && (
              <section className="share-decided" role="status">
                <h2>Thanks — we've got your note.</h2>
                <p>Our team will revise the designs. You can still heart favourites or approve one below.</p>
              </section>
            )}

            {data.drafts.length === 0 ? (
              <p className="share-empty">No designs here yet — our team is still preparing them. This page refreshes on its own.</p>
            ) : (
              <ul className="share-grid">
                {data.drafts.map((d, i) => {
                  const label = friendlyDraft(d, i);
                  const saving = busy === d.id + "heart" || busy === d.id + "reject" || busy === d.id + "approve";
                  return (
                    <li key={d.id} className="share-card" data-liked={d.liked}>
                      <button type="button" className="share-img" onClick={() => setZoom(d.url)} aria-label={`Enlarge ${label}`}>
                        <img src={d.url} alt={label} loading="lazy" />
                      </button>
                      <div className="share-card-body">
                        <strong>{label}</strong>
                        {d.liked && <span className="share-loved">In your shortlist</span>}
                        {!d.liked && passed.includes(d.id) && <span className="share-passed">You passed on this one</span>}
                        <div className="share-reactions">
                          <button
                            type="button"
                            className={"share-btn" + (d.liked ? " on" : "")}
                            aria-pressed={d.liked}
                            aria-label={d.liked ? `Loved: ${label}` : `Love ${label}`}
                            disabled={saving}
                            onClick={() => void react(d.id, "heart")}
                          >
                            ♥ {d.liked ? "Loved" : "Love it"}
                          </button>
                          <button
                            type="button"
                            className="share-btn"
                            aria-label={`Not for me: ${label}`}
                            disabled={saving}
                            onClick={() => void react(d.id, "reject")}
                          >
                            ✕ Not for me
                          </button>
                        </div>
                        {approved ? null : armed === d.id ? (
                          <div className="share-confirm">
                            <span>Approve “{label}” as the final design?</span>
                            <div className="share-confirm-row">
                              <button type="button" className="share-btn" disabled={saving} onClick={() => setArmed(null)}>
                                Back
                              </button>
                              <button type="button" className="share-btn primary" disabled={saving} onClick={() => void approve(d.id)}>
                                {saving ? "Saving…" : "Yes, approve it"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button type="button" className="share-btn primary share-approve" disabled={!!busy} onClick={() => void approve(d.id)}>
                            Approve this design
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <section className="share-shortlist" aria-live="polite">
              <h2>Your shortlist ({shortlisted.length})</h2>
              {shortlisted.length === 0 ? (
                <p className="share-empty">Nothing loved yet — tap the heart on any design to add it here.</p>
              ) : (
                <ul className="share-shortlist-list">
                  {shortlisted.map((d) => (
                    <li key={d.id}>
                      <img src={d.url} alt="" aria-hidden="true" width={48} height={48} />
                      <span>{d.title?.trim() || "Design"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {!approved && data.drafts.length > 0 && (
              <section className="share-changes">
                <h2>Ask for changes</h2>
                <p className="share-empty">Tell us what to adjust and our team will revise the designs.</p>
                <label className="share-field">
                  <span>Design this note is about</span>
                  <select value={changeTarget?.id || ""} onChange={(e) => setChangeDraft(e.target.value)} disabled={busy === "changes"}>
                    {data.drafts.map((d, i) => (
                      <option key={d.id} value={d.id}>
                        {friendlyDraft(d, i)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="share-field">
                  <span>What should we change?</span>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={note}
                    onChange={(e) => {
                      setNote(e.target.value);
                      setNoteError("");
                      setNoteSent(false);
                    }}
                    placeholder="e.g. Please make the weekend offer headline bigger."
                    disabled={busy === "changes"}
                  />
                </label>
                <div className="share-changes-row">
                  <span className="share-count">{note.trim().length}/500</span>
                  <button type="button" className="share-btn primary" disabled={busy === "changes"} onClick={() => void sendChanges()}>
                    {busy === "changes" ? "Sending…" : "Send change request"}
                  </button>
                </div>
                {noteError && (
                  <p className="share-error" role="alert">
                    {noteError}
                  </p>
                )}
                {noteSent && !noteError && <p className="share-sent">Sent — thank you. Our team will revise the designs.</p>}
              </section>
            )}
          </>
        )}

        {saveError && (
          <p className="share-error" role="alert">
            {saveError}
          </p>
        )}
      </main>

      {zoom && (
        <div className="share-lightbox" onClick={() => setZoom(null)} role="dialog" aria-label="Enlarged design">
          <img src={zoom} alt="Enlarged design" />
        </div>
      )}
    </div>
  );
}
