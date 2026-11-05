import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { clearClientSession, connect, HttpError, type Client } from "./api";
import { EMPTY_FORM, type ApiResponse, type ConsultInfo, type ExtractedField, type FieldIssue, type FormFields, type Looks, type RetakeInfo, type SuggestedLook } from "./types";
import ConfirmDetails from "./confirm/ConfirmDetails";
import FormModal from "./FormModal";
import Header from "./Header";
import LooksPicker from "./looks/LooksPicker";
import { mergeLooks, mergeSuggested } from "./looks/refresh";
import { toFieldKeys } from "./staff/fields";
import { LANGS, fieldLabel, statusLabel, t, useLang, type I18nKey, type Lang } from "./i18n";
import { pendingSources, seedTranslation, swapMessages } from "./retranslate";
import { CheckboxIcon, CloseIcon, FileIcon, ImageIcon, MicIcon, PaperclipIcon, SendIcon } from "./icons";
import ListenButton from "./speech/ListenButton";
import { isMicSupported, startListening } from "./speech/mic";

type Msg =
  | { id: number; role: "user"; text: string; files: string[] }
  | { id: number; role: "assistant"; text: string; images: string[]; status: string; round: number; choices?: boolean; refsStep?: boolean; looks?: Looks | null; suggested_looks?: SuggestedLook[] | null; extracted?: ExtractedField[] | null; retake?: RetakeInfo | null; consult?: ConsultInfo | null; source?: string; i18nKey?: "greeting" | "welcomeBack" }
  | { id: number; role: "error"; text: string };

type NewMsg = Msg extends infer T ? (T extends Msg ? Omit<T, "id"> : never) : never;

const isAcceptable = (f: File) => /\.(pdf|jpe?g|png)$/i.test(f.name) || f.type === "application/pdf" || f.type === "image/jpeg" || f.type === "image/png";

let nextId = 1;

// Resume link: `missing` may hold form keys or labels.
const toFormKeys = (missing: string[]) => toFieldKeys(missing).filter((k) => k in EMPTY_FORM);

const ASSET = import.meta.env.BASE_URL;

/** One line per "\n"; "• " lines get a hanging indent; blank lines become a small gap. */
function MsgText({ text }: { text: string }) {
  return (
    <div className="msg-text">
      {text.split("\n").map((line, i) =>
        !line.trim() ? <div key={i} className="gap" /> : <div key={i} className={line.startsWith("• ") ? "li" : undefined}>{line}</div>,
      )}
    </div>
  );
}

function Avatar() {
  return <img className="avatar" src={ASSET + "agent-64.png"} alt="" aria-hidden="true" width={32} height={32} />;
}

