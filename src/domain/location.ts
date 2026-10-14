/** A geocoded place. Plain value object, no framework dependencies. */
export interface Location {
  name: string;
  country: string;
  countryCode: string;
  /** First-level admin area (state/region), helps disambiguate e.g. Paris FR vs Paris US. */
  region?: string;
  latitude: number;
  longitude: number;
  /** IANA timezone, e.g. "Europe/Paris". Days are expressed in this zone. */
  timezone: string;
}

/**
 * Stable cache key for anything tied to a position (forecast, ski-area lookup).
 * Two decimals is ~1 km, far finer than the weather model grid.
 */
export function locationKey(
  loc: Pick<Location, 'latitude' | 'longitude'>,
): string {
  return `${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)}`;
}
