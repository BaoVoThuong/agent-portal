/**
 * Câu chữ của một thông báo — dùng chung cho chuông trong web và cho Web Push.
 *
 * Trước 2026-09-10 những hàm này nằm trong `NotificationBell.tsx`, tức chỉ chạy
 * được ở client. Web Push cần title/body ngay lúc GỬI, mà việc gửi diễn ra ở
 * server — nếu chép lại một bản thứ hai thì chữ trong web và chữ ngoài màn hình
 * sẽ trôi lệch nhau theo từng lần ai đó sửa một vế.
 *
 * Toàn bộ file thuần: không I/O, không đụng DOM, import được từ cả hai phía.
 */

export type NotificationEntityKind = "task" | "enrollment";

/**
 * Danh sách loại thông báo mà giao diện biết cách diễn đạt.
 *
 * Gộp cả loại của task lẫn của enrollment vào một union vì người nhận chỉ có
 * MỘT cái chuông: hai nguồn đổ chung vào một danh sách.
 */
export const NOTIFICATION_COPY_TYPES = [
  "assigned",
  "mentioned",
  "commented",
  "reacted",
  "overdue",
  "todo_reminder",
  "overdue_reminder",
  "due_date_overdue",
  "due_date_overdue_reminder",
  "waiting_reminder",
  "unassigned",
  "reopened",
  "qc_needed",
  "due_soon",
  "stale",
  "overdue_unlocked",
  "qc_stale",
  "sla_escalated",
  "qc_reviewed",
  "cancelled",
  "attachment_added",
  "backlog_attention",
  "task_created",
  "stage_changed",
] as const;

export type NotificationCopyType = (typeof NOTIFICATION_COPY_TYPES)[number];

/**
 * Phần tối thiểu của một thông báo cần để dựng câu chữ và đường dẫn.
 *
 * Cố ý KHÔNG đòi cả bản ghi: người gửi push chỉ có bấy nhiêu trường trong tay
 * ngay lúc ghi thông báo, chưa kịp đọc lại từ database.
 */
export type NotificationCopySource = {
  type: NotificationCopyType;
  /** Thiếu thì coi là task — dữ liệu cũ ghi trước khi enrollment ra đời. */
  entity_type?: NotificationEntityKind | null;
  entity_id?: string | null;
  task_id: string;
};

export function notificationEntityKind(
  notification: NotificationCopySource
): NotificationEntityKind {
  return notification.entity_type === "enrollment" ? "enrollment" : "task";
}

export function notificationEntityId(notification: NotificationCopySource): string {
  return notification.entity_id ?? notification.task_id;
}

export function notificationEntityLabel(notification: NotificationCopySource): string {
  return notificationEntityKind(notification) === "enrollment" ? "Enrollment" : "Task";
}

/** Đường dẫn mở đúng bản ghi. Service worker dùng nguyên chuỗi này khi người dùng bấm. */
export function notificationHref(notification: NotificationCopySource): string {
  return notificationEntityKind(notification) === "enrollment"
    ? `/enrollment?record=${notificationEntityId(notification)}`
    : `/tasks?task=${notificationEntityId(notification)}`;
}

export function notificationActionText(notification: NotificationCopySource): string {
  const kind = notificationEntityKind(notification);
  switch (notification.type) {
    case "assigned":
      return kind === "enrollment"
        ? "assigned you to an enrollment record"
        : "assigned you to a task";
    case "mentioned":
      return "tagged you in a comment";
    case "commented":
      return kind === "enrollment"
        ? "commented on an enrollment record"
        : "commented on a task assigned to you";
    case "reacted":
      return kind === "enrollment"
        ? "reacted to your enrollment comment"
        : "reacted to your task comment";
    case "unassigned":
      return "removed you from a task";
    case "reopened":
      return kind === "enrollment" ? "reopened this enrollment record" : "reopened this task";
    case "qc_needed":
      return kind === "enrollment"
        ? "marked an enrollment record for QC"
        : "marked a closed task for QC";
    case "qc_reviewed":
      return kind === "enrollment" ? "QC checked this enrollment record" : "QC checked this task";
    case "cancelled":
      return "cancelled this task";
    case "attachment_added":
      return "added an attachment";
    case "backlog_attention":
      return "created an urgent/high backlog task";
    case "task_created":
      return "created a task";
    case "stage_changed":
      return "moved this enrollment record";
    case "overdue":
      return kind === "enrollment"
        ? "Enrollment due date is overdue"
        : "Task just went overdue";
    case "todo_reminder":
      return "Task is still in To Do";
    case "overdue_reminder":
      return "Task is still overdue — reminder";
    case "due_date_overdue":
      return "Task passed its due date";
    case "due_date_overdue_reminder":
      return "Task is still past its due date — reminder";
    case "waiting_reminder":
      return "Task is still waiting for follow-up";
    case "due_soon":
      return kind === "enrollment" ? "Enrollment is due soon" : "Task is due soon";
    case "stale":
      return "Task has had no activity";
    case "overdue_unlocked":
      return "resolved this overdue task (reason logged)";
    case "qc_stale":
      return kind === "enrollment"
        ? "Enrollment still needs QC — reminder"
        : "Task still needs QC — reminder";
    case "sla_escalated":
      return "SLA needs attention";
  }
}

/**
 * Thông báo do hệ thống (cron) sinh ra thì không "từ" ai cả.
 *
 * `notificationActionText` cho những loại này đã là một câu hoàn chỉnh, nên
 * người gọi phải bỏ phần tên người thực hiện ở đầu — nếu không sẽ ra
 * "Ann Strambler Task is still overdue".
 */
export function isSystemNotification(notification: NotificationCopySource): boolean {
  switch (notification.type) {
    case "overdue":
    case "todo_reminder":
    case "overdue_reminder":
    case "waiting_reminder":
    case "due_soon":
    case "stale":
    case "qc_stale":
    case "sla_escalated":
      return true;
    default:
      return false;
  }
}

/**
 * Một dòng hoàn chỉnh: "Ann Strambler tagged you in a comment", hoặc
 * "Task is still overdue — reminder" khi là thông báo hệ thống.
 */
export function notificationSentence(
  notification: NotificationCopySource,
  actorLabel: string
): string {
  const action = notificationActionText(notification);
  if (isSystemNotification(notification)) return action;
  const actor = actorLabel.trim();
  return actor ? `${actor} ${action}` : action;
}
