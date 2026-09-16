import {
  uniqueNotificationRecipients,
  uniqueNotificationRows,
  type NotificationInsertInput,
} from "./notifications";

/**
 * Các dòng thông báo lúc TẠO task — mỗi người nhận đúng MỘT dòng.
 *
 * Trước 16/09/2026 route dựng ba danh sách độc lập rồi chỉ gộp trùng khi CÙNG
 * loại (`uniqueNotificationRows` gộp theo recipient+task+type+actor+comment+
 * detail). Ai vừa có `task.manage` vừa là admin cũ, hoặc là agent của task, nằm
 * trong cả `task_created` lẫn `backlog_attention` và nhận hai dòng trong cùng
 * một giây — CS-237 (15/09/2026): 4 trên 12 người nhận đôi; 47 lần trong 21 ngày.
 *
 * Thứ tự ưu tiên, loại cụ thể hơn thắng:
 *   được giao việc  >  task gấp chưa ai nhận  >  có task mới.
 *
 * Hàm thuần: route tự tra danh sách người nhận rồi đưa vào đây.
 */
export function buildCreateTaskNotificationRows(input: {
  taskId: string;
  actorEmail: string;
  /** Người được giao ngay lúc tạo. */
  assignees: string[];
  /** Người có task.manage + agent của task. */
  createdRecipients: string[];
  /** Agent + phụ tá + admin; rỗng khi task không phải Backlog Urgent/High chưa ai nhận. */
  backlogAttentionRecipients: string[];
  priority: string;
}): NotificationInsertInput[] {
  const assigned = uniqueNotificationRecipients(input.assignees, [input.actorEmail]);
  const backlog = uniqueNotificationRecipients(input.backlogAttentionRecipients, [
    input.actorEmail,
    ...assigned,
  ]);
  const created = uniqueNotificationRecipients(input.createdRecipients, [
    input.actorEmail,
    ...assigned,
    ...backlog,
  ]);

  return uniqueNotificationRows([
    ...assigned.map((recipient) => ({
      recipient_email: recipient,
      task_id: input.taskId,
      type: "assigned" as const,
      actor_email: input.actorEmail,
    })),
    ...backlog.map((recipient) => ({
      recipient_email: recipient,
      task_id: input.taskId,
      type: "backlog_attention" as const,
      actor_email: input.actorEmail,
      detail: `${input.priority} backlog task needs assignment`,
    })),
    ...created.map((recipient) => ({
      recipient_email: recipient,
      task_id: input.taskId,
      type: "task_created" as const,
      actor_email: input.actorEmail,
    })),
  ]);
}
