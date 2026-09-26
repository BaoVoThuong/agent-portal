import { getSupabaseAdmin } from "@/lib/supabase";
import { broadcastNotif } from "./realtime";

export const TASK_NOTIFICATION_TYPES = [
  "assigned",
  "mentioned",
  "commented",
  "reacted",
  "overdue",
  "todo_reminder",
  "overdue_reminder",
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
  // Hạn cứng do admin đặt (Due Date). Tách khỏi 'overdue'/'overdue_reminder'
  // của SLA: một task có thể vỡ cái này mà không vỡ cái kia, và người đọc
  // thông báo cần biết mình đang vỡ cái nào.
  "due_date_overdue",
  "due_date_overdue_reminder",
] as const;

export type TaskNotificationType = (typeof TASK_NOTIFICATION_TYPES)[number];

export type CommentNotification = { email: string; type: "mentioned" | "commented" };
export type NotificationInsertInput = {
  recipient_email: string;
  task_id: string;
  type: TaskNotificationType;
  actor_email: string;
  comment_id?: string | null;
  detail?: string | null;
};

// Who to notify for a new comment: mentioned users (minus the author), plus the
// task's assignees as 'commented' (unless they are the author or already mentioned).
//
// Agent của task KHÔNG nằm trong danh sách này từ 16/09/2026: agent đọc 0% trong
// 2.019 dòng `commented` họ nhận suốt 14 ngày, mà đó là luồng ồn nhất hệ thống.
// Agent vẫn nhận khi bị @ đích danh, và vẫn nhận nếu họ là participant — tức đã
// từng được nhắc tên hoặc được thêm vào task.
export function resolveCommentRecipients(
  task: {
    assignees?: string[];
    assignee_email?: string | null;
    participants?: string[];
    reporter_email?: string | null;
  },
  authorEmail: string,
  mentions: string[]
): CommentNotification[] {
  const mentionSet = new Set(
    mentions.map((m) => m.trim()).filter((m) => m && m !== authorEmail)
  );
  const out: CommentNotification[] = [...mentionSet].map((email) => ({
    email,
    type: "mentioned",
  }));

  const assignees =
    task.assignees && task.assignees.length > 0
      ? task.assignees
      : task.assignee_email
        ? [task.assignee_email]
        : [];
  const commentTargets = [
    ...assignees,
    ...(task.participants ?? []),
    task.reporter_email ?? "",
  ];
  for (const email of [...new Set(commentTargets)]) {
    if (email && email !== authorEmail && !mentionSet.has(email)) {
      out.push({ email, type: "commented" });
    }
  }
  return out;
}

/**
 * Loại thông báo gửi được cho người VỪA mất quan hệ với task: "bạn không còn được
 * giao task này" — họ đã thấy task tới giây trước, và đây là tin họ cần.
 */
const NOTIFY_WITHOUT_VIEW: ReadonlySet<TaskNotificationType> = new Set(["unassigned"]);

/**
 * Chỉ giữ dòng mà người nhận XEM ĐƯỢC task (Phase F, D17) — một chỗ cho mọi
 * producer: comment, giao việc, backlog, cron quá hạn, QC… Trước đây mỗi
 * producer tự chọn người nhận và chỉ vài đường có lọc (A5), nên ví dụ admin
 * không có quyền task vẫn nhận tiêu đề task qua backlog_attention (review A,
 * P1-03).
 *
 * Fail-closed: không xác định được quyền thì KHÔNG gửi dòng nào (ghi log).
 */
async function keepTaskViewers(
  rows: NotificationInsertInput[]
): Promise<NotificationInsertInput[]> {
  const checked = rows.filter((row) => !NOTIFY_WITHOUT_VIEW.has(row.type));
  if (checked.length === 0) return rows;
  try {
    const { audienceKey, taskViewersAmong } = await import("@/lib/notifications/audience");
    const allowed = await taskViewersAmong(
      checked.map((row) => ({ entityId: row.task_id, email: row.recipient_email }))
    );
    return rows.filter(
      (row) =>
        NOTIFY_WITHOUT_VIEW.has(row.type) ||
        allowed.has(audienceKey(row.task_id, row.recipient_email))
    );
  } catch (error) {
    console.error("[notifications] recipient access check failed; dropping checked rows", {
      rows: checked.length,
      error: error instanceof Error ? error.message : String(error),
    });
    return rows.filter((row) => NOTIFY_WITHOUT_VIEW.has(row.type));
  }
}

export async function insertNotifications(
  input: NotificationInsertInput[]
): Promise<boolean> {
  if (input.length === 0) return true;
  const rows = await keepTaskViewers(input);
  if (rows.length === 0) return true;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("task_notifications").insert(
    toNotificationInsertRows(rows)
  );
  if (error) throw new Error(error.message);

  // Realtime "ping" so recipients' open tabs toast instantly (content stays in DB).
  const broadcast = await broadcastNotif(rows.map((r) => r.recipient_email));

  // Và đẩy ra ngoài trình duyệt cho ai không mở tab. Service worker tự bỏ qua
  // khi người nhận đang nhìn portal, nên không kêu hai lần.
  await schedulePush(async () => {
    const { pushForTaskNotifications } = await import("@/lib/notifications/push-dispatch");
    await pushForTaskNotifications(rows);
  });

  return broadcast;
}

/**
 * Đẩy thông báo ra ngoài trình duyệt, sau khi response đã trả.
 *
 * `after()` của Next chạy tiếp khi request đã kết thúc, và trên Vercel nó giữ
 * function sống đủ lâu để hoàn tất. Cố ý KHÔNG thả promise trôi: serverless giết
 * tiến trình ngay sau response, nên promise thả trôi bị cắt giữa chừng và người
 * nhận mất thông báo một cách ngẫu nhiên.
 *
 * Nạp động vì hai lý do: `push-dispatch` là `server-only` (không được kéo vào
 * test đang import module này), và ngoài request scope — script, cron chạy tay —
 * thì `after()` ném lỗi, lúc đó bỏ qua là đúng.
 */
async function schedulePush(run: () => Promise<void>): Promise<void> {
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    // Ngoài request scope: bỏ qua push, thông báo trong web vẫn đã ghi xong.
  }
}


export function toNotificationInsertRows(
  rows: NotificationInsertInput[]
) {
  return rows.map((r) => ({
    recipient_email: r.recipient_email,
    task_id: r.task_id,
    type: r.type,
    actor_email: r.actor_email,
    comment_id: r.comment_id ?? null,
    detail: r.detail ?? null,
  }));
}

export function uniqueNotificationRecipients(
  emails: (string | null | undefined)[],
  excluded: (string | null | undefined)[] = []
): string[] {
  const excludedSet = new Set(
    excluded.map((email) => email?.trim()).filter((email): email is string => Boolean(email))
  );
  return [
    ...new Set(
      emails
        .map((email) => email?.trim())
        .filter((email): email is string => {
          if (!email) return false;
          return !excludedSet.has(email);
        })
    ),
  ];
}

export function uniqueNotificationRows(
  rows: NotificationInsertInput[]
): NotificationInsertInput[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [
      row.recipient_email,
      row.task_id,
      row.type,
      row.actor_email,
      row.comment_id ?? "",
      row.detail ?? "",
    ].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
