import { getSupabaseAdmin } from "@/lib/supabase";
import { broadcastNotif } from "./realtime";

export type CommentNotification = { email: string; type: "mentioned" | "commented" };

// Who to notify for a new comment: mentioned users (minus the author), plus the
// task's assignee as 'commented' (unless they are the author or already mentioned).
export function resolveCommentRecipients(
  task: { assignee_email: string | null },
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
  const assignee = task.assignee_email;
  if (assignee && assignee !== authorEmail && !mentionSet.has(assignee)) {
    out.push({ email: assignee, type: "commented" });
  }
  return out;
}

export async function insertNotifications(
  rows: {
    recipient_email: string;
    task_id: string;
    type: string;
    actor_email: string;
    comment_id?: string | null;
  }[]
): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("task_notifications").insert(
    rows.map((r) => ({
      recipient_email: r.recipient_email,
      task_id: r.task_id,
      type: r.type,
      actor_email: r.actor_email,
      comment_id: r.comment_id ?? null,
    }))
  );
  if (error) throw new Error(error.message);

  // Realtime "ping" so recipients' open tabs toast instantly (content stays in DB).
  await broadcastNotif(rows.map((r) => r.recipient_email));
}
