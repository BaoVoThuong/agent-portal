/**
 * Small, side-effect-free helpers used by Config refreshers.
 *
 * Refresh requests are intentionally not retried here. A caller owns the
 * request sequence for its data family and uses these helpers to reject stale
 * responses and to turn malformed/error responses into safe copy.
 */

export function isLatestRefresh(requestSequence: number, currentSequence: number): boolean {
  return requestSequence === currentSequence;
}

export function safeRefreshErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const message = (payload as { error?: unknown }).error;
  if (typeof message !== "string") return fallback;
  const trimmed = message.trim();
  return trimmed.length > 0 && trimmed.length <= 240 ? trimmed : fallback;
}

export async function readRefreshResponse<T>(
  response: Response,
  fallback: string
): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(safeRefreshErrorMessage(payload, fallback));
  }
  return payload as T;
}
