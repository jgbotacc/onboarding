// Speech-synthesis logic for the Listen buttons (client UI only).
// Never autoplays: speech starts only when speak() is called from a user gesture.
// Only one message speaks at a time: speak() cancels any active utterance first.
import type { Lang } from "../i18n";

export type ListenState = "idle" | "speaking" | "paused";

export interface ListenStatus {
  activeId: string | null;
  state: ListenState;
}

/** BCP47 tag sent to the utterance when no matching voice provides its own. */
const BCP47: Record<Lang, string> = {
  en: "en-US",
  zh: "zh-CN",
  ms: "ms-MY",
  ta: "ta-IN",
};

export function bcp47(lang: Lang): string {
  return BCP47[lang] ?? "en-US";
}

export function isSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export function getVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return [];
  try {
    return window.speechSynthesis.getVoices();
  } catch {
    return [];
  }
}

/** Pick the best voice for `lang`, or null when the device has none. */
export function pickVoice(lang: Lang, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const want = lang.toLowerCase();
  const norm = (v: string) => v.toLowerCase().replace(/_/g, "-");
  const prefix = voices.filter((v) => norm(v.lang).startsWith(want));
  if (prefix.length) return prefix.find((v) => v.default) ?? prefix[0];
  const keywords: Record<Lang, string[]> = {
    en: ["english"],
    zh: ["chinese", "mandarin", "cantonese", "cmn", "zh"],
    ms: ["malay", "melayu"],
    ta: ["tamil"],
  };
  const keys = keywords[lang];
  const byName = voices.find((v) => {
    const n = v.name.toLowerCase();
    return keys.some((k) => n.includes(k));
  });
  return byName ?? null;
}

export function hasVoiceFor(lang: Lang, voices?: SpeechSynthesisVoice[]): boolean {
  return pickVoice(lang, voices ?? getVoices()) !== null;
}

type Listener = (s: ListenStatus) => void;

let status: ListenStatus = { activeId: null, state: "idle" };
const listeners = new Set<Listener>();
let startedAt = 0;
let onDone: ((ok: boolean, ms: number) => void) | null = null;

function emit() {
  const snap = { ...status };
  listeners.forEach((l) => {
    try {
      l({ ...snap });
    } catch {
      /* ignore listener errors */
    }
  });
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  try {
    listener({ ...status });
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(listener);
  };
}

export function getStatus(): ListenStatus {
  return { ...status };
}

function finish(ok: boolean) {
  const cb = onDone;
  onDone = null;
  const ms = startedAt ? Date.now() - startedAt : 0;
  startedAt = 0;
  status = { activeId: null, state: "idle" };
  emit();
  if (cb) {
    try {
      cb(ok, ms);
    } catch {
      /* trace callback never throws into the UI */
    }
  }
}

/**
 * Speak `text` for `id`, cancelling anything else first.
 * Returns false when speech is unavailable (caller keeps the button disabled).
 */
export function speak(
  id: string,
  text: string,
  lang: Lang,
  done?: (ok: boolean, ms: number) => void,
): boolean {
  if (!isSpeechSupported() || !text.trim()) {
    done?.(false, 0);
    return false;
  }
  const synth = window.speechSynthesis;
  try {
    synth.cancel();
  } catch {
    /* ignore */
  }
  // A previous use was interrupted by this one: close it out as ok.
  if (onDone && status.activeId !== null && status.activeId !== id) {
    const prev = onDone;
    onDone = null;
    try {
      prev(true, startedAt ? Date.now() - startedAt : 0);
    } catch {
      /* ignore */
    }
  }
  const voice = pickVoice(lang, getVoices());
  if (!voice) {
    status = { activeId: null, state: "idle" };
    emit();
    done?.(false, 0);
    return false;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang || bcp47(lang);
  onDone = done ?? null;
  startedAt = Date.now();
  status = { activeId: id, state: "speaking" };
  u.onend = () => {
    if (status.activeId === id) finish(true);
  };
  u.onerror = () => {
    if (status.activeId === id) finish(false);
  };
  try {
    synth.speak(u);
  } catch {
    if (status.activeId === id) finish(false);
    return false;
  }
  // Some browsers report synchronously; emit so buttons flip to Pause/Stop.
  emit();
  return true;
}

export function pauseActive(): void {
  if (!isSpeechSupported() || status.state !== "speaking") return;
  try {
    window.speechSynthesis.pause();
  } catch {
    return;
  }
  status = { ...status, state: "paused" };
  emit();
}

export function resumeActive(): void {
  if (!isSpeechSupported() || status.state !== "paused") return;
  try {
    window.speechSynthesis.resume();
  } catch {
    return;
  }
  status = { ...status, state: "speaking" };
  emit();
}

/** Stop speech. When `id` is given, stop only if that message is active. */
export function stopActive(id?: string): void {
  if (status.state === "idle") return;
  if (id !== undefined && status.activeId !== id) return;
  if (isSpeechSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
  // cancel() does not reliably fire onend, so finish explicitly.
  finish(true);
}
