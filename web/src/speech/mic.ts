// Speech-recognition logic for the mic button next to the message box (client UI only).
// Never auto-sends: transcripts go to the caller, which puts them in the input
// for the client to check before sending.
import type { Lang } from "../i18n";

/** BCP47 tag sent to the recognizer so it listens in the UI language. */
const BCP47: Record<Lang, string> = {
  en: "en-US",
  zh: "zh-CN",
  ms: "ms-MY",
  ta: "ta-IN",
};

export function bcp47(lang: Lang): string {
  return BCP47[lang] ?? "en-US";
}

// Minimal SpeechRecognition shapes (not in TS's DOM lib; webkit-prefixed in some browsers).
interface MicResult {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}
interface MicResultEvent extends Event {
  readonly results: ArrayLike<MicResult>;
  readonly resultIndex: number;
}
interface MicRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: MicResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type MicCtor = new () => MicRecognition;

function getCtor(): MicCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const c = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof c === "function" ? (c as MicCtor) : null;
}

/** True when the browser offers SpeechRecognition (standard or webkit-prefixed). */
export function isMicSupported(): boolean {
  return getCtor() !== null;
}

/**
 * Listen once in `lang`. Calls `onText` with each recognized chunk and
 * `onDone(ok, ms)` exactly once at the end (ok = some speech was recognized).
 * Returns a stop function, or null when the browser does not support it.
 */
export function startListening(
  lang: Lang,
  onText: (text: string) => void,
  onDone: (ok: boolean, ms: number) => void,
): (() => void) | null {
  const Ctor = getCtor();
  if (!Ctor) {
    onDone(false, 0);
    return null;
  }
  let rec: MicRecognition;
  try {
    rec = new Ctor();
  } catch {
    onDone(false, 0);
    return null;
  }
  const startedAt = Date.now();
  let heard = false;
  let done = false;
  const finish = (ok: boolean) => {
    if (done) return;
    done = true;
    try {
      onDone(ok, Date.now() - startedAt);
    } catch {
      /* trace callback never throws into the UI */
    }
  };
  try {
    rec.lang = bcp47(lang);
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
  } catch {
    /* ignore; defaults still work */
  }
  rec.onresult = (e: MicResultEvent) => {
    let text = "";
    try {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal && r[0]) text += r[0].transcript;
      }
    } catch {
      /* ignore malformed results */
    }
    text = text.trim();
    if (!text) return;
    heard = true;
    try {
      onText(text);
    } catch {
      /* caller error must not break recognition */
    }
  };
  // onerror is usually followed by onend; finish() runs only once.
  rec.onerror = () => finish(heard);
  rec.onend = () => finish(heard);
  try {
    rec.start();
  } catch {
    finish(false);
    return null;
  }
  return () => {
    try {
      rec.stop();
    } catch {
      finish(heard);
    }
  };
}
