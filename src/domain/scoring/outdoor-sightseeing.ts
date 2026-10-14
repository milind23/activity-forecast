/**
 * OUTDOOR SIGHTSEEING — v1 heuristics, tunable.
 *
 * Start from 100 and subtract penalties:
 *   rain        up to 45 (worse of: probability-based, amount-based)
 *   temperature up to 30 (3 pts per °C outside a comfortable 15-26 °C max-temp band)
 *   wind        up to 15 (above 30 km/h)
 *   no sun      up to 10 (fewer than 6 sunshine hours)
 * Thunderstorms cap the score at 10.
 */
import { DailyWeather, isThunderstorm } from '../weather';
import { ScoreResult, clampScore, scale } from '../score';

export const OUTDOOR = {
  RAIN_MAX_PENALTY: 45,
  HEAVY_RAIN_MM: 8,
  COMFORT_MIN_C: 15,
  COMFORT_MAX_C: 26,
  TEMP_PENALTY_PER_C: 3,
  TEMP_MAX_PENALTY: 30,
  WIND_OK_KMH: 30,
  WIND_BAD_KMH: 60,
  WIND_MAX_PENALTY: 15,
  SUNNY_HOURS: 6,
  SUN_MAX_PENALTY: 10,
  THUNDERSTORM_CAP: 10,
} as const;

export function scoreOutdoorSightseeing(day: DailyWeather): ScoreResult {
  const notes: string[] = [];
  let score = 100;

  const byProbability = scale(
    day.precipitationProbability ?? 0,
    20,
    100,
    0,
    OUTDOOR.RAIN_MAX_PENALTY,
  );
  const byAmount = scale(
    day.precipitationMm ?? 0,
    0.2,
    OUTDOOR.HEAVY_RAIN_MM,
    0,
    OUTDOOR.RAIN_MAX_PENALTY,
  );
  const rainPenalty = Math.max(byProbability, byAmount);
  score -= rainPenalty;
  if (rainPenalty >= 10)
    notes.push(
      `rain likely (${day.precipitationProbability ?? '?'}%, ${(day.precipitationMm ?? 0).toFixed(1)} mm)`,
    );

  if (day.tempMaxC !== null) {
    const t = day.tempMaxC;
    const outside =
      t < OUTDOOR.COMFORT_MIN_C
        ? OUTDOOR.COMFORT_MIN_C - t
        : t > OUTDOOR.COMFORT_MAX_C
          ? t - OUTDOOR.COMFORT_MAX_C
          : 0;
    score -= Math.min(
      OUTDOOR.TEMP_MAX_PENALTY,
      outside * OUTDOOR.TEMP_PENALTY_PER_C,
    );
    if (t < OUTDOOR.COMFORT_MIN_C) notes.push(`cool (${Math.round(t)}°C max)`);
    else if (t > OUTDOOR.COMFORT_MAX_C)
      notes.push(`hot (${Math.round(t)}°C max)`);
    else notes.push(`pleasant ${Math.round(t)}°C`);
  }

  const wind = day.windSpeedMaxKmh ?? 0;
  score -= scale(
    wind,
    OUTDOOR.WIND_OK_KMH,
    OUTDOOR.WIND_BAD_KMH,
    0,
    OUTDOOR.WIND_MAX_PENALTY,
  );
  if (wind > OUTDOOR.WIND_OK_KMH)
    notes.push(`windy (${Math.round(wind)} km/h)`);

  if (day.sunshineHours !== null) {
    score -= scale(
      day.sunshineHours,
      OUTDOOR.SUNNY_HOURS,
      0,
      0,
      OUTDOOR.SUN_MAX_PENALTY,
    );
    if (day.sunshineHours >= OUTDOOR.SUNNY_HOURS) notes.push('sunny');
  }

  if (isThunderstorm(day.weatherCode)) {
    score = Math.min(score, OUTDOOR.THUNDERSTORM_CAP);
    notes.unshift('thunderstorms');
  }
  return {
    score: clampScore(score),
    reason: notes.join(', ') || 'average conditions',
  };
}
