/**
 * Share one database lookup per key across requests on the same server
 * instance for a short time.
 *
 * Every page and API route re-reads the same small, rarely changing rows
 * (the caller's RBAC access, the task agent list, a CS member's agents). From
 * Vercel each read is a network round trip to Supabase, and in October 2026
 * these three alone were ~50,000 calls a day for ~50 people.
 *
 * Concurrent callers share the in-flight Promise. A result is reused until
 * `ttlMs` passes, so a change made elsewhere shows up within `ttlMs`.
 * `invalidate` drops entries on this instance only; other instances catch up
 * when their entries expire. Results rejected by `keep` and rejected Promises
 * are never reused, so a failed read is retried by the next caller.
 */
export type SharedLookup<T> = {
  get(key: string): Promise<T>;
  invalidate(key?: string): void;
};

export function createSharedLookup<T>(
  load: (key: string) => Promise<T>,
  options: { ttlMs: number; keep?: (value: T) => boolean; now?: () => number },
): SharedLookup<T> {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { at: number; value: Promise<T> }>();

  const forget = (key: string, value: Promise<T>) => {
    if (entries.get(key)?.value === value) entries.delete(key);
  };

  return {
    get(key) {
      const hit = entries.get(key);
      if (hit && now() - hit.at < options.ttlMs) return hit.value;

      const value = load(key);
      entries.set(key, { at: now(), value });
      value.then(
        (result) => {
          if (options.keep && !options.keep(result)) forget(key, value);
        },
        () => forget(key, value),
      );
      return value;
    },
    invalidate(key) {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
  };
}
