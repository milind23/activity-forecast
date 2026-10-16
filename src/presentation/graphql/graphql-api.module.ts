import { join } from 'path';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ApplicationModule } from '../../application/application.module';
import { ActivityForecastResolver } from './activity-forecast.resolver';
import { ApplicationErrorFilter } from './application-error.filter';
import { AppConfig } from '../../config/configuration';
import { createQueryLimitsRule } from './query-limits';
import { ApiKeyAuthGuard } from '../security/api-key-auth.guard';
import { SecurityErrorFilter } from '../security/security-error.filter';

@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const cfg = config.getOrThrow<AppConfig>('app');
        return {
          // Code-first: the SDL is generated from the TS classes and written out for reviewers.
          autoSchemaFile:
            process.env.NODE_ENV === 'test'
              ? true
              : join(process.cwd(), 'schema.gql'),
          sortSchema: true,
          // Keep the local GraphiQL explorer and introspection out of production.
          graphiql: process.env.NODE_ENV !== 'production',
          introspection: process.env.NODE_ENV !== 'production',
          includeStacktraceInErrorResponses: false,
          csrfPrevention: true,
          allowBatchedHttpRequests: false,
          validationRules: [
            createQueryLimitsRule({
              maxDepth: cfg.graphqlMaxDepth,
              maxAliases: cfg.graphqlMaxAliases,
              maxRootFields: cfg.graphqlMaxRootFields,
              maxComplexity: cfg.graphqlMaxComplexity,
            }),
          ],
        };
      },
    }),
    ApplicationModule,
  ],
  providers: [
    ActivityForecastResolver,
    { provide: APP_FILTER, useClass: ApplicationErrorFilter },
    { provide: APP_FILTER, useClass: SecurityErrorFilter },
    { provide: APP_GUARD, useClass: ApiKeyAuthGuard },
  ],
})
export class GraphqlApiModule {}
