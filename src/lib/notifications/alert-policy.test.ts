import { describe, expect, it } from "vitest";
import {
  HIDDEN_TAB_CLAIM_DELAY_MS,
  alertClaimDelayMs,
  isDirectNotification,
  notificationAlertTag,
  shouldRenotify,
  shouldShowNativePopup,
} from "./alert-policy";

describe("tag gộp popup", () => {
  it("loại gọi đích danh có họ tag riêng, không bị bình luận cùng task đè mất", () => {
    expect(notificationAlertTag({ type: "mentioned", task_id: "t1" })).toBe("task:t1:direct");
    expect(notificationAlertTag({ type: "commented", task_id: "t1" })).toBe("task:t1:activity");
  });

  it("dùng đúng loại bản ghi và id", () => {
    expect(
      notificationAlertTag({
        type: "assigned",
        entity_type: "enrollment",
        entity_id: "r9",
        task_id: "r9",
      })
    ).toBe("enrollment:r9:direct");
  });

  it("chỉ loại gọi đích danh mới kêu lại khi thay thế popup cũ", () => {
    for (const type of ["mentioned", "assigned", "unassigned", "reopened"] as const) {
      expect(isDirectNotification(type), type).toBe(true);
      expect(shouldRenotify({ type }), type).toBe(true);
    }
    for (const type of ["commented", "waiting_reminder", "task_created"] as const) {
      expect(shouldRenotify({ type }), type).toBe(false);
    }
  });
});

describe("khi nào cái chuông tự bật popup hệ điều hành", () => {
  const base = {
    permission: "granted" as const,
    documentHasFocus: false,
    pushSubscribedOnThisDevice: false,
  };

  it("bật khi cửa sổ không focus và máy chưa có push", () => {
    expect(shouldShowNativePopup(base)).toBe(true);
  });

  it("không bật khi người dùng đang thao tác trên portal — toast đã báo", () => {
    expect(shouldShowNativePopup({ ...base, documentHasFocus: true })).toBe(false);
  });

  it("không bật khi máy có push — service worker lo, bật thêm là kêu hai lần", () => {
    expect(shouldShowNativePopup({ ...base, pushSubscribedOnThisDevice: true })).toBe(false);
  });

  it("không bật khi chưa được cấp quyền", () => {
    expect(shouldShowNativePopup({ ...base, permission: "default" })).toBe(false);
    expect(shouldShowNativePopup({ ...base, permission: null })).toBe(false);
  });
});

describe("tab nào giành quyền báo", () => {
  it("tab đang hiện giành ngay, tab ẩn chờ một nhịp", () => {
    expect(alertClaimDelayMs("visible")).toBe(0);
    expect(alertClaimDelayMs("hidden")).toBe(HIDDEN_TAB_CLAIM_DELAY_MS);
  });
});
