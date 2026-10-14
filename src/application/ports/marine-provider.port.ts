import { DailyMarine } from '../../domain';

export const MARINE_PROVIDER = Symbol('MARINE_PROVIDER');

export interface MarineProviderPort {
  /** Raw payload, or null when the location has no marine data (inland). */
  fetchRaw(latitude: number, longitude: number): Promise<unknown | null>;
  parse(raw: unknown): DailyMarine[];
}
