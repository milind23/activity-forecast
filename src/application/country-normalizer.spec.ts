import { InvalidCountryError } from './errors';
import { normalizeCountryCode } from './country-normalizer';

describe('normalizeCountryCode', () => {
  it.each([
    ['India', 'IN'],
    ['INDIA', 'IN'],
    ['in', 'IN'],
    ['IND', 'IN'],
    ['USA', 'US'],
    ['United States', 'US'],
    ['UNITED STATES OF AMERICA', 'US'],
    ['U.S.A.', 'US'],
    ['United Kingdom', 'GB'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeCountryCode(input)).toBe(expected);
  });

  it('keeps an omitted country optional', () => {
    expect(normalizeCountryCode()).toBeUndefined();
  });

  it.each(['', 'Atlantis', 'ZZ'])(
    'rejects unrecognized country %p',
    (input) => {
      expect(() => normalizeCountryCode(input)).toThrow(InvalidCountryError);
    },
  );
});
