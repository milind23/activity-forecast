/** One local calendar day of weather, already normalised from the provider. */
export interface DailyWeather {
  /** Local date in the location's timezone, YYYY-MM-DD. */
  date: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipitationMm: number | null;
  /** 0-100 */
  precipitationProbability: number | null;
  snowfallCm: number | null;
  /** Max snow depth during the day, metres. */
  snowDepthM: number | null;
  windSpeedMaxKmh: number | null;
  /** WMO weather code. */
  weatherCode: number | null;
  sunshineHours: number | null;
}

/** One local calendar day of sea state. */
export interface DailyMarine {
  date: string;
  waveHeightMaxM: number | null;
  wavePeriodMaxS: number | null;
}

/** WMO codes 95-99 are thunderstorms. */
export function isThunderstorm(code: number | null): boolean {
  return code !== null && code >= 95;
}
