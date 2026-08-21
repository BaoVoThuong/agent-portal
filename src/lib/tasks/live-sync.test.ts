import { describe, expect, it } from "vitest";
import {
  authoritativeTaskSnapshot,
  canRefreshTaskData,
  TASK_DEGRADED_RECONCILE_MS,
  TASK_LIVE_RECONCILE_MS,
  mergeTaskReconcileScope,
  taskBroadcastReconcileScope,
  taskInvalidationReconcileScope,
  taskLivePollInterval,
  taskRefetchDisposition,
} from "./live-sync";

describe("task list refetch policy", () => {
  it("applies a current server snapshot", () => {
    expect(
      taskRefetchDisposition({
        writeVersionAtStart: 4,
        currentWriteVersion: 4,
        pendingMutationCount: 0,
      }),
    ).toBe("apply");
  });

  it("lets the server row replace a recently rendered local row", () => {
    const local = { id: "task-1", status: "todo", comment_count: 0 };
    const remote = { id: "task-1", status: "done", comment_count: 1 };

    expect(authoritativeTaskSnapshot([local], [remote])).toEqual([remote]);
  });

  it("retries when a local write completed during the request", () => {
    expect(
      taskRefetchDisposition({
        writeVersionAtStart: 7,
        currentWriteVersion: 8,
        pendingMutationCount: 0,
      }),
    ).toBe("retry");
  });

  it("defers while a direct mutation is still open", () => {
    expect(
      taskRefetchDisposition({
        writeVersionAtStart: 7,
        currentWriteVersion: 8,
        pendingMutationCount: 1,
      }),
    ).toBe("defer");
  });

});

describe("task live-sync self healing", () => {
  it("reconciles less often while realtime is healthy", () => {
    expect(taskLivePollInterval("live")).toBe(TASK_LIVE_RECONCILE_MS);
    expect(taskLivePollInterval("connecting")).toBe(
      TASK_DEGRADED_RECONCILE_MS,
    );
    expect(taskLivePollInterval("degraded")).toBe(
      TASK_DEGRADED_RECONCILE_MS,
    );
  });

  it("only refreshes a foreground tab with network access", () => {
    expect(canRefreshTaskData("visible", true)).toBe(true);
    expect(canRefreshTaskData("hidden", true)).toBe(false);
    expect(canRefreshTaskData("visible", false)).toBe(false);
  });
});

describe("task reconcile scope", () => {
  it("ignores a board's own document invalidation", () => {
    expect(
      taskInvalidationReconcileScope(
        { origin: "document", taskId: "t1", sourceId: "board-a" },
        "board-a",
      ),
    ).toBeNull();
  });

  it("keeps sibling-document task changes scoped and storage broad", () => {
    expect(
      taskInvalidationReconcileScope(
        { origin: "document", taskId: "t1", sourceId: "drawer-a" },
        "board-a",
      ),
    ).toBe("tasks-only");
    expect(
      taskInvalidationReconcileScope({ origin: "storage" }, "board-a"),
    ).toBe("full");
  });

  it("ignores the matching server echo but refreshes other tabs", () => {
    expect(taskBroadcastReconcileScope("board-a", "board-a")).toBeNull();
    expect(taskBroadcastReconcileScope("board-a", "board-b")).toBe(
      "tasks-only",
    );
    expect(taskBroadcastReconcileScope(undefined, "board-b")).toBe(
      "tasks-only",
    );
  });

  it("lets a full reconcile dominate coalesced task-only work", () => {
    expect(mergeTaskReconcileScope(null, "tasks-only")).toBe("tasks-only");
    expect(mergeTaskReconcileScope("tasks-only", "full")).toBe("full");
    expect(mergeTaskReconcileScope("full", "tasks-only")).toBe("full");
  });
});
