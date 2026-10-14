/** Result of scoring one activity on one day. */
export interface ScoreResult {
  /** 0-100, or null when the activity cannot be assessed (e.g. no coastal data). */
  score: number | null;
  /** Short human-readable explanation. */
  reason: string;
}

export interface DayScore extends ScoreResult {
  date: string;
}

export const clampScore = (n: number): number =>
  Math.round(Math.min(100, Math.max(0, n)));

/** Linear interpolation of `value` from [inMin, inMax] onto [outMin, outMax], clamped. */
export function scale(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  if (inMax === inMin) return outMax;
  const t = Math.min(1, Math.max(0, (value - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}
