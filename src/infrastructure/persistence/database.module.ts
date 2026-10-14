import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../../config/configuration';
import { ENTITIES } from './entities';

/**
 * SQLite through sql.js (WASM): zero native dependencies, the file is created
 * on first write. DATABASE_PATH=":memory:" gives a throwaway DB (used by e2e).
 *
 * synchronize=true is deliberate for a take-home: the schema is three cache
 * tables whose contents can always be refetched. In production: migrations.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { databasePath } = config.getOrThrow<AppConfig>('app');
        const inMemory = databasePath === ':memory:';
        if (!inMemory) mkdirSync(dirname(databasePath), { recursive: true });
        return {
          type: 'sqljs' as const,
          location: inMemory ? undefined : databasePath,
          autoSave: !inMemory,
          entities: ENTITIES,
          synchronize: true,
        };
      },
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
