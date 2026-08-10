import { timingSafeEqual } from "node:crypto";

export type CronAuthResult = "ok" | "misconfigured" | "unauthorized";

/**
 * Cron credentials must stay in the Authorization header. Query-string
 * secrets are routinely copied into access logs, proxy logs, and history.
 */
export function checkCronAuthorization(request: Request): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return "misconfigured";

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return "unauthorized";

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const received = Buffer.from(authHeader);
  // timingSafeEqual throws on unequal-length buffers, and the length itself is
  // not a secret worth protecting, so compare it plainly first. Without this
  // guard a short token would surface as a 500 instead of a 401.
  if (expected.length !== received.length) return "unauthorized";

  return timingSafeEqual(expected, received) ? "ok" : "unauthorized";
}
