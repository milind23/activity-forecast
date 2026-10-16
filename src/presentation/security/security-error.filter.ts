import { Catch } from '@nestjs/common';
import { GqlExceptionFilter } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';

/** Authentication failures are expected client errors, not server exceptions to log. */
@Catch(GraphQLError)
export class SecurityErrorFilter implements GqlExceptionFilter {
  catch(error: GraphQLError): GraphQLError {
    return error;
  }
}
