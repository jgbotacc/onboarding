import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { connect, type Client } from "./api";
import { MAX_ROUNDS, STATUS_LABELS, type ApiResponse, type FormFields } from "./types";
import FormModal from "./FormModal";
import { CheckboxIcon, CloseIcon, FileIcon, ImageIcon, PaperclipIcon, SendIcon } from "./icons";

type Msg =
  | { id: number; role: "user"; text: string; files: string[] }
  | { id: number; role: "assistant"; text: string; images: string[]; status: string; round: number; choices?: boolean }
  | { id: number; role: "error"; text: string };

type NewMsg = Msg extends infer T ? (T extends Msg ? Omit<T, "id"> : never) : never;

const GREETING = "Welcome. To get started, upload a PDF with your business details (plus any JPG reference images), or fill in a registration form.";
const isAcceptable = (f: File) => /\.(pdf|jpe?g)$/i.test(f.name) || f.type === "application/pdf" || f.type === "image/jpeg";

let nextId = 1;

const ASSET = import.meta.env.BASE_URL;
const AGENT_NAME = "Onboarding agent";

function Avatar() {
  return <img className="avatar" src={ASSET + "agent-64.png"} alt="" aria-hidden="true" width={32} height={32} />;
}

export default function App() {
  const [client, setClient] = useState<Client | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [status, setStatus] = useState("registering");
  const [missing, setMissing] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const dragDepth = useRef(0);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const push = useCallback((m: NewMsg) => setMessages((prev) => [...prev, { ...m, id: nextId++ } as Msg]), []);

  useEffect(() => {
    let alive = true;
    connect().then((c) => {
      if (!alive) return;
      setClient(c);
      setMessages([{ id: nextId++, role: "assistant", text: GREETING, images: [], status: "registering", round: 0, choices: true }]);
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

  const render = useCallback(
    (r: ApiResponse) => {
      push({ role: "assistant", text: r.reply || "", images: r.images || [], status: r.status || "", round: r.round || 0 });
      if (r.status) setStatus(r.status);
      setMissing(r.missing || []);
    },
    [push],
  );

  const run = useCallback(
    async (p: () => Promise<ApiResponse>) => {
      setBusy(true);
      try {
        render(await p());
        return true;
      } catch (e) {
        push({ role: "error", text: `Something went wrong (${(e as Error).message}). Please try again.` });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [push, render],
  );

  const addFiles = (list: FileList | File[]) => {
    const ok: File[] = [];
    const bad: string[] = [];
    Array.from(list).forEach((f) => (isAcceptable(f) ? ok.push(f) : bad.push(f.name)));
    if (bad.length) push({ role: "error", text: "Only PDF and JPG files are supported: " + bad.join(", ") });
    if (ok.length) setFiles((prev) => [...prev, ...ok]);
  };

  const started = messages.some((m) => m.role === "user");

  const submitForm = (fields: FormFields) => {
    if (!client || busy) return;
    setFormOpen(false);
    push({ role: "user", text: "Submitted registration form", files: fields.business_name ? [fields.business_name] : [] });
    run(() => client.form(fields));
  };

  const startFeedback = () => {
    setFeedbackMode(true);
    inputRef.current?.focus();
  };

  const accept = () => {
    if (!client || busy) return;
    setFeedbackMode(false);
    push({ role: "user", text: "Looks good", files: [] });
    run(() => client.review(true, ""));
  };

  const send = async () => {
    if (!client || busy) return;
    const t = text.trim();
    const fs = files.slice();
    if (!t && !fs.length) return;
    setText("");
    setFiles([]);
    push({ role: "user", text: t, files: fs.map((f) => f.name) });
    if (fs.length) {
      const ok = await run(() => client.upload(fs));
      if (!ok || !t) return;
    }
    const asFeedback = feedbackMode && status === "awaiting_review";
    setFeedbackMode(false);
    await run(() => (asFeedback ? client.review(false, t) : client.chat(t)));
  };

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

  const lastReviewId = [...messages].reverse().find((m) => m.role === "assistant" && m.status === "awaiting_review")?.id;
  const reviewOpen = status === "awaiting_review";

  return (
    <div className="app" onDragEnter={onDragEnter} onDragOver={(e) => e.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}>
      <header className="header">
        <img className="header-avatar" src={ASSET + "agent-64.png"} alt="" aria-hidden="true" width={24} height={24} />
        <h1>Client Onboarding</h1>
        <span className="pill" id="statusPill" data-status={status}>
          {STATUS_LABELS[status] || status.replace(/_/g, " ")}
        </span>
        {client?.mock && (
          <span className="badge-demo" id="demoBadge">
            Demo mode (mock data)
          </span>
        )}
      </header>

      <main className="chat" id="chat" ref={chatRef} aria-live="polite">
        <div className="column">
          {messages.map((m) => {
            if (m.role === "user")
              return (
                <div key={m.id} className="msg user">
                  {m.text && <div>{m.text}</div>}
                  {m.files.length > 0 && <div className="files">{m.files.join(", ")}</div>}
                </div>
              );
            if (m.role === "error")
              return (
                <div key={m.id} className="msg error" role="alert">
                  {m.text}
                </div>
              );
            if (m.choices && !started)
              return (
                <div key={m.id} className="welcome">
                  <img className="welcome-figure" src={ASSET + "agent-clean.png"} alt={AGENT_NAME} width={140} />
                  <div className="welcome-body">
                    <div className="agent-label">{AGENT_NAME}</div>
                    <div className="msg assistant speech">
                      <div>{m.text}</div>
                      <div className="choices">
                        <button type="button" className="btn primary" id="choiceUpload" disabled={busy} onClick={() => fileRef.current?.click()}>
                          Upload PDF
                        </button>
                        <button type="button" className="btn" id="choiceForm" disabled={busy} onClick={() => setFormOpen(true)}>
                          Fill in a new form
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
              <div className="msg assistant">
                {m.text && <div>{m.text}</div>}
                {m.images.length > 0 && (
                  <div className="img-grid">
                    {m.images.map((src, i) => (
                      <button type="button" key={i} className="thumb" onClick={() => setLightbox(src)} aria-label={`Enlarge image ${i + 1}`}>
                        <img src={src} alt={`Generated image ${i + 1}`} loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
                {showReview && (
                  <>
                    {m.round > 0 && (
                      <div className="round">
                        Round {m.round} of {MAX_ROUNDS}
                      </div>
                    )}
                    <div className="review">
                      <button type="button" className="btn primary" disabled={!active || busy} onClick={accept}>
                        Looks good
                      </button>
                      <button type="button" className={"btn" + (active && feedbackMode ? " on" : "")} disabled={!active || busy} onClick={startFeedback}>
                        Request changes
                      </button>
                    </div>
                  </>
                )}
              </div>
              </div>
            );
          })}
          {busy && (
            <div className="row assistant">
              <Avatar />
              <div className="typing" aria-label="Waiting for reply">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="dock">
        <div className="column">
          {missing.length > 0 && (
            <section className="missing-card" id="missingCard">
              <div className="missing-title">Still needed</div>
              <ul id="missingList">
                {missing.map((m) => (
                  <li key={m}>
                    <CheckboxIcon />
                    {m}
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
                  <button type="button" aria-label={"Remove " + f.name} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}>
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          )}
          <form className={"composer" + (feedbackMode ? " feedback" : "")} id="composer" onSubmit={onSubmit} autoComplete="off">
            <input
              ref={fileRef}
              type="file"
              id="fileInput"
              accept=".pdf,.jpg,.jpeg,application/pdf,image/jpeg"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button type="button" className="btn-icon" id="attachBtn" title="Attach PDF or JPG" aria-label="Attach files" onClick={() => fileRef.current?.click()}>
              <PaperclipIcon />
            </button>
            <textarea
              ref={inputRef}
              id="textInput"
              rows={1}
              value={text}
              placeholder={feedbackMode ? "Describe what you'd like changed" : "Message"}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="submit" className="btn-send" id="sendBtn" disabled={busy || !client}>
              <span>Send</span>
              <SendIcon />
            </button>
          </form>
          {feedbackMode && <div className="hint">Your next message is sent as feedback on this round.</div>}
        </div>
      </footer>

      {dragging && <div className="drop-overlay">Drop PDF or JPG files to attach</div>}
      {formOpen && <FormModal onCancel={() => setFormOpen(false)} onSubmit={submitForm} />}
      {lightbox && (
        <div className="lightbox" id="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Image preview">
          <img src={lightbox} alt="Enlarged image" />
        </div>
      )}
    </div>
  );
}
