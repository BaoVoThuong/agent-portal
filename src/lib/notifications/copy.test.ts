import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_COPY_TYPES,
  isSystemNotification,
  notificationActionText,
  notificationEntityId,
  notificationEntityKind,
  notificationHref,
  notificationSentence,
  type NotificationCopySource,
  type NotificationCopyType,
} from "./copy";

function notif(overrides: Partial<NotificationCopySource> = {}): NotificationCopySource {
  return { type: "commented", task_id: "task-1", ...overrides };
}

describe("mọi loại thông báo đều có câu chữ", () => {
  // Chuông và push đọc chung hàm này; một loại thiếu chữ là một dòng trống trên
  // màn hình người dùng, không phải lỗi ném ra.
  it("không loại nào trả về chuỗi rỗng, ở cả hai kiểu bản ghi", () => {
    for (const type of NOTIFICATION_COPY_TYPES) {
      for (const entity of ["task", "enrollment"] as const) {
        const text = notificationActionText(notif({ type, entity_type: entity }));
        expect(text.length, `${type}/${entity}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("phân biệt task và enrollment", () => {
  it("thiếu entity_type thì coi là task — dữ liệu ghi trước khi có enrollment", () => {
    expect(notificationEntityKind(notif())).toBe("task");
    expect(notificationEntityKind(notif({ entity_type: null }))).toBe("task");
    expect(notificationEntityKind(notif({ entity_type: "enrollment" }))).toBe("enrollment");
  });

  it("id lùi về task_id khi entity_id trống", () => {
    expect(notificationEntityId(notif())).toBe("task-1");
    expect(notificationEntityId(notif({ entity_id: "rec-9" }))).toBe("rec-9");
  });

  it("đường dẫn trỏ đúng màn hình", () => {
    expect(notificationHref(notif())).toBe("/tasks?task=task-1");
    expect(
      notificationHref(notif({ entity_type: "enrollment", entity_id: "rec-9" }))
    ).toBe("/enrollment?record=rec-9");
  });

  it("cùng một loại nhưng chữ khác nhau giữa hai kiểu bản ghi", () => {
    expect(notificationActionText(notif({ type: "assigned" }))).toContain("task");
    expect(
      notificationActionText(notif({ type: "assigned", entity_type: "enrollment" }))
    ).toContain("enrollment");
  });
});

describe("thông báo hệ thống không có người thực hiện", () => {
  const systemTypes: NotificationCopyType[] = [
    "overdue",
    "todo_reminder",
    "overdue_reminder",
    "waiting_reminder",
    "due_soon",
    "stale",
    "qc_stale",
    "sla_escalated",
  ];

  it("nhận diện đúng loại do cron sinh ra", () => {
    for (const type of systemTypes) {
      expect(isSystemNotification(notif({ type })), type).toBe(true);
    }
    expect(isSystemNotification(notif({ type: "commented" }))).toBe(false);
  });

  it("không ghép tên người vào câu của hệ thống", () => {
    // Nếu ghép sẽ ra "Ann Strambler Task is still overdue".
    expect(notificationSentence(notif({ type: "overdue_reminder" }), "Ann Strambler")).toBe(
      "Task is still overdue — reminder"
    );
  });

  it("ghép tên người cho thông báo do người khác gây ra", () => {
    expect(notificationSentence(notif({ type: "mentioned" }), "Ann Strambler")).toBe(
      "Ann Strambler tagged you in a comment"
    );
  });

  it("không có tên người thì vẫn ra câu đọc được", () => {
    expect(notificationSentence(notif({ type: "mentioned" }), "   ")).toBe(
      "tagged you in a comment"
    );
  });
});
