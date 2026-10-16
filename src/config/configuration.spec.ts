import { loadConfig } from './configuration';

describe('security configuration', () => {
  it('is secure for browsers and bounded by default while keeping local auth optional', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      corsAllowedOrigins: [],
      requestBodyLimit: '16kb',
      trustProxyHops: 0,
      rateLimitWindowMs: 60000,
      rateLimitMax: 60,
      authRequired: false,
      apiKeys: [],
      graphqlMaxDepth: 8,
      graphqlMaxAliases: 15,
      graphqlMaxRootFields: 4,
      graphqlMaxComplexity: 100,
      terrainLookupDeadlineMs: 3000,
    });
  });

  it('parses exact CORS origins and scoped API keys', () => {
    const config = loadConfig({
      AUTH_REQUIRED: 'true',
      CORS_ALLOWED_ORIGINS: 'https://app.example,https://admin.example',
      AUTH_API_KEYS_JSON: JSON.stringify([
        {
          subject: 'mobile-client',
          key: 'a-secure-test-key-with-at-least-32-characters',
          scopes: ['forecast:read', 'forecast:read'],
        },
      ]),
    });
    expect(config.corsAllowedOrigins).toEqual([
      'https://app.example',
      'https://admin.example',
    ]);
    expect(config.apiKeys).toEqual([
      {
        subject: 'mobile-client',
        key: 'a-secure-test-key-with-at-least-32-characters',
        scopes: ['forecast:read'],
      },
    ]);
  });

  it('fails closed when private mode has no key', () => {
    expect(() => loadConfig({ AUTH_REQUIRED: 'true' })).toThrow(
      'AUTH_REQUIRED=true requires at least one AUTH_API_KEYS_JSON entry',
    );
  });

  it.each([
    ['wildcard CORS', { CORS_ALLOWED_ORIGINS: 'https://*.example.com' }],
    ['CORS path', { CORS_ALLOWED_ORIGINS: 'https://app.example/path' }],
    ['large body', { REQUEST_BODY_LIMIT: '2mb' }],
    ['invalid depth', { GRAPHQL_MAX_DEPTH: '0' }],
    ['invalid boolean', { AUTH_REQUIRED: 'yes' }],
    [
      'whitespace in key',
      {
        AUTH_API_KEYS_JSON: JSON.stringify([
          {
            subject: 'bad-key',
            key: 'a key with whitespace that is over thirty-two characters',
            scopes: ['forecast:read'],
          },
        ]),
      },
    ],
  ])('rejects unsafe configuration: %s', (_name, env) => {
    expect(() => loadConfig(env)).toThrow();
  });
});
