import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  GEOCODER,
  MARINE_PROVIDER,
  TERRAIN_PROVIDER,
  WEATHER_PROVIDER,
} from '../src/application/ports';
import { nextLocalDates } from '../src/application/activity-forecast.service';
import {
  DailyMarine,
  DailyWeather,
  Location,
  SkiArea,
  SkiAreaSource,
  SkiOperatingStatus,
} from '../src/domain';
import { makeDay } from '../src/domain/testing/day.fixture';

const locations: Record<string, Location> = {
  zermatt: {
    name: 'Zermatt',
    country: 'Switzerland',
    countryCode: 'CH',
    latitude: 45.9763,
    longitude: 7.6586,
    timezone: 'Europe/Zurich',
  },
  phoenix: {
    name: 'Phoenix',
    country: 'United States',
    countryCode: 'US',
    latitude: 33.4484,
    longitude: -112.074,
    timezone: 'America/Phoenix',
  },
  biarritz: {
    name: 'Biarritz',
    country: 'France',
    countryCode: 'FR',
    latitude: 43.4832,
    longitude: -1.5586,
    timezone: 'Europe/Paris',
  },
  'alpine outage': {
    name: 'Alpine Outage',
    country: 'Switzerland',
    countryCode: 'CH',
    latitude: 46.8,
    longitude: 8.2,
    timezone: 'Europe/Zurich',
  },
};

const zermattArea: SkiArea = {
  id: 'catalog:matterhorn-ski-paradise',
  name: 'Matterhorn Ski Paradise',
  latitude: 45.9384,
  longitude: 7.729,
  forecastElevationM: 3000,
  source: SkiAreaSource.CURATED_CATALOG,
  operatingStatus: SkiOperatingStatus.UNKNOWN,
  operationsUrl: 'https://zermatt.swiss/en/info/lifts-pistes',
};

const daysFor = (
  location: Location,
  overrides: (index: number) => Partial<DailyWeather>,
): DailyWeather[] =>
  nextLocalDates(new Date(), location.timezone).map((date, index) =>
    makeDay({ date, ...overrides(index) }),
  );

