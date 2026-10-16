import express from 'express';
import request from 'supertest';
import { loadConfig } from '../src/config/configuration';
import { createGraphqlRateLimiter } from '../src/presentation/http/configure-http';

describe('GraphQL rate limiter (e2e)', () => {
  it('returns a stable 429 response after the configured per-IP allowance', async () => {
    const app = express();
    const config = {
      ...loadConfig({}),
      rateLimitMax: 2,
      rateLimitWindowMs: 60000,
    };
    app.use('/graphql', createGraphqlRateLimiter(config));
    app.post('/graphql', (_req, res) => res.json({ data: { ok: true } }));

    await request(app).post('/graphql').expect(200);
    await request(app).post('/graphql').expect(200);
    const limited = await request(app).post('/graphql').expect(429);

    expect(limited.body.errors[0]).toMatchObject({
      message: 'Too many requests; retry later',
      extensions: { code: 'RATE_LIMITED', retryAfterSeconds: 60 },
    });
    expect(limited.headers['retry-after']).toBe('60');
    expect(limited.headers.ratelimit).toBeDefined();
  });
});
