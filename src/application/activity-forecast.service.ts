import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActivityRecommendation,
  ActivityRanking,
  DailyMarine,
  DailyWeather,
  Location,
  MarineDataStatus,
  SkiArea,
  SkiAreaStatus,
  locationKey,
  rankActivities,
  recommendActivities,
  summarizeRecommendations,
} from '../domain';
import { AppConfig } from '../config/configuration';
import { CityNotFoundError, UpstreamUnavailableError } from './errors';
import { normalizeCountryCode } from './country-normalizer';
import { SingleFlight } from './single-flight';
import {
  FORECAST_REPOSITORY,
  ForecastRepositoryPort,
  ForecastSnapshot,
  GEOCODER,
  GeocoderPort,
  MARINE_PROVIDER,
  MarineProviderPort,
  TERRAIN_PROVIDER,
  TerrainProviderPort,
  WEATHER_PROVIDER,
  WeatherProviderPort,
} from './ports';

export interface DataFreshness {
  /** When the primary atmospheric-weather payload was fetched. */
  fetchedAt: Date;
  /** true when atmospheric refresh failed and stored weather is being served. */
  isStale: boolean;
}

export interface ActivityForecast {
  location: Location;
  dataFreshness: DataFreshness;
  activities: ActivityRanking[];
  assessment: ForecastAssessment;
}

export interface ForecastAssessment {
  ski: {
    status: SkiAreaStatus;
    area: SkiArea | null;
    mountainForecastAvailable: boolean;
    forecastFetchedAt: Date | null;
    forecastIsStale: boolean;
  };
  marine: {
    status: MarineDataStatus;
    fetchedAt: Date | null;
    isStale: boolean;
  };
}

export interface ActivityRecommendations {
  destination: string;
  summary: string;
  recommendations: ActivityRecommendation[];
  advisory: string;
}

const HOUR_MS = 3_600_000;

type SnapshotResult = { snapshot: ForecastSnapshot; isStale: boolean };
type SnapshotFlightAttempt =
  | { windowStart: string; result: SnapshotResult }
  | { windowStart: string; error: unknown };
type SkiAreaResolution = { status: SkiAreaStatus; area: SkiArea | null };
type MarineFetchResult = {
  raw: unknown | null;
  status: MarineDataStatus;
  fetchedAt: Date | null;
  isStale: boolean;
};
type SkiWeatherResult = {
  daysByDate: ReadonlyMap<string, DailyWeather> | null;
  fetchedAt: Date | null;
  isStale: boolean;
};
type SkiWeatherCache = { raw: unknown; fetchedAt: Date };

/**
 * Use case: "rank the next 7 days for each activity in <city>".
 *
 * Read-through cache over the repository:
 *   geocode     cached forever (place coordinates don't move)
 *   forecast    raw payloads, refreshed lazily when older than FORECAST_TTL_HOURS
 *   ski terrain cached for TERRAIN_CACHE_DAYS (ski areas rarely appear/disappear)
 * Scores are always computed fresh from the stored raw data.
 */
@Injectable()
export class ActivityForecastService {
  private readonly logger = new Logger(ActivityForecastService.name);
  private readonly flights = new SingleFlight();
  private readonly cfg: AppConfig;

  constructor(
    @Inject(GEOCODER) private readonly geocoder: GeocoderPort,
    @Inject(WEATHER_PROVIDER) private readonly weather: WeatherProviderPort,
    @Inject(MARINE_PROVIDER) private readonly marine: MarineProviderPort,
    @Inject(TERRAIN_PROVIDER) private readonly terrain: TerrainProviderPort,
    @Inject(FORECAST_REPOSITORY) private readonly repo: ForecastRepositoryPort,
    config: ConfigService,
  ) {
    this.cfg = config.getOrThrow<AppConfig>('app');
  }

