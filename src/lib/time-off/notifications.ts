import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fetchEmailsWithPermission } from "@/lib/rbac/permission-holders";
import { broadcastNotif } from "@/lib/tasks/realtime";

/**
 * Thông báo của Time Off.
 *
 * Đi theo đúng khuôn `enrollment_notifications`: mỗi module một bảng, chuông
 * đọc hết rồi trộn lại. KHÔNG nhồi vào `task_notifications` — bảng đó có
 * `task_id not null references tasks(id)`, muốn dùng chung phải nới cột đó
 * thành nullable, tức đụng vào đường thông báo bận nhất của cả ứng dụng để
 * phục vụ một module phụ.
 */

export type TimeOffNotificationType =
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled";

export type TimeOffNotificationInsertInput = {
  recipient_email: string;
  request_id: string;
  type: TimeOffNotificationType;
  actor_email: string;
  detail?: string | null;
};

function normalizeEmail(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

/**
 * Gộp trùng theo (đơn, người nhận, loại).
 *
 * Người vừa được chọn làm manager vừa có quyền duyệt sẽ lọt vào cả hai danh
 * sách người nhận. Không gộp ở đây thì họ nhận hai thông báo giống hệt nhau
 * cho cùng một đơn — và index duy nhất dưới database sẽ làm cả lượt insert
 * thất bại, kéo theo cả thao tác nộp đơn.
 */
export function uniqueTimeOffNotificationRows(
  rows: readonly TimeOffNotificationInsertInput[]
): TimeOffNotificationInsertInput[] {
  const seen = new Map<string, TimeOffNotificationInsertInput>();
  for (const row of rows) {
    const recipient = normalizeEmail(row.recipient_email);
    if (!recipient || !row.request_id) continue;
    const key = `${row.request_id}::${recipient}::${row.type}`;
    if (seen.has(key)) continue;
    seen.set(key, { ...row, recipient_email: recipient });
  }
  return [...seen.values()];
}

/**
 * Ai được báo khi có đơn nghỉ mới: manager được chọn + mọi người có quyền
 * duyệt. Loại chính người nộp — không ai cần tin nhắn báo về việc mình vừa làm.
 *
 * Quyết định của đội: chọn manager là để BÁO TIN, không giới hạn ai được
 * duyệt. Nên danh sách người duyệt vẫn là toàn bộ người có `timeoff.admin`,
 * y như trước.
 */
export async function resolveTimeOffRecipients(opts: {
  requesterEmail: string;
  managerEmail: string | null;
}): Promise<string[]> {
  const approvers = await fetchEmailsWithPermission(PERMISSIONS.TIME_OFF_ADMIN);
  const requester = normalizeEmail(opts.requesterEmail);
  return [
    ...new Set(
      [normalizeEmail(opts.managerEmail), ...approvers]
        .filter(Boolean)
        .filter((email) => email !== requester)
    ),
  ];
}

export async function insertTimeOffNotifications(
  rows: readonly TimeOffNotificationInsertInput[]
): Promise<void> {
  const uniqueRows = uniqueTimeOffNotificationRows(rows);
  if (uniqueRows.length === 0) return;

  const { error } = await getSupabaseAdmin()
    .from("time_off_notifications")
    .insert(
      uniqueRows.map((row) => ({
        recipient_email: row.recipient_email,
        request_id: row.request_id,
        type: row.type,
        actor_email: row.actor_email,
        detail: row.detail ?? null,
      }))
    );
  if (error) throw new Error(error.message);

  await broadcastNotif(uniqueRows.map((row) => row.recipient_email));
}

export type TimeOffDecision = "approve" | "reject" | "cancel";

/** Same wording as the "submitted" notice, so the bell reads alike for one request. */
export function timeOffRequestDetail(request: {
  total_days: number | string | null;
  start_date: string;
  end_date: string;
}): string {
  return `${request.total_days ?? "?"} ngày, ${request.start_date} → ${request.end_date}`;
}

/**
 * Who hears about a decision (2026-10-24; before this the three types were in
 * the CHECK constraint but nothing ever wrote them):
 * - approve / reject → the requester;
 * - cancel (only the requester can) → whoever was told about the submission:
 *   the chosen manager and every Time Off Admin.
 * The actor is never notified about their own action.
 */
export function timeOffDecisionRows(input: {
  decision: TimeOffDecision;
  requestId: string;
  actorEmail: string;
  requesterEmail: string;
  submissionRecipients: readonly string[];
  detail: string;
}): TimeOffNotificationInsertInput[] {
  const actor = normalizeEmail(input.actorEmail);
  const type: TimeOffNotificationType =
    input.decision === "approve" ? "approved" : input.decision === "reject" ? "rejected" : "cancelled";
  const recipients =
    input.decision === "cancel" ? input.submissionRecipients : [input.requesterEmail];
  return uniqueTimeOffNotificationRows(
    recipients
      .filter((email) => normalizeEmail(email) && normalizeEmail(email) !== actor)
      .map((email) => ({
        recipient_email: email,
        request_id: input.requestId,
        type,
        actor_email: actor,
        detail: input.detail,
      })),
  );
}

/** Loads the request's people and writes the decision notifications. Callers run it after the response. */
export async function notifyTimeOffDecision(input: {
  decision: TimeOffDecision;
  requestId: string;
  actorEmail: string;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data: request, error } = await supabase
    .from("time_off_requests")
    .select("id,requester_id,manager_id,start_date,end_date,total_days")
    .eq("id", input.requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!request) return;
  const row = request as {
    requester_id: string;
    manager_id: string | null;
    start_date: string;
    end_date: string;
    total_days: number | string | null;
  };
  const accountIds = [row.requester_id, row.manager_id].filter((id): id is string => Boolean(id));
  const { data: accounts, error: accountError } = await supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .select("id,email")
    .in("id", accountIds);
  if (accountError) throw new Error(accountError.message);
  const emailById = new Map(
    ((accounts ?? []) as { id: string; email: string }[]).map((account) => [account.id, account.email]),
  );
  const requesterEmail = emailById.get(row.requester_id);
  if (!requesterEmail) return;

  const submissionRecipients =
    input.decision === "cancel"
      ? await resolveTimeOffRecipients({
          requesterEmail,
          managerEmail: row.manager_id ? emailById.get(row.manager_id) ?? null : null,
        })
      : [];
  await insertTimeOffNotifications(
    timeOffDecisionRows({
      decision: input.decision,
      requestId: input.requestId,
      actorEmail: input.actorEmail,
      requesterEmail,
      submissionRecipients,
      detail: timeOffRequestDetail(row),
    }),
  );
}
