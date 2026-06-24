import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask, canMutateTask } from "@/lib/tasks/access";
import { resolveTaskPatch } from "@/lib/tasks/transitions";
import type { TaskRow } from "@/lib/tasks/types";
import { buildActivityEntries } from "@/lib/tasks/activity";
import { insertNotifications } from "@/lib/tasks/notifications";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function loadActorAndTask(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  return { actor, task: data as unknown as TaskRow, supabase };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canViewTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  return NextResponse.json({ task: r.task });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canMutateTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const resolved = resolveTaskPatch(r.actor, r.task, body);
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: 400 });

  const { data, error } = await r.supabase
    .from("tasks")
    .update({ ...resolved.patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const entries = buildActivityEntries(
    {
      status: r.task.status,
      assignee_email: r.task.assignee_email,
      agent_email: r.task.agent_email,
    },
    resolved.patch
  );
  if (entries.length > 0) {
    await r.supabase.from("task_activity").insert(
      entries.map((e) => ({
        task_id: id,
        actor_email: r.actor.email,
        type: e.type,
        meta: e.meta,
      }))
    );
  }

  // Notify a newly assigned person (not when assigning to self).
  const newAssignee = resolved.patch.assignee_email as string | null | undefined;
  if (
    newAssignee &&
    newAssignee !== r.task.assignee_email &&
    newAssignee !== r.actor.email
  ) {
    await insertNotifications([
      { recipient_email: newAssignee, task_id: id, type: "assigned", actor_email: r.actor.email },
    ]);
  }

  return NextResponse.json({ task: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canMutateTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { error } = await r.supabase
    .from("tasks")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await r.supabase.from("task_activity").insert({
    task_id: id,
    actor_email: r.actor.email,
    type: "archived",
    meta: null,
  });

  return NextResponse.json({ ok: true });
}