describe('booking recommendation scenario matrix (e2e)', () => {
  let app: INestApplication;
  const realFetch = global.fetch;

  const geocoder = {
    search: jest.fn(
      async (city: string) => locations[city.toLowerCase()] ?? null,
    ),
  };
  const weather = {
    fetchRaw: jest.fn(
      async (
        latitude: number,
        _longitude: number,
        elevationM?: number,
      ): Promise<unknown> => {
        if (elevationM === 3000) {
          return {
            days: daysFor(locations.zermatt, () => ({
              snowDepthM: 1.4,
              snowfallCm: 7,
              tempMaxC: -5,
              windSpeedMaxKmh: 15,
            })),
          };
        }
        if (Math.abs(latitude - locations.zermatt.latitude) < 0.01) {
          return {
            days: daysFor(locations.zermatt, (index) =>
              index === 6
                ? {
                    precipitationMm: 15,
                    precipitationProbability: 95,
                    weatherCode: 95,
                    sunshineHours: 0,
                  }
                : { tempMaxC: 19, sunshineHours: 9 },
            ),
          };
        }
        if (Math.abs(latitude - locations.phoenix.latitude) < 0.01) {
          return {
            days: daysFor(locations.phoenix, () => ({
              tempMaxC: 40,
              snowDepthM: 0,
              snowfallCm: 0,
            })),
          };
        }
        const location =
          Math.abs(latitude - locations.biarritz.latitude) < 0.01
            ? locations.biarritz
            : locations['alpine outage'];
        return { days: daysFor(location, () => ({ tempMaxC: 21 })) };
      },
    ),
    parse: (raw: unknown) => (raw as { days: DailyWeather[] }).days,
  };
  const marine = {
    fetchRaw: jest.fn(async (latitude: number): Promise<unknown | null> => {
      if (Math.abs(latitude - locations.biarritz.latitude) >= 0.01) return null;
      return {
        days: nextLocalDates(new Date(), locations.biarritz.timezone).map(
          (date) => ({ date, waveHeightMaxM: 1.6, wavePeriodMaxS: 12 }),
        ),
      };
    }),
    parse: (raw: unknown): DailyMarine[] =>
      (raw as { days: DailyMarine[] }).days,
  };
  const terrain = {
    findSkiAreaNearby: jest.fn(
      async (latitude: number): Promise<SkiArea | null> => {
        if (Math.abs(latitude - locations.zermatt.latitude) < 0.01)
          return zermattArea;
        if (Math.abs(latitude - locations['alpine outage'].latitude) < 0.01)
          throw new Error('terrain provider unavailable');
        return null;
      },
    ),
  };

  beforeAll(async () => {
    process.env.DATABASE_PATH = ':memory:';
    global.fetch = jest.fn(() => Promise.reject(new Error('network disabled')));
    Logger.overrideLogger(false);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GEOCODER)
      .useValue(geocoder)
      .overrideProvider(WEATHER_PROVIDER)
      .useValue(weather)
      .overrideProvider(MARINE_PROVIDER)
      .useValue(marine)
      .overrideProvider(TERRAIN_PROVIDER)
      .useValue(terrain)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    global.fetch = realFetch;
  });

  const query = /* GraphQL */ `
    query ($city: String!, $country: String) {
      activityRecommendations(city: $city, country: $country) {
        summary
        recommendations {
          activity
          action
          bookingReadiness
          confidence
          recommendedDate
          score
          message
          evidence
          checksBeforeBooking
        }
      }
    }
  `;

  async function recommendations(city: string, country: string) {
    const response = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query, variables: { city, country } })
      .expect(200);
    expect(response.body.errors).toBeUndefined();
    return response.body.data.activityRecommendations as {
      summary: string;
      recommendations: Array<Record<string, unknown>>;
    };
  }

  const activity = (
    result: Awaited<ReturnType<typeof recommendations>>,
    name: string,
  ) => result.recommendations.find((item) => item.activity === name)!;

  it('Zermatt: uses a confirmed resort and 3000 m forecast, but requires live operations verification', async () => {
    const result = await recommendations('Zermatt', 'Switzerland');
    expect(activity(result, 'SKIING')).toMatchObject({
      action: 'PLAN',
      bookingReadiness: 'VERIFY_LIVE_STATUS',
      confidence: 'MEDIUM',
      recommendedDate: expect.any(String),
      message: expect.stringContaining('Matterhorn Ski Paradise'),
      evidence: expect.arrayContaining([
        'Ski venue: Matterhorn Ski Paradise (CURATED_CATALOG)',
        'Mountain forecast elevation: 3000 m',
      ]),
    });
    expect(weather.fetchRaw).toHaveBeenCalledWith(45.9384, 7.729, 3000);
  });

  it('Zermatt: makes indoor and outdoor plans on different, appropriate days', async () => {
    const result = await recommendations('Zermatt', 'CH');
    const outdoor = activity(result, 'OUTDOOR_SIGHTSEEING');
    const indoor = activity(result, 'INDOOR_SIGHTSEEING');
    expect(outdoor.action).toBe('PLAN');
    expect(indoor.action).toBe('PLAN');
    expect(outdoor.recommendedDate).not.toBe(indoor.recommendedDate);
  });

  it('Phoenix: marks skiing and surfing not applicable instead of provider failures', async () => {
    const result = await recommendations('Phoenix', 'United States of America');
    expect(activity(result, 'SKIING')).toMatchObject({
      action: 'SKIP',
      bookingReadiness: 'NOT_APPLICABLE',
      score: 0,
    });
    expect(activity(result, 'SURFING')).toMatchObject({
      action: 'SKIP',
      bookingReadiness: 'NOT_APPLICABLE',
      score: 0,
    });
  });

  it('Biarritz: recommends a surf window but retains local safety checks', async () => {
    const result = await recommendations('Biarritz', 'France');
    expect(activity(result, 'SURFING')).toMatchObject({
      action: 'PLAN',
      bookingReadiness: 'VERIFY_LIVE_STATUS',
      confidence: 'MEDIUM',
      recommendedDate: expect.any(String),
      checksBeforeBooking: expect.arrayContaining([
        'Local tide, swell direction and beach warnings',
      ]),
    });
  });

  it('terrain outage: reports skiing data unavailable without blocking other activities', async () => {
    const result = await recommendations('Alpine Outage', 'Switzerland');
    expect(activity(result, 'SKIING')).toMatchObject({
      action: 'UNAVAILABLE',
      bookingReadiness: 'DATA_UNAVAILABLE',
      confidence: 'NONE',
      score: null,
    });
    expect(activity(result, 'OUTDOOR_SIGHTSEEING').action).toBe('PLAN');
  });

  it('never calls the real network', () => {
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
