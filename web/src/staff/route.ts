import type { StaffRole } from "./api";

export type StaffView = "staff" | "designer";

const isMockSearch = (search: string) => /(^|[?&])mock=1(&|$)/.test(search);

/** Legacy designer addresses redirect to the matching staff address, keeping the query.
 * Returns the replace target (path + search + hash), or null when no redirect applies. */
export function designerRedirect(hash: string, pathname: string, search: string): string | null {
  const designerHash = hash.match(/^#\/designer\b(.*)$/);
  if (designerHash) return `${pathname}${search}#/staff${designerHash[1]}`;
  if (/\/designer\/?$/.test(pathname)) return `/staff${search}${hash}`;
  return null;
}

/** Which view the single staff address shows. The signed-in role decides;
 * ?mock=1&role=designer previews the designer view without signing in (mock only). */
export function pickStaffView(role: StaffRole | null, search: string): StaffView {
  if (isMockSearch(search) && /(^|[?&])role=designer(&|$)/.test(search)) return "designer";
  return role === "designer" ? "designer" : "staff";
}
