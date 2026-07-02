import { getSupabaseAdmin } from "@/lib/supabase";
import { broadcastNotif } from "./realtime";

export type CommentNotification = { email: string; type: "mentioned" | "commented" };

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
