import { SkiArea } from '../../domain';

export const TERRAIN_PROVIDER = Symbol('TERRAIN_PROVIDER');

export interface TerrainProviderPort {
  /** Finds a concrete ski resort/downhill piste. Throws on upstream failure. */
  findSkiAreaNearby(
    latitude: number,
    longitude: number,
    radiusKm: number,
    countryCode?: string,
  ): Promise<SkiArea | null>;
}