export default function App() {
  const [lang, setLang] = useLang();
  const [client, setClient] = useState<Client | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  // History re-translation: cached translation per source+lang for this page.
  const transCache = useRef(new Map<string, string>());
  const messagesRef = useRef<Msg[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const [status, setStatus] = useState("registering");
  const [missing, setMissing] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // Language switch: true while earlier replies re-translate.
  const [translating, setTranslating] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micSupported] = useState(() => isMicSupported());
  const micStopRef = useRef<(() => void) | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Final accepted message: shown as a popup, not a chat bubble. Dismissed per
  // message id so a later accepted reply pops up again.
  const [dismissedAcceptedId, setDismissedAcceptedId] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  // Resume link (/?resume=<token>): fields staff asked the client to fill in again.
  const [refill, setRefill] = useState<{ keys: (keyof FormFields)[]; note: string } | null>(null);
  const dragDepth = useRef(0);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const closed = !!client?.linkClosed; // [resume-410]
  // [chat-gate] The chat box stays hidden on the start screen until a PDF upload succeeds, the form is
  // submitted, or a resume-link session loads. Reference-image-only uploads don't count.
  const [chatReady, setChatReady] = useState(false);
  // [field-validation] Reply held back while the form stays open on server `invalid`; shown if the client cancels.
  const heldRef = useRef<{ user: NewMsg; r: ApiResponse } | null>(null);
  const uploadedRef = useRef<File[]>([]); // reference images already sent, so a resubmit doesn't re-upload

  const push = useCallback((m: NewMsg) => setMessages((prev) => [...prev, { ...m, id: nextId++ } as Msg]), []);

  const traceListen = useCallback(
    (ok: boolean, ms: number) => {
      client?.trace("listen", ok, ms);
    },
    [client],
  );

  const traceMic = useCallback(
    (ok: boolean, ms: number) => {
      client?.trace("mic", ok, ms);
    },
    [client],
  );

  useEffect(() => {
    let alive = true;
    connect().then((c) => {
      if (!alive) return;
      setClient(c);
      if (c.linkClosed || c.resume) setChatReady(true); // [chat-gate]
      if (c.linkClosed) {
        // [resume-410] Used/unknown resume link: show the message, no start choices, chat closed.
        seedTranslation(transCache.current, c.linkClosed.message, lang, c.linkClosed.message);
        setMessages([{ id: nextId++, role: "assistant", text: c.linkClosed.message, images: [], status: c.linkClosed.status, round: 0, source: c.linkClosed.message }]);
        setStatus(c.linkClosed.status);
        return;
      }
      if (c.resume) {
        const keys = toFormKeys(c.resume.missing);
        const welcome = !c.resume.reply;
        if (!welcome) seedTranslation(transCache.current, c.resume.reply, lang, c.resume.reply);
        setMessages([{ id: nextId++, role: "assistant", text: c.resume.reply || t(lang, "welcomeBack"), images: [], status: "missing_info", round: 0, ...(welcome ? { i18nKey: "welcomeBack" as const } : { source: c.resume.reply }) }]);
        setStatus("missing_info");
        if (keys.length) {
          setRefill({ keys, note: c.resume.reply });
          setFormOpen(true);
        } else setMissing(c.resume.missing);
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete("resume"); // one-time token: drop it from the address bar
          window.history.replaceState(null, "", u.toString());
        } catch {
          /* ignore */
        }
        return;
      }
      setMessages([{ id: nextId++, role: "assistant", text: t(lang, "greeting"), images: [], status: "registering", round: 0, choices: true, i18nKey: "greeting" }]);
      inputRef.current?.focus();
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setLightbox(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [text]);

  // The language changed under us: stop listening so the old language can't continue.
  useEffect(() => {
    micStopRef.current?.();
    micStopRef.current = null;
    setMicOn(false);
  }, [lang]);

  // Language switch: built-in lines re-render from i18n; server lines show the cached
  // translation for the new language at once, else one client.translate call for all
  // uncached sources swaps the text in place. A failed call keeps the text on screen.
  // While the call runs, a small note shows in the target language.
  useEffect(() => {
    const renderBuiltin = (key: string) => t(lang, key as I18nKey);
    setMessages((prev) => swapMessages(prev, lang, transCache.current, new Map(), renderBuiltin));
    const needed = pendingSources(messagesRef.current, lang, transCache.current);
    if (!client || needed.length === 0) {
      setTranslating(false);
      return;
    }
    let alive = true;
    setTranslating(true);
    client
      .translate(needed, lang)
      .then((res) => {
        if (!alive) return;
        const fetched = new Map(needed.map((s, i) => [s, res.texts[i] ?? s] as [string, string]));
        setMessages((prev) => swapMessages(prev, lang, transCache.current, fetched, renderBuiltin));
        setTranslating(false);
      })
      .catch(() => {
        /* keep the text on screen */
        if (!alive) return;
        setTranslating(false);
      });
    return () => {
      alive = false;
    };
  }, [lang, client]);

  useEffect(
    () => () => {
      micStopRef.current?.();
    },
    [],
  );

  const render = useCallback(
    (r: ApiResponse) => {
      // History re-translation: keep the English source so a language switch can re-translate.
      const source = r.source ?? r.reply ?? "";
      const creationLang: Lang = r.lang === "en" || r.lang === "zh" || r.lang === "ms" || r.lang === "ta" ? r.lang : lang;
      if (source) seedTranslation(transCache.current, source, creationLang, r.reply || "");
      push({ role: "assistant", text: r.reply || "", images: r.consult ? [] : r.images || [], status: r.status || "", round: r.round || 0, refsStep: r.refsStep === true, looks: r.consult ? null : r.looks ?? null, suggested_looks: r.suggested_looks ?? null, extracted: r.extracted ?? null, retake: r.retake ?? null, consult: r.consult ?? null, source: source || undefined });
      if (r.status) setStatus(r.status);
      setMissing(r.missing || []);
    },
    [push, lang],
  );

  const replyError = useCallback(
    (e: unknown) => {
      if (e instanceof HttpError && e.status === 400 && e.detail) {
        push({ role: "error", text: e.detail });
        return;
      }
      console.error(e);
      push({ role: "error", text: t(lang, "sendFailed") });
    },
    [push, lang],
  );

  const run = useCallback(
    async (p: () => Promise<ApiResponse>) => {
      setBusy(true);
      try {
        render(await p());
        return true;
      } catch (e) {
        // [upload-check] Show the server's reason for a rejected file (e.g. "must be JPG or PNG").
        const text = e instanceof HttpError && e.status === 400 && e.detail
          ? e.detail
          : (console.error(e), t(lang, "sendFailed"));
        push({ role: "error", text });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [push, render, lang],
  );

  const hasPdf = (fs: File[]) => fs.some((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");

  const addFiles = (list: FileList | File[]) => {
    const ok: File[] = [];
    const bad: string[] = [];
    Array.from(list).forEach((f) => (isAcceptable(f) ? ok.push(f) : bad.push(f.name)));
    if (bad.length) push({ role: "error", text: t(lang, "badFiles", { names: bad.join(", ") }) });
    if (!ok.length) return;
    if (!chatReady) {
      // [chat-gate] No chat box yet: "Upload PDF" (or a drop) sends the files straight away.
      if (!client || busy) return;
      push({ role: "user", text: "", files: ok.map((f) => f.name) });
      run(() => client.upload(ok)).then((done) => done && hasPdf(ok) && setChatReady(true));
      return;
    }
    setFiles((prev) => [...prev, ...ok]);
  };

  // Keep the start choices (upload / form) until the client is registered, so sending a
  // reference image first no longer hides "Fill in a new form".
  const started = messages.some((m) => m.role === "user") && !["registering", "need_document"].includes(status);
  // [refs-step] The reference-images step has no text box: upload image(s), or send
  // empty to skip. Keyed on the reply flag, not status alone: the plain
  // need_direction step that asks for a design direction keeps its text input.
  const lastBot = [...messages].reverse().find((m) => m.role === "assistant");
  const refsStep = status === "need_direction" && !!lastBot && lastBot.role === "assistant" && lastBot.refsStep === true;

  // Form path: reference images (optional) go to /api/upload first so the session holds them
  // as style refs, then /api/form registers the client and starts round 1 with those refs.
  // [field-validation] The form stays open while it submits. If the server returns `invalid`,
  // the issues go back to the form (shown under each field) and nothing is posted to the chat yet.
  const submitForm = async (fields: FormFields, images: File[] = []): Promise<FieldIssue[] | undefined> => {
    if (!client || busy) return;
    const user: NewMsg = refill
      ? { role: "user", text: t(lang, "updatedDetails"), files: refill.keys.map((k) => fieldLabel(lang, k)) }
      : { role: "user", text: t(lang, "sentForm"), files: [...(fields.business_name ? [fields.business_name] : []), ...images.map((f) => f.name)] };
    setBusy(true);
    let r: ApiResponse;
    try {
      const fresh = images.filter((f) => !uploadedRef.current.includes(f));
      if (!refill && fresh.length) {
        await client.upload(fresh);
        uploadedRef.current = [...uploadedRef.current, ...fresh];
      }
      r = await client.form(fields);
    } catch (e) {
      setFormOpen(false);
      setRefill(null);
      push(user);
      console.error(e);
      push({ role: "error", text: t(lang, "sendFailed") });
      return;
    } finally {
      setBusy(false);
    }
    if (r.invalid?.length) {
      heldRef.current = { user, r };
      return r.invalid;
    }
    heldRef.current = null;
    setFormOpen(false);
    setRefill(null);
    setChatReady(true); // [chat-gate]
    push(user);
    render(r);
  };

  const cancelForm = () => {
    setFormOpen(false);
    const held = heldRef.current;
    heldRef.current = null;
    if (held) {
      // Closed with values still rejected: show the agent's re-ask (with examples) in the chat.
      setRefill(null);
      setChatReady(true); // [chat-gate] the form was submitted; fixes continue in the chat
      push(held.user);
      render(held.r);
    }
  };

  const accept = () => {
    if (!client || busy) return;
    push({ role: "user", text: t(lang, "looksGood"), files: [] });
    run(() => client.review(true, ""));
  };

  const send = async () => {
    if (!client || busy || client.linkClosed) return;
    const t = text.trim();
    const fs = files.slice();
    if (!t && !fs.length) {
      // [refs-step] Empty send on the reference-images step skips, exactly like typing "skip".
      if (!refsStep) return;
      push({ role: "user", text: "skip", files: [] });
      await run(() => client.chat("skip"));
      return;
    }
    setText("");
    setFiles([]);
    push({ role: "user", text: t, files: fs.map((f) => f.name) });
    if (fs.length) {
      const ok = await run(() => client.upload(fs));
      if (ok && hasPdf(fs)) setChatReady(true);
      if (!ok || !t) return;
    }
    await run(() => client.chat(t));
  };

  // Mic: spoken answers go into the input for the client to check; never auto-sent.
  const toggleMic = useCallback(() => {
    if (!micSupported || closed) return;
    if (micOn) {
      micStopRef.current?.();
      return;
    }
    const stop = startListening(
      lang,
      (heard) => {
        setText((prev) => (prev.trim() ? prev.replace(/\s+$/, "") + " " + heard : heard));
        inputRef.current?.focus();
      },
      (ok, ms) => {
        micStopRef.current = null;
        setMicOn(false);
        try {
          traceMic(ok, ms);
        } catch {
          /* trace never breaks the UI */
        }
      },
    );
    if (!stop) return; // unsupported or blocked: onDone already ran
    micStopRef.current = stop;
    setMicOn(true);
  }, [micSupported, closed, micOn, lang, traceMic]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current++;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  // The server names missing fields in English; show them in the UI language when known.
  const missingLabel = (m: string) => {
    const k = toFieldKeys([m])[0];
    return k ? fieldLabel(lang, k) : m;
  };

  // The final message is the reply whose session status is "accepted" (from the
  // API, never matched on English text). It shows as a popup, not a bubble.
  const acceptedMsg = [...messages].reverse().find((m) => m.role === "assistant" && m.status === "accepted");
  const showAccepted = !!acceptedMsg && dismissedAcceptedId !== acceptedMsg.id;
  const acceptedCloseRef = useRef<HTMLButtonElement>(null);
  const acceptedRestoreRef = useRef<Element | null>(null);
  // Closing the final popup starts over: drop the stored session, drop any
  // one-time resume token, and reload so the app re-runs the first-visit init
  // (a new session showing the upload/form start). No server call touches the
  // finished case, and the language stays in localStorage.
  const closeAccepted = useCallback(() => {
    if (acceptedMsg) setDismissedAcceptedId(acceptedMsg.id);
    clearClientSession();
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("resume");
      window.history.replaceState(null, "", u.toString());
    } catch {
      /* ignore */
    }
    window.location.reload();
  }, [acceptedMsg]);
  // Focus moves into the popup while it is open; Escape (or the close button)
  // dismisses it and focus returns to where it was.
  useEffect(() => {
    if (!showAccepted) return;
    acceptedRestoreRef.current = document.activeElement;
    acceptedCloseRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      (acceptedRestoreRef.current as HTMLElement | null)?.focus?.();
    };
  }, [showAccepted]);
  const onAcceptedKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      closeAccepted();
    }
  };
  const lastReviewId = [...messages].reverse().find((m) => m.role === "assistant" && m.status === "awaiting_review")?.id;
  const lastLooksId = [...messages].reverse().find((m) => m.role === "assistant" && (m.looks?.options?.length ?? 0) > 0)?.id;
  const lastConfirmId = [...messages].reverse().find((m) => m.role === "assistant" && ((m.extracted?.length ?? 0) > 0 || !!m.retake))?.id;
  const reviewOpen = status === "awaiting_review";
  const handedOff = status === "handed_off" || messages.some((m) => m.role === "assistant" && !!m.consult);

  // Staff can send looks while the picker is open: refresh the open looks message
  // in place (no new chat message) every 15 s and on window focus. Stops once the
  // client picks, skips, or the status leaves awaiting_review; never polls in mock mode.
  useEffect(() => {
    if (!client || client.mock || closed || busy || handedOff) return;
    if (status !== "awaiting_review") return;
    if (lastLooksId == null) return;
    const targetId = lastLooksId;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      let r: ApiResponse;
      try {
        r = await client.refresh();
      } catch {
        return; // a failed poll never breaks the chat
      }
      if (stopped) return;
      if (r.status && r.status !== "awaiting_review") {
        setStatus(r.status);
        return;
      }
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== targetId || m.role !== "assistant") return m;
          const looks = m.looks ? mergeLooks(m.looks, r.looks) : null;
          const suggested = mergeSuggested(m.suggested_looks, r.suggested_looks);
          if (!looks && !suggested) return m;
          return { ...m, looks: looks ?? m.looks, suggested_looks: suggested ?? m.suggested_looks };
        }),
      );
    };
    const onFocus = () => void tick();
    const timer = setInterval(() => void tick(), 15000);
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [client, closed, busy, handedOff, status, lastLooksId]);
  const micLabel = t(lang, micOn ? "mic.stop" : "mic.label");
  const micTitle = micSupported ? micLabel : t(lang, "mic.notSupported");

  return (
    <div className="app" onDragEnter={onDragEnter} onDragOver={(e) => e.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}>
      <Header
        title={t(lang, "appTitle")}
        label={
          <span className="pill" id="statusPill" data-status={status}>
            {statusLabel(lang, status)}
          </span>
        }
        right={
          <>
            <select
              className="lang-select"
              id="langSelect"
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              aria-label={t(lang, "language")}
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
            {client?.mock && (
              <span className="badge-demo" id="demoBadge">
                {t(lang, "demoBadge")}
              </span>
            )}
          </>
        }
      />

      <main className="chat" id="chat" ref={chatRef} aria-live="polite">
        <div className="column">
          {messages.map((m) => {
            if (m.role === "assistant" && m.status === "accepted") return null; // final message shows as a popup
            if (m.role === "user")
              return (
                <div key={m.id} className="msg user" lang={lang}>
                  {m.text && <div>{m.text}</div>}
                  {m.files.length > 0 && <div className="files">{m.files.join(", ")}</div>}
                </div>
              );
            if (m.role === "error")
              return (
                <div key={m.id} className="msg error" role="alert" lang={lang}>
                  {m.text}
                </div>
              );
            if (m.choices && !started)
              return (
                <div key={m.id} className="welcome">
                  <img className="welcome-figure" src={ASSET + "agent-clean.png"} alt={t(lang, "agentName")} width={140} />
                  <div className="welcome-body">
                    <div className="agent-label">{t(lang, "agentName")}</div>
                    <div className="msg assistant speech" lang={lang}>
                      <MsgText text={m.text} />
                      <ListenButton id={"msg-" + m.id} text={m.text} lang={lang} trace={traceListen} />
                      <div className="choices">
                        <button type="button" className="btn primary" id="choiceUpload" disabled={busy} onClick={() => fileRef.current?.click()}>
                          {t(lang, "uploadPdf")}
                        </button>
                        <button type="button" className="btn" id="choiceForm" disabled={busy} onClick={() => setFormOpen(true)}>
                          {t(lang, "fillForm")}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            const showReview = m.status === "awaiting_review";
            const active = showReview && reviewOpen && m.id === lastReviewId;
            return (
              <div key={m.id} className="row assistant">
              <Avatar />
              <div className="msg assistant" lang={lang}>
                {m.text && <MsgText text={m.text} />}
                <ListenButton id={"msg-" + m.id} text={m.text} lang={lang} trace={traceListen} />
                {!m.consult && (m.looks?.options?.length ?? 0) > 0 && m.looks && client ? (
                  <LooksPicker
                    looks={m.looks}
                    lang={lang}
                    client={client}
                    disabled={busy || handedOff || m.id !== lastLooksId}
                    onReply={render}
                    onError={replyError}
                    idPrefix={"looks-" + m.id}
                  />
                ) : (
                  !m.consult && m.images.length > 0 && (
                    <div className="img-grid">
                      {m.images.map((src, i) => (
                        <button type="button" key={i} className="thumb" onClick={() => setLightbox(src)} aria-label={t(lang, "enlargeImage", { n: i + 1 })}>
                          <img src={src} alt={t(lang, "generatedImage", { n: i + 1 })} loading="lazy" />
                        </button>
                      ))}
                    </div>
                  )
                )}
                {!m.consult && !(m.looks?.options?.length ?? 0) && (m.suggested_looks?.length ?? 0) > 0 && (
                  <div className="suggested-card">
                    <p className="suggested-title">{t(lang, "looks.suggested")}</p>
                    <div className="suggested-grid">
                      {m.suggested_looks!.map((s, i) => (
                        <figure key={s.id} className="suggested-item">
                          <img src={s.url} alt={s.alt || t(lang, "looks.option", { n: i + 1 })} loading="lazy" />
                          {(s.alt || s.title) && <figcaption className="look-caption">{s.alt || s.title}</figcaption>}
                        </figure>
                      ))}
                    </div>
                  </div>
                )}
                {(m.extracted?.length || m.retake) && client ? (
                  <ConfirmDetails
                    extracted={m.extracted}
                    retake={m.retake}
                    lang={lang}
                    client={client}
                    disabled={busy || m.id !== lastConfirmId}
                    trace={traceListen}
                    onReply={render}
                    onError={replyError}
                    idPrefix={"confirm-" + m.id}
                  />
                ) : null}
                {m.consult && <p className="consult-note">{t(lang, "consult.note")}</p>}
                {showReview && (
                  <div className="review">
                    <button type="button" className="btn primary" disabled={!active || busy} onClick={accept}>
                      {t(lang, "looksGood")}
                    </button>
                  </div>
                )}
              </div>
              </div>
            );
          })}
          {busy && (
            <div className="row assistant">
              <Avatar />
              <div className="typing" aria-label={t(lang, "waitingReply")}>
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
          {translating && (
            <div className="hint" role="status" aria-live="polite">
              {t(lang, "translating")}
            </div>
          )}
        </div>
      </main>

      {/* [chat-gate] kept outside the dock so "Upload PDF" works before the chat box shows */}
      <input
        ref={fileRef}
        type="file"
        id="fileInput"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {chatReady && (
      <footer className="dock">
        <div className="column">
          {missing.length > 0 && (
            <section className="missing-card" id="missingCard">
              <div className="missing-title">{t(lang, "stillNeeded")}</div>
              <ul id="missingList">
                {missing.map((m) => (
                  <li key={m}>
                    <CheckboxIcon />
                    {missingLabel(m)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {files.length > 0 && (
            <div className="chips" id="chips">
              {files.map((f, i) => (
                <span className="chip" key={f.name + i}>
                  {/\.pdf$/i.test(f.name) ? <FileIcon /> : <ImageIcon />}
                  <span className="name">{f.name}</span>
                  <button type="button" aria-label={t(lang, "removeFile", { name: f.name })} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form className="composer" id="composer" onSubmit={onSubmit} autoComplete="off">
            <button type="button" className="btn-icon" id="attachBtn" title={t(lang, "attachTitle")} aria-label={t(lang, "attachLabel")} disabled={closed} onClick={() => fileRef.current?.click()}>
              <PaperclipIcon />
            </button>
            {!refsStep && (
              <textarea
                ref={inputRef}
                id="textInput"
                rows={1}
                value={text}
                placeholder={closed ? t(lang, "linkClosed") : t(lang, "typeMessage")}
                disabled={closed}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKeyDown}
              />
            )}
            <button
              type="button"
              className="btn-icon mic-btn"
              id="micBtn"
              hidden={!micSupported || refsStep}
              title={micTitle}
              aria-label={micLabel}
              aria-pressed={micOn}
              disabled={closed || !micSupported}
              onClick={toggleMic}
            >
              <MicIcon />
            </button>
            <span className="visually-hidden" aria-live="polite">
              {micOn ? t(lang, "mic.listening") : ""}
            </span>
            <button type="submit" className="btn-send" id="sendBtn" disabled={busy || !client || closed}>
              <span>{t(lang, "send")}</span>
              <SendIcon />
            </button>
          </form>
        </div>
      </footer>
      )}

      {dragging && <div className="drop-overlay">{t(lang, "dropHere")}</div>}
      {formOpen && (
        <FormModal lang={lang} onCancel={cancelForm} onSubmit={submitForm} only={refill?.keys} intro={refill?.note} trace={traceListen} />
      )}
      {!formOpen && refill && (
        <div className="refill-bar">
          <button type="button" className="btn primary" onClick={() => setFormOpen(true)}>
            {t(lang, "updatedDetails")}
          </button>
        </div>
      )}
      {lightbox && (
        <div className="lightbox" id="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label={t(lang, "imagePreview")}>
          <img src={lightbox} alt={t(lang, "enlargedImage")} />
        </div>
      )}
      {showAccepted && acceptedMsg && (
        <div className="modal-backdrop" id="acceptedPopup" onMouseDown={(e) => e.target === e.currentTarget && closeAccepted()}>
          <div className="modal accepted-modal" role="dialog" aria-modal="true" aria-labelledby="acceptedTitle" onKeyDown={onAcceptedKeyDown}>
            <div className="accepted-text" id="acceptedTitle" lang={lang}>
              <MsgText text={acceptedMsg.text} />
            </div>
            <ListenButton id={"accepted-" + acceptedMsg.id} text={acceptedMsg.text} lang={lang} trace={traceListen} />
            <button ref={acceptedCloseRef} type="button" className="btn primary" id="acceptedClose" onClick={closeAccepted}>
              {t(lang, "close")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
