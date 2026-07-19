import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isTaskViewAdmin } from "@/lib/tasks/access";
import { attachAssigneesToTasks } from "@/lib/tasks/assignees";
import { insertNotifications } from "@/lib/tasks/notifications";
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
import { TASK_COLUMNS } from "@/lib/tasks/queries";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function isConflict(message: string): boolean {
  return ["ASSIGN_CONFLICT", "INVALID_CS", "TASK_NOT_FOUND"].some((code) =>
    message.includes(code)
  );
}

export async function POST(request: Request, { params }: Ctx) {
  const session = await auth();
  const actorEmail = session?.user?.email;
  if (!actorEmail) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTaskViewAdmin(session.user)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const expectedUpdatedAt =
    typeof body?.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null;
  if (!email) return NextResponse.json({ error: "email is required." }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const { error: assignError } = await supabase.rpc("assign_unassigned_task", {
    p_task_id: id,
    p_cs_email: email,
    p_expected_updated_at: expectedUpdatedAt,
    p_actor_email: actorEmail,
  });
  if (assignError) {
    if (isConflict(assignError.message)) {
      return NextResponse.json(
        { error: "This task is no longer unassigned or the CS is not eligible." },
        { status: 409 }
      );
    }
    if (assignError.message.includes("assign_unassigned_task")) {
      return NextResponse.json(
        { error: "The atomic assignment migration has not been applied." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: assignError.message }, { status: 500 });
  }

  const { data, error: taskError } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("id", id)
    .single();
  if (taskError) return NextResponse.json({ error: taskError.message }, { status: 500 });

  await insertNotifications([
    {
      recipient_email: email,
      task_id: id,
      type: "assigned",
      actor_email: actorEmail,
    },
  ]);
  await Promise.all([broadcastTasksChanged(), broadcastTaskRoom(id)]);

  const [task] = await attachAssigneesToTasks(
    [data as unknown as TaskRow],
    supabase,
    { currentEmail: actorEmail }
  );
  return NextResponse.json({ task });
}
