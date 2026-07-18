import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { notifTopic } from "@/lib/tasks/realtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const [{ data, error }, unreadRes, unreadAssignedRes] = await Promise.all([
    supabase
      .from("task_notifications")
      .select("id,task_id,type,actor_email,comment_id,detail,is_read,created_at")
      .eq("recipient_email", email)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("task_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_email", email)
      .eq("is_read", false),
    supabase
      .from("task_notifications")
      .select("task_id")
      .eq("recipient_email", email)
      .eq("type", "assigned")
      .eq("is_read", false),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (unreadRes.error) {
    return NextResponse.json({ error: unreadRes.error.message }, { status: 500 });
  }
  if (unreadAssignedRes.error) {
    return NextResponse.json({ error: unreadAssignedRes.error.message }, { status: 500 });
  }

  const base = (data ?? []) as {
    id: string;
    task_id: string;
    type: string;
    actor_email: string;
    comment_id: string | null;
    is_read: boolean;
    created_at: string;
  }[];

  // Enrich with the task title, actor display name, and comment body so the bell
  // tells users exactly what happened before they click.
  const taskIds = [...new Set(base.map((n) => n.task_id))];
  const actorEmails = [...new Set(base.map((n) => n.actor_email))];
  const commentIds = [
    ...new Set(base.map((n) => n.comment_id).filter((id): id is string => Boolean(id))),
  ];
  const [titlesRes, actorsRes, commentsRes] = await Promise.all([
    taskIds.length
      ? supabase.from("tasks").select("id,title").in("id", taskIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    actorEmails.length
      ? supabase.from("portal_account").select("email,name").in("email", actorEmails)
      : Promise.resolve({ data: [] as { email: string; name: string | null }[] }),
    commentIds.length
      ? supabase.from("task_comments").select("id,body").in("id", commentIds)
      : Promise.resolve({ data: [] as { id: string; body: string }[] }),
  ]);
  const titleById = new Map(
    ((titlesRes.data ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title])
  );
  const nameByEmail = new Map(
    ((actorsRes.data ?? []) as { email: string; name: string | null }[]).map((a) => [
      a.email,
      a.name,
    ])
  );
  const commentById = new Map(
    ((commentsRes.data ?? []) as { id: string; body: string }[]).map((c) => [
      c.id,
      c.body,
    ])
  );

  const notifications = base.map((n) => ({
    ...n,
    task_title: titleById.get(n.task_id) ?? null,
    actor_name: nameByEmail.get(n.actor_email) ?? null,
    comment_body: n.comment_id ? commentById.get(n.comment_id) ?? null : null,
  }));
  const unread =
    typeof unreadRes.count === "number"
      ? unreadRes.count
      : notifications.filter((n) => !n.is_read).length;
  const unreadAssignedTaskIds = [
    ...new Set(
      ((unreadAssignedRes.data ?? []) as { task_id: string }[]).map((n) => n.task_id)
    ),
  ];
  return NextResponse.json({
    notifications,
    unread,
    unreadAssignedTaskIds,
    topic: notifTopic(email),
  });
}
