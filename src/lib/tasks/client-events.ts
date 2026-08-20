import {
  clearCachedTaskDetails,
  invalidateTaskDetail,
} from "./detail-cache";

export const OPEN_TASK_EVENT = "agent-portal:open-task";
export const TASK_DATA_INVALIDATED_EVENT = "agent-portal:tasks-invalidated";
export const TASK_DATA_INVALIDATED_STORAGE_KEY =
  "eps.tasks.data-invalidated.v1";

type OpenTaskEventDetail = {
  taskId: string;
  commentId?: string;
};

export type TaskDataInvalidation = {
  origin: "document" | "storage";
  taskId?: string;
  sourceId?: string;
};

type PublishTaskDataInvalidationOptions = {
  taskId?: string;
  sourceId?: string;
};

export function createTaskDataInvalidationSourceId(prefix: string): string {
  const nonce =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return [prefix, Date.now().toString(36), nonce].join(":");
}

export function dispatchOpenTask(taskId: string, commentId?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenTaskEventDetail>(OPEN_TASK_EVENT, {
      detail: { taskId, commentId },
    })
  );
}

/**
 * Tell this document and sibling tabs that canonical task data changed.
 * Cross-tab storage carries only a unique nonce; task data is always re-read
 * through the authenticated API. The same-document event may include a task id
 * and component source id so local caches can be scoped and duplicate detail
 * refreshes can be skipped.
 */
export function publishTaskDataInvalidation(
  options: PublishTaskDataInvalidationOptions = {},
): void {
  if (typeof window === "undefined") return;
  if (options.taskId) invalidateTaskDetail(options.taskId);
  else clearCachedTaskDetails();
  window.dispatchEvent(
    new CustomEvent<PublishTaskDataInvalidationOptions>(
      TASK_DATA_INVALIDATED_EVENT,
      { detail: options },
    ),
  );
  try {
    const nonce =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
    window.localStorage.setItem(
      TASK_DATA_INVALIDATED_STORAGE_KEY,
      `${Date.now()}:${nonce}`,
    );
  } catch {
    // Current-tab delivery already happened. Realtime and periodic reconcile
    // remain the fallback when storage is unavailable.
  }
}

export function subscribeTaskDataInvalidation(
  listener: (invalidation: TaskDataInvalidation) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onCurrentDocument = (event: Event) => {
    const detail = (event as CustomEvent<PublishTaskDataInvalidationOptions>)
      .detail;
    listener({
      origin: "document",
      taskId: detail?.taskId,
      sourceId: detail?.sourceId,
    });
  };
  const onStorage = (event: StorageEvent) => {
    if (
      event.key === TASK_DATA_INVALIDATED_STORAGE_KEY &&
      event.newValue !== null
    ) {
      // Storage carries only a nonce, so invalidate every bounded in-memory
      // detail entry before notifying the receiving tab.
      clearCachedTaskDetails();
      listener({ origin: "storage" });
    }
  };
  window.addEventListener(TASK_DATA_INVALIDATED_EVENT, onCurrentDocument);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(TASK_DATA_INVALIDATED_EVENT, onCurrentDocument);
    window.removeEventListener("storage", onStorage);
  };
}

export function writeTaskDeepLink(
  taskId: string | null,
  mode: "push" | "replace" = "replace",
  commentId?: string | null
) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (taskId) {
    url.searchParams.set("task", taskId);
    if (commentId) {
      url.searchParams.set("comment", commentId);
    } else {
      url.searchParams.delete("comment");
    }
  } else {
    url.searchParams.delete("task");
    url.searchParams.delete("comment");
  }

  const nextHref = `${url.pathname}${url.search}${url.hash}`;
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextHref === currentHref) return;

  if (mode === "push") {
    window.history.pushState(window.history.state, "", nextHref);
    return;
  }

  window.history.replaceState(window.history.state, "", nextHref);
}
