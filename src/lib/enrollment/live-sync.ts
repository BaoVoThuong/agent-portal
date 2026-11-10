export type EnrollmentLiveStatus = "connecting" | "live" | "degraded";
export type EnrollmentReconcileScope = "enrollments-only" | "full";

type EnrollmentInvalidationSignal = {
  origin: "document" | "storage";
  recordId?: string;
  sourceId?: string;
};

export const ENROLLMENT_LIVE_EVENT_DEBOUNCE_MS = 300;
export const ENROLLMENT_LIVE_REFRESH_THROTTLE_MS = 5_000;
export const ENROLLMENT_LIVE_RECONCILE_MS = 60_000;
export const ENROLLMENT_DEGRADED_RECONCILE_MS = 15_000;
/** The list is expensive: a Realtime outage must not multiply list requests. */
export const ENROLLMENT_LIST_RECONCILE_MS = ENROLLMENT_LIVE_RECONCILE_MS;
export const ENROLLMENT_OPTIONS_POLL_EVERY_TICKS = 5;

export const ENROLLMENT_REFETCH_REASONS = [
  "broadcast",
  "invalidation",
  "focus",
  "poll",
  "reconnect",
  "import",
  "parent",
  "retry",
  "other",
] as const;
export type EnrollmentRefetchReason = (typeof ENROLLMENT_REFETCH_REASONS)[number];

export function parseEnrollmentRefetchReason(value: string | null): EnrollmentRefetchReason {
  return (ENROLLMENT_REFETCH_REASONS as readonly string[]).includes(value ?? "")
    ? (value as EnrollmentRefetchReason)
    : "other";
}

export function mergeEnrollmentReconcileScope(
  current: EnrollmentReconcileScope | null,
  incoming: EnrollmentReconcileScope,
): EnrollmentReconcileScope {
  return current === "full" || incoming === "full" ? "full" : "enrollments-only";
}

export function enrollmentInvalidationReconcileScope(
  invalidation: EnrollmentInvalidationSignal,
  ownSourceId: string,
): EnrollmentReconcileScope | null {
  if (invalidation.origin === "document" && invalidation.sourceId === ownSourceId) {
    return null;
  }
  return invalidation.recordId ? "enrollments-only" : "full";
}

export function enrollmentBroadcastReconcileScope(
  sourceId: string | undefined,
  ownSourceId: string,
): EnrollmentReconcileScope | null {
  if (sourceId === ownSourceId) return null;
  return sourceId ? "enrollments-only" : "full";
}

export type EnrollmentRefetchDisposition = "defer" | "retry" | "apply";

export function enrollmentRefetchDisposition({
  writeVersionAtStart,
  currentWriteVersion,
  pendingMutationCount,
}: {
  writeVersionAtStart: number;
  currentWriteVersion: number;
  pendingMutationCount: number;
}): EnrollmentRefetchDisposition {
  if (pendingMutationCount > 0) return "defer";
  if (writeVersionAtStart !== currentWriteVersion) return "retry";
  return "apply";
}

export function enrollmentLivePollInterval(status: EnrollmentLiveStatus): number {
  return status === "live"
    ? ENROLLMENT_LIVE_RECONCILE_MS
    : ENROLLMENT_DEGRADED_RECONCILE_MS;
}

export function canRefreshEnrollmentData(
  visibilityState: string,
  online: boolean,
): boolean {
  return visibilityState === "visible" && online;
}

