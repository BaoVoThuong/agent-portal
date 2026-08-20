import { getSupabaseAdmin } from "@/lib/supabase";
import { broadcastNotif } from "./realtime";

export const TASK_NOTIFICATION_TYPES = [
  "assigned",
  "mentioned",
  "commented",
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
export function resolveCommentRecipients(
  task: {
    assignees?: string[];
    assignee_email?: string | null;
    participants?: string[];
    reporter_email?: string | null;
    agent_email?: string | null;
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
    task.agent_email ?? "",
  ];
  for (const email of [...new Set(commentTargets)]) {
    if (email && email !== authorEmail && !mentionSet.has(email)) {
      out.push({ email, type: "commented" });
    }
  }
  return out;
}

export async function insertNotifications(
  rows: NotificationInsertInput[]
): Promise<boolean> {
  if (rows.length === 0) return true;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("task_notifications").insert(
    toNotificationInsertRows(rows)
  );
  if (error) throw new Error(error.message);

  // Realtime "ping" so recipients' open tabs toast instantly (content stays in DB).
  return broadcastNotif(rows.map((r) => r.recipient_email));
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
