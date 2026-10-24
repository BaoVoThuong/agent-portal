/** The deployment this bundle was built for; empty outside Vercel. See next.config.ts. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

/**
 * A tab is out of date only when both sides know their deployment and they
 * differ; a missing id (local dev, a failed check) never raises the banner.
 */
export function isNewerDeployment(
  tabVersion: string | null | undefined,
  serverVersion: string | null | undefined,
): boolean {
  return Boolean(tabVersion && serverVersion && tabVersion !== serverVersion);
}
