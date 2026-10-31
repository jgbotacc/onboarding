import { createStaffMock } from "./mock";
import type { DecisionBody, DecisionResult, StaffDetail, StaffRow } from "./types";

export interface StaffClient {
  mock: boolean;
  list(): Promise<StaffRow[]>;
  detail(id: string): Promise<StaffDetail>;
  decide(id: string, body: DecisionBody): Promise<DecisionResult>;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
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

/** Real API unless ?mock=1 or the list endpoint fails, then demo data. */
export async function connectStaff(): Promise<{ client: StaffClient; rows: StaffRow[] }> {
  if (!/(^|[?&])mock=1(&|$)/.test(window.location.search)) {
    try {
      const rows = await real.list();
      if (Array.isArray(rows)) return { client: { mock: false, ...real }, rows };
    } catch {
      /* fall through to mock */
    }
  }
  const m = createStaffMock();
  return { client: { mock: true, ...m }, rows: await m.list() };
}
