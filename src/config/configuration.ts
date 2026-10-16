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
  /** Exact browser origins allowed to call the API. Empty means cross-origin browser calls are disabled. */
  corsAllowedOrigins: string[];
  /** Express body-parser limit. Kept small because GraphQL operations are compact JSON documents. */
  requestBodyLimit: string;
  /** Number of reverse proxies between the public client and this process. */
  trustProxyHops: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  authRequired: boolean;
  apiKeys: ApiKeyPolicy[];
  graphqlMaxDepth: number;
  graphqlMaxAliases: number;
  graphqlMaxRootFields: number;
  graphqlMaxComplexity: number;
}

export interface ApiKeyPolicy {
  /** Stable, non-secret identifier used for audit context. */
  subject: string;
  /** Secret service credential. It is never returned or logged. */
  key: string;
  scopes: string[];
}

const num = (v: string | undefined, fallback: number): number => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const boundedInt = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
};

const bool = (value: string | undefined, fallback: boolean, name: string) => {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false`);
};

const parseOrigins = (value: string | undefined): string[] => {
  if (!value?.trim()) return [];
  return [...new Set(value.split(',').map((origin) => origin.trim()))].map(
    (origin) => {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error(
          `CORS_ALLOWED_ORIGINS contains an invalid origin: ${origin}`,
        );
      }
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.origin !== origin ||
        origin.includes('*')
      ) {
        throw new Error(
          `CORS_ALLOWED_ORIGINS must contain exact http(s) origins without paths or wildcards: ${origin}`,
        );
      }
      return origin;
    },
  );
};

const parseBodyLimit = (value: string | undefined): string => {
  const limit = (value || '16kb').toLowerCase();
  const match = /^(\d+)(b|kb|mb)$/.exec(limit);
  if (!match) {
    throw new Error('REQUEST_BODY_LIMIT must look like 16384b, 16kb, or 1mb');
  }
  const quantity = Number(match[1]);
  const multiplier =
    match[2] === 'mb' ? 1024 * 1024 : match[2] === 'kb' ? 1024 : 1;
  if (quantity < 1 || quantity * multiplier > 1024 * 1024) {
    throw new Error('REQUEST_BODY_LIMIT must be between 1 byte and 1mb');
  }
  return limit;
};

const parseApiKeys = (value: string | undefined): ApiKeyPolicy[] => {
  if (!value?.trim()) return [];
  let input: unknown;
  try {
    input = JSON.parse(value);
  } catch {
    throw new Error('AUTH_API_KEYS_JSON must be valid JSON');
  }
  if (!Array.isArray(input)) {
    throw new Error('AUTH_API_KEYS_JSON must be a JSON array');
  }
  const policies = input.map((entry, index): ApiKeyPolicy => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`AUTH_API_KEYS_JSON[${index}] must be an object`);
    }
    const candidate = entry as Record<string, unknown>;
    const { subject, key, scopes } = candidate;
    if (
      typeof subject !== 'string' ||
      !/^[A-Za-z0-9._-]{1,80}$/.test(subject)
    ) {
      throw new Error(`AUTH_API_KEYS_JSON[${index}].subject is invalid`);
    }
    if (
      typeof key !== 'string' ||
      key.length < 32 ||
      key.trim() !== key ||
      /\s/.test(key)
    ) {
      throw new Error(
        `AUTH_API_KEYS_JSON[${index}].key must be at least 32 characters with no whitespace`,
      );
    }
    if (
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      scopes.some((scope) => typeof scope !== 'string' || scope.length === 0)
    ) {
      throw new Error(
        `AUTH_API_KEYS_JSON[${index}].scopes must be a non-empty string array`,
      );
    }
    return { subject, key, scopes: [...new Set(scopes as string[])] };
  });
  if (
    new Set(policies.map(({ subject }) => subject)).size !== policies.length
  ) {
    throw new Error('AUTH_API_KEYS_JSON subjects must be unique');
  }
  if (new Set(policies.map(({ key }) => key)).size !== policies.length) {
    throw new Error('AUTH_API_KEYS_JSON keys must be unique');
  }
  return policies;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const authRequired = bool(env.AUTH_REQUIRED, false, 'AUTH_REQUIRED');
  const apiKeys = parseApiKeys(env.AUTH_API_KEYS_JSON);
  if (authRequired && apiKeys.length === 0) {
    throw new Error(
      'AUTH_REQUIRED=true requires at least one AUTH_API_KEYS_JSON entry',
    );
  }

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
    terrainLookupDeadlineMs: num(env.TERRAIN_LOOKUP_DEADLINE_MS, 3000),
    corsAllowedOrigins: parseOrigins(env.CORS_ALLOWED_ORIGINS),
    requestBodyLimit: parseBodyLimit(env.REQUEST_BODY_LIMIT),
    trustProxyHops: boundedInt(
      env.TRUST_PROXY_HOPS,
      0,
      0,
      10,
      'TRUST_PROXY_HOPS',
    ),
    rateLimitWindowMs: boundedInt(
      env.RATE_LIMIT_WINDOW_MS,
      60000,
      1000,
      3600000,
      'RATE_LIMIT_WINDOW_MS',
    ),
    rateLimitMax: boundedInt(
      env.RATE_LIMIT_MAX,
      60,
      1,
      10000,
      'RATE_LIMIT_MAX',
    ),
    authRequired,
    apiKeys,
    graphqlMaxDepth: boundedInt(
      env.GRAPHQL_MAX_DEPTH,
      8,
      1,
      30,
      'GRAPHQL_MAX_DEPTH',
    ),
    graphqlMaxAliases: boundedInt(
      env.GRAPHQL_MAX_ALIASES,
      15,
      0,
      100,
      'GRAPHQL_MAX_ALIASES',
    ),
    graphqlMaxRootFields: boundedInt(
      env.GRAPHQL_MAX_ROOT_FIELDS,
      4,
      1,
      20,
      'GRAPHQL_MAX_ROOT_FIELDS',
    ),
    graphqlMaxComplexity: boundedInt(
      env.GRAPHQL_MAX_COMPLEXITY,
      100,
      10,
      1000,
      'GRAPHQL_MAX_COMPLEXITY',
    ),
  };
}

/** Shape registered with @nestjs/config: `config.get('app')`. */
export default () => ({ app: loadConfig() });
