import { Catch, Logger } from '@nestjs/common';
import { GqlExceptionFilter } from '@nestjs/graphql';
import {
  CityNotFoundError,
  UpstreamUnavailableError,
} from '../../application/errors';
import { toGraphQLError } from './error-mapping';

/**
 * Turns expected application errors into GraphQL errors with stable codes.
 * Using a filter (rather than try/catch in resolvers) keeps resolvers thin and
 * stops Nest logging client mistakes like "city not found" as server ERRORs.
 */
@Catch(CityNotFoundError, UpstreamUnavailableError)
export class ApplicationErrorFilter implements GqlExceptionFilter {
  private readonly logger = new Logger('GraphQL');

  catch(err: CityNotFoundError | UpstreamUnavailableError) {
    if (err instanceof UpstreamUnavailableError) this.logger.error(err.message);
    else this.logger.log(err.message);
    return toGraphQLError(err);
  }
}
