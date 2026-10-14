import { BadRequestException, Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { GraphqlApiModule } from './presentation/graphql/graphql-api.module';

@Module({
  imports: [
    // .env is optional; every setting has a default (see .env.example).
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      cache: true,
    }),
    GraphqlApiModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        transform: true,
        forbidUnknownValues: true,
        // Surface the actual rule in the GraphQL error message, not "Bad Request Exception".
        exceptionFactory: (errors) =>
          new BadRequestException(
            errors
              .flatMap((e) => Object.values(e.constraints ?? {}))
              .join('; '),
          ),
      }),
    },
  ],
})
export class AppModule {}
