import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ErrorRequestHandler,
  json,
  Request,
  Response,
  urlencoded,
} from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { AppConfig } from '../../config/configuration';

/**
 * HTTP controls are configured before Nest registers its routes. Creating the
 * application with `{ bodyParser: false }` is therefore required.
 */
export function configureHttpSecurity(app: INestApplication): void {
  const cfg = app.get(ConfigService).getOrThrow<AppConfig>('app');
  const express = app.getHttpAdapter().getInstance();

  express.disable('x-powered-by');
  if (cfg.trustProxyHops > 0) express.set('trust proxy', cfg.trustProxyHops);
  else express.set('trust proxy', false);

  app.use(
    helmet({
      // TLS terminates at the supplied gateway. HSTS is intentionally not
      // emitted by the HTTP-only app because a mistaken setting is sticky in browsers.
      strictTransportSecurity: false,
      // GraphiQL contains inline assets in local development. It is disabled
      // in production, where a restrictive policy is safe.
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production'
          ? {
              directives: {
                defaultSrc: ["'none'"],
                baseUri: ["'none'"],
                frameAncestors: ["'none'"],
                formAction: ["'none'"],
              },
            }
          : false,
    }),
  );

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      // Non-browser clients do not send Origin. Browser origins must be exact
      // allow-list matches; an empty list disables cross-origin browser access.
      callback(
        null,
        origin === undefined || cfg.corsAllowedOrigins.includes(origin),
      );
    },
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After'],
    credentials: false,
    maxAge: 600,
  });

  app.use('/graphql', createGraphqlRateLimiter(cfg));
  app.use(
    json({
      limit: cfg.requestBodyLimit,
      type: ['application/json', 'application/*+json'],
    }),
  );
  app.use(
    urlencoded({
      limit: cfg.requestBodyLimit,
      extended: false,
      parameterLimit: 20,
    }),
  );
  const bodyParserErrorHandler: ErrorRequestHandler = (
    error,
    _req,
    res,
    next,
  ) => {
    const parserError = error as { status?: number; type?: string };
    if (
      parserError.status !== 413 &&
      parserError.type !== 'entity.parse.failed'
    ) {
      next(error);
      return;
    }
    const tooLarge = parserError.status === 413;
    res.status(tooLarge ? 413 : 400).json({
      errors: [
        {
          message: tooLarge
            ? 'Request body is too large'
            : 'Request body is not valid JSON',
          extensions: { code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST' },
        },
      ],
    });
  };
  app.use(bodyParserErrorHandler);

  if (process.env.NODE_ENV === 'production') {
    app.use('/graphql', (req: Request, res: Response, next: () => void) => {
      if (req.method === 'POST' || req.method === 'OPTIONS') return next();
      res.setHeader('Allow', 'POST, OPTIONS');
      res.status(405).json({
        errors: [
          {
            message: 'Only POST is accepted for GraphQL operations',
            extensions: { code: 'METHOD_NOT_ALLOWED' },
          },
        ],
      });
    });
  }
}

export function createGraphqlRateLimiter(cfg: AppConfig) {
  return rateLimit({
    windowMs: cfg.rateLimitWindowMs,
    limit: cfg.rateLimitMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    passOnStoreError: false,
    skip: (req) => req.method === 'OPTIONS',
    handler: (_req, res) => {
      const retryAfter = Math.ceil(cfg.rateLimitWindowMs / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        errors: [
          {
            message: 'Too many requests; retry later',
            extensions: {
              code: 'RATE_LIMITED',
              retryAfterSeconds: retryAfter,
            },
          },
        ],
      });
    },
  });
}
