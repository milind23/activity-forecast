import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const { port } = app.get(ConfigService).getOrThrow<AppConfig>('app');
  await app.listen(port);
  Logger.log(
    `GraphQL ready: http://localhost:${port}/graphql (Apollo Sandbox)`,
    'Bootstrap',
  );
}
void bootstrap();
