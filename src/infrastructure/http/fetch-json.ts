import { UpstreamUnavailableError } from '../../application/errors';

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Minimal JSON fetch with timeout using Node's built-in fetch (no axios needed).
 * Network errors and timeouts become UpstreamUnavailableError; non-2xx responses
 * become HttpStatusError so callers can treat e.g. 400 "no data" specially.
 */
export async function fetchJson<T = unknown>(
  source: string,
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'activity-forecast/0.1 (take-home exercise)',
        ...init.headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new UpstreamUnavailableError(source, (err as Error).message);
  }
  if (!res.ok)
    throw new HttpStatusError(res.status, await res.text().catch(() => ''));
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new UpstreamUnavailableError(
      source,
      `invalid JSON: ${(err as Error).message}`,
    );
  }
}

/** Wrap anything thrown by an adapter so the application only sees UpstreamUnavailableError. */
export function asUpstreamError(
  source: string,
  err: unknown,
): UpstreamUnavailableError {
  return err instanceof UpstreamUnavailableError
    ? err
    : new UpstreamUnavailableError(source, (err as Error).message);
}
