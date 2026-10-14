export const TERRAIN_PROVIDER = Symbol('TERRAIN_PROVIDER');

export interface TerrainProviderPort {
  /** Is there a ski resort / downhill piste within radiusKm? Throws on upstream failure. */
  hasSkiAreaNearby(
    latitude: number,
    longitude: number,
    radiusKm: number,
  ): Promise<boolean>;
}
