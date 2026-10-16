import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkiArea, SkiAreaSource, SkiOperatingStatus } from '../../domain';
import { TerrainProviderPort } from '../../application/ports';
import { AppConfig } from '../../config/configuration';
import { asUpstreamError, fetchJson } from '../http/fetch-json';
import { findCatalogSkiArea } from './ski-resort-catalog';

/** Busy public servers often succeed on a quick retry. */
const ATTEMPTS_PER_ENDPOINT = 2;
const RETRY_DELAY_MS = 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

/**
 * Deterministic curated catalogue first, OpenStreetMap discovery second.
 * Public Overpass is a discovery/fallback source, never the only source for a
 * known resort that the service claims to support.
 */
@Injectable()
export class OverpassTerrainAdapter implements TerrainProviderPort {
  private readonly logger = new Logger(OverpassTerrainAdapter.name);
  private readonly cfg: AppConfig;

  constructor(config: ConfigService) {
    this.cfg = config.getOrThrow<AppConfig>('app');
  }

  async findSkiAreaNearby(
    latitude: number,
    longitude: number,
    radiusKm: number,
    countryCode = '',
  ): Promise<SkiArea | null> {
    const catalog = findCatalogSkiArea(
      { latitude, longitude, countryCode },
      radiusKm,
    );
    if (catalog) return catalog;

    const [resorts, pistes] = buildSkiAreaQueries(
      latitude,
      longitude,
      radiusKm,
    );
    return (await this.firstMatch(resorts)) ?? (await this.firstMatch(pistes));
  }

  private async firstMatch(query: string): Promise<SkiArea | null> {
    let lastError: unknown = new Error('no Overpass endpoint configured');
    for (const url of this.cfg.overpassUrls) {
      for (let attempt = 1; attempt <= ATTEMPTS_PER_ENDPOINT; attempt += 1) {
        try {
          return await this.query(url, query);
        } catch (error) {
          lastError = error;
          this.logger.warn(
            `Overpass ${url} attempt ${attempt} failed: ${(error as Error).message.slice(0, 120)}`,
          );
          await sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }
    throw asUpstreamError('overpass', lastError);
  }

  private async query(url: string, query: string): Promise<SkiArea | null> {
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
    return toSkiArea(body.elements?.[0]);
  }
}

export function toSkiArea(element?: OverpassElement): SkiArea | null {
  if (!element) return null;
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (latitude === undefined || longitude === undefined) return null;

  const elevation = Number(element.tags?.ele);
  const type = element.type ?? 'element';
  const id = element.id ?? 0;
  return {
    id: `osm:${type}:${id}`,
    name: element.tags?.name ?? 'Nearby ski area',
    latitude,
    longitude,
    forecastElevationM: Number.isFinite(elevation) ? elevation : null,
    source: SkiAreaSource.OPENSTREETMAP,
    sourceUrl: id > 0 ? `https://www.openstreetmap.org/${type}/${id}` : null,
    operatingStatus: SkiOperatingStatus.UNKNOWN,
    // OSM is provenance/discovery, not an authoritative live lift-status feed.
    operationsUrl: null,
  };
}

/** [resort areas query, downhill pistes query]. */
export function buildSkiAreaQueries(
  lat: number,
  lon: number,
  radiusKm: number,
): [string, string] {
  const around = `around:${Math.round(radiusKm * 1000)},${lat},${lon}`;
  return [
    `[out:json][timeout:25];nwr["landuse"="winter_sports"](${around});out tags center 20;`,
    `[out:json][timeout:25];way["piste:type"="downhill"](${around});out tags center 20;`,
  ];
}
