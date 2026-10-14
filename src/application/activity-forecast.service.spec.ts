import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Activity, DailyWeather, Location } from '../domain';
import { makeDay } from '../domain/testing/day.fixture';
import { loadConfig } from '../config/configuration';
import {
  ActivityForecastService,
  localDate,
} from './activity-forecast.service';
import { CityNotFoundError, UpstreamUnavailableError } from './errors';
import {
  ForecastRepositoryPort,
  ForecastSnapshot,
  SkiTerrainRecord,
} from './ports';

const chamonix: Location = {
  name: 'Chamonix',
  country: 'France',
  countryCode: 'FR',
  latitude: 45.92,
  longitude: 6.87,
  timezone: 'Europe/Paris',
};

class InMemoryRepo implements ForecastRepositoryPort {
  geocodes = new Map<string, Location>();
  snapshots = new Map<string, ForecastSnapshot>();
  terrain = new Map<string, SkiTerrainRecord>();
  findGeocode = async (k: string) => this.geocodes.get(k) ?? null;
  saveGeocode = async (k: string, l: Location) => void this.geocodes.set(k, l);
  findSnapshot = async (k: string) => this.snapshots.get(k) ?? null;
  saveSnapshot = async (s: ForecastSnapshot) =>
    void this.snapshots.set(s.locationKey, s);
  findSkiTerrain = async (k: string) => this.terrain.get(k) ?? null;
  saveSkiTerrain = async (r: SkiTerrainRecord) =>
    void this.terrain.set(r.locationKey, r);
}

function setup() {
  const today = localDate(new Date(), chamonix.timezone);
  const days: DailyWeather[] = [
    makeDay({ date: today, snowDepthM: 1, tempMaxC: -2 }),
  ];
  const geocoder = { search: jest.fn(async () => chamonix) };
  const weather = {
    fetchRaw: jest.fn(async (): Promise<unknown> => ({ days })),
    parse: (raw: unknown) => (raw as { days: DailyWeather[] }).days,
  };
  const marine = {
    fetchRaw: jest.fn(async (): Promise<unknown> => null),
    parse: () => [],
  };
  const terrain = { hasSkiAreaNearby: jest.fn(async () => true) };
  const repo = new InMemoryRepo();
  const config = {
    getOrThrow: () => loadConfig({}),
  } as unknown as ConfigService;
  const service = new ActivityForecastService(
    geocoder,
    weather,
    marine,
    terrain,
    repo,
    config,
  );
  return { service, geocoder, weather, marine, terrain, repo };
}

describe('ActivityForecastService', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('geocodes, fetches, persists and ranks', async () => {
    const { service, repo } = setup();
    const result = await service.getForecast('Chamonix', 'fr');
    expect(result.location).toEqual(chamonix);
    expect(result.dataFreshness.isStale).toBe(false);
    expect(result.activities).toHaveLength(4);
    const ski = result.activities.find((a) => a.activity === Activity.SKIING)!;
    expect(ski.days[0].score).toBeGreaterThan(50);
    const surf = result.activities.find(
      (a) => a.activity === Activity.SURFING,
    )!;
    expect(surf.days[0]).toMatchObject({
      score: null,
      reason: 'no coastal data',
    });
    expect(repo.geocodes.has('chamonix|FR')).toBe(true);
    expect(repo.snapshots.size).toBe(1);
  });

  it('serves fresh stored data without calling upstream again', async () => {
    const { service, geocoder, weather, terrain } = setup();
    await service.getForecast('Chamonix');
    await service.getForecast('chamonix ');
    expect(geocoder.search).toHaveBeenCalledTimes(1);
    expect(weather.fetchRaw).toHaveBeenCalledTimes(1);
    expect(terrain.hasSkiAreaNearby).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight fetch between concurrent requests', async () => {
    const { service, weather } = setup();
    await Promise.all(
      [1, 2, 3, 4, 5].map(() => service.getForecast('Chamonix')),
    );
    expect(weather.fetchRaw).toHaveBeenCalledTimes(1);
  });

  it('refreshes data older than the TTL', async () => {
    const { service, weather, repo } = setup();
    await service.getForecast('Chamonix');
    const snap = [...repo.snapshots.values()][0];
    snap.fetchedAt = new Date(Date.now() - 4 * 3_600_000);
    await service.getForecast('Chamonix');
    expect(weather.fetchRaw).toHaveBeenCalledTimes(2);
  });

  it('serves stale data with isStale=true when the refresh fails', async () => {
    const { service, weather, repo } = setup();
    await service.getForecast('Chamonix');
    const snap = [...repo.snapshots.values()][0];
    const old = new Date(Date.now() - 5 * 3_600_000);
    snap.fetchedAt = old;
    weather.fetchRaw.mockRejectedValueOnce(
      new UpstreamUnavailableError('open-meteo'),
    );
    const result = await service.getForecast('Chamonix');
    expect(result.dataFreshness).toEqual({ fetchedAt: old, isStale: true });
  });

  it('throws UpstreamUnavailableError when there is nothing stored to fall back on', async () => {
    const { service, weather } = setup();
    weather.fetchRaw.mockRejectedValueOnce(
      new UpstreamUnavailableError('open-meteo'),
    );
    await expect(service.getForecast('Chamonix')).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('throws CityNotFoundError for unknown cities', async () => {
    const { service, geocoder } = setup();
    geocoder.search.mockResolvedValueOnce(null as unknown as Location);
    await expect(service.getForecast('Nowhereville')).rejects.toBeInstanceOf(
      CityNotFoundError,
    );
  });

  it('scores skiing as unknown (null) when the terrain lookup fails, and retries next time', async () => {
    const { service, terrain, repo } = setup();
    terrain.hasSkiAreaNearby.mockRejectedValueOnce(new Error('overpass down'));
    const result = await service.getForecast('Chamonix');
    expect(result.activities[0].days[0]).toMatchObject({
      score: null,
      reason: 'ski area lookup unavailable',
    });
    expect(repo.terrain.size).toBe(0);
    await service.getForecast('Chamonix');
    expect(terrain.hasSkiAreaNearby).toHaveBeenCalledTimes(2);
  });

  it('still answers when the marine fetch fails', async () => {
    const { service, marine } = setup();
    marine.fetchRaw.mockRejectedValueOnce(new Error('marine down'));
    const result = await service.getForecast('Chamonix');
    expect(result.activities[1].days[0].score).toBeNull();
  });
});
