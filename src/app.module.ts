import { Module, ValidationPipe } from '@nestjs/common';
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
      }),
    },
  ],
})
export class AppModule {}
