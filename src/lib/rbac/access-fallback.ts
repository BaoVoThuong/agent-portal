import type { UserAccess } from "@/lib/rbac/access";

/**
 * When the RBAC read fails because the database is stalled, reuse what this
 * server instance last read for the same email, if it is recent.
 *
 * Before 2026-11-07 a failed read meant "no permissions": during the 06/11
 * stalls every 401/403 in the Vercel log (215 of them) came from that, and
 * people were shown "No Access" or "Forbidden" with their roles intact.
 *
 * Only a successful read is remembered, and only for `maxAgeMs`. A read that
 * finds the account missing or inactive is not a failure: it replaces the
 * remembered value. `clear` runs with the RBAC invalidation, so a role change
 * made on this instance is never undone by the fallback.
 */
export type AccessFallback = {
  resolve(email: string, access: UserAccess): UserAccess;
  clear(): void;
};

export function createAccessFallback(options: {
  maxAgeMs: number;
  now?: () => number;
}): AccessFallback {
  const now = options.now ?? Date.now;
  const lastGood = new Map<string, { at: number; access: UserAccess }>();

  return {
    resolve(email, access) {
      if (!access.unavailable) {
        if (access.userId !== null) lastGood.set(email, { at: now(), access });
        else lastGood.delete(email);
        return access;
      }
      const remembered = lastGood.get(email);
      if (remembered && now() - remembered.at <= options.maxAgeMs) {
        return remembered.access;
      }
      return access;
    },
    clear() {
      lastGood.clear();
    },
  };
}
