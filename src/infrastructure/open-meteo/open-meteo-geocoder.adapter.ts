import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Location } from '../../domain';
import { GeocoderPort } from '../../application/ports';
import { AppConfig } from '../../config/configuration';
import { asUpstreamError, fetchJson } from '../http/fetch-json';

interface GeocodingResponse {
  results?: {
    name: string;
    latitude: number;
    longitude: number;
    country?: string;
    country_code?: string;
    admin1?: string;
    timezone?: string;
  }[];
}

/** Open-Meteo geocoding: https://open-meteo.com/en/docs/geocoding-api. Takes the top match. */
@Injectable()
export class OpenMeteoGeocoderAdapter implements GeocoderPort {
  private readonly cfg: AppConfig;
  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<AppConfig>('app');
  }

  async search(city: string, countryCode?: string): Promise<Location | null> {
    const params = new URLSearchParams({
      name: city,
      count: '1',
      language: 'en',
      format: 'json',
    });
    if (countryCode) params.set('countryCode', countryCode);
    try {
      const body = await fetchJson<GeocodingResponse>(
        'open-meteo geocoding',
        `${this.cfg.geocodingUrl}?${params}`,
        this.cfg.httpTimeoutMs,
      );
      return parseGeocoding(body);
    } catch (err) {
      throw asUpstreamError('open-meteo geocoding', err);
    }
  }
}

export function parseGeocoding(body: GeocodingResponse): Location | null {
  const top = body.results?.[0];
  if (!top) return null;
  return {
    name: top.name,
    country: top.country ?? top.country_code ?? 'Unknown',
    countryCode: top.country_code ?? '',
    region: top.admin1,
    latitude: top.latitude,
    longitude: top.longitude,
    timezone: top.timezone ?? 'UTC',
  };
}
