import { MAX_ROUNDS, type Looks } from "../types";

/**
 * Pure selection logic for the looks picker.
 * UI state (the picked ids, in-flight requests) lives in LooksPicker.
 */

/** Toggle one look id in the picked set. The client may pick one or more. */
export function togglePicked(picked: readonly string[], id: string): string[] {
  return picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
}

/** Whether one look id is currently picked. */
export function isPicked(picked: readonly string[], id: string): boolean {
  return picked.includes(id);
}

/** "Use these" is only enabled once at least one look is picked. */
export function canUsePicked(picked: readonly string[]): boolean {
  return picked.length > 0;
}

/** Whether a reply carries look options worth rendering. */
export function hasLookOptions(looks: Looks | null | undefined): boolean {
  return !!looks && Array.isArray(looks.options) && looks.options.length > 0;
}

/** 1-based round counters for "Round {round} of {max}", with sane fallbacks. */
export function roundInfo(looks: Looks): { round: number; max: number } {
  const round = Number.isFinite(looks.round) && looks.round > 0 ? Math.floor(looks.round) : 1;
  const rawMax = Number.isFinite(looks.max_rounds) && looks.max_rounds > 0 ? Math.floor(looks.max_rounds) : MAX_ROUNDS;
  return { round, max: Math.max(rawMax, round) };
}
