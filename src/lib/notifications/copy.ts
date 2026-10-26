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

export type NotificationEntityKind = "task" | "enrollment" | "time_off" | "provider";

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
  "record_created",
  "stage_changed",
  // Time Off: đơn xin nghỉ vừa được nộp, rồi kết quả của nó (2026-10-24).
  // "cancelled" dùng chung chữ với task, tách câu theo entity.
  "submitted",
  "approved",
  "rejected",
] as const;

export type NotificationCopyType = (typeof NOTIFICATION_COPY_TYPES)[number];

/**
 * `detail` mà cron ghi lên `waiting_reminder` khi task đang ở Billing.
 *
 * Billing dùng chung loại thông báo với Waiting (chung ngưỡng giờ trong Reminder
 * Setup). Thêm hẳn một loại mới nghĩa là một rollout sửa CHECK constraint trước
 * khi deploy — không đáng cho một câu chữ; một giá trị `detail` là đủ.
 */
export const WAITING_REMINDER_BILLING_DETAIL = "billing";

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
  /** Chi tiết của dòng thông báo. Hiện chỉ `waiting_reminder` đọc nó (Waiting hay Billing). */
  detail?: string | null;
};

export function notificationEntityKind(
  notification: NotificationCopySource
): NotificationEntityKind {
  if (notification.entity_type === "enrollment") return "enrollment";
  if (notification.entity_type === "time_off") return "time_off";
  if (notification.entity_type === "provider") return "provider";
  return "task";
}

export function notificationEntityId(notification: NotificationCopySource): string {
  return notification.entity_id ?? notification.task_id;
}

export function notificationEntityLabel(notification: NotificationCopySource): string {
  switch (notificationEntityKind(notification)) {
    case "enrollment":
      return "Enrollment";
    case "time_off":
      return "Time off";
    case "provider":
      return "Provider";
    default:
      return "Task";
  }
}

/** Đường dẫn mở đúng bản ghi, hoặc đúng mục Time Off. Service worker dùng nguyên chuỗi này khi người dùng bấm. */
export function notificationHref(notification: NotificationCopySource): string {
  switch (notificationEntityKind(notification)) {
    case "enrollment":
      return `/enrollment?record=${notificationEntityId(notification)}`;
    // Đơn nghỉ chờ duyệt nằm ở tab Approvals; đưa thẳng người duyệt tới đó
    // thay vì thả họ xuống màn hình "My leave" rồi tự đi tìm.
    case "time_off": {
      // Người nộp xem kết quả ở "My leave"; đơn bị huỷ không còn ở hàng chờ
      // duyệt nên người duyệt xem ở History; đơn mới thì tới hàng chờ duyệt.
      // Time Off chưa hỗ trợ chọn một đơn bằng URL; đừng tạo ?request= giả.
      if (notification.type === "approved" || notification.type === "rejected") {
        return "/time-off";
      }
      if (notification.type === "cancelled") return "/time-off?tab=history";
      return "/time-off?tab=approvals";
    }
    // Provider List mở đúng dialog của dòng đó (ProviderListClient đọc ?provider=,
    // tìm ở cả List lẫn Backlog). Dòng bị Reject đã archive, không còn dialog
    // nào để mở — đưa người gửi về tab Backlog.
    case "provider":
      // Một lượt nhập chỉ có một thông báo trỏ vào dòng đầu. Dòng đầu có thể
      // đã được duyệt trong khi các dòng còn lại vẫn chờ, nên mở tab Backlog.
      if (notification.type === "submitted" || notification.type === "rejected") {
        return "/tasks/providers?view=backlog";
      }
      return `/tasks/providers?provider=${notificationEntityId(notification)}`;
    default:
      return `/tasks?task=${notificationEntityId(notification)}`;
  }
}

export function notificationActionText(notification: NotificationCopySource): string {
  const kind = notificationEntityKind(notification);
  switch (notification.type) {
    case "record_created":
      return kind === "enrollment" ? "created a new enrollment record" : "created a new record";
    // Ba loại này dùng chung giữa Time Off và Backlog của Provider List
    // (2026-10-26); tách câu theo entity. Một lượt nhập nhiều dòng là MỘT thông
    // báo, `detail` mang số dòng.
    case "submitted": {
      if (kind !== "provider") return "gửi một đơn xin nghỉ";
      const count = Number(notification.detail);
      return count > 1
        ? `sent ${count} providers to the Backlog`
        : "sent a provider to the Backlog";
    }
    case "approved":
      if (kind !== "provider") return "duyệt đơn xin nghỉ của bạn";
      return notification.detail === "merged"
        ? "merged your Backlog submission into this provider"
        : "verified your provider into the list";
    case "rejected":
      return kind === "provider"
        ? "rejected your provider submission"
        : "từ chối đơn xin nghỉ của bạn";
    case "assigned":
      return kind === "enrollment"
        ? "assigned you to an enrollment record"
        : "assigned you to a task";
    case "mentioned":
      return "tagged you in a comment";
    case "commented":
      return kind === "enrollment"
        ? "commented on an enrollment record"
        // KHÔNG nói "assigned to you": người nhận gồm cả agent, participant và
        // reporter — phần lớn không phải người được giao task.
        : "commented on a task";
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
      return kind === "time_off" ? "huỷ đơn xin nghỉ" : "cancelled this task";
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
      return notification.detail === WAITING_REMINDER_BILLING_DETAIL
        ? "Task is still in Billing — reminder"
        : "Task is still waiting for follow-up";
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
    // Hai loại Due Date cũng do cron ghi (actor_email = "system"). Thiếu chúng ở
    // đây thì chuông và push hiện "system Task passed its due date".
    case "due_date_overdue":
    case "due_date_overdue_reminder":
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
