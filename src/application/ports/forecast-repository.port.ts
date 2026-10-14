import { Location } from '../../domain';

export const FORECAST_REPOSITORY = Symbol('FORECAST_REPOSITORY');

export interface ForecastSnapshot {
  locationKey: string;
  weatherRaw: unknown;
  /** null = no marine data for this location. */
  marineRaw: unknown | null;
  fetchedAt: Date;
}

export interface SkiTerrainRecord {
  locationKey: string;
  hasSkiArea: boolean;
  checkedAt: Date;
}

/** Persistence for everything we fetch, so requests rarely hit upstream APIs. */
export interface ForecastRepositoryPort {
  findGeocode(queryKey: string): Promise<Location | null>;
  saveGeocode(queryKey: string, location: Location): Promise<void>;
  findSnapshot(locationKey: string): Promise<ForecastSnapshot | null>;
  saveSnapshot(snapshot: ForecastSnapshot): Promise<void>;
  findSkiTerrain(locationKey: string): Promise<SkiTerrainRecord | null>;
  saveSkiTerrain(record: SkiTerrainRecord): Promise<void>;
}
