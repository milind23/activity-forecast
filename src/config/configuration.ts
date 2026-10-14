/**
 * All runtime settings, with defaults so `npm run start:dev` needs no .env.
 * See .env.example for documentation of each variable.
 */
export interface AppConfig {
  port: number;
  databasePath: string;
  forecastTtlHours: number;
  terrainCacheDays: number;
  skiSearchRadiusKm: number;
  httpTimeoutMs: number;
  geocodingUrl: string;
  forecastUrl: string;
  marineUrl: string;
  /** Tried in order until one answers (public Overpass instances are often busy). */
  overpassUrls: string[];
  /** How long a request waits for a first-time ski-area lookup before answering without it. */
  terrainLookupDeadlineMs: number;
}

const num = (v: string | undefined, fallback: number): number => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: num(env.PORT, 3000),
    databasePath: env.DATABASE_PATH || 'data/activity-forecast.sqlite',
    forecastTtlHours: num(env.FORECAST_TTL_HOURS, 3),
    terrainCacheDays: num(env.TERRAIN_CACHE_DAYS, 90),
    skiSearchRadiusKm: num(env.SKI_SEARCH_RADIUS_KM, 50),
    httpTimeoutMs: num(env.HTTP_TIMEOUT_MS, 10000),
    geocodingUrl:
      env.GEOCODING_URL || 'https://geocoding-api.open-meteo.com/v1/search',
    forecastUrl: env.FORECAST_URL || 'https://api.open-meteo.com/v1/forecast',
    marineUrl: env.MARINE_URL || 'https://marine-api.open-meteo.com/v1/marine',
    overpassUrls: (
      env.OVERPASS_URLS ||
      'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://overpass.private.coffee/api/interpreter'
    )
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean),
    terrainLookupDeadlineMs: num(env.TERRAIN_LOOKUP_DEADLINE_MS, 15000),
  };
}

/** Shape registered with @nestjs/config: `config.get('app')`. */
export default () => ({ app: loadConfig() });
