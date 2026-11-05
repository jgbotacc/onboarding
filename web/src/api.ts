import { EMPTY_FORM, type ApiResponse, type FormFields, type Lang, type TraceKind } from "./types";
import { createMock } from "./mock";

export const API_BASE = "";
const SESSION_KEY = "onboardingSessionId";
const SECRET_KEY = "onboardingSessionSecret"; // [session-secret] proves this tab owns the session
const LANG_KEY = "onboardingLang";

const store = (k: string, v: string) => {
  try {
    if (v) sessionStorage.setItem(k, v);
    else sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
};
const read = (k: string) => {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};

/** Drop the stored client session so the next connect() starts a fresh one. Keeps the chosen language (localStorage). */
export function clearClientSession(): void {
  store(SESSION_KEY, "");
  store(SECRET_KEY, "");
}

const isLang = (v: unknown): v is Lang => v === "en" || v === "zh" || v === "ms" || v === "ta";

/** Active language, shared with the i18n picker via localStorage (default `en`). */
export function getLang(): Lang {
  try {
    const s = localStorage.getItem(LANG_KEY);
    if (isLang(s)) return s;
  } catch {
    /* storage unavailable */
  }
  return "en";
}

export function storeLang(lang: Lang): void {
  try {
    if (!isLang(lang)) return;
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;
  } catch {
    /* storage unavailable */
  }
}

/** [resume-410] The server answered with an error status (vs a network failure, which stays a plain Error). */
export class HttpError extends Error {
  constructor(public status: number, public detail: string) {
    super("HTTP " + status);
  }
}

const errorDetail = (j: unknown): string => {
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  if (typeof o.Detail === "string" && o.Detail) return o.Detail;
  if (typeof o.detail === "string" && o.detail) return o.detail;
  if (typeof o.message === "string" && o.message) return o.message;
  return "";
};

/**
 * Map a raw reply onto the contract shape (`Docs/UI-API-CONTRACT.md`), accepting the PRD
 * response names too: `confirm.fields[{key,label,value}]` -> `extracted[{field,label,value}]`,
 * `looks.options[{id,url,title}]` -> `[{id,url,alt}]`, `retake:true` + `retake_reason` -> `retake:{reason}`.
 * `step` falls back to `status` (and vice versa).
 */
export function normalizeChatReply(raw: unknown): ApiResponse {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...src } as Record<string, unknown>;
  if (typeof out.step !== "string" || !out.step) {
    if (typeof out.status === "string" && out.status) out.step = out.status;
  }
  if (typeof out.status !== "string" || !out.status) {
    if (typeof out.step === "string" && out.step) out.status = out.step;
    else if (out.status == null) out.status = "";
  }
  if (typeof out.reply !== "string") out.reply = "";
  if (!Array.isArray(out.images)) out.images = [];
  if (!Array.isArray(out.missing)) out.missing = [];
  if (typeof out.round !== "number") out.round = 0;
  const looks = out.looks as { options?: unknown } | null | undefined;
  if (looks && typeof looks === "object" && Array.isArray(looks.options)) {
    out.looks = {
      ...looks,
      options: looks.options.map((o) => {
        const opt = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
        return {
          id: String(opt.id ?? ""),
          url: String(opt.url ?? ""),
          alt: typeof opt.alt === "string" ? opt.alt : typeof opt.title === "string" ? opt.title : "",
          suggested: opt.suggested === true,
        };
      }),
    };
  }
  if (Array.isArray(out.suggested_looks)) {
    out.suggested_looks = (out.suggested_looks as unknown[]).map((s) => {
      const item = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const alt = typeof item.alt === "string" ? item.alt : typeof item.title === "string" ? item.title : "";
      return {
        id: String(item.id ?? ""),
        url: String(item.url ?? ""),
        alt,
        title: typeof item.title === "string" ? item.title : alt,
        suggested: true,
      };
    });
  }
  const confirm = out.confirm as { fields?: unknown } | null | undefined;
  if (!Array.isArray(out.extracted) && confirm && Array.isArray(confirm.fields)) {
    out.extracted = confirm.fields.map((f) => {
      const fld = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      return {
        field: String(fld.field ?? fld.key ?? ""),
        label: String(fld.label ?? fld.field ?? fld.key ?? ""),
        value: String(fld.value ?? ""),
      };
    });
  } else if (Array.isArray(out.extracted)) {
    out.extracted = out.extracted.map((f) => {
      const fld = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      return {
        field: String(fld.field ?? fld.key ?? ""),
        label: String(fld.label ?? fld.field ?? fld.key ?? ""),
        value: String(fld.value ?? ""),
      };
    });
  }
  const retake = out.retake as { reason?: unknown } | boolean | null | undefined;
  if (retake && typeof retake === "object" && typeof retake.reason === "string") {
    /* already the contract shape */
  } else if (out.retake === true) {
    const reason = typeof out.retake_reason === "string" && out.retake_reason ? out.retake_reason : "blurry";
    out.retake = { reason };
  } else if (typeof out.retake_reason === "string" && out.retake_reason && !out.retake) {
    out.retake = { reason: out.retake_reason };
  } else if (out.retake === false) {
    out.retake = undefined;
  }
  return out as unknown as ApiResponse;
}