  async getForecast(city: string, country?: string): Promise<ActivityForecast> {
    const countryCode = normalizeCountryCode(country);
    const location = await this.resolveLocation(city, countryCode);
    const key = locationKey(location);
    // One request gets one date window. Recomputing this after either upstream
    // branch completes can cross local midnight and return only six days.
    const requiredDates = nextLocalDates(new Date(), location.timezone);

    const [{ snapshot, isStale }, skiResolution] = await Promise.all([
      this.getCoalescedSnapshot(location, key, requiredDates),
      this.skiAreaWithDeadline(location, key),
    ]);

    const requiredDateSet = new Set(requiredDates);
    // Keep exactly today + 6 in the location's timezone. getSnapshot guarantees
    // that all seven dates exist, including when it falls back to stale data.
    const days = this.weather
      .parse(snapshot.weatherRaw)
      .filter((d) => requiredDateSet.has(d.date));
    const marineDays = this.parseMarineSafely(snapshot.marineRaw);
    const marineByDate = new Map<string, DailyMarine>(
      marineDays.map((m) => [m.date, m]),
    );
    const skiWeather = await this.getSkiWeather(
      location,
      key,
      snapshot,
      skiResolution,
      days,
      requiredDates,
      isStale,
    );
    const marineStatus = this.marineStatus(snapshot);
    const marineIsStale = this.marineIsStale(snapshot, marineStatus);

    return {
      location,
      dataFreshness: { fetchedAt: snapshot.fetchedAt, isStale },
      activities: rankActivities(days, {
        skiArea: skiResolution.status,
        skiWeatherByDate: skiWeather.daysByDate,
        marineByDate,
        marineStatus,
      }),
      assessment: {
        ski: {
          status: skiResolution.status,
          area: skiResolution.area,
          mountainForecastAvailable: skiWeather.daysByDate !== null,
          forecastFetchedAt: skiWeather.fetchedAt,
          forecastIsStale: skiWeather.isStale,
        },
        marine: {
          status: marineStatus,
          fetchedAt: snapshot.marineFetchedAt ?? null,
          isStale: marineIsStale,
        },
      },
    };
  }

  /** Product-facing view: turn ranked evidence into an actionable decision. */
  async getRecommendations(
    city: string,
    country?: string,
  ): Promise<ActivityRecommendations> {
    const forecast = await this.getForecast(city, country);
    const recommendations = recommendActivities(forecast.activities, {
      weatherFetchedAt: forecast.dataFreshness.fetchedAt,
      weatherIsStale: forecast.dataFreshness.isStale,
      ski: forecast.assessment.ski,
      marineStatus: forecast.assessment.marine.status,
      marineFetchedAt: forecast.assessment.marine.fetchedAt,
      marineIsStale: forecast.assessment.marine.isStale,
    });
    const staleNotice = forecast.dataFreshness.isStale
      ? ' Live refresh was unavailable, so this uses the latest stored seven-day forecast.'
      : '';

    return {
      destination: `${forecast.location.name}, ${forecast.location.country}`,
      summary: summarizeRecommendations(recommendations),
      recommendations,
      advisory:
        'Weather suitability only. Check local safety alerts, tides, avalanche conditions, venue access and availability before booking.' +
        staleNotice,
    };
  }

  private async resolveLocation(
    city: string,
    countryCode?: string,
  ): Promise<Location> {
    const cc = countryCode?.toUpperCase();
    const queryKey = `${city.trim().toLowerCase()}|${cc ?? ''}`;
    const cached = await this.repo.findGeocode(queryKey);
    if (cached) return cached;

    const found = await this.flights.run(`geocode:${queryKey}`, () =>
      this.geocoder.search(city.trim(), cc),
    );
    if (!found) throw new CityNotFoundError(city, cc);
    await this.repo.saveGeocode(queryKey, found);
    return found;
  }

