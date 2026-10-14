import { Location } from '../../domain';

export const GEOCODER = Symbol('GEOCODER');

export interface GeocoderPort {
  /** Top match, or null when nothing matches. Throws UpstreamUnavailableError on failure. */
  search(city: string, countryCode?: string): Promise<Location | null>;
}
