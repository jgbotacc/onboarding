import { ApiResponse, EMPTY_FORM, type FormFields } from "./types";
import { createMock } from "./mock";

export const API_BASE = "";
const SESSION_KEY = "onboardingSessionId";
const SECRET_KEY = "onboardingSessionSecret"; // [session-secret] proves this tab owns the session

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

/** [resume-410] The server answered with an error status (vs a network failure, which stays a plain Error). */
export class HttpError extends Error {
  constructor(public status: number, public detail: string) {
    super("HTTP " + status);
  }
}

async function postJson<T>(path: string, body: unknown, secret?: string): Promise<T> {
  const r = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "x-session-secret": secret } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) {
    let detail = "";
    try {
      const j = await r.json();
      detail = typeof j?.detail === "string" ? j.detail : typeof j?.message === "string" ? j.message : "";
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
  /** Set when opened from a staff "more information" link (/?resume=<token>). */
  resume?: { missing: string[]; reply: string };
  /** [resume-410] Set when a resume link is used up (410) or unknown (404): show this and close the chat. */
  linkClosed?: { status: "link_used" | "link_invalid"; message: string };
}

export const LINK_USED_MSG = "This link has already been used. Your details are saved, and our team will be in touch.";
const LINK_INVALID_MSG = "This link is no longer valid. If you still need to update your details, please contact our team.";

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
  reply: "Our team needs a few more details before approving your designs: please add a working website link, a phone number and a bit more on your design preferences. (Demo note)",
};

function mockClient(): Client {
  if (resumeToken() === MOCK_USED) {
    dropResumeParam();
    return { mock: true, sessionId: "", ...createMock(), linkClosed: { status: "link_used", message: LINK_USED_MSG } };
  }
  const resumed = !!resumeToken();
  const m = createMock({ resumed });
  return { mock: true, sessionId: "mock-" + Math.random().toString(36).slice(2, 10), ...m, ...(resumed ? { resume: MOCK_RESUME } : {}) };
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
      return { ...realClient(r.sessionId, r.sessionSecret), resume: { missing: r.missing || [], reply: r.reply || "" } };
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

function realClient(sessionId: string, secret: string): Client {
  return {
    mock: false,
    sessionId,
    async upload(files) {
      const fd = new FormData();
      fd.append("sessionId", sessionId);
      files.forEach((f) => fd.append("files[]", f, f.name));
      const res = await fetch(API_BASE + "/api/upload", { method: "POST", body: fd, headers: { "x-session-secret": secret } });
      if (!res.ok) {
        let detail = "";
        try {
          const j = await res.json();
          detail = typeof j?.detail === "string" ? j.detail : "";
        } catch {
          /* not JSON */
        }
        throw new HttpError(res.status, detail);
      }
      return res.json();
    },
    form: (fields) => postJson("/api/form", { sessionId, fields: { ...EMPTY_FORM, ...fields } }, secret),
    chat: (text) => postJson("/api/chat", { sessionId, text }, secret),
    review: (accepted, feedback) => postJson("/api/review", { sessionId, accepted, feedback: feedback || "" }, secret),
  };
}
