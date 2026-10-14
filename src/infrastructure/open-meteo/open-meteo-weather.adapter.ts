import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DailyWeather } from '../../domain';
import { WeatherProviderPort } from '../../application/ports';
import { AppConfig } from '../../config/configuration';
import { asUpstreamError, fetchJson } from '../http/fetch-json';

export const DAILY_FIELDS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'snowfall_sum',
  'wind_speed_10m_max',
  'sunshine_duration',
] as const;

type Series = (number | null)[];
export interface OpenMeteoForecastRaw {
  timezone?: string;
  daily?: { time: string[] } & Partial<
    Record<(typeof DAILY_FIELDS)[number], Series>
  >;
  /** snow_depth is only available hourly; we take the daily max. */
  hourly?: { time: string[]; snow_depth?: Series };
}

/** Open-Meteo forecast: https://open-meteo.com/en/docs. 7 days, local timezone. */
@Injectable()
export class OpenMeteoWeatherAdapter implements WeatherProviderPort {
  private readonly cfg: AppConfig;
  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<AppConfig>('app');
  }

  async fetchRaw(latitude: number, longitude: number): Promise<unknown> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      daily: DAILY_FIELDS.join(','),
      hourly: 'snow_depth',
      timezone: 'auto',
      forecast_days: '7',
    });
    try {
      return await fetchJson(
        'open-meteo forecast',
        `${this.cfg.forecastUrl}?${params}`,
        this.cfg.httpTimeoutMs,
      );
    } catch (err) {
      throw asUpstreamError('open-meteo forecast', err);
    }
  }

  parse(raw: unknown): DailyWeather[] {
    return parseOpenMeteoForecast(raw as OpenMeteoForecastRaw);
  }
}

export function parseOpenMeteoForecast(
  raw: OpenMeteoForecastRaw,
): DailyWeather[] {
  const d = raw.daily;
  if (!d?.time) return [];

  // Hourly times are local ("2026-10-14T13:00"), so the date prefix is the local day.
  const snowDepthByDate = new Map<string, number>();
  const h = raw.hourly;
  h?.time.forEach((t, i) => {
    const v = h.snow_depth?.[i];
    if (v === null || v === undefined) return;
    const date = t.slice(0, 10);
    snowDepthByDate.set(date, Math.max(snowDepthByDate.get(date) ?? 0, v));
  });

  const at = (s: Series | undefined, i: number) => s?.[i] ?? null;
  return d.time.map((date, i) => {
    const sunshineSeconds = at(d.sunshine_duration, i);
    return {
      date,
      tempMaxC: at(d.temperature_2m_max, i),
      tempMinC: at(d.temperature_2m_min, i),
      precipitationMm: at(d.precipitation_sum, i),
      precipitationProbability: at(d.precipitation_probability_max, i),
      snowfallCm: at(d.snowfall_sum, i),
      snowDepthM: snowDepthByDate.get(date) ?? null,
      windSpeedMaxKmh: at(d.wind_speed_10m_max, i),
      weatherCode: at(d.weather_code, i),
      sunshineHours: sunshineSeconds === null ? null : sunshineSeconds / 3600,
    };
  });
}
