/**
 * SURFING — v1 heuristics, tunable.
 *
 * No marine data for the location => null ("no coastal data").
 * Otherwise the score is the sum of:
 *   wave height up to 50 pts (sweet spot 1-2.5 m; flat below 0.3 m; too big above ~4 m)
 *   wave period up to 30 pts (longer period = cleaner, more powerful swell)
 *   wind        up to 20 pts (strong wind chops the surface up)
 */
import { DailyMarine, DailyWeather } from '../weather';
import { ScoreResult, clampScore, scale } from '../score';

export const SURF = {
  FLAT_M: 0.3,
  IDEAL_MIN_M: 1.0,
  IDEAL_MAX_M: 2.5,
  TOO_BIG_M: 4.0,
  HEIGHT_POINTS: 50,
  SHORT_PERIOD_S: 6,
  GOOD_PERIOD_S: 12,
  PERIOD_POINTS: 30,
  LIGHT_WIND_KMH: 15,
  BLOWN_OUT_KMH: 40,
  WIND_POINTS: 20,
} as const;

export function scoreSurfing(
  day: DailyWeather,
  marine: DailyMarine | undefined,
): ScoreResult {
  if (!marine || marine.waveHeightMaxM === null)
    return { score: null, reason: 'no coastal data' };

  const h = marine.waveHeightMaxM;
  const notes: string[] = [`waves ${h.toFixed(1)} m`];

  let heightPts: number;
  if (h < SURF.FLAT_M) {
    heightPts = 0;
    notes.push('flat');
  } else if (h < SURF.IDEAL_MIN_M) {
    heightPts = scale(h, SURF.FLAT_M, SURF.IDEAL_MIN_M, 5, SURF.HEIGHT_POINTS);
  } else if (h <= SURF.IDEAL_MAX_M) {
    heightPts = SURF.HEIGHT_POINTS;
  } else {
    heightPts = scale(
      h,
      SURF.IDEAL_MAX_M,
      SURF.TOO_BIG_M,
      SURF.HEIGHT_POINTS,
      10,
    );
    if (h > SURF.TOO_BIG_M) notes.push('very big');
  }

  let periodPts = SURF.PERIOD_POINTS / 3; // unknown period: assume mediocre
  if (marine.wavePeriodMaxS !== null) {
    const p = marine.wavePeriodMaxS;
    periodPts = scale(
      p,
      SURF.SHORT_PERIOD_S,
      SURF.GOOD_PERIOD_S,
      0,
      SURF.PERIOD_POINTS,
    );
    notes.push(`period ${Math.round(p)} s`);
  }

  const wind = day.windSpeedMaxKmh ?? 0;
  const windPts = scale(
    wind,
    SURF.LIGHT_WIND_KMH,
    SURF.BLOWN_OUT_KMH,
    SURF.WIND_POINTS,
    0,
  );
  if (wind > SURF.LIGHT_WIND_KMH * 2)
    notes.push(`windy (${Math.round(wind)} km/h)`);

  // A flat sea isn't rescued by a long period or calm wind.
  const score = h < SURF.FLAT_M ? 0 : heightPts + periodPts + windPts;
  return { score: clampScore(score), reason: notes.join(', ') };
}
