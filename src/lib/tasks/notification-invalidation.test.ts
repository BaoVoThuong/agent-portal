import { describe, expect, it } from "vitest";
import { resolveNotificationInvalidation } from "./notification-invalidation";

describe("resolveNotificationInvalidation", () => {
  it("returns nothing without a task notification", () => {
    expect(
      resolveNotificationInvalidation([{ kind: "enrollment", id: "e1" }]),
    ).toBeNull();
    expect(resolveNotificationInvalidation([])).toBeNull();
  });

  it("scopes a batch containing one unique task", () => {
    expect(
      resolveNotificationInvalidation([
        { kind: "task", id: "t1" },
        { kind: "task", id: "t1" },
        { kind: "enrollment", id: "e1" },
      ]),
    ).toEqual({ taskId: "t1" });
  });

  it("invalidates broadly when several tasks occur in one batch", () => {
    expect(
      resolveNotificationInvalidation([
        { kind: "task", id: "t1" },
        { kind: "task", id: "t2" },
      ]),
    ).toEqual({});
  });

  // Đơn nghỉ phép không liên quan gì tới bảng task, nên không được phép làm
  // mới drawer task đang mở.
  it("ignores time-off notifications entirely", () => {
    expect(
      resolveNotificationInvalidation([{ kind: "time_off", id: "r1" }]),
    ).toBeNull();
    expect(
      resolveNotificationInvalidation([
        { kind: "task", id: "t1" },
        { kind: "time_off", id: "r1" },
      ]),
    ).toEqual({ taskId: "t1" });
  });
});
