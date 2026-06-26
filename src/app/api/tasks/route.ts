import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canAccessBoard, canCreateTask, resolveCreateAssignment } from "@/lib/tasks/access";
import { fetchTasksForActor } from "@/lib/tasks/queries";
import { midpoint } from "@/lib/tasks/ordering";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/types";
import { broadcastTasksChanged } from "@/lib/tasks/realtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canAccessBoard(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tasks = await fetchTasksForActor(actor);
  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);
  if (!canCreateTask(actor))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });

  const requestedStatus =
    typeof body?.status === "string" &&
    (TASK_STATUSES as readonly string[]).includes(body.status)
      ? body.status
      : "backlog";
  const assignment = resolveCreateAssignment(actor, {
    assignee_email: typeof body?.assignee_email === "string" ? body.assignee_email : null,
    status: requestedStatus,
  });
  if (!assignment.ok)
    return NextResponse.json({ error: assignment.error }, { status: 400 });

  const priority =
    typeof body?.priority === "string" &&
    (TASK_PRIORITIES as readonly string[]).includes(body.priority)
      ? body.priority
      : "medium";
  const agentEmail =
    typeof body?.agent_email === "string" && body.agent_email.trim() !== ""
      ? body.agent_email.trim()
      : null;

  const supabase = getSupabaseAdmin();
  // Place new card at the bottom of its column.
  const { data: last } = await supabase
    .from("tasks")
    .select("position")
    .eq("status", assignment.status)
    .is("archived_at", null)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = midpoint((last as { position: number } | null)?.position ?? null, null);

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      title,
      description:
        typeof body?.description === "string" && body.description.trim() !== ""
          ? body.description.trim()
          : null,
      status: assignment.status,
      priority,
      agent_email: agentEmail,
      assignee_email: assignment.assignee_email,
      reporter_email: email,
      due_date:
        typeof body?.due_date === "string" && body.due_date.trim() !== ""
          ? body.due_date.trim()
          : null,
      category_id:
        typeof body?.category_id === "string" && body.category_id.trim() !== ""
          ? body.category_id.trim()
          : null,
      position,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("task_activity").insert({
    task_id: (data as { id: string }).id,
    actor_email: email,
    type: "created",
    meta: assignment.assignee_email ? { to: assignment.assignee_email } : null,
  });

  await broadcastTasksChanged();
  return NextResponse.json({ task: data });
}
