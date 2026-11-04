import { createStaffMock } from "./mock";
import type { Consult, DecisionBody, DecisionResult, RejectedLookRound, ShareCreated, ShareLink, ShortlistView, StaffDetail, StaffMetrics, StaffRow, StudioDraft, StudioDraftsBody, StudioGet, StudioRemixBody, StudioRunResult } from "./types";

export interface StaffClient {
  mock: boolean;
  list(): Promise<StaffRow[]>;
  detail(id: string): Promise<StaffDetail>;
  decide(id: string, body: DecisionBody): Promise<DecisionResult>;
  rejectedLooks(id: string): Promise<RejectedLookRound[]>;
  consults(): Promise<Consult[]>;
  approveConsult(id: string): Promise<Consult>;
  metrics(): Promise<StaffMetrics>;
  studio(id: string): Promise<StudioGet>;
  generateDrafts(id: string, body: StudioDraftsBody): Promise<StudioRunResult>;
  remixDraft(id: string, body: StudioRemixBody): Promise<StudioRunResult>;
  starDraft(id: string, draftId: string, starred: boolean): Promise<StudioDraft>;
  pinDraft(id: string, draftId: string, target: "client" | "consult" | null): Promise<StudioDraft>;
  sendDraft(id: string, draftId: string): Promise<StudioDraft>;
  createShare(id: string, days?: number): Promise<ShareCreated>;
  listShares(id: string): Promise<ShareLink[]>;
  revokeShare(id: string, tokenId: string): Promise<{ id: string; revoked_at: string }>;
  shortlist(id: string): Promise<ShortlistView>;
  setShortlist(id: string, draftId: string, add: boolean): Promise<{ drafts: StudioDraft[] }>;
}

// [staff-key] Staff passcode, kept for this browser tab only and sent as x-staff-key on every staff call.
const KEY = "staffKey";
export const getStaffKey = () => {
  try {
    return sessionStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
};
export const setStaffKey = (k: string) => {
  try {
    if (k) sessionStorage.setItem(KEY, k);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
};

/** The server refused the passcode (401) or staff access isn't set up (503). */
export class StaffAuthError extends Error {
  constructor(public status: number) {
    super(status === 503 ? "Staff access isn't set up yet." : "Passcode needed");
  }
}

let onAuthFail: (e: StaffAuthError) => void = () => {};
export const setOnAuthFail = (f: (e: StaffAuthError) => void) => {
  onAuthFail = f;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-staff-key", getStaffKey());
  const r = await fetch(path, { ...init, headers });
  if (r.status === 401 || r.status === 503) {
    const e = new StaffAuthError(r.status);
    if (r.status === 401) setStaffKey("");
    onAuthFail(e);
    throw e;
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

const real: Omit<StaffClient, "mock"> = {
  list: () => req("/api/staff/clients"),
  detail: (id) => req("/api/staff/clients/" + encodeURIComponent(id)),
  decide: (id, body) =>
    req("/api/staff/clients/" + encodeURIComponent(id) + "/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  rejectedLooks: (id) => req("/api/staff/clients/" + encodeURIComponent(id) + "/rejected-looks"),
  consults: () => req("/api/staff/consults"),
  approveConsult: (id) =>
    req("/api/staff/consults/" + encodeURIComponent(id) + "/approve", { method: "POST" }),
  metrics: () => req("/api/staff/metrics"),
  studio: (id) => req("/api/staff/clients/" + encodeURIComponent(id) + "/studio"),
  generateDrafts: (id, body) =>
    req("/api/staff/clients/" + encodeURIComponent(id) + "/studio/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  remixDraft: (id, body) =>
    req("/api/staff/clients/" + encodeURIComponent(id) + "/studio/remix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  starDraft: (id, draftId, starred) =>
    req("/api/staff/clients/" + encodeURIComponent(id) + "/studio/drafts/" + encodeURIComponent(draftId) + "/star", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred }),
    }),
  pinDraft: (id, draftId, target) =>
    req("/api/staff/clients/" + encodeURIComponent(id) + "/studio/drafts/" + encodeURIComponent(draftId) + "/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    }),
  sendDraft: (id, draftId) =>
    req("/api/staff/clients/" + encodeURIComponent(id) + "/studio/drafts/" + encodeURIComponent(draftId) + "/send", {
      method: "POST",
    }),
  createShare: (id, days = 7) =>
    req("/api/staff/clients/" + encodeURIComponent(id) + "/studio/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    }),
  listShares: (id) => req("/api/staff/clients/" + encodeURIComponent(id) + "/studio/shares"),
  revokeShare: (id, tokenId) =>
    req("/api/staff/clients/" + encodeURIComponent(id) + "/studio/shares/" + encodeURIComponent(tokenId) + "/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  shortlist: (id) => req("/api/staff/clients/" + encodeURIComponent(id) + "/studio/shortlist"),
  setShortlist: (id, draftId, add) =>
    req("/api/staff/clients/" + encodeURIComponent(id) + "/studio/shortlist/" + encodeURIComponent(draftId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ add }),
    }),
};

export type StaffConnect =
  | { client: StaffClient; rows: StaffRow[]; auth?: undefined }
  | { client?: undefined; rows?: undefined; auth: StaffAuthError | null };

/** Real API (needs the passcode) unless ?mock=1 or the server can't be reached, then demo data.
 * Returns { auth } when the passcode is missing or wrong, so the page can ask for it. */
export async function connectStaff(): Promise<StaffConnect> {
  if (!/(^|[?&])mock=1(&|$)/.test(window.location.search)) {
    if (!getStaffKey()) return { auth: null };
    try {
      const rows = await real.list();
      if (Array.isArray(rows)) return { client: { mock: false, ...real }, rows };
    } catch (e) {
      if (e instanceof StaffAuthError) return { auth: e };
      /* network failure: fall through to mock */
    }
  }
  const m = createStaffMock();
  return { client: { mock: true, ...m }, rows: await m.list() };
}
