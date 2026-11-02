// Small i18n module for the client UI. The staff UI stays English.
import { useEffect, useState } from "react";
import en from "./en";
import zh from "./zh";
import ms from "./ms";
import ta from "./ta";

export type Lang = "en" | "zh" | "ms" | "ta";
export type I18nKey = keyof typeof en;

export const LANGS: { code: Lang; name: string }[] = [
  { code: "en", name: "English" },
  { code: "zh", name: "中文" },
  { code: "ms", name: "Bahasa Melayu" },
  { code: "ta", name: "தமிழ்" },
];

export const LANG_NAMES: Record<Lang, string> = Object.fromEntries(LANGS.map((l) => [l.code, l.name])) as Record<Lang, string>;

const DICTS: Record<Lang, typeof en> = { en, zh, ms, ta };

export type Vars = Record<string, string | number>;

/** Look up `key` in `lang` (English fallback). `{name}` parts are filled from `vars`. */
export function t(lang: Lang, key: I18nKey, vars?: Vars): string {
  let s: string = DICTS[lang]?.[key] ?? en[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
  return s;
}

/** Status pill label; unknown statuses fall back to the raw value with spaces. */
export function statusLabel(lang: Lang, status: string): string {
  const key = ("status." + status) as I18nKey;
  return key in en ? t(lang, key) : status.replace(/_/g, " ");
}

/** Registration form field label. */
export function fieldLabel(lang: Lang, key: string): string {
  return t(lang, ("field." + key) as I18nKey);
}

const STORE_KEY = "onboardingLang";
const isLang = (v: unknown): v is Lang => v === "en" || v === "zh" || v === "ms" || v === "ta";

/** Active language, kept in localStorage and mirrored to <html lang>. */
export function useLang(): [Lang, (lang: Lang) => void] {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const s = localStorage.getItem(STORE_KEY);
      if (isLang(s)) return s;
    } catch {
      /* storage unavailable */
    }
    return "en";
  });
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, lang);
    } catch {
      /* storage unavailable */
    }
    document.documentElement.lang = lang;
  }, [lang]);
  return [lang, setLang];
}
