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
import { parseOpenMeteoForecast } from '../src/infrastructure/open-meteo/open-meteo-weather.adapter';
import { parseOpenMeteoMarine } from '../src/infrastructure/open-meteo/open-meteo-marine.adapter';
import { chamonixLocation, chamonixWeatherRaw } from './fixtures';

/**
 * Full Nest app + real GraphQL + real TypeORM (in-memory SQLite) + real parsers.
 * Only the network-facing adapter methods are replaced with fakes.
 */
describe('activityForecast query (e2e)', () => {
  let app: INestApplication;
  const geocoder = {
    search: jest.fn(async (city: string) =>
      city.toLowerCase().startsWith('chamonix') ? chamonixLocation : null,
    ),
  };
  const weather = {
    fetchRaw: jest.fn(async () => chamonixWeatherRaw()),
    parse: parseOpenMeteoForecast,
  };
  const marine = {
    fetchRaw: jest.fn(async () => null),
    parse: parseOpenMeteoMarine,
  };
  const terrain = { hasSkiAreaNearby: jest.fn(async () => true) };
  const realFetch = global.fetch;

  beforeAll(async () => {
    process.env.DATABASE_PATH = ':memory:';
    // Belt and braces: any accidental real HTTP call fails the test.
    global.fetch = jest.fn(() =>
      Promise.reject(new Error('network disabled in e2e')),
    );
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

  const QUERY = /* GraphQL */ `
    query ($city: String!, $country: String) {
      activityForecast(city: $city, country: $country) {
        location {
          name
          country
          countryCode
          latitude
          longitude
          timezone
        }
        dataFreshness {
          fetchedAt
          isStale
        }
        activities {
          activity
          bestDay
          days {
            date
            score
            reason
          }
        }
      }
    }
  `;
  const gql = (variables: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/graphql')
      .send({ query: QUERY, variables });

  it('returns ranked activities for a city', async () => {
    const res = await gql({ city: 'Chamonix', country: 'FR' }).expect(200);
    expect(res.body.errors).toBeUndefined();
    const f = res.body.data.activityForecast;

    expect(f.location).toMatchObject({
      name: 'Chamonix-Mont-Blanc',
      country: 'France',
      timezone: 'Europe/Paris',
    });
    expect(f.dataFreshness.isStale).toBe(false);
    expect(new Date(f.dataFreshness.fetchedAt).getTime()).not.toBeNaN();
    expect(f.activities.map((a: { activity: string }) => a.activity)).toEqual([
      'SKIING',
      'SURFING',
      'OUTDOOR_SIGHTSEEING',
      'INDOOR_SIGHTSEEING',
    ]);

    for (const a of f.activities) {
      expect(a.days).toHaveLength(7);
      const scores = a.days
        .map((d: { score: number | null }) => d.score)
        .filter((s: number | null) => s !== null);
      expect(scores).toEqual([...scores].sort((x, y) => y - x)); // best-first
    }

    const [ski, surf, outdoor] = f.activities;
    // Day 2 has 18 cm of fresh snow on a 1.1 m base: the powder day wins.
    expect(ski.bestDay).toBe(ski.days[0].date);
    expect(ski.days[0].reason).toContain('fresh snow');
    expect(surf.bestDay).toBeNull();
    expect(surf.days[0]).toMatchObject({
      score: null,
      reason: 'no coastal data',
    });
    expect(outdoor.days[6].reason).toMatch(/thunderstorms|rain/);
  });

  it('persists the forecast and does not refetch on the next request', async () => {
    await gql({ city: 'Chamonix', country: 'FR' }).expect(200);
    expect(geocoder.search).toHaveBeenCalledTimes(1);
    expect(weather.fetchRaw).toHaveBeenCalledTimes(1);
    expect(terrain.hasSkiAreaNearby).toHaveBeenCalledTimes(1);
  });

  it('returns CITY_NOT_FOUND for unknown places', async () => {
    const res = await gql({ city: 'Xyzzyville' }).expect(200);
    expect(res.body.data).toBeNull();
    expect(res.body.errors[0].extensions.code).toBe('CITY_NOT_FOUND');
    expect(res.body.errors[0].message).toContain('Xyzzyville');
  });

  it('rejects an invalid country code with a validation error', async () => {
    const res = await gql({ city: 'Paris', country: 'France' }).expect(200);
    expect(res.body.errors[0].extensions.code).toBe('BAD_REQUEST');
    expect(res.body.errors[0].message).toContain('2-letter ISO');
    expect(geocoder.search).not.toHaveBeenCalledWith(
      'Paris',
      expect.anything(),
    );
  });

  it('never touched the real network', () => {
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
