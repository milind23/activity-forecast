import { join } from 'path';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { ApplicationModule } from '../../application/application.module';
import { ActivityForecastResolver } from './activity-forecast.resolver';
import { EXAMPLE_QUERY } from './example-query';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      // Code-first: the SDL is generated from the TS classes and written out for reviewers.
      autoSchemaFile:
        process.env.NODE_ENV === 'test'
          ? true
          : join(process.cwd(), 'schema.gql'),
      sortSchema: true,
      playground: false,
      introspection: true,
      includeStacktraceInErrorResponses: false,
      plugins: [
        ApolloServerPluginLandingPageLocalDefault({
          embed: true,
          document: EXAMPLE_QUERY,
          includeCookies: false,
        }),
      ],
    }),
    ApplicationModule,
  ],
  providers: [ActivityForecastResolver],
})
export class GraphqlApiModule {}
