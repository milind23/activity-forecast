import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';
import { configureHttpSecurity } from './presentation/http/configure-http';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureHttpSecurity(app);
  app.enableShutdownHooks();
  const { port } = app.get(ConfigService).getOrThrow<AppConfig>('app');
  await app.listen(port);
  Logger.log(`GraphQL endpoint: http://localhost:${port}/graphql`, 'Bootstrap');
}
void bootstrap();
