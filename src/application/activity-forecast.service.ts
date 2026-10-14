import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActivityRanking,
  DailyMarine,
  Location,
  SkiAreaStatus,
  locationKey,
  rankActivities,
} from '../domain';
import { AppConfig } from '../config/configuration';
import { CityNotFoundError, UpstreamUnavailableError } from './errors';
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
  fetchedAt: Date;
  /** true when the refresh failed and we fell back to older stored data. */
  isStale: boolean;
}

export interface ActivityForecast {
  location: Location;
  dataFreshness: DataFreshness;
  activities: ActivityRanking[];
}

const HOUR_MS = 3_600_000;

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

  async getForecast(
    city: string,
    countryCode?: string,
  ): Promise<ActivityForecast> {
    const location = await this.resolveLocation(city, countryCode);
    const key = locationKey(location);

    const [{ snapshot, isStale }, skiArea] = await Promise.all([
      this.flights.run(`forecast:${key}`, () =>
        this.getSnapshot(location, key),
      ),
      this.flights.run(`terrain:${key}`, () =>
        this.getSkiAreaStatus(location, key),
      ),
    ]);

    const today = localDate(new Date(), location.timezone);
    // Drop days that are already in the past locally (possible with stale data).
    const days = this.weather
      .parse(snapshot.weatherRaw)
      .filter((d) => d.date >= today);
    const marineDays =
      snapshot.marineRaw === null ? [] : this.marine.parse(snapshot.marineRaw);
    const marineByDate = new Map<string, DailyMarine>(
      marineDays.map((m) => [m.date, m]),
    );

    return {
      location,
      dataFreshness: { fetchedAt: snapshot.fetchedAt, isStale },
      activities: rankActivities(days, { skiArea, marineByDate }),
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
  ): Promise<{ snapshot: ForecastSnapshot; isStale: boolean }> {
    const existing = await this.repo.findSnapshot(key);
    const ttlMs = this.cfg.forecastTtlHours * HOUR_MS;
    if (existing && Date.now() - existing.fetchedAt.getTime() < ttlMs) {
      return { snapshot: existing, isStale: false };
    }

    try {
      const { latitude, longitude } = location;
      const [weatherRaw, marineRaw] = await Promise.all([
        this.weather.fetchRaw(latitude, longitude),
        this.fetchMarineSafely(latitude, longitude),
      ]);
      const snapshot: ForecastSnapshot = {
        locationKey: key,
        weatherRaw,
        marineRaw,
        fetchedAt: new Date(),
      };
      await this.repo.saveSnapshot(snapshot);
      this.logger.log(`Refreshed forecast for ${location.name} (${key})`);
      return { snapshot, isStale: false };
    } catch (err) {
      if (existing) {
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

  /** Marine data is optional: a failure only costs us the surf score, not the response. */
  private async fetchMarineSafely(
    lat: number,
    lon: number,
  ): Promise<unknown | null> {
    try {
      return await this.marine.fetchRaw(lat, lon);
    } catch (err) {
      this.logger.warn(
        `Marine fetch failed, surfing will be unscored: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async getSkiAreaStatus(
    location: Location,
    key: string,
  ): Promise<SkiAreaStatus> {
    const cached = await this.repo.findSkiTerrain(key);
    const maxAgeMs = this.cfg.terrainCacheDays * 24 * HOUR_MS;
    if (cached && Date.now() - cached.checkedAt.getTime() < maxAgeMs) {
      return cached.hasSkiArea ? 'nearby' : 'none';
    }
    try {
      const hasSkiArea = await this.terrain.hasSkiAreaNearby(
        location.latitude,
        location.longitude,
        this.cfg.skiSearchRadiusKm,
      );
      await this.repo.saveSkiTerrain({
        locationKey: key,
        hasSkiArea,
        checkedAt: new Date(),
      });
      return hasSkiArea ? 'nearby' : 'none';
    } catch (err) {
      this.logger.warn(
        `Ski-area lookup failed for ${key}: ${(err as Error).message}`,
      );
      // An old answer beats no answer; otherwise skiing is unscored (not cached, retried next time).
      if (cached) return cached.hasSkiArea ? 'nearby' : 'none';
      return 'unknown';
    }
  }
}

/** YYYY-MM-DD for `date` in the given IANA timezone. */
export function localDate(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
