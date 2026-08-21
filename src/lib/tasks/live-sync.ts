export type TaskLiveStatus = "connecting" | "live" | "degraded";
export type TaskReconcileScope = "tasks-only" | "full";

type TaskInvalidationSignal = {
  origin: "document" | "storage";
  taskId?: string;
  sourceId?: string;
};

export const TASK_LIVE_EVENT_DEBOUNCE_MS = 300;
export const TASK_LIVE_REFRESH_THROTTLE_MS = 5_000;
export const TASK_LIVE_RECONCILE_MS = 60_000;
export const TASK_DEGRADED_RECONCILE_MS = 15_000;

export function mergeTaskReconcileScope(
  current: TaskReconcileScope | null,
  incoming: TaskReconcileScope,
): TaskReconcileScope {
  return current === "full" || incoming === "full" ? "full" : "tasks-only";
}

export function taskInvalidationReconcileScope(
  invalidation: TaskInvalidationSignal,
  ownSourceId: string,
): TaskReconcileScope | null {
  if (
    invalidation.origin === "document" &&
    invalidation.sourceId === ownSourceId
  ) {
    return null;
  }
  return invalidation.taskId ? "tasks-only" : "full";
}

export function taskBroadcastReconcileScope(
  sourceId: string | undefined,
  ownSourceId: string,
): TaskReconcileScope | null {
  if (sourceId === ownSourceId) return null;
  return "tasks-only";
}

export type TaskRefetchDisposition =
  | "defer"
  | "retry"
  | "apply";

export function taskRefetchDisposition({
  writeVersionAtStart,
  currentWriteVersion,
  pendingMutationCount,
}: {
  writeVersionAtStart: number;
  currentWriteVersion: number;
  pendingMutationCount: number;
}): TaskRefetchDisposition {
  if (pendingMutationCount > 0) return "defer";
  if (writeVersionAtStart !== currentWriteVersion) return "retry";
  return "apply";
}

/**
 * A full-list response is authoritative once the request-race guards above
 * allow it to apply. In particular, do not retain a row just because this tab
 * wrote it recently: that can permanently discard a newer remote update.
 */
export function authoritativeTaskSnapshot<T>(
  _current: readonly T[],
  fetched: readonly T[],
): T[] {
  return fetched.slice();
}

export function taskLivePollInterval(status: TaskLiveStatus): number {
  return status === "live"
    ? TASK_LIVE_RECONCILE_MS
    : TASK_DEGRADED_RECONCILE_MS;
}

export function canRefreshTaskData(
  visibilityState: string,
  online: boolean,
): boolean {
  return visibilityState === "visible" && online;
}