async function postJson<T>(path: string, body: unknown, secret?: string): Promise<T> {
  const lang = getLang();
  const payload = { ...((body as Record<string, unknown>) ?? {}), lang };
  const r = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-lang": lang, ...(secret ? { "x-session-secret": secret } : {}) },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    let detail = "";
    try {
      detail = errorDetail(await r.json());
    } catch {
      /* not JSON */
    }
    throw new HttpError(r.status, detail);
  }
  return r.json() as Promise<T>;
}

async function deleteJson<T>(path: string, body: unknown, secret?: string): Promise<T> {
  const lang = getLang();
  const payload = { ...((body as Record<string, unknown>) ?? {}), lang };
  const r = await fetch(API_BASE + path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", "x-lang": lang, ...(secret ? { "x-session-secret": secret } : {}) },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    let detail = "";
    try {
      detail = errorDetail(await r.json());
    } catch {
      /* not JSON */
    }
    throw new HttpError(r.status, detail);
  }
  return r.json() as Promise<T>;
}

export interface Client {
  mock: boolean;
  sessionId: string;
  upload(files: File[]): Promise<ApiResponse>;
  form(fields: FormFields): Promise<ApiResponse>;
  chat(text: string): Promise<ApiResponse>;
  review(accepted: boolean, feedback: string): Promise<ApiResponse>;
  pickLooks(ids: string[]): Promise<ApiResponse>;
  skipLooks(): Promise<ApiResponse>;
  confirmExtracted(fields: Record<string, string>): Promise<ApiResponse>;
  removeUpload(): Promise<ApiResponse>;
  trace(kind: TraceKind, ok: boolean, ms: number): Promise<void>;
  setLang(lang: Lang): void;
  /** Re-translate stored bot replies (POST /api/translate); `texts` come back in order. */
  translate(texts: string[], lang: Lang): Promise<{ lang: Lang; texts: string[] }>;
  /** Resume poll: POST /api/session with the session secret; returns the current looks and suggested_looks. */
  refresh(): Promise<ApiResponse>;
  /** Set when opened from a staff "more information" link (/?resume=<token>). */
  resume?: { missing: string[]; reply: string };
  /** [resume-410] Set when a resume link is used up (410) or unknown (404): show this and close the chat. */
  linkClosed?: { status: "link_used" | "link_invalid"; message: string };
}

export const LINK_USED_MSG = "This link has already been used. Your details are saved, and we'll be in touch.";
const LINK_INVALID_MSG = "This link has expired. Need to change something? Just get in touch with us.";

const dropResumeParam = () => {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete("resume");
    window.history.replaceState(null, "", u.toString());
  } catch {
    /* ignore */
  }
};

// --- Resume link (staff "I need more information") ---
const resumeToken = () => new URLSearchParams(window.location.search).get("resume") || "";
const MOCK_USED = "used"; // [resume-410] ?mock=1&resume=used previews the used-link state
const MOCK_RESUME = {
  missing: ["business_website", "phone_number", "design_preferences"],
  reply: "We need a few more things before we can approve your designs:\n\n\u2022 A working website link\n\u2022 A phone number\n\u2022 A bit more about the style you like\n\n(Sample note)",
};

type MockHandlers = ReturnType<typeof createMock>;

function mockExtras(m: MockHandlers) {
  return {
    pickLooks: (ids: string[]) => m.pickLooks(ids),
    skipLooks: () => m.skipLooks(),
    confirmExtracted: (fields: Record<string, string>) => m.confirmExtracted(fields),
    removeUpload: () => m.removeUpload(),
    trace: (kind: TraceKind, ok: boolean, ms: number) => m.trace(kind, ok, ms),
    setLang: (lang: Lang) => {
      storeLang(lang);
    },
    translate: (texts: string[], lang: Lang) => m.translate(texts, lang),
    // Mock has no backend: the picker never polls in mock mode, so this stays a no-op.
    refresh: () =>
      new Promise<ApiResponse>((res) =>
        setTimeout(
          () =>
            res({
              reply: "",
              step: "choosing_look",
              status: "choosing_look",
              images: [],
              missing: [],
              round: 0,
              looks: null,
              suggested_looks: null,
            }),
          100,
        ),
      ),
  };
}

function mockClient(): Client {
  if (resumeToken() === MOCK_USED) {
    dropResumeParam();
    const m = createMock();
    return { mock: true, sessionId: "", ...m, ...mockExtras(m), linkClosed: { status: "link_used", message: LINK_USED_MSG } };
  }
  const resumed = !!resumeToken();
  const m = createMock({ resumed });
  return { mock: true, sessionId: "mock-" + Math.random().toString(36).slice(2, 10), ...m, ...mockExtras(m), ...(resumed ? { resume: MOCK_RESUME } : {}) };
}

