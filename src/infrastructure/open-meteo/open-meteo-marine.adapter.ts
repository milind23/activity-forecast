import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DailyMarine } from '../../domain';
import { MarineProviderPort } from '../../application/ports';
import { AppConfig } from '../../config/configuration';
import {
  HttpStatusError,
  asUpstreamError,
  fetchJson,
} from '../http/fetch-json';

type Series = (number | null)[];
export interface OpenMeteoMarineRaw {
  daily?: {
    time: string[];
    wave_height_max?: Series;
    wave_period_max?: Series;
  };
}

/**
 * Open-Meteo Marine: https://open-meteo.com/en/docs/marine-weather-api.
 * Inland points come back as all-null series (or occasionally a 400); both mean
 * "no coastal data" and are returned as null.
 */
@Injectable()
export class OpenMeteoMarineAdapter implements MarineProviderPort {
  private readonly cfg: AppConfig;
  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<AppConfig>('app');
  }

  async fetchRaw(latitude: number, longitude: number): Promise<unknown | null> {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      daily: 'wave_height_max,wave_period_max',
      timezone: 'auto',
      forecast_days: '7',
    });
    try {
      const raw = await fetchJson<OpenMeteoMarineRaw>(
        'open-meteo marine',
        `${this.cfg.marineUrl}?${params}`,
        this.cfg.httpTimeoutMs,
      );
      return hasMarineData(raw) ? raw : null;
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 400) return null;
      throw asUpstreamError('open-meteo marine', err);
    }
  }

  parse(raw: unknown): DailyMarine[] {
    return parseOpenMeteoMarine(raw as OpenMeteoMarineRaw);
  }
}

export function hasMarineData(raw: OpenMeteoMarineRaw): boolean {
  return (raw.daily?.wave_height_max ?? []).some((v) => v !== null);
}

export function parseOpenMeteoMarine(raw: OpenMeteoMarineRaw): DailyMarine[] {
  const d = raw.daily;
  if (!d?.time) return [];
  return d.time.map((date, i) => ({
    date,
    waveHeightMaxM: d.wave_height_max?.[i] ?? null,
    wavePeriodMaxS: d.wave_period_max?.[i] ?? null,
  }));
}
