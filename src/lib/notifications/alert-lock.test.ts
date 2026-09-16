import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_LOCK_HOLD_MS,
  claimNotificationAlert,
  type AlertLockManager,
} from "./alert-lock";

/** Web Locks giả với `ifAvailable`: tên đang bị giữ thì callback nhận null. */
function fakeLockManager(): AlertLockManager {
  const held = new Set<string>();
  return {
    request(name, _options, callback) {
      if (held.has(name)) return Promise.resolve(callback(null));
      held.add(name);
      return Promise.resolve(callback({ name })).finally(() => held.delete(name));
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("claimNotificationAlert", () => {
  it("chỉ tab đầu tiên giành được quyền báo cho một thông báo", async () => {
    vi.useFakeTimers();
    const locks = fakeLockManager();
    await expect(claimNotificationAlert("task:n1", locks)).resolves.toBe(true);
    await expect(claimNotificationAlert("task:n1", locks)).resolves.toBe(false);
  });

  it("thông báo khác thì giành riêng", async () => {
    vi.useFakeTimers();
    const locks = fakeLockManager();
    await expect(claimNotificationAlert("task:n1", locks)).resolves.toBe(true);
    await expect(claimNotificationAlert("task:n2", locks)).resolves.toBe(true);
  });

  it("nhả khoá sau thời gian giữ", async () => {
    vi.useFakeTimers();
    const locks = fakeLockManager();
    await claimNotificationAlert("task:n1", locks);
    await vi.advanceTimersByTimeAsync(ALERT_LOCK_HOLD_MS);
    await expect(claimNotificationAlert("task:n1", locks)).resolves.toBe(true);
  });

  it("trình duyệt không có Web Locks thì vẫn báo — thừa còn hơn mất", async () => {
    await expect(claimNotificationAlert("task:n1", null)).resolves.toBe(true);
  });

  it("Web Locks ném lỗi thì vẫn báo", async () => {
    const broken: AlertLockManager = {
      request: () => Promise.reject(new Error("boom")),
    };
    await expect(claimNotificationAlert("task:n1", broken)).resolves.toBe(true);
  });
});