export async function connect(): Promise<Client> {
  if (/(^|[?&])mock=1(&|$)/.test(window.location.search)) return mockClient();
  const token = resumeToken();
  if (token) {
    try {
      const r = await postJson<ApiResponse & { sessionId?: string; sessionSecret?: string }>("/api/session", { resumeToken: token });
      if (!r || !r.sessionId || !r.sessionSecret) throw new Error("no sessionId");
      store(SESSION_KEY, r.sessionId);
      store(SECRET_KEY, r.sessionSecret);
      const norm = normalizeChatReply(r);
      return { ...realClient(r.sessionId, r.sessionSecret), resume: { missing: norm.missing || [], reply: norm.reply || "" } };
    } catch (e) {
      // [resume-410] The server answered: the link is used (410) or unknown (404). Say so; don't fall back to demo mode.
      // Only real network failures (no answer) fall through to mock.
      if (e instanceof HttpError && (e.status === 410 || e.status === 404)) {
        dropResumeParam();
        const used = e.status === 410;
        return {
          ...realClient("", ""),
          linkClosed: { status: used ? "link_used" : "link_invalid", message: e.detail || (used ? LINK_USED_MSG : LINK_INVALID_MSG) },
        };
      }
      return mockClient();
    }
  }
  const saved = read(SESSION_KEY);
  const savedSecret = read(SECRET_KEY);
  try {
    const r = await postJson<{ sessionId?: string; sessionSecret?: string }>(
      "/api/session",
      saved && savedSecret ? { sessionId: saved, sessionSecret: savedSecret } : {},
    );
    if (!r || !r.sessionId) throw new Error("no sessionId");
    const sessionId = r.sessionId;
    // A new session comes with its secret (returned once); a resumed one keeps the saved secret.
    const secret = r.sessionSecret || (sessionId === saved ? savedSecret || "" : "");
    if (!secret) throw new Error("no session secret");
    store(SESSION_KEY, sessionId);
    store(SECRET_KEY, secret);
    return realClient(sessionId, secret);
  } catch {
    return mockClient();
  }
}

export function realClient(sessionId: string, secret: string): Client {
  // All backend paths live here so they are easy to swap (Docs/UI-API-CONTRACT.md).
  return {
    mock: false,
    sessionId,
    async upload(files) {
      const lang = getLang();
      const fd = new FormData();
      fd.append("sessionId", sessionId);
      fd.append("lang", lang);
      files.forEach((f) => fd.append("files[]", f, f.name));
      const res = await fetch(API_BASE + "/api/upload", { method: "POST", body: fd, headers: { "x-session-secret": secret, "x-lang": lang } });
      if (!res.ok) {
        let detail = "";
        try {
          detail = errorDetail(await res.json());
        } catch {
          /* not JSON */
        }
        throw new HttpError(res.status, detail);
      }
      return normalizeChatReply(await res.json());
    },
    refresh: async () =>
      normalizeChatReply(await postJson("/api/session", { sessionId, sessionSecret: secret }, secret)),
    // History re-translation: sends the target lang explicitly (postJson would use the stored one).
    translate: async (texts, lang) => {
      const r = await fetch(API_BASE + "/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-lang": lang, ...(secret ? { "x-session-secret": secret } : {}) },
        body: JSON.stringify({ sessionId, sessionSecret: secret, lang, texts }),
      });
      if (!r.ok) {
        let detail = "";
        try {
          detail = errorDetail(await r.json());
        } catch {
          /* not JSON */
        }
        throw new HttpError(r.status, detail);
      }
      const j = (await r.json()) as { lang?: unknown; texts?: unknown };
      return {
        lang: isLang(j.lang) ? j.lang : lang,
        texts: Array.isArray(j.texts) ? j.texts.map((x) => String(x)) : texts.slice(),
      };
    },
    form: async (fields) => normalizeChatReply(await postJson("/api/form", { sessionId, fields: { ...EMPTY_FORM, ...fields } }, secret)),
    chat: async (text) => normalizeChatReply(await postJson("/api/chat", { sessionId, text }, secret)),
    review: async (accepted, feedback) =>
      normalizeChatReply(await postJson("/api/review", { sessionId, accepted, feedback: feedback || "" }, secret)),
    pickLooks: async (ids) => normalizeChatReply(await postJson("/api/looks/pick", { sessionId, picked_ids: ids }, secret)),
    skipLooks: async () => normalizeChatReply(await postJson("/api/looks/skip", { sessionId }, secret)),
    confirmExtracted: async (fields) =>
      normalizeChatReply(await postJson("/api/extracted/confirm", { sessionId, fields }, secret)),
    removeUpload: async () => normalizeChatReply(await deleteJson("/api/upload", { sessionId }, secret)),
    trace: async (kind, ok, ms) => {
      try {
        const lang = getLang();
        await fetch(API_BASE + "/api/trace", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-session-secret": secret, "x-lang": lang },
          body: JSON.stringify({ sessionId, kind, ok, ms, lang }),
        });
      } catch {
        /* trace never throws: the UI ignores errors and never retries */
      }
    },
    setLang: (lang) => {
      storeLang(lang);
    },
  };
}
