/**
 * INDOOR SIGHTSEEING — v1 heuristics, tunable.
 *
 * Museums are open whatever the weather, so this never drops below a floor.
 * It rises as outdoor conditions get worse: a rainy day is a great museum day,
 * a perfect sunny day is a "fine, but you could be outside" museum day.
 *
 *   score = FLOOR + (100 - outdoorScore) * (100 - FLOOR) / 100
 *
 * Limitation (open question): this is purely relative to the weather; it does
 * not know whether the town actually has museums/galleries.
 */
import { DailyWeather } from '../weather';
import { ScoreResult, clampScore } from '../score';
import { scoreOutdoorSightseeing } from './outdoor-sightseeing';

export const INDOOR = {
  FLOOR: 40,
} as const;

export function scoreIndoorSightseeing(day: DailyWeather): ScoreResult {
  const outdoor = scoreOutdoorSightseeing(day).score ?? 50;
  const score = INDOOR.FLOOR + ((100 - outdoor) * (100 - INDOOR.FLOOR)) / 100;
  const reason =
    outdoor < 40
      ? 'poor weather outside - good day for indoor sights'
      : outdoor > 75
        ? 'always available, but the weather favours being outdoors'
        : 'always available; mixed weather outside';
  return { score: clampScore(score), reason };
}
