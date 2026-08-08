export type CronAuthResult = "ok" | "misconfigured" | "unauthorized";

/**
 * Cron credentials must stay in the Authorization header. Query-string
 * secrets are routinely copied into access logs, proxy logs, and history.
 */
export function checkCronAuthorization(request: Request): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return "misconfigured";

  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}` ? "ok" : "unauthorized";
}
