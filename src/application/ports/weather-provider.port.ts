import { DailyWeather } from '../../domain';

export const WEATHER_PROVIDER = Symbol('WEATHER_PROVIDER');

/**
 * Raw payloads are stored verbatim and parsed at request time, so changing
 * the scoring (or which fields we read) never requires a refetch.
 */
export interface WeatherProviderPort {
  /** Throws UpstreamUnavailableError on failure. */
  fetchRaw(
    latitude: number,
    longitude: number,
    elevationM?: number,
  ): Promise<unknown>;
  parse(raw: unknown): DailyWeather[];
}
