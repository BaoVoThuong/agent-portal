import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const insert = vi.fn(async () => ({ error: null as { message: string } | null }));
  return {
    insert,
    supabase: { from: vi.fn(() => ({ insert })) },
    broadcastNotif: vi.fn(async () => true),
    pushTask: vi.fn(async () => undefined),
    pushEnrollment: vi.fn(async () => undefined),
    after: vi.fn<(run: () => Promise<void>) => void>(),
  };
});

vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: () => mocks.supabase }));
vi.mock("@/lib/tasks/realtime", () => ({ broadcastNotif: mocks.broadcastNotif }));
vi.mock("@/lib/notifications/push-dispatch", () => ({
  pushForTaskNotifications: mocks.pushTask,
  pushForEnrollmentNotifications: mocks.pushEnrollment,
}));
vi.mock("next/server", () => ({ after: mocks.after }));

import { insertNotifications } from "./notifications";
import { insertEnrollmentNotifications } from "@/lib/enrollment/notifications";

const taskRow = {
  recipient_email: "agent@example.com",
  task_id: "task-1",
  type: "assigned" as const,
  actor_email: "cs@example.com",
};

const enrollmentRow = {
  recipient_email: "agent@example.com",
  record_id: "record-1",
  type: "assigned" as const,
  actor_email: "cs@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insert.mockResolvedValue({ error: null });
  mocks.broadcastNotif.mockResolvedValue(true);
  mocks.after.mockImplementation(() => undefined);
});

describe("insertNotifications delivery", () => {
  it("writes rows in the request and defers realtime and push to after()", async () => {
    await expect(insertNotifications([taskRow], { deliverAfterResponse: true })).resolves.toBe(true);

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastNotif).not.toHaveBeenCalled();
    expect(mocks.pushTask).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);

    // The deferred callback delivers directly, without scheduling another after().
    await mocks.after.mock.calls[0][0]();
    expect(mocks.broadcastNotif).toHaveBeenCalledWith(["agent@example.com"]);
    expect(mocks.pushTask).toHaveBeenCalledWith([taskRow]);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("still throws when writing the rows fails, so callers keep their warning", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "insert failed" } });

    await expect(insertNotifications([taskRow], { deliverAfterResponse: true })).rejects.toThrow(
      "insert failed",
    );
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("delivers inline when there is no request scope", async () => {
    mocks.after.mockImplementation(() => {
      throw new Error("after() was called outside a request scope");
    });

    await expect(insertNotifications([taskRow], { deliverAfterResponse: true })).resolves.toBe(true);
    expect(mocks.broadcastNotif).toHaveBeenCalledTimes(1);
  });

  it("keeps the old behaviour without the option: waits for the broadcast", async () => {
    mocks.broadcastNotif.mockResolvedValue(false);

    await expect(insertNotifications([taskRow])).resolves.toBe(false);
    expect(mocks.broadcastNotif).toHaveBeenCalledTimes(1);
  });

  it("logs a failed deferred broadcast instead of throwing", async () => {
    mocks.broadcastNotif.mockResolvedValue(false);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await insertNotifications([taskRow], { deliverAfterResponse: true });
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith("task.notification.delivery_failed", {
      taskIds: ["task-1"],
      stage: "broadcast",
    });
    error.mockRestore();
  });

  it("still sends browser push when deferred realtime throws", async () => {
    mocks.broadcastNotif.mockRejectedValue(new Error("topic secret missing"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await insertNotifications([taskRow], { deliverAfterResponse: true });
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();

    expect(mocks.pushTask).toHaveBeenCalledWith([taskRow]);
    expect(error).toHaveBeenCalledWith("task.notification.delivery_failed", {
      taskIds: ["task-1"],
      stage: "broadcast",
      error: "topic secret missing",
    });
    error.mockRestore();
  });
});

describe("insertEnrollmentNotifications delivery", () => {
  it("writes rows in the request and defers realtime and push to after()", async () => {
    await insertEnrollmentNotifications([enrollmentRow], {
      alreadyScoped: true,
      deliverAfterResponse: true,
    });

    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.broadcastNotif).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);

    await mocks.after.mock.calls[0][0]();
    expect(mocks.broadcastNotif).toHaveBeenCalledWith(["agent@example.com"]);
    expect(mocks.pushEnrollment).toHaveBeenCalledWith([enrollmentRow]);
  });

  it("still sends browser push when enrollment realtime throws", async () => {
    mocks.broadcastNotif.mockRejectedValue(new Error("topic secret missing"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await insertEnrollmentNotifications([enrollmentRow], {
      alreadyScoped: true,
      deliverAfterResponse: true,
    });
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();

    expect(mocks.pushEnrollment).toHaveBeenCalledWith([enrollmentRow]);
    expect(error).toHaveBeenCalledWith("enrollment.notification.delivery_failed", {
      recordIds: ["record-1"],
      stage: "broadcast",
      error: "topic secret missing",
    });
    error.mockRestore();
  });
});
