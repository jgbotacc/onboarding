// Listen button: reads one message aloud via speechSynthesis.
// WCAG 2.2: native buttons (keyboard operable, visible focus), text labels,
// aria-label from t(), aria-pressed while speaking, no autoplay, pause/stop
// controls (1.4.2), and a text notice when no voice is available.
import { useEffect, useId, useState } from "react";
import { t, type Lang } from "../i18n";
import {
  getVoices,
  hasVoiceFor,
  isSpeechSupported,
  pauseActive,
  resumeActive,
  speak,
  stopActive,
  subscribe,
  type ListenStatus,
} from "./listen";

interface Props {
  /** Unique id for this message; one message speaks at a time. */
  id: string;
  /** Exact text to read aloud. */
  text: string;
  lang: Lang;
  /** Log the use: client.trace("listen", ok, ms). Never throws. */
  trace?: (ok: boolean, ms: number) => void | Promise<void>;
}

export default function ListenButton({ id, text, lang, trace }: Props) {
  const [status, setStatus] = useState<ListenStatus>({ activeId: null, state: "idle" });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesReady, setVoicesReady] = useState(false);
  const [supported] = useState(() => isSpeechSupported());
  const noticeId = useId();

  useEffect(() => subscribe(setStatus), []);

  useEffect(() => {
    if (!supported) return;
    const refresh = () => {
      setVoices(getVoices());
      setVoicesReady(true);
    };
    refresh();
    try {
      window.speechSynthesis.onvoiceschanged = refresh;
    } catch {
      /* ignore */
    }
    window.speechSynthesis?.addEventListener?.("voiceschanged", refresh);
    return () => {
      try {
        window.speechSynthesis?.removeEventListener?.("voiceschanged", refresh);
        if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged === refresh) {
          window.speechSynthesis.onvoiceschanged = null;
        }
      } catch {
        /* ignore */
      }
      stopActive(id);
    };
  }, [supported, id]);

  // The language changed under us: stop this message so the old voice can't continue.
  useEffect(() => {
    stopActive(id);
  }, [lang, id]);

  const mine = status.activeId === id && status.state !== "idle";
  const speaking = mine && status.state === "speaking";
  const paused = mine && status.state === "paused";
  const voiceMissing = supported && voicesReady && !hasVoiceFor(lang, voices);
  const disabled = !supported || voiceMissing || !text.trim();

  const log = (ok: boolean, ms: number) => {
    try {
      void trace?.(ok, ms);
    } catch {
      /* trace never breaks the UI */
    }
  };

  const onMain = () => {
    if (disabled) return;
    if (speaking) {
      pauseActive();
      return;
    }
    if (paused) {
      resumeActive();
      return;
    }
    speak(id, text, lang, log);
  };

  const onStop = () => stopActive(id);

  if (disabled) {
    const reason = !supported
      ? t(lang, "listen.notSupported")
      : !text.trim()
        ? ""
        : t(lang, "listen.noVoice");
    return (
      <span className="listen-group">
        <button
          type="button"
          className="btn listen-btn"
          disabled
          aria-label={t(lang, "listen.listen")}
          aria-describedby={reason ? noticeId : undefined}
        >
          {t(lang, "listen.listen")}
        </button>
        {reason && (
          <span className="listen-notice" id={noticeId}>
            {reason}
          </span>
        )}
      </span>
    );
  }

  const mainLabel = speaking
    ? t(lang, "listen.pause")
    : paused
      ? t(lang, "listen.resume")
      : t(lang, "listen.listen");

  return (
    <span className="listen-group" role="group" aria-label={t(lang, "listen.group")}>
      <button
        type="button"
        className="btn listen-btn"
        onClick={onMain}
        aria-label={mainLabel}
        aria-pressed={mine}
      >
        {mainLabel}
      </button>
      {mine && (
        <button
          type="button"
          className="btn listen-btn"
          onClick={onStop}
          aria-label={t(lang, "listen.stop")}
        >
          {t(lang, "listen.stop")}
        </button>
      )}
      <span className="visually-hidden" aria-live="polite">
        {speaking ? t(lang, "listen.speaking") : paused ? t(lang, "listen.paused") : ""}
      </span>
    </span>
  );
}
