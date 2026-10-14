/**
 * Coalesces concurrent calls for the same key into one in-flight promise.
 * Ten simultaneous requests for "Chamonix" => one upstream fetch.
 * In-process only; with several instances you'd want a distributed lock (see README).
 */
export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const p = fn().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }

  get size(): number {
    return this.inFlight.size;
  }
}
