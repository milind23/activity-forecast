import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TerrainProviderPort } from '../../application/ports';
import { AppConfig } from '../../config/configuration';
import { asUpstreamError, fetchJson } from '../http/fetch-json';

/** Busy public servers often succeed on a quick retry (observed ~50% 504s). */
const ATTEMPTS_PER_ENDPOINT = 2;
const RETRY_DELAY_MS = 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    // Cheap query first (resort areas); the piste query is much heavier in dense
    // regions like the Alps, so only run it when no resort polygon is mapped.
    const [resorts, pistes] = buildSkiAreaQueries(
      latitude,
      longitude,
      radiusKm,
    );
    return (await this.anyMatch(resorts)) || (await this.anyMatch(pistes));
  }

  /** Runs one query against the configured endpoints, with a retry each. */
  private async anyMatch(query: string): Promise<boolean> {
    let lastError: unknown = new Error('no Overpass endpoint configured');
    for (const url of this.cfg.overpassUrls) {
      for (let attempt = 1; attempt <= ATTEMPTS_PER_ENDPOINT; attempt++) {
        try {
          return await this.query(url, query);
        } catch (err) {
          lastError = err;
          this.logger.warn(
            `Overpass ${url} attempt ${attempt} failed: ${(err as Error).message.slice(0, 120)}`,
          );
          await sleep(RETRY_DELAY_MS * attempt);
        }
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

/** [resort areas query, downhill pistes query]; each only needs one hit. */
export function buildSkiAreaQueries(
  lat: number,
  lon: number,
  radiusKm: number,
): [string, string] {
  const around = `around:${Math.round(radiusKm * 1000)},${lat},${lon}`;
  return [
    `[out:json][timeout:25];nwr["landuse"="winter_sports"](${around});out ids 1;`,
    `[out:json][timeout:25];way["piste:type"="downhill"](${around});out ids 1;`,
  ];
}
