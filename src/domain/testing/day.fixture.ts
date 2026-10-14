import { DailyWeather } from '../weather';

/** A pleasant, dry, snowless day; override fields per test. */
export function makeDay(overrides: Partial<DailyWeather> = {}): DailyWeather {
  return {
    date: '2026-10-15',
    tempMaxC: 20,
    tempMinC: 10,
    precipitationMm: 0,
    precipitationProbability: 0,
    snowfallCm: 0,
    snowDepthM: 0,
    windSpeedMaxKmh: 10,
    weatherCode: 1,
    sunshineHours: 10,
    ...overrides,
  };
}
