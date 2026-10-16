import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Activity,
  DailyMarine,
  DailyWeather,
  Location,
  SkiArea,
  SkiAreaSource,
  SkiOperatingStatus,
} from '../domain';
import { makeDay } from '../domain/testing/day.fixture';
import { loadConfig } from '../config/configuration';
import {
  ActivityForecastService,
  nextLocalDates,
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

const chamonixSkiArea: SkiArea = {
  id: 'test:chamonix',
  name: 'Test Chamonix ski area',
  latitude: chamonix.latitude,
  longitude: chamonix.longitude,
  forecastElevationM: null,
  source: SkiAreaSource.CURATED_CATALOG,
  operatingStatus: SkiOperatingStatus.UNKNOWN,
  operationsUrl: 'https://example.test/chamonix/status',
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
  const days: DailyWeather[] = nextLocalDates(
    new Date(),
    chamonix.timezone,
  ).map((date) => makeDay({ date, snowDepthM: 1, tempMaxC: -2 }));
  const geocoder = { search: jest.fn(async () => chamonix) };
  const weather = {
    fetchRaw: jest.fn(
      async (
        latitude: number,
        longitude: number,
        elevationM?: number,
      ): Promise<unknown> => {
        void latitude;
        void longitude;
        void elevationM;
        return { days };
      },
    ),
    parse: (raw: unknown) => (raw as { days: DailyWeather[] }).days,
  };
  const marine = {
    fetchRaw: jest.fn(async (): Promise<unknown> => null),
    parse: jest.fn((raw: unknown): DailyMarine[] => {
      void raw;
      return [];
    }),
  };
  const terrain = {
    findSkiAreaNearby: jest.fn(
      async (
        latitude: number,
        longitude: number,
        radiusKm: number,
        countryCode?: string,
      ): Promise<SkiArea | null> => {
        void latitude;
        void longitude;
        void radiusKm;
        void countryCode;
        return chamonixSkiArea;
      },
    ),
  };
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
      score: 0,
      reason: 'no coastal waters near this location',
    });
    expect(repo.geocodes.has('chamonix|FR')).toBe(true);
    expect(repo.snapshots.size).toBe(1);
  });

  it('returns a product-facing recommendation view without raw forecast details', async () => {
    const { service } = setup();

    const result = await service.getRecommendations('Chamonix', 'France');

    expect(result.destination).toBe('Chamonix, France');
    expect(result.recommendations).toHaveLength(4);
    expect(result.recommendations[0]).toMatchObject({
      activity: Activity.SKIING,
      action: 'PLAN',
      recommendedDate: expect.any(String),
      score: expect.any(Number),
    });
    expect(result.recommendations[1]).toMatchObject({
      activity: Activity.SURFING,
      action: 'SKIP',
      bookingReadiness: 'NOT_APPLICABLE',
      recommendedDate: null,
      score: 0,
    });
    expect(result.advisory).toContain('before booking');
  });

  it('scores a confirmed ski resort from persisted mountain-elevation weather', async () => {
    const { service, weather, terrain, repo } = setup();
    const mountainArea: SkiArea = {
      ...chamonixSkiArea,
      id: 'test:mountain',
      name: 'Test Mountain Resort',
      latitude: 45.97,
      longitude: 6.86,
      forecastElevationM: 2800,
    };
    terrain.findSkiAreaNearby.mockResolvedValueOnce(mountainArea);
    const dates = nextLocalDates(new Date(), chamonix.timezone);
    const cityDays = dates.map((date) =>
      makeDay({ date, snowDepthM: 0, snowfallCm: 0, tempMaxC: 18 }),
    );
    const mountainDays = dates.map((date) =>
      makeDay({ date, snowDepthM: 1.2, snowfallCm: 8, tempMaxC: -4 }),
    );
    weather.fetchRaw.mockImplementation(
      async (_latitude, _longitude, elevationM): Promise<unknown> => ({
        days: elevationM === 2800 ? mountainDays : cityDays,
      }),
    );

    const result = await service.getRecommendations('Chamonix', 'France');
    const skiing = result.recommendations[0];

    expect(weather.fetchRaw).toHaveBeenCalledWith(45.97, 6.86, 2800);
    expect(skiing).toMatchObject({
      action: 'PLAN',
      bookingReadiness: 'VERIFY_LIVE_STATUS',
      confidence: 'MEDIUM',
      recommendedDate: expect.any(String),
    });
    expect(skiing.message).toContain('Test Mountain Resort');
    expect(skiing.evidence).toContain('Mountain forecast elevation: 2800 m');
    expect([...repo.snapshots.values()][0]).toMatchObject({
      skiWeatherLocationKey: '45.9700,6.8600@2800',
      skiWeatherRaw: { days: mountainDays },
    });
  });

  it('keeps a known resort unbookable when its mountain forecast is unavailable', async () => {
    const { service, weather, terrain } = setup();
    const mountainArea: SkiArea = {
      ...chamonixSkiArea,
      latitude: 45.97,
      longitude: 6.86,
      forecastElevationM: 2800,
    };
    terrain.findSkiAreaNearby.mockResolvedValueOnce(mountainArea);
    weather.fetchRaw.mockImplementation(
      async (latitude, longitude, elevationM): Promise<unknown> => {
        void latitude;
        void longitude;
        if (elevationM === 2800)
          throw new UpstreamUnavailableError('mountain weather');
        const dates = nextLocalDates(new Date(), chamonix.timezone);
        return { days: dates.map((date) => makeDay({ date, tempMaxC: 18 })) };
      },
    );

    const result = await service.getRecommendations('Chamonix', 'France');

    expect(result.recommendations[0]).toMatchObject({
      activity: Activity.SKIING,
      action: 'UNAVAILABLE',
      bookingReadiness: 'DATA_UNAVAILABLE',
      confidence: 'NONE',
      dataAsOf: null,
    });
  });

  it('marks stored mountain fallback evidence stale and lowers ski confidence', async () => {
    const { service, weather, terrain, repo } = setup();
    const mountainArea: SkiArea = {
      ...chamonixSkiArea,
      latitude: 45.97,
      longitude: 6.86,
      forecastElevationM: 2800,
    };
    terrain.findSkiAreaNearby.mockResolvedValueOnce(mountainArea);
    const dates = nextLocalDates(new Date(), chamonix.timezone);
    const cityDays = dates.map((date) => makeDay({ date, tempMaxC: 18 }));
    const mountainDays = dates.map((date) =>
      makeDay({ date, snowDepthM: 1.2, snowfallCm: 8, tempMaxC: -4 }),
    );
    weather.fetchRaw.mockImplementation(
      async (latitude, longitude, elevationM): Promise<unknown> => {
        void latitude;
        void longitude;
        return { days: elevationM === 2800 ? mountainDays : cityDays };
      },
    );
    await service.getRecommendations('Chamonix', 'France');
    const snapshot = [...repo.snapshots.values()][0];
    snapshot.skiWeatherFetchedAt = new Date(Date.now() - 4 * 3_600_000);
    weather.fetchRaw.mockRejectedValueOnce(
      new UpstreamUnavailableError('mountain weather'),
    );

    const result = await service.getRecommendations('Chamonix', 'France');

    expect(result.recommendations[0]).toMatchObject({
      action: 'PLAN',
      confidence: 'LOW',
      evidence: expect.arrayContaining([
        'Mountain forecast is stored fallback data',
      ]),
    });
  });

  it('reuses separately cached mountain weather inside the TTL', async () => {
    const { service, weather, terrain } = setup();
    terrain.findSkiAreaNearby.mockResolvedValueOnce({
      ...chamonixSkiArea,
      latitude: 45.97,
      longitude: 6.86,
      forecastElevationM: 2800,
    });

    await service.getForecast('Chamonix', 'France');
    await service.getForecast('Chamonix', 'France');

    expect(weather.fetchRaw).toHaveBeenCalledTimes(2); // city + mountain once each
    expect(terrain.findSkiAreaNearby).toHaveBeenCalledTimes(1);
  });

  it('serves fresh stored data without calling upstream again', async () => {
    const { service, geocoder, weather, terrain } = setup();
    await service.getForecast('Chamonix');
    await service.getForecast('chamonix ');
    expect(geocoder.search).toHaveBeenCalledTimes(1);
    expect(weather.fetchRaw).toHaveBeenCalledTimes(1);
    expect(terrain.findSkiAreaNearby).toHaveBeenCalledTimes(1);
  });

  it('refreshes instead of crashing when fresh stored weather is malformed', async () => {
    const { service, weather, repo } = setup();
    await service.getForecast('Chamonix');
    [...repo.snapshots.values()][0].weatherRaw = {};

    const result = await service.getForecast('Chamonix');

    expect(result.activities).toHaveLength(4);
    expect(weather.fetchRaw).toHaveBeenCalledTimes(2);
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

  it('rejects stale data that no longer covers all of the next 7 days', async () => {
    const { service, weather, repo } = setup();
    await service.getForecast('Chamonix');
    const snap = [...repo.snapshots.values()][0];
    snap.fetchedAt = new Date(Date.now() - 24 * 3_600_000);
    snap.weatherRaw = {
      days: [makeDay({ date: '2020-01-01' })],
    };
    weather.fetchRaw.mockRejectedValueOnce(
      new UpstreamUnavailableError('open-meteo'),
    );

    await expect(service.getForecast('Chamonix')).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
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
    terrain.findSkiAreaNearby.mockRejectedValueOnce(new Error('overpass down'));
    const result = await service.getForecast('Chamonix');
    expect(result.activities[0].days[0]).toMatchObject({
      score: null,
      reason: 'ski area lookup unavailable, try again shortly',
    });
    expect(repo.terrain.size).toBe(0);
    await service.getForecast('Chamonix');
    expect(terrain.findSkiAreaNearby).toHaveBeenCalledTimes(2);
  });

  it('answers without the ski-area lookup if it exceeds the deadline, and caches it later', async () => {
    const { service, terrain, repo } = setup();
    let finish: (value: SkiArea) => void = () => undefined;
    terrain.findSkiAreaNearby.mockImplementationOnce(
      () => new Promise<SkiArea>((resolve) => (finish = resolve)),
    );
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    });
    try {
      const pending = service.getForecast('Chamonix');
      await jest.advanceTimersByTimeAsync(20000);
      const result = await pending;
      expect(result.activities[0].days[0].score).toBeNull();
    } finally {
      jest.useRealTimers();
    }
    finish(chamonixSkiArea);
    await new Promise((r) => setImmediate(r));
    expect([...repo.terrain.values()][0]).toMatchObject({
      hasSkiArea: true,
      skiArea: chamonixSkiArea,
    });
  });

  it('uses one seven-day window when a request crosses local midnight', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      now: new Date('2026-10-15T21:59:59Z'), // 23:59:59 in Europe/Paris
    });
    try {
      const { service, terrain } = setup();
      terrain.findSkiAreaNearby.mockImplementationOnce(
        () =>
          new Promise<SkiArea>((resolve) =>
            setTimeout(() => resolve(chamonixSkiArea), 2000),
          ),
      );

      const pending = service.getForecast('Chamonix');
      await jest.advanceTimersByTimeAsync(2000);
      const result = await pending;

      const expected = nextLocalDates(
        new Date('2026-10-15T21:59:59Z'),
        chamonix.timezone,
      );
      for (const activity of result.activities) {
        expect(activity.days).toHaveLength(7);
        expect(activity.days.map((day) => day.date).sort()).toEqual(expected);
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it('serializes and revalidates an in-flight refresh across local midnight', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      now: new Date('2026-10-15T21:59:59Z'),
    });
    try {
      const { service, weather } = setup();
      weather.fetchRaw.mockImplementation(() => {
        const dates = nextLocalDates(new Date(), chamonix.timezone);
        const days = dates.map((date) =>
          makeDay({ date, snowDepthM: 1, tempMaxC: -2 }),
        );
        return new Promise<unknown>((resolve) =>
          setTimeout(() => resolve({ days }), 5000),
        );
      });

      const beforeMidnight = service.getForecast('Chamonix');
      await jest.advanceTimersByTimeAsync(0);
      expect(weather.fetchRaw).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(2000);
      const afterMidnight = service.getForecast('Chamonix');
      await jest.advanceTimersByTimeAsync(0);
      expect(weather.fetchRaw).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(3000);
      expect(weather.fetchRaw).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(5000);
      const [first, second] = await Promise.all([
        beforeMidnight,
        afterMidnight,
      ]);

      expect(first.activities[0].days).toHaveLength(7);
      expect(second.activities[0].days).toHaveLength(7);
      expect(first.activities[0].days.map((day) => day.date)).not.toContain(
        '2026-10-22',
      );
      expect(second.activities[0].days.map((day) => day.date)).toContain(
        '2026-10-22',
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries after midnight when the shared earlier-window refresh is rejected', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      now: new Date('2026-10-15T21:59:59Z'),
    });
    try {
      const { service, weather } = setup();
      const responseForCurrentWindow = () => ({
        days: nextLocalDates(new Date(), chamonix.timezone).map((date) =>
          makeDay({ date, snowDepthM: 1, tempMaxC: -2 }),
        ),
      });
      weather.fetchRaw
        .mockImplementationOnce(
          () =>
            new Promise<unknown>((resolve) =>
              setTimeout(() => resolve(responseForCurrentWindow()), 5000),
            ),
        )
        .mockImplementationOnce(async () => responseForCurrentWindow());

      const beforeMidnight = service
        .getForecast('Chamonix')
        .catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(2000);
      const afterMidnight = service.getForecast('Chamonix');

      await jest.advanceTimersByTimeAsync(3000);
      const [firstOutcome, second] = await Promise.all([
        beforeMidnight,
        afterMidnight,
      ]);

      expect(firstOutcome).toBeInstanceOf(UpstreamUnavailableError);
      expect(second.activities[0].days).toHaveLength(7);
      expect(second.activities[0].days.map((day) => day.date)).toContain(
        '2026-10-22',
      );
      expect(weather.fetchRaw).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('still answers when the marine fetch fails', async () => {
    const { service, marine } = setup();
    marine.fetchRaw.mockRejectedValueOnce(new Error('marine down'));
    const result = await service.getForecast('Chamonix');
    expect(result.activities[1].days[0].score).toBeNull();
  });

  it('still answers when marine data cannot be parsed', async () => {
    const { service, marine, repo } = setup();
    marine.fetchRaw.mockResolvedValueOnce({ malformed: true });
    marine.parse.mockImplementationOnce(() => {
      throw new Error('malformed marine payload');
    });

    const result = await service.getForecast('Chamonix');

    expect(result.activities[1].days).toHaveLength(7);
    expect(result.activities[1].days.every((day) => day.score === null)).toBe(
      true,
    );
    expect([...repo.snapshots.values()][0].marineRaw).toBeNull();
  });

  it('retains stored marine data when a refresh of that source fails', async () => {
    const { service, marine, repo } = setup();
    const dates = nextLocalDates(new Date(), chamonix.timezone);
    const marineRaw = { date: dates[0], waveHeightMaxM: 1.5 };
    marine.fetchRaw.mockResolvedValueOnce(marineRaw);
    marine.parse.mockImplementation((raw: unknown) => {
      const value = raw as { date: string; waveHeightMaxM: number };
      return [
        {
          date: value.date,
          waveHeightMaxM: value.waveHeightMaxM,
          wavePeriodMaxS: 12,
        },
      ];
    });
    await service.getForecast('Chamonix');

    const snap = [...repo.snapshots.values()][0];
    snap.fetchedAt = new Date(Date.now() - 4 * 3_600_000);
    marine.fetchRaw.mockRejectedValueOnce(new Error('marine down'));

    const result = await service.getForecast('Chamonix');
    expect(result.activities[1].days[0].score).not.toBeNull();
    expect(result.assessment.marine.isStale).toBe(true);
    expect([...repo.snapshots.values()][0].marineRaw).toBe(marineRaw);

    const recommendations = await service.getRecommendations('Chamonix');
    expect(recommendations.recommendations[1]).toMatchObject({
      confidence: 'LOW',
      evidence: expect.arrayContaining([
        'Marine forecast is stored fallback data',
      ]),
    });
  });
});

describe('nextLocalDates', () => {
  it.each([
    {
      name: 'Europe/Paris spring-forward weekend',
      now: '2026-03-28T22:30:00Z',
      expected: [
        '2026-03-28',
        '2026-03-29',
        '2026-03-30',
        '2026-03-31',
        '2026-04-01',
        '2026-04-02',
        '2026-04-03',
      ],
    },
    {
      name: 'Europe/Paris fall-back weekend',
      now: '2026-10-24T22:30:00Z',
      expected: [
        '2026-10-25',
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
        '2026-10-31',
      ],
    },
  ])('steps calendar dates across $name', ({ now, expected }) => {
    expect(nextLocalDates(new Date(now), 'Europe/Paris')).toEqual(expected);
  });
});
