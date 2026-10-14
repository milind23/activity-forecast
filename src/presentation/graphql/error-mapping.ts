import { GraphQLError } from 'graphql';
import {
  CityNotFoundError,
  UpstreamUnavailableError,
} from '../../application/errors';

/** Stable machine-readable codes clients can switch on (extensions.code). */
export const ErrorCodes = {
  CITY_NOT_FOUND: 'CITY_NOT_FOUND',
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
  if (err instanceof UpstreamUnavailableError) {
    return new GraphQLError(
      'Weather data is temporarily unavailable and nothing is cached for this location yet. Please retry shortly.',
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