  private async getSnapshot(
    location: Location,
    key: string,
    requiredDates: readonly string[],
  ): Promise<SnapshotResult> {
    const existing = await this.repo.findSnapshot(key);
    const ttlMs = this.cfg.forecastTtlHours * HOUR_MS;
    if (
      existing &&
      Date.now() - existing.fetchedAt.getTime() < ttlMs &&
      this.hasRequiredCoverage(existing.weatherRaw, requiredDates)
    ) {
      return { snapshot: existing, isStale: false };
    }

    try {
      const { latitude, longitude } = location;
      const [weatherRaw, marine] = await Promise.all([
        this.weather.fetchRaw(latitude, longitude),
        this.fetchMarineSafely(
          latitude,
          longitude,
          existing?.marineRaw ?? null,
          existing ? this.marineStatus(existing) : 'unavailable',
          existing?.marineFetchedAt ?? null,
        ),
      ]);
      if (!this.hasRequiredCoverage(weatherRaw, requiredDates)) {
        throw new UpstreamUnavailableError(
          'open-meteo forecast',
          'response does not cover all of the next 7 local dates',
        );
      }
      const snapshot: ForecastSnapshot = {
        locationKey: key,
        weatherRaw,
        marineRaw: marine.raw,
        marineStatus: marine.status,
        marineFetchedAt: marine.fetchedAt,
        marineIsStale: marine.isStale,
        skiWeatherRaw: existing?.skiWeatherRaw ?? null,
        skiWeatherLocationKey: existing?.skiWeatherLocationKey ?? null,
        skiWeatherFetchedAt: existing?.skiWeatherFetchedAt ?? null,
        fetchedAt: new Date(),
      };
      await this.repo.saveSnapshot(snapshot);
      this.logger.log(`Refreshed forecast for ${location.name} (${key})`);
      return { snapshot, isStale: false };
    } catch (err) {
      if (
        existing &&
        this.hasRequiredCoverage(existing.weatherRaw, requiredDates)
      ) {
        this.logger.warn(
          `Refresh failed for ${key}, serving data from ${existing.fetchedAt.toISOString()}: ${(err as Error).message}`,
        );
        return { snapshot: existing, isStale: true };
      }
      throw err instanceof UpstreamUnavailableError
        ? err
        : new UpstreamUnavailableError('forecast', (err as Error).message);
    }
  }

  /**
   * Serialize refreshes per location so two date windows cannot overwrite each
   * other out of order. A caller that joined a flight started just before local
   * midnight revalidates the result and, if needed, starts the next flight.
   */
  private async getCoalescedSnapshot(
    location: Location,
    key: string,
    requiredDates: readonly string[],
  ): Promise<SnapshotResult> {
    const flightKey = `forecast:${key}`;
    const requestedStart = requiredDates[0];

    // Normally this runs once. A second pass is only needed when this caller
    // joined a flight whose local-date window started on a different day.
    for (let pass = 0; pass < 2; pass += 1) {
      const attempt = await this.flights.run<SnapshotFlightAttempt>(
        flightKey,
        async () => {
          try {
            return {
              windowStart: requestedStart,
              result: await this.getSnapshot(location, key, requiredDates),
            };
          } catch (error) {
            return { windowStart: requestedStart, error };
          }
        },
      );

      if (
        'result' in attempt &&
        this.hasRequiredCoverage(
          attempt.result.snapshot.weatherRaw,
          requiredDates,
        )
      ) {
        return attempt.result;
      }

      if (attempt.windowStart === requestedStart) {
        if ('error' in attempt) throw attempt.error;
        throw new UpstreamUnavailableError(
          'forecast',
          'shared response does not cover the requested local dates',
        );
      }
    }

    throw new UpstreamUnavailableError(
      'forecast',
      'could not obtain a snapshot for the requested local-date window',
    );
  }

  /**
   * Marine data is optional. On refresh failure, retain the last successful
   * payload instead of replacing useful surf data with null for a full TTL.
   */
  private async fetchMarineSafely(
    lat: number,
    lon: number,
    fallback: unknown | null,
    fallbackStatus: MarineDataStatus,
    fallbackFetchedAt: Date | null,
  ): Promise<MarineFetchResult> {
    try {
      const raw = await this.marine.fetchRaw(lat, lon);
      // Validate before persistence so a malformed partial response cannot
      // displace the last-known-good payload.
      if (raw !== null) this.marine.parse(raw);
      return {
        raw,
        status: raw === null ? 'not_applicable' : 'available',
        fetchedAt: new Date(),
        isStale: false,
      };
    } catch (err) {
      const hasKnownFallback =
        fallback !== null || fallbackStatus === 'not_applicable';
      const outcome = hasKnownFallback
        ? 'retaining stored marine assessment'
        : 'surfing will be unscored';
      this.logger.warn(
        `Marine fetch failed, ${outcome}: ${(err as Error).message}`,
      );
      return hasKnownFallback
        ? {
            raw: fallback,
            status: fallbackStatus,
            fetchedAt: fallbackFetchedAt,
            isStale: true,
          }
        : {
            raw: null,
            status: 'unavailable',
            fetchedAt: null,
            isStale: false,
          };
    }
  }

  private marineStatus(snapshot: ForecastSnapshot): MarineDataStatus {
    if (snapshot.marineStatus) return snapshot.marineStatus;
    // Legacy rows cannot prove that null means inland rather than provider
    // failure, so fail safely until the next refresh records explicit status.
    return snapshot.marineRaw === null ? 'unavailable' : 'available';
  }

