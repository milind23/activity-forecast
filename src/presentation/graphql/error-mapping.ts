import { GraphQLError } from 'graphql';
import {
  CityNotFoundError,
  InvalidCountryError,
  UpstreamUnavailableError,
} from '../../application/errors';

/** Stable machine-readable codes clients can switch on (extensions.code). */
export const ErrorCodes = {
  CITY_NOT_FOUND: 'CITY_NOT_FOUND',
  INVALID_COUNTRY: 'INVALID_COUNTRY',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
} as const;

export function toGraphQLError(err: unknown): unknown {
  if (err instanceof CityNotFoundError) {
    return new GraphQLError(err.message, {
      extensions: {
        code: ErrorCodes.CITY_NOT_FOUND,
        city: err.city,
        country: err.country,
      },
    });
  }
  if (err instanceof InvalidCountryError) {
    return new GraphQLError(err.message, {
      extensions: {
        code: ErrorCodes.INVALID_COUNTRY,
        country: err.country,
      },
    });
  }
  if (err instanceof UpstreamUnavailableError) {
    return new GraphQLError(
      'Weather data is temporarily unavailable, and no stored forecast covers all seven requested dates. Please retry shortly.',
      {
        extensions: {
          code: ErrorCodes.UPSTREAM_UNAVAILABLE,
          source: err.source,
        },
      },
    );
  }
  return err;
}
