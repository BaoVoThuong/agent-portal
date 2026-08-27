import type { LeadAlertSettings, LeadRow, LeadStatus } from "./types";

export type LeadAlert =
  | "never_contacted"
  | "stale"
  | "follow_up_overdue"
  | "exhausted";

/**
 * Đỏ = agent chưa làm phần việc của mình. Vàng = agent đã làm nhưng lead khó.
 * Phân biệt này quan trọng: gom chung một màu là đổ lỗi cho người gọi 4 lần
 * không ai nghe máy giống hệt người chưa bấm số bao giờ.
 */
export const ALERT_SEVERITY: Record<LeadAlert, "red" | "amber"> = {
  never_contacted: "red",
  stale: "red",
  follow_up_overdue: "red",
  exhausted: "amber",
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Hàm thuần, không I/O — đó là lý do không cần cron để "quét lead quá hạn".
 * Cờ là hàm của bốn cột đã lưu sẵn trên `leads` cộng settings cộng thời điểm
 * hiện tại, nên tính lúc đọc là đủ và luôn tươi.
 *
 * `status` nhận null khi lead trỏ tới một status admin đã xoá; coi như còn mở
 * để lead không im lặng biến mất khỏi màn hình manager.
 */
export function resolveLeadAlerts(
  lead: LeadRow,
  status: LeadStatus | null,
  settings: LeadAlertSettings,
  now: Date = new Date()
): LeadAlert[] {
  if (lead.archived_at) return [];
  if (status && (status.kind === "won" || status.kind === "lost")) return [];
  // Chưa giao thì không ai có lỗi.
  if (!lead.assigned_to_email || !lead.assigned_at) return [];

  const alerts: LeadAlert[] = [];
  const nowMs = now.getTime();

  if (!lead.first_contacted_at) {
    const assignedMs = Date.parse(lead.assigned_at);
    if (
      Number.isFinite(assignedMs) &&
      nowMs - assignedMs > settings.no_contact_hours * HOUR_MS
    ) {
      alerts.push("never_contacted");
    }
  } else if (lead.last_contacted_at) {
    const lastMs = Date.parse(lead.last_contacted_at);
    if (
      Number.isFinite(lastMs) &&
      nowMs - lastMs > settings.stale_days * DAY_MS
    ) {
      alerts.push("stale");
    }
  }

  if (lead.next_follow_up_at) {
    const dueMs = Date.parse(lead.next_follow_up_at);
    if (Number.isFinite(dueMs) && dueMs < nowMs) {
      alerts.push("follow_up_overdue");
    }
  }

  // contact_attempt_count chỉ tăng qua log_lead_interaction_atomic và chỉ khi
  // loại tương tác có counts_as_contact, nên chạm ngưỡng nghĩa là agent đã
  // thật sự thử đủ số lần. Không cần kiểm thêm first_contacted_at.
  if (lead.contact_attempt_count >= settings.max_attempts) {
    alerts.push("exhausted");
  }

  return alerts;
}
