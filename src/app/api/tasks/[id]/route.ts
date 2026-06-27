import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask, canMutateTask, canAssignToTask } from "@/lib/tasks/access";
import { resolveTaskPatch } from "@/lib/tasks/transitions";
import type { TaskRow } from "@/lib/tasks/types";
import { buildActivityEntries } from "@/lib/tasks/activity";
import { insertNotifications } from "@/lib/tasks/notifications";
import { removeTaskFiles } from "@/lib/tasks/storage";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";
import { fetchAgentsForCs } from "@/lib/tasks/membership";

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
  const reassigning = body !== null && typeof body === "object" && "assignee_email" in body;
  const agents = r.actor.isManager ? [] : await fetchAgentsForCs(r.actor.email);
  const isAgentMember = Boolean(r.task.agent_email && agents.includes(r.task.agent_email));
  if (reassigning && !canAssignToTask(r.actor, isAgentMember)) {
    return NextResponse.json({ error: "You cannot assign this task." }, { status: 403 });
  }
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

  await broadcastTasksChanged();
  return NextResponse.json({ task: data });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canMutateTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // Best-effort: remove attachment files from storage before the rows cascade away.
  const { data: atts } = await r.supabase
    .from("task_attachments")
    .select("storage_path")
    .eq("task_id", id);
  const paths = ((atts ?? []) as { storage_path: string }[]).map((a) => a.storage_path);
  if (paths.length > 0) {
    await removeTaskFiles(paths).catch(() => {});
  }

  // Hard delete. Child rows (comments, attachments, activity, notifications)
  // are removed by the `on delete cascade` foreign keys.
  const { error } = await r.supabase.from("tasks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastTasksChanged();
  return NextResponse.json({ ok: true });
}
