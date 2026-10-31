import { createStaffMock } from "./mock";
import type { DecisionBody, DecisionResult, StaffDetail, StaffRow } from "./types";

export interface StaffClient {
  mock: boolean;
  list(): Promise<StaffRow[]>;
  detail(id: string): Promise<StaffDetail>;
  decide(id: string, body: DecisionBody): Promise<DecisionResult>;
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
  if (!r.ok) throw new Error("HTTP " + r.status);
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
