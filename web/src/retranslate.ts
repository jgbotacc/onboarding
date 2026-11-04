// History re-translation on language-switch (client chat only).
// Built-in lines (greeting / welcomeBack) re-render from i18n via their key;
// server lines carry the English `source` from the reply and are swapped for the
// cached translation for the new language, else one translate call for all
// uncached sources. Client and error messages never change.
import type { Lang } from "./i18n";

export interface Translatable {
  role: string;
  text: string;
  source?: string;
  i18nKey?: string;
}

export const retranslateKey = (source: string, lang: Lang): string => `${lang}\n${source}`;

/** Remember how `source` reads in `lang` (e.g. when a reply first arrives). */
export function seedTranslation(cache: Map<string, string>, source: string, lang: Lang, text: string): void {
  if (!source) return;
  cache.set(retranslateKey(source, lang), text);
}

/** Unique server sources with no cached translation for `lang`, in message order. */
export function pendingSources(messages: readonly Translatable[], lang: Lang, cache: Map<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.role !== "assistant" || m.i18nKey || m.source == null || m.source === "") continue;
    if (seen.has(m.source)) continue;
    seen.add(m.source);
    if (!cache.has(retranslateKey(m.source, lang))) out.push(m.source);
  }
  return out;
}

/**
 * Re-render history for `lang`: built-in lines via `renderBuiltin`, server lines
 * from `cache`/`fetched` (source -> translated text). Every applied server
 * translation is stored in `cache`. Messages with nothing available keep their text.
 */
export function swapMessages<T extends Translatable>(
  messages: readonly T[],
  lang: Lang,
  cache: Map<string, string>,
  fetched: Map<string, string>,
  renderBuiltin: (key: string) => string,
): T[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    if (m.i18nKey) {
      const text = renderBuiltin(m.i18nKey);
      return text === m.text ? m : { ...m, text };
    }
    if (m.source == null || m.source === "") return m;
    const hit = cache.get(retranslateKey(m.source, lang)) ?? fetched.get(m.source);
    if (hit == null) return m;
    cache.set(retranslateKey(m.source, lang), hit);
    return hit === m.text ? m : { ...m, text: hit };
  });
}
