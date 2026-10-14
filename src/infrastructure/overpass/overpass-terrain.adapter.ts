import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TerrainProviderPort } from '../../application/ports';
import { AppConfig } from '../../config/configuration';
import { asUpstreamError, fetchJson } from '../http/fetch-json';

interface OverpassResponse {
  elements?: unknown[];
}

/**
 * OpenStreetMap Overpass: is there a ski resort (landuse=winter_sports) or a
 * downhill piste within the radius? We only need existence, so `out ids 1`.
 * Results are cached long-term by the service, so this runs rarely.
 * Public instances are frequently overloaded, so several endpoints are tried in order.
 */
@Injectable()
export class OverpassTerrainAdapter implements TerrainProviderPort {
  private readonly logger = new Logger(OverpassTerrainAdapter.name);
  private readonly cfg: AppConfig;
  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<AppConfig>('app');
  }

  async hasSkiAreaNearby(
    latitude: number,
    longitude: number,
    radiusKm: number,
  ): Promise<boolean> {
    const query = buildSkiAreaQuery(latitude, longitude, radiusKm);
    let lastError: unknown = new Error('no Overpass endpoint configured');
    for (const url of this.cfg.overpassUrls) {
      try {
        return await this.query(url, query);
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `Overpass endpoint ${url} failed: ${(err as Error).message}`,
        );
      }
    }
    throw asUpstreamError('overpass', lastError);
  }

  private async query(url: string, query: string): Promise<boolean> {
    {
      const body = await fetchJson<OverpassResponse>(
        'overpass',
        url,
        Math.max(this.cfg.httpTimeoutMs, 20000),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: query }).toString(),
        },
      );
      return (body.elements?.length ?? 0) > 0;
    }
  }
}

export function buildSkiAreaQuery(
  lat: number,
  lon: number,
  radiusKm: number,
): string {
  const around = `around:${Math.round(radiusKm * 1000)},${lat},${lon}`;
  return `[out:json][timeout:25];
(
  nwr["landuse"="winter_sports"](${around});
  way["piste:type"="downhill"](${around});
);
out ids 1;`;
}
