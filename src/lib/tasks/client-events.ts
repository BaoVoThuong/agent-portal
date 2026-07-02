export const OPEN_TASK_EVENT = "agent-portal:open-task";

type OpenTaskEventDetail = {
  taskId: string;
};

export function dispatchOpenTask(taskId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<OpenTaskEventDetail>(OPEN_TASK_EVENT, {
      detail: { taskId },
    })
  );
}

export function writeTaskDeepLink(
  taskId: string | null,
  mode: "push" | "replace" = "replace"
) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (taskId) {
    url.searchParams.set("task", taskId);
  } else {
    url.searchParams.delete("task");
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