  private marineIsStale(
    snapshot: ForecastSnapshot,
    status: MarineDataStatus,
  ): boolean {
    if (status === 'unavailable') return false;
    if (snapshot.marineIsStale) return true;
    const fetchedAt = snapshot.marineFetchedAt;
    if (!fetchedAt) return false;
    return (
      Date.now() - fetchedAt.getTime() >= this.cfg.forecastTtlHours * HOUR_MS
    );
  }

  /** Optional marine data must never make the other three rankings fail. */
  private parseMarineSafely(raw: unknown | null): DailyMarine[] {
    if (raw === null) return [];
    try {
      return this.marine.parse(raw);
    } catch (error) {
      this.logger.warn(
        `Stored marine data could not be parsed, surfing will be unscored: ${(error as Error).message}`,
      );
      return [];
    }
  }

  private hasRequiredCoverage(
    raw: unknown,
    requiredDates: readonly string[],
  ): boolean {
    try {
      const available = new Set(this.weather.parse(raw).map((day) => day.date));
      return requiredDates.every((date) => available.has(date));
    } catch {
      // Treat a malformed stored/provider payload as unusable cache data. A
      // refresh may repair it; if that also fails, getSnapshot maps the error.
      return false;
    }
  }

  /**
   * A confirmed resort is scored from its mountain point/elevation, never from
   * valley-town weather. The raw mountain payload is persisted with the main
   * snapshot and follows the same TTL/coverage rules.
   */
  private async getSkiWeather(
    location: Location,
    key: string,
    snapshot: ForecastSnapshot,
    resolution: SkiAreaResolution,
    cityDays: DailyWeather[],
    requiredDates: readonly string[],
    atmosphericIsStale: boolean,
  ): Promise<SkiWeatherResult> {
    const area = resolution.area;
    if (resolution.status !== 'nearby' || !area) {
      return { daysByDate: null, fetchedAt: null, isStale: false };
    }

    if (
      area.forecastElevationM === null &&
      Math.abs(area.latitude - location.latitude) < 0.000001 &&
      Math.abs(area.longitude - location.longitude) < 0.000001
    ) {
      return {
        daysByDate: new Map(cityDays.map((day) => [day.date, day])),
        fetchedAt: snapshot.fetchedAt,
        isStale: atmosphericIsStale,
      };
    }

    const targetKey = skiWeatherTargetKey(area);
    const ttlMs = this.cfg.forecastTtlHours * HOUR_MS;
    const storedFetchedAt = snapshot.skiWeatherFetchedAt ?? null;
    const storedUsable =
      snapshot.skiWeatherLocationKey === targetKey &&
      snapshot.skiWeatherRaw != null &&
      storedFetchedAt !== null &&
      this.hasRequiredCoverage(snapshot.skiWeatherRaw, requiredDates);

    if (storedUsable && Date.now() - storedFetchedAt.getTime() < ttlMs) {
      return this.toSkiWeatherResult(
        snapshot.skiWeatherRaw,
        storedFetchedAt,
        requiredDates,
        false,
      );
    }

    try {
      const cache = await this.flights.run<SkiWeatherCache>(
        `ski-weather:${key}:${targetKey}`,
        async () => {
          const latest = (await this.repo.findSnapshot(key)) ?? snapshot;
          const latestFetchedAt = latest.skiWeatherFetchedAt ?? null;
          if (
            latest.skiWeatherLocationKey === targetKey &&
            latest.skiWeatherRaw != null &&
            latestFetchedAt !== null &&
            Date.now() - latestFetchedAt.getTime() < ttlMs &&
            this.hasRequiredCoverage(latest.skiWeatherRaw, requiredDates)
          ) {
            return { raw: latest.skiWeatherRaw, fetchedAt: latestFetchedAt };
          }

          const raw = await this.weather.fetchRaw(
            area.latitude,
            area.longitude,
            area.forecastElevationM ?? undefined,
          );
          if (!this.hasRequiredCoverage(raw, requiredDates)) {
            throw new UpstreamUnavailableError(
              'open-meteo mountain forecast',
              'response does not cover all of the next 7 local dates',
            );
          }
          const fetchedAt = new Date();
          await this.repo.saveSnapshot({
            ...latest,
            skiWeatherRaw: raw,
            skiWeatherLocationKey: targetKey,
            skiWeatherFetchedAt: fetchedAt,
          });
          return { raw, fetchedAt };
        },
      );
      return this.toSkiWeatherResult(
        cache.raw,
        cache.fetchedAt,
        requiredDates,
        false,
      );
    } catch (error) {
      if (storedUsable && storedFetchedAt) {
        this.logger.warn(
          `Mountain forecast refresh failed for ${area.name}; using stored data: ${(error as Error).message}`,
        );
        return this.toSkiWeatherResult(
          snapshot.skiWeatherRaw,
          storedFetchedAt,
          requiredDates,
          true,
        );
      }
      this.logger.warn(
        `Mountain forecast unavailable for ${area.name}: ${(error as Error).message}`,
      );
      return { daysByDate: null, fetchedAt: null, isStale: false };
    }
  }

