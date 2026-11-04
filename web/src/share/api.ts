// Public share-link API (PRD 4.8.3.3). No login: the token is the only secret and it
// travels in the x-share-token header only — never in a URL path, query string, or
// storage (the page keeps it in memory, read from the #t= fragment browsers never send).
export type FeedbackKind = "heart" | "reject" | "approve" | "changes";

export interface ShareDraft {
  id: string;
  url: string;
  title: string;
  liked: boolean;
}

export interface ShareDecided {
  draft_id: string;
  kind: "approve" | "changes";
}

export interface ShareState {
  business_name: string;
  drafts: ShareDraft[];
  shortlist: string[];
  decided: ShareDecided | null;
}

export interface ShareFeedbackBody {
  draft_id: string;
  kind: FeedbackKind;
  note?: string;
}

export interface ShareClient {
  mock: boolean;
  get(token: string): Promise<ShareState>;
  feedback(token: string, body: ShareFeedbackBody): Promise<{ ok: true; shortlist: string[] }>;
}

/** 404 (unknown/revoked/missing) or 410 (expired). Messages match the backend wording. */
export class ShareLinkError extends Error {
  constructor(
    public status: 404 | 410,
    message: string,
  ) {
    super(message);
    this.name = "ShareLinkError";
  }
}

export const isShareMock = () =>
  typeof window !== "undefined" && /(^|[?&])mock=1(&|$)/.test(window.location.search);

/** Read the link token from the URL fragment (#t=<token>), which browsers never send. */
export const tokenFromFragment = (): string => {
  const m = /#t=([^&]*)/.exec(window.location.hash || "");
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]).trim();
  } catch {
    return "";
  }
};

async function req<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-share-token", token);
  const r = await fetch(path, { ...init, headers });
  if (r.status === 404) {
    throw new ShareLinkError(404, "This link is no longer valid. Please ask our team for a new one.");
  }
  if (r.status === 410) {
    throw new ShareLinkError(410, "This link has expired. Please ask our team for a new one.");
  }
  if (!r.ok) {
    let detail = "";
    try {
      const body = (await r.clone().json()) as { detail?: unknown };
      if (typeof body?.detail === "string" && body.detail.trim()) detail = body.detail.trim();
    } catch {
      /* not JSON */
    }
    throw new Error(detail || "HTTP " + r.status);
  }
  return r.json() as Promise<T>;
}

export const realShareClient: ShareClient = {
  mock: false,
  get: (token) => req<ShareState>(token, "/api/share"),
  feedback: (token, body) =>
    req<{ ok: true; shortlist: string[] }>(token, "/api/share/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body.kind === "changes" ? body : { draft_id: body.draft_id, kind: body.kind }),
    }),
};
