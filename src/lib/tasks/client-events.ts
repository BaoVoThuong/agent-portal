export const OPEN_TASK_EVENT = "agent-portal:open-task";

type OpenTaskEventDetail = {
  taskId: string;
  commentId?: string;
};

export function dispatchOpenTask(taskId: string, commentId?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenTaskEventDetail>(OPEN_TASK_EVENT, {
      detail: { taskId, commentId },
    })
  );
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
