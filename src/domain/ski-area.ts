export type SkiAreaStatus = 'nearby' | 'none' | 'unknown';

export enum SkiAreaSource {
  CURATED_CATALOG = 'CURATED_CATALOG',
  OPENSTREETMAP = 'OPENSTREETMAP',
}

export enum SkiOperatingStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  UNKNOWN = 'UNKNOWN',
}

/** A concrete ski venue and the mountain point used for its forecast. */
export interface SkiArea {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Representative ski elevation; null lets Open-Meteo use its DEM. */
  forecastElevationM: number | null;
  source: SkiAreaSource;
  /** Provenance page for the venue record; not necessarily live operations. */
  sourceUrl?: string | null;
  operatingStatus: SkiOperatingStatus;
  /** Official page a user should check before purchasing. */
  operationsUrl: string | null;
}
