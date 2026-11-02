// Talk-only onboarding screen. The owner finishes onboarding by talking,
// with almost no reading or typing. Speech starts only after the Start
// button is tapped, so nothing autoplays. Typed input stays on screen as
// a fallback for every listening step.
import { useEffect, useRef, useState } from "react";
import { connect, type Client } from "../api";
import { EMPTY_FORM, type ApiResponse, type LookOption } from "../types";
import { LANGS, t, useLang, type Lang } from "../i18n";
import {
  VOICE_STEPS,
  lookLines,
  parseLookChoice,
  parseYesNo,
  readBack,
  spokenEmail,
  stepQuestion,
} from "./logic";
import {
  getStatus,
  isSpeechSupported,
  pauseActive,
  resumeActive,
  speak,
  stopActive,
  subscribe,
} from "../speech/listen";
import { isMicSupported, startListening } from "../speech/mic";
import "./voice.css";

interface Line {
  who: "bot" | "owner";
  text: string;
}

export default function VoiceApp() {
  const [lang, setLang] = useLang();
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [heard, setHeard] = useState("");
  const [listening, setListening] = useState(false);
  const [typed, setTyped] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [looks, setLooks] = useState<LookOption[] | null>(null);
  const [done, setDone] = useState(false);
  const [speech, setSpeech] = useState(() => getStatus());
  const [micSupported] = useState(() => isMicSupported());

  const runRef = useRef(0);
  const langRef = useRef<Lang>(lang);
  langRef.current = lang;
  const clientRef = useRef<Client | null>(null);
  const promptRef = useRef("");
  const pendingRef = useRef<{ resolve: (v: string | null) => void } | null>(null);
  const micStopRef = useRef<(() => void) | null>(null);
  const heardTextRef = useRef("");
  const sayCount = useRef(0);

  useEffect(() => subscribe(setSpeech), []);

  const push = (who: Line["who"], text: string) =>
    setLines((prev) => [...prev, { who, text }]);

  const showPrompt = (text: string) => {
    promptRef.current = text;
    setPrompt(text);
  };

  /** Speak one prompt, resolving when finished, interrupted or unavailable. */
  const say = (text: string): Promise<void> =>
    new Promise((resolve) => {
      if (!text.trim() || !isSpeechSupported()) return resolve();
      const id = `voice-${sayCount.current++}`;
      try {
        const ok = speak(id, text, langRef.current, () => resolve());
        if (!ok) resolve();
      } catch {
        resolve();
      }
    });

  /**
   * Wait for one answer: the mic when supported, else the typed box.
   * Typed input always wins a race by stopping the mic first.
   */
  const awaitHeard = (): Promise<string | null> =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (v: string | null) => {
        if (settled) return;
        settled = true;
        pendingRef.current = null;
        setListening(false);
        resolve(v);
      };
      pendingRef.current = { resolve: finish };
      heardTextRef.current = "";
      setHeard("");
      setListening(true);
      if (!isMicSupported()) return; // typed box only; stays open until Send
      let stop: (() => void) | null = null;
      try {
        stop = startListening(
          langRef.current,
          (chunk) => {
            heardTextRef.current += (heardTextRef.current ? " " : "") + chunk;
          },
          (ok) => {
            micStopRef.current = null;
            const text = heardTextRef.current.trim();
            finish(ok && text ? text : null);
          },
        );
      } catch {
        stop = null;
      }
      micStopRef.current = stop;
      // A null stop means the mic failed to start; the typed box still resolves.
    });

  const stopMic = () => {
    const stop = micStopRef.current;
    micStopRef.current = null;
    if (stop) {
      try {
        stop();
      } catch {
        /* already stopped */
      }
    }
  };

  /** Typed Send answers whatever the voice loop is waiting for. */
  const submitTyped = () => {
    const value = typed.trim();
    if (!value) return;
    setTyped("");
    const pending = pendingRef.current;
    if (!pending) return;
    stopMic();
    setHeard(value);
    push("owner", value);
    pending.resolve(value);
  };

  const runSteps = async (run: number): Promise<Record<string, string> | null> => {
    const answers: Record<string, string> = {};
    const lang = langRef.current;
    for (const step of VOICE_STEPS) {
      // One question at a time; repeat it until the owner confirms an answer.
      while (runRef.current === run) {
        const q = stepQuestion(langRef.current, step);
        setLooks(null);
        showPrompt(q);
        push("bot", q);
        await say(q);
        if (runRef.current !== run) return null;
        const raw = await awaitHeard();
        if (runRef.current !== run) return null;
        const value = (raw ?? "").trim();
        if (!value) {
          const again = t(lang, "voice.notHeard");
          push("bot", again);
          await say(again);
          continue;
        }
        setHeard(value);
        // The style step alone accepts "skip" as a full answer.
        if (step.skippable && parseLookChoice(value, lang, 1) === "skip") {
          answers[step.field] = "";
          continue;
        }
        const confirm = readBack(lang, step.field === "email" ? spokenEmail(value) : value);
        showPrompt(confirm);
        push("bot", confirm);
        await say(confirm);
        if (runRef.current !== run) return null;
        const checkRaw = await awaitHeard();
        if (runRef.current !== run) return null;
        const yn = checkRaw == null ? null : parseYesNo(checkRaw.trim(), lang);
        if (yn === "yes") {
          answers[step.field] = step.field === "email" ? spokenEmail(value) : value;
          break;
        }
        if (checkRaw == null || !checkRaw.trim()) {
          const again = t(lang, "voice.notHeard");
          push("bot", again);
          await say(again);
        }
        // "no" or unparsable: ask the same question again.
      }
    }
    return answers;
  };

  const runLooks = async (run: number, client: Client, first: ApiResponse): Promise<void> => {
    let reply = first;
    const lang = langRef.current;
    while (runRef.current === run) {
      push("bot", reply.reply);
      showPrompt(reply.reply);
      const status = reply.status;
      if (status === "accepted" || status === "handed_off") {
        await say(reply.reply);
        if (runRef.current !== run) return;
        const finished = t(lang, "voice.done");
        showPrompt(finished);
        push("bot", finished);
        setLooks(null);
        setDone(true);
        return;
      }
      const options = reply.looks?.options ?? [];
      if (options.length > 0) {
        setLooks(options);
        const intro = t(lang, "voice.looksIntro", { n: options.length });
        const lookSpoken = lookLines(lang, options).join(" ");
        push("bot", lookLines(lang, options).join("\n"));
        showPrompt(intro + "\n" + lookLines(lang, options).join("\n"));
        await say(intro + " " + lookSpoken);
        if (runRef.current !== run) return;
        const raw = await awaitHeard();
        if (runRef.current !== run) return;
        const text = (raw ?? "").trim();
        if (!text) {
          const again = t(lang, "voice.notHeard");
          push("bot", again);
          await say(again);
          continue;
        }
        setHeard(text);
        const choice = parseLookChoice(text, lang, options.length);
        if (typeof choice === "number") {
          reply = await client.pickLooks([options[choice].id]);
          continue;
        }
        if (choice === "skip") {
          reply = await client.skipLooks();
          continue;
        }
        const again = t(lang, "voice.notHeard");
        push("bot", again);
        await say(again);
        continue;
      }
      // No looks to pick: hear one free reply, read it back, send on yes.
      setLooks(null);
      await say(reply.reply);
      if (runRef.current !== run) return;
      const raw = await awaitHeard();
      if (runRef.current !== run) return;
      const text = (raw ?? "").trim();
      if (!text) {
        const again = t(lang, "voice.notHeard");
        push("bot", again);
        await say(again);
        continue;
      }
      setHeard(text);
      const confirm = readBack(lang, text);
      push("bot", confirm);
      await say(confirm);
      if (runRef.current !== run) return;
      const checkRaw = await awaitHeard();
      if (runRef.current !== run) return;
      const yn = checkRaw == null ? null : parseYesNo(checkRaw.trim(), lang);
      if (yn === "yes") {
        reply = await client.chat(text);
      } else if (checkRaw == null || !checkRaw.trim()) {
        const again = t(lang, "voice.notHeard");
        push("bot", again);
        await say(again);
      }
      // "no" or unparsable: listen for a fresh answer to the same reply.
    }
  };

  const handleStart = async () => {
    const run = ++runRef.current;
    setBusy(true);
    setDone(false);
    setLines([]);
    setLooks(null);
    setHeard("");
    try {
      const client = await connect();
      if (runRef.current !== run) return;
      client.setLang(langRef.current);
      clientRef.current = client;
      setStarted(true);
      setBusy(false);
      const answers = await runSteps(run);
      if (answers == null || runRef.current !== run) return;
      const reply = await client.form({ ...EMPTY_FORM, ...answers });
      if (runRef.current !== run) return;
      await runLooks(run, client, reply);
    } catch {
      if (runRef.current !== run) return;
      setBusy(false);
      const failed = t(langRef.current, "sendFailed");
      push("bot", failed);
      showPrompt(failed);
      await say(failed);
    }
  };

  const handleStop = () => {
    runRef.current++;
    stopMic();
    try {
      stopActive();
    } catch {
      /* no speech to stop */
    }
    pendingRef.current?.resolve(null);
    pendingRef.current = null;
    clientRef.current = null;
    setListening(false);
    setBusy(false);
    setStarted(false);
    setPrompt("");
    setHeard("");
    setLooks(null);
    setDone(false);
  };

  const handlePauseResume = () => {
    if (speech.state === "paused") resumeActive();
    else pauseActive();
  };

  const handleRepeat = () => {
    if (promptRef.current) void say(promptRef.current);
  };

  const paused = speech.state === "paused";

  return (
    <div className="voice">
      <header className="voice-top">
        <span className="voice-title">{t(lang, "appTitle")}</span>
        <a className="voice-chat-link" href="#/chat">
          Use the chat instead
        </a>
      </header>

      {!started ? (
        <section className="voice-start" aria-label={t(lang, "appTitle")}>
          <label className="voice-label" htmlFor="voice-lang">
            {t(lang, "language")}
          </label>
          <select
            id="voice-lang"
            className="voice-select"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="voice-start-btn"
            aria-label={t(lang, "voice.start")}
            disabled={busy}
            onClick={handleStart}
          >
            {t(lang, "voice.start")}
          </button>
        </section>
      ) : (
        <main className="voice-main">
          <div className="voice-controls" role="group" aria-label={t(lang, "voice.start")}>
            <button
              type="button"
              className="voice-btn"
              aria-label={t(lang, paused ? "voice.resume" : "voice.pause")}
              onClick={handlePauseResume}
            >
              {t(lang, paused ? "voice.resume" : "voice.pause")}
            </button>
            <button
              type="button"
              className="voice-btn"
              aria-label={t(lang, "voice.stop")}
              onClick={handleStop}
            >
              {t(lang, "voice.stop")}
            </button>
            <button
              type="button"
              className="voice-btn"
              aria-label={t(lang, "voice.repeat")}
              onClick={handleRepeat}
            >
              {t(lang, "voice.repeat")}
            </button>
          </div>

          <div className="voice-prompt" aria-live="polite" aria-atomic="true">
            <p className="voice-prompt-text">{prompt}</p>
            {listening && <p className="voice-state">{t(lang, "voice.listening")}</p>}
            {heard && (
              <p className="voice-heard">
                {t(lang, "voice.confirm", { text: heard })}
              </p>
            )}
            {!micSupported && <p className="voice-nomic">{t(lang, "voice.noMic")}</p>}
            {done && <p className="voice-finished">{t(lang, "voice.done")}</p>}
          </div>

          {looks && looks.length > 0 && (
            <ul className="voice-looks">
              {looks.map((o, i) => (
                <li key={o.id} className="voice-look">
                  <img src={o.url} alt={o.alt} className="voice-look-img" />
                  <span className="voice-look-alt">
                    {i + 1}. {o.alt}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form
            className="voice-type"
            onSubmit={(e) => {
              e.preventDefault();
              submitTyped();
            }}
          >
            <label className="voice-label" htmlFor="voice-typed">
              {t(lang, "voice.typeInstead")}
            </label>
            <div className="voice-type-row">
              <input
                id="voice-typed"
                className="voice-input"
                type="text"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
              />
              <button
                type="submit"
                className="voice-btn voice-send"
                aria-label={t(lang, "voice.send")}
              >
                {t(lang, "voice.send")}
              </button>
            </div>
          </form>

          {lines.length > 0 && (
            <ol className="voice-log" aria-label={t(lang, "appTitle")}>
              {lines.map((l, i) => (
                <li key={i} className={l.who === "bot" ? "voice-bot" : "voice-owner"}>
                  {l.text}
                </li>
              ))}
            </ol>
          )}
        </main>
      )}
    </div>
  );
}
