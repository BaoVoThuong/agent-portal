import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask } from "@/lib/tasks/access";
import { fetchTaskAssignees } from "@/lib/tasks/assignees";
import { resolveCommentRecipients, insertNotifications } from "@/lib/tasks/notifications";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const COMMENT_COLUMNS =
  "id,task_id,parent_id,author_email,body,created_at,updated_at,deleted_at";

async function loadActorAndTask(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("id,status,assignee_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  return { actor, task: data as unknown as Pick<TaskRow, "id" | "status" | "assignee_email">, supabase };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canViewTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data, error } = await r.supabase
    .from("task_comments")
    .select(COMMENT_COLUMNS)
    .eq("task_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ comments: data ?? [] });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canViewTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  // Validate parent: must be a top-level comment on THIS task (one-level threading).
  let parentId: string | null = null;
  if (typeof body?.parentId === "string" && body.parentId) {
    const { data: parent } = await r.supabase
      .from("task_comments")
      .select("id,task_id,parent_id")
      .eq("id", body.parentId)
      .maybeSingle();
    const p = parent as { task_id: string; parent_id: string | null } | null;
    if (!p || p.task_id !== id || p.parent_id !== null)
      return NextResponse.json({ error: "Invalid parent comment." }, { status: 400 });
    parentId = body.parentId;
  }

  const { data: comment, error } = await r.supabase
    .from("task_comments")
    .insert({ task_id: id, parent_id: parentId, author_email: r.actor.email, body: text })
    .select(COMMENT_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log activity.
  await r.supabase.from("task_activity").insert({
    task_id: id,
    actor_email: r.actor.email,
    type: "comment_added",
    meta: null,
  });

  // Validate mentions against board members, then notify.
  const rawMentions = Array.isArray(body?.mentions)
    ? (body.mentions as unknown[]).filter((m): m is string => typeof m === "string")
    : [];
  const memberEmails = new Set((await fetchTaskAssignees()).map((m) => m.email));
  const validMentions = rawMentions.filter((m) => memberEmails.has(m));
  const recipients = resolveCommentRecipients(r.task, r.actor.email, validMentions);
  await insertNotifications(
    recipients.map((rec) => ({
      recipient_email: rec.email,
      task_id: id,
      type: rec.type,
      actor_email: r.actor.email,
      comment_id: (comment as { id: string }).id,
    }))
  );

  return NextResponse.json({ comment });
}