  private toSkiWeatherResult(
    raw: unknown,
    fetchedAt: Date,
    requiredDates: readonly string[],
    isStale: boolean,
  ): SkiWeatherResult {
    const required = new Set(requiredDates);
    const days = this.weather
      .parse(raw)
      .filter((day) => required.has(day.date));
    return {
      daysByDate: new Map(days.map((day) => [day.date, day])),
      fetchedAt,
      isStale,
    };
  }

  /**
   * A first-time Overpass lookup can be slow (busy public servers). Rather than
   * hold the whole response hostage, wait up to TERRAIN_LOOKUP_DEADLINE_MS and
   * answer with 'unknown' (skiing = null); the lookup keeps running and its
   * result is cached for the next request.
   */
  private skiAreaWithDeadline(
    location: Location,
    key: string,
  ): Promise<SkiAreaResolution> {
    const lookup = this.flights.run(`terrain:${key}`, () =>
      this.getSkiAreaResolution(location, key),
    );
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<SkiAreaResolution>((resolve) => {
      timer = setTimeout(() => {
        this.logger.warn(
          `Ski-area lookup for ${key} still running; answering without it`,
        );
        resolve({ status: 'unknown', area: null });
      }, this.cfg.terrainLookupDeadlineMs);
    });
    return Promise.race([lookup, deadline]).finally(() => clearTimeout(timer));
  }

  private async getSkiAreaResolution(
    location: Location,
    key: string,
  ): Promise<SkiAreaResolution> {
    const cached = await this.repo.findSkiTerrain(key);
    const maxAgeMs = this.cfg.terrainCacheDays * 24 * HOUR_MS;
    if (
      cached &&
      Date.now() - cached.checkedAt.getTime() < maxAgeMs &&
      (!cached.hasSkiArea || cached.skiArea)
    ) {
      return cached.hasSkiArea
        ? { status: 'nearby', area: cached.skiArea ?? null }
        : { status: 'none', area: null };
    }
    try {
      const skiArea = await this.terrain.findSkiAreaNearby(
        location.latitude,
        location.longitude,
        this.cfg.skiSearchRadiusKm,
        location.countryCode,
      );
      await this.repo.saveSkiTerrain({
        locationKey: key,
        hasSkiArea: skiArea !== null,
        skiArea,
        checkedAt: new Date(),
      });
      return skiArea
        ? { status: 'nearby', area: skiArea }
        : { status: 'none', area: null };
    } catch (err) {
      this.logger.warn(
        `Ski-area lookup failed for ${key}: ${(err as Error).message}`,
      );
      // An old answer beats no answer; otherwise skiing is unscored (not cached, retried next time).
      if (cached?.hasSkiArea && cached.skiArea) {
        return { status: 'nearby', area: cached.skiArea };
      }
      if (cached && !cached.hasSkiArea) {
        return { status: 'none', area: null };
      }
      return { status: 'unknown', area: null };
    }
  }
}

function skiWeatherTargetKey(area: SkiArea): string {
  return `${area.latitude.toFixed(4)},${area.longitude.toFixed(4)}@${area.forecastElevationM ?? 'dem'}`;
}

/** YYYY-MM-DD for `date` in the given IANA timezone. */
export function localDate(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Today + 6 local calendar dates, represented as YYYY-MM-DD. */
export function nextLocalDates(
  now: Date,
  timeZone: string,
  count = 7,
): string[] {
  const start = localDate(now, timeZone);
  const [year, month, day] = start.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(cursor);
    date.setUTCDate(cursor.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  });
}
