import { describe, expect, it } from "vitest";
import { buildCreateTaskNotificationRows } from "@/lib/tasks/create-notifications";
import type { NotificationInsertInput } from "@/lib/tasks/notifications";

function typesFor(rows: NotificationInsertInput[], email: string) {
  return rows.filter((row) => row.recipient_email === email).map((row) => row.type);
}

const managers = ["khang@x.com", "bao@x.com", "nam@x.com", "linh@x.com", "kay@x.com"];

describe("buildCreateTaskNotificationRows", () => {
  // Tái hiện CS-237 (15/09/2026): Huy tạo task High ở Backlog, agent là Ann.
  // Khang/Bao/Nam có task.manage VÀ là admin cũ; Ann là agent — cả bốn từng
  // nhận hai dòng trong cùng một giây.
  it("người nằm trong cả hai danh sách chỉ nhận backlog_attention", () => {
    const rows = buildCreateTaskNotificationRows({
      taskId: "t1",
      actorEmail: "huy@x.com",
      assignees: [],
      createdRecipients: [...managers, "ann@x.com"],
      backlogAttentionRecipients: [
        "ann@x.com",
        "thao@x.com",
        "khang@x.com",
        "bao@x.com",
        "nam@x.com",
      ],
      priority: "high",
    });

    for (const email of ["khang@x.com", "bao@x.com", "nam@x.com", "ann@x.com"]) {
      expect(typesFor(rows, email), email).toEqual(["backlog_attention"]);
    }
    expect(typesFor(rows, "thao@x.com")).toEqual(["backlog_attention"]);
    expect(typesFor(rows, "linh@x.com")).toEqual(["task_created"]);

    const recipients = rows.map((row) => row.recipient_email);
    expect(new Set(recipients).size, "mỗi người đúng một dòng").toBe(recipients.length);
  });

  it("ghi mức ưu tiên vào detail của backlog_attention", () => {
    const [row] = buildCreateTaskNotificationRows({
      taskId: "t1",
      actorEmail: "huy@x.com",
      assignees: [],
      createdRecipients: [],
      backlogAttentionRecipients: ["ann@x.com"],
      priority: "urgent",
    });
    expect(row).toMatchObject({
      recipient_email: "ann@x.com",
      type: "backlog_attention",
      detail: "urgent backlog task needs assignment",
    });
  });

  it("người được giao lúc tạo chỉ nhận assigned, kể cả khi có task.manage", () => {
    const rows = buildCreateTaskNotificationRows({
      taskId: "t1",
      actorEmail: "huy@x.com",
      assignees: ["kay@x.com"],
      createdRecipients: managers,
      backlogAttentionRecipients: [],
      priority: "medium",
    });
    expect(typesFor(rows, "kay@x.com")).toEqual(["assigned"]);
    expect(typesFor(rows, "khang@x.com")).toEqual(["task_created"]);
  });

  it("không bao giờ báo cho chính người tạo", () => {
    const rows = buildCreateTaskNotificationRows({
      taskId: "t1",
      actorEmail: "khang@x.com",
      assignees: ["khang@x.com"],
      createdRecipients: managers,
      backlogAttentionRecipients: ["khang@x.com"],
      priority: "high",
    });
    expect(typesFor(rows, "khang@x.com")).toEqual([]);
  });

  it("task không gấp: người quản lý và agent nhận task_created", () => {
    const rows = buildCreateTaskNotificationRows({
      taskId: "t1",
      actorEmail: "huy@x.com",
      assignees: [],
      createdRecipients: ["linh@x.com", "ann@x.com"],
      backlogAttentionRecipients: [],
      priority: "medium",
    });
    expect(rows.map((row) => row.type)).toEqual(["task_created", "task_created"]);
  });
});
