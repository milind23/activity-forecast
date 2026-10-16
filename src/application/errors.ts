/** Application-level errors; the presentation layer maps them to GraphQL errors. */
export class CityNotFoundError extends Error {
  constructor(
    readonly city: string,
    readonly country?: string,
  ) {
    super(`City not found: "${city}"${country ? ` in ${country}` : ''}`);
    this.name = 'CityNotFoundError';
  }
}

export class InvalidCountryError extends Error {
  constructor(readonly country: string) {
    super(
      `Country not recognized: "${country}". Use an English country name or ISO alpha-2/alpha-3 code.`,
    );
    this.name = 'InvalidCountryError';
  }
}

export class UpstreamUnavailableError extends Error {
  constructor(
    readonly source: string,
    readonly causeMessage?: string,
  ) {
    super(
      `Upstream service unavailable: ${source}${causeMessage ? ` (${causeMessage})` : ''}`,
    );
    this.name = 'UpstreamUnavailableError';
  }
}
