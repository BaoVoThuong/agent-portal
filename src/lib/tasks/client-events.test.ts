import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTaskDataInvalidationSourceId,
  publishTaskDataInvalidation,
  subscribeTaskDataInvalidation,
  TASK_DATA_INVALIDATED_STORAGE_KEY,
} from "./client-events";
import {
  getCachedTaskDetail,
  setCachedTaskDetail,
} from "./detail-cache";
import type { TaskDetail } from "./detail";

const emptyDetail: TaskDetail = {
  comments: [],
  commentsHasMore: false,
  activity: [],
  attachments: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeWindow() {
  return Object.assign(new EventTarget(), {
    localStorage: {
      setItem: vi.fn(),
    },
  });
}

describe("task data invalidation", () => {
  it("creates a different mutation source for each loaded tab", () => {
    const first = createTaskDataInvalidationSourceId("task-drawer");
    const second = createTaskDataInvalidationSourceId("task-drawer");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^task-drawer:[a-z0-9]+:.+/);
  });

  it("notifies the current document and publishes a cross-tab nonce", () => {
    const browser = fakeWindow();
    vi.stubGlobal("window", browser);
    const listener = vi.fn();
    const unsubscribe = subscribeTaskDataInvalidation(listener);

    setCachedTaskDetail("task-1", emptyDetail);
    publishTaskDataInvalidation({ taskId: "task-1", sourceId: "drawer-1" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      origin: "document",
      taskId: "task-1",
      sourceId: "drawer-1",
    });
    expect(getCachedTaskDetail("task-1")).toBeUndefined();
    expect(browser.localStorage.setItem).toHaveBeenCalledWith(
      TASK_DATA_INVALIDATED_STORAGE_KEY,
      expect.any(String),
    );
    unsubscribe();
  });

  it("reacts to the storage event emitted by a sibling tab", () => {
    const browser = fakeWindow();
    vi.stubGlobal("window", browser);
    const listener = vi.fn();
    const unsubscribe = subscribeTaskDataInvalidation(listener);
    const event = new Event("storage");
    Object.defineProperties(event, {
      key: { value: TASK_DATA_INVALIDATED_STORAGE_KEY },
      newValue: { value: "nonce" },
    });

    browser.dispatchEvent(event);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ origin: "storage" });
    unsubscribe();
  });

  it("is safe during server rendering", () => {
    vi.stubGlobal("window", undefined);
    expect(() => publishTaskDataInvalidation()).not.toThrow();
    expect(() => subscribeTaskDataInvalidation(() => {})).not.toThrow();
  });
});
