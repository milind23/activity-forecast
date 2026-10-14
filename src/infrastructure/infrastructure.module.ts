import { Module } from '@nestjs/common';
import {
  FORECAST_REPOSITORY,
  GEOCODER,
  MARINE_PROVIDER,
  TERRAIN_PROVIDER,
  WEATHER_PROVIDER,
} from '../application/ports';
import { OpenMeteoGeocoderAdapter } from './open-meteo/open-meteo-geocoder.adapter';
import { OpenMeteoWeatherAdapter } from './open-meteo/open-meteo-weather.adapter';
import { OpenMeteoMarineAdapter } from './open-meteo/open-meteo-marine.adapter';
import { OverpassTerrainAdapter } from './overpass/overpass-terrain.adapter';
import { DatabaseModule } from './persistence/database.module';
import { TypeOrmForecastRepository } from './persistence/typeorm-forecast.repository';

/** Binds every application port (DI token) to its concrete adapter. */
@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: GEOCODER, useClass: OpenMeteoGeocoderAdapter },
    { provide: WEATHER_PROVIDER, useClass: OpenMeteoWeatherAdapter },
    { provide: MARINE_PROVIDER, useClass: OpenMeteoMarineAdapter },
    { provide: TERRAIN_PROVIDER, useClass: OverpassTerrainAdapter },
    { provide: FORECAST_REPOSITORY, useClass: TypeOrmForecastRepository },
  ],
  exports: [
    GEOCODER,
    WEATHER_PROVIDER,
    MARINE_PROVIDER,
    TERRAIN_PROVIDER,
    FORECAST_REPOSITORY,
  ],
})
export class InfrastructureModule {}
