/**
 * SKIING — v1 heuristics, tunable.
 *
 * Gate: no ski area within the search radius => 0 ("no ski area nearby").
 * Otherwise the score is the sum of:
 *   snow base   up to 45 pts  (snow depth; 0 below 10 cm, full at 1 m)
 *   fresh snow  up to 25 pts  (snowfall that day; full at 10 cm)
 *   temperature up to 20 pts  (max temp in the "good snow" band)
 *   calm wind   up to 10 pts  (lifts close in strong wind)
 * No snow base and no fresh snow => 0 ("little or no snow"): nothing to ski on.
 */
import { DailyWeather } from '../weather';
import { ScoreResult, clampScore, scale } from '../score';

export type SkiAreaStatus = 'nearby' | 'none' | 'unknown';

export const SKI = {
  MIN_BASE_M: 0.1,
  GOOD_BASE_M: 1.0,
  BASE_POINTS: 45,
  GOOD_SNOWFALL_CM: 10,
  SNOWFALL_POINTS: 25,
  /** Max temperature band (°C) that keeps snow good without being brutal. */
  IDEAL_TEMP_MIN_C: -12,
  IDEAL_TEMP_MAX_C: 2,
  /** Points fall to 0 this many degrees outside the band. */
  TEMP_FALLOFF_C: 8,
  TEMP_POINTS: 20,
  WIND_CALM_KMH: 30,
  WIND_LIFTS_CLOSED_KMH: 60,
  WIND_POINTS: 10,
  /** No base and no fresh snow means nothing to ski on: capped here (0 keeps bestDay null). */
  NO_SNOW_CAP: 0,
} as const;

export function scoreSkiing(
  day: DailyWeather,
  skiArea: SkiAreaStatus,
): ScoreResult {
  if (skiArea === 'none') return { score: 0, reason: 'no ski area nearby' };
  if (skiArea === 'unknown')
    return {
      score: null,
      reason: 'ski area lookup unavailable, try again shortly',
    };

  const depth = day.snowDepthM ?? 0;
  const snowfall = day.snowfallCm ?? 0;
  const notes: string[] = [];

  const basePts =
    depth < SKI.MIN_BASE_M
      ? 0
      : scale(depth, SKI.MIN_BASE_M, SKI.GOOD_BASE_M, 10, SKI.BASE_POINTS);
  notes.push(`snow depth ${Math.round(depth * 100)} cm`);

  const freshPts = scale(
    snowfall,
    0,
    SKI.GOOD_SNOWFALL_CM,
    0,
    SKI.SNOWFALL_POINTS,
  );
  if (snowfall >= 1) notes.push(`${snowfall.toFixed(1)} cm fresh snow`);

  let tempPts = SKI.TEMP_POINTS / 2; // unknown temperature: neutral
  if (day.tempMaxC !== null) {
    const t = day.tempMaxC;
    const outside =
      t > SKI.IDEAL_TEMP_MAX_C
        ? t - SKI.IDEAL_TEMP_MAX_C
        : t < SKI.IDEAL_TEMP_MIN_C
          ? SKI.IDEAL_TEMP_MIN_C - t
          : 0;
    tempPts = scale(outside, 0, SKI.TEMP_FALLOFF_C, SKI.TEMP_POINTS, 0);
    if (t > SKI.IDEAL_TEMP_MAX_C) notes.push(`mild (${Math.round(t)}°C max)`);
    else if (t < SKI.IDEAL_TEMP_MIN_C)
      notes.push(`very cold (${Math.round(t)}°C max)`);
  }

  const wind = day.windSpeedMaxKmh ?? 0;
  const windPts = scale(
    wind,
    SKI.WIND_CALM_KMH,
    SKI.WIND_LIFTS_CLOSED_KMH,
    SKI.WIND_POINTS,
    0,
  );
  if (wind > SKI.WIND_CALM_KMH) notes.push(`windy (${Math.round(wind)} km/h)`);

  let score = basePts + freshPts + tempPts + windPts;
  if (depth < SKI.MIN_BASE_M && snowfall < 1) {
    score = Math.min(score, SKI.NO_SNOW_CAP);
    notes.unshift('little or no snow');
  }
  return { score: clampScore(score), reason: notes.join(', ') };
}
