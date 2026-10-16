import * as countries from 'i18n-iso-countries';
import { InvalidCountryError } from './errors';

/**
 * Convert a human-friendly English country name or ISO alpha-2/alpha-3 code
 * into the alpha-2 value expected by Open-Meteo.
 *
 * Examples: India -> IN, USA -> US, United States of America -> US.
 */
export function normalizeCountryCode(country?: string): string | undefined {
  if (country === undefined) return undefined;

  const value = country.trim();
  if (!value) throw new InvalidCountryError(country);

  const upper = value.toUpperCase();
  const alpha2 =
    (upper.length === 2 && countries.isValid(upper) ? upper : undefined) ??
    (upper.length === 3 ? countries.alpha3ToAlpha2(upper) : undefined) ??
    countries.getAlpha2Code(value, 'en');

  if (!alpha2) throw new InvalidCountryError(country);
  return alpha2;
}
