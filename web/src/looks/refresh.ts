import type { Looks, SuggestedLook } from "../types";

/** Options in `incoming` whose ids are not in `shown` yet (staff-sent while the picker was open). */
export function newLookOptions<T extends { id: string }>(shown: { id: string }[] | null | undefined, incoming: T[] | null | undefined): T[] {
  const seen = new Set((shown || []).map((o) => o.id));
  return (incoming || []).filter((o) => o.id && !seen.has(o.id));
}

/** The same merge for `suggested_looks` (read-only staff suggestions shown under the picker). */
export function newSuggestedLooks(shown: SuggestedLook[] | null | undefined, incoming: SuggestedLook[] | null | undefined) {
  return newLookOptions(shown, incoming);
}

/** Looks with unseen options appended; `null` when nothing new arrived (no re-render needed). */
export function mergeLooks(current: Looks, incoming: Looks | null | undefined): Looks | null {
  if (!incoming || !Array.isArray(incoming.options)) return null;
  const fresh = newLookOptions(current.options, incoming.options);
  if (!fresh.length) return null;
  return { ...current, options: [...current.options, ...fresh] };
}

/** Suggested looks with unseen entries appended; `null` when nothing new arrived. */
export function mergeSuggested(
  current: SuggestedLook[] | null | undefined,
  incoming: SuggestedLook[] | null | undefined,
): SuggestedLook[] | null {
  if (!incoming || !incoming.length) return null;
  const fresh = newSuggestedLooks(current, incoming);
  if (!fresh.length) return null;
  return [...(current || []), ...fresh];
}
