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
import { SkiAreaSource, SkiOperatingStatus } from '../src/domain';
import { parseOpenMeteoMarine } from '../src/infrastructure/open-meteo/open-meteo-marine.adapter';
import { parseOpenMeteoForecast } from '../src/infrastructure/open-meteo/open-meteo-weather.adapter';
import { configureHttpSecurity } from '../src/presentation/http/configure-http';
import { chamonixLocation, chamonixWeatherRaw } from './fixtures';

describe('security controls (e2e)', () => {
  let app: INestApplication;
  const readKey = 'read-key-that-is-at-least-thirty-two-characters';
  const wrongScopeKey = 'wrong-scope-key-at-least-thirty-two-characters';
  const managedEnv = [
    'NODE_ENV',
    'DATABASE_PATH',
    'AUTH_REQUIRED',
    'AUTH_API_KEYS_JSON',
    'CORS_ALLOWED_ORIGINS',
    'REQUEST_BODY_LIMIT',
    'RATE_LIMIT_MAX',
    'GRAPHQL_MAX_ALIASES',
    'GRAPHQL_MAX_ROOT_FIELDS',
  ] as const;
  const originalEnv = new Map(
    managedEnv.map((name) => [name, process.env[name]]),
  );

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_PATH = ':memory:';
    process.env.AUTH_REQUIRED = 'true';
    process.env.AUTH_API_KEYS_JSON = JSON.stringify([
      { subject: 'reader', key: readKey, scopes: ['forecast:read'] },
      { subject: 'billing-only', key: wrongScopeKey, scopes: ['billing:read'] },
    ]);
    process.env.CORS_ALLOWED_ORIGINS = 'https://client.example';
    process.env.REQUEST_BODY_LIMIT = '2kb';
    process.env.RATE_LIMIT_MAX = '100';
    process.env.GRAPHQL_MAX_ALIASES = '2';
    process.env.GRAPHQL_MAX_ROOT_FIELDS = '2';
    Logger.overrideLogger(false);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GEOCODER)
      .useValue({ search: jest.fn(async () => chamonixLocation) })
      .overrideProvider(WEATHER_PROVIDER)
      .useValue({
        fetchRaw: jest.fn(async () => chamonixWeatherRaw()),
        parse: parseOpenMeteoForecast,
      })
      .overrideProvider(MARINE_PROVIDER)
      .useValue({
        fetchRaw: jest.fn(async () => null),
        parse: parseOpenMeteoMarine,
      })
      .overrideProvider(TERRAIN_PROVIDER)
      .useValue({
        findSkiAreaNearby: jest.fn(async () => ({
          id: 'test:chamonix',
          name: 'Test Chamonix ski area',
          latitude: chamonixLocation.latitude,
          longitude: chamonixLocation.longitude,
          forecastElevationM: null,
          source: SkiAreaSource.CURATED_CATALOG,
          operatingStatus: SkiOperatingStatus.UNKNOWN,
        })),
      })
      .compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureHttpSecurity(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const query =
    '{ activityRecommendations(city: "Chamonix", country: "France") { destination } }';
  const post = (body: string | object | undefined, key?: string) => {
    const call = request(app.getHttpServer()).post('/graphql').send(body);
    return key ? call.set('Authorization', `Bearer ${key}`) : call;
  };

  it('requires a valid API credential in private mode', async () => {
    const missing = await post({ query }).expect(200);
    expect(missing.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');

    const invalid = await post({ query }, 'not-a-valid-key').expect(200);
    expect(invalid.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
  });

  it('enforces resolver scopes', async () => {
    const response = await post({ query }, wrongScopeKey).expect(200);
    expect(response.body.errors[0].extensions).toMatchObject({
      code: 'FORBIDDEN',
      requiredScopes: ['forecast:read'],
    });
  });

  it('accepts either a scoped Bearer token or X-API-Key, but not both', async () => {
    const bearer = await post({ query }, readKey).expect(200);
    expect(bearer.body.data.activityRecommendations.destination).toContain(
      'Chamonix',
    );

    const apiKey = await request(app.getHttpServer())
      .post('/graphql')
      .set('X-API-Key', readKey)
      .send({ query })
      .expect(200);
    expect(apiKey.body.errors).toBeUndefined();

    const ambiguous = await request(app.getHttpServer())
      .post('/graphql')
      .set('Authorization', `Bearer ${readKey}`)
      .set('X-API-Key', readKey)
      .send({ query })
      .expect(200);
    expect(ambiguous.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
  });

  it('uses an exact browser-origin allow list', async () => {
    const allowed = await request(app.getHttpServer())
      .options('/graphql')
      .set('Origin', 'https://client.example')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://client.example',
    );

    const denied = await request(app.getHttpServer())
      .options('/graphql')
      .set('Origin', 'https://attacker.example')
      .set('Access-Control-Request-Method', 'POST')
      .expect(400);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects abusive alias fan-out before resolver execution', async () => {
    const abusiveQuery = `query {
      a: activityRecommendations(city: "Chamonix") { destination }
      b: activityRecommendations(city: "Chamonix") { destination }
      c: activityRecommendations(city: "Chamonix") { destination }
    }`;
    const response = await post({ query: abusiveQuery }, readKey).expect(400);
    expect(response.body.errors[0].extensions).toMatchObject({
      code: 'GRAPHQL_VALIDATION_FAILED',
      limitType: 'ALIASES',
      limit: 2,
      actual: 3,
    });
  });

  it('disables GraphQL GET and introspection in production', async () => {
    const getResponse = await request(app.getHttpServer())
      .get('/graphql')
      .set('Authorization', `Bearer ${readKey}`)
      .query({ query })
      .expect(405);
    expect(getResponse.body.errors[0].extensions.code).toBe(
      'METHOD_NOT_ALLOWED',
    );

    const introspection = await post(
      { query: '{ __schema { queryType { name } } }' },
      readKey,
    ).expect(400);
    expect(introspection.body.errors[0].message).toContain(
      'GraphQL introspection is not allowed',
    );
  });

  it('rejects oversized JSON and emits baseline security headers', async () => {
    const oversized = await post(
      { query, padding: 'x'.repeat(3000) },
      readKey,
    ).expect(413);
    expect(oversized.body.errors[0].extensions.code).toBe('PAYLOAD_TOO_LARGE');

    const normal = await post({ query }, readKey).expect(200);
    expect(normal.headers['x-content-type-options']).toBe('nosniff');
    expect(normal.headers['x-powered-by']).toBeUndefined();
  });
});
