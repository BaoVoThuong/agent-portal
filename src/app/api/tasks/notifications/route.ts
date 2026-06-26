import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("task_notifications")
    .select("id,task_id,type,actor_email,comment_id,is_read,created_at")
    .eq("recipient_email", email)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const base = (data ?? []) as {
    id: string;
    task_id: string;
    type: string;
    actor_email: string;
    comment_id: string | null;
    is_read: boolean;
    created_at: string;
  }[];

  // Enrich with the task title + the actor's display name so the bell is readable.
  const taskIds = [...new Set(base.map((n) => n.task_id))];
  const actorEmails = [...new Set(base.map((n) => n.actor_email))];
  const [titlesRes, actorsRes] = await Promise.all([
    taskIds.length
      ? supabase.from("tasks").select("id,title").in("id", taskIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    actorEmails.length
      ? supabase.from("portal_account").select("email,name").in("email", actorEmails)
      : Promise.resolve({ data: [] as { email: string; name: string | null }[] }),
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

  const notifications = base.map((n) => ({
    ...n,
    task_title: titleById.get(n.task_id) ?? null,
    actor_name: nameByEmail.get(n.actor_email) ?? null,
  }));
  const unread = notifications.filter((n) => !n.is_read).length;
  return NextResponse.json({ notifications, unread });
}
