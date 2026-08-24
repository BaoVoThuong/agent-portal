import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canAssign, isTaskViewAdmin } from "@/lib/tasks/access";
import {
  attachAssigneesToTasks,
  isEligibleTaskAssigneeEmail,
} from "@/lib/tasks/assignees";
import { insertNotifications } from "@/lib/tasks/notifications";
import {
  broadcastTaskRoom,
  broadcastTasksChanged,
  readTaskMutationSourceId,
} from "@/lib/tasks/realtime";
import { TASK_COLUMNS } from "@/lib/tasks/queries";
import type { TaskRow } from "@/lib/tasks/types";
import { settleSideEffects } from "@/lib/tasks/mutation-result";

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
  // isTaskViewAdmin alone is a ROLE test and says nothing about task.manage, so
  // an admin-shaped role with that permission revoked used to pass here while
  // failing every other assignment path. assign_unassigned_task is a
  // security-definer RPC that only validates the assignee, never p_actor_email,
  // so this route is the sole gate. Resolve the actor the same way the sibling
  // /assignees route does.
  const actor = buildTaskActor(session.user.permissions, actorEmail, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  if (!canAssign(actor)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const expectedUpdatedAt =
    typeof body?.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null;
  if (!email) return NextResponse.json({ error: "email is required." }, { status: 400 });
  if (!(await isEligibleTaskAssigneeEmail(email))) {
    return NextResponse.json(
      { error: `Assignee is not eligible: ${email}` },
      { status: 400 }
    );
  }

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

  const [taskResult, warnings] = await Promise.all([
    supabase.from("tasks").select(TASK_COLUMNS).eq("id", id).single(),
    settleSideEffects([
      {
        code: "notification_failed",
        message: "The task was assigned but the assignee notification may be delayed.",
        run: () =>
          insertNotifications([
            {
              recipient_email: email,
              task_id: id,
              type: "assigned",
              actor_email: actorEmail,
            },
          ]),
      },
      {
        code: "board_broadcast_failed",
        message: "The task was assigned but other boards may refresh on fallback.",
        run: () =>
          broadcastTasksChanged(readTaskMutationSourceId(request)),
      },
      {
        code: "detail_broadcast_failed",
        message: "The task was assigned but open task details may refresh on fallback.",
        run: () => broadcastTaskRoom(id, readTaskMutationSourceId(request)),
      },
    ]),
  ]);

  const { data, error: taskError } = taskResult;
  if (taskError || !data) {
    warnings.push({
      code: "task_reload_failed",
      message: "The task was assigned but its updated row could not be reloaded.",
    });
    console.warn("Task assignment committed but reload failed", taskError);
    return NextResponse.json({ task: null, warnings });
  }

  let task = data as unknown as TaskRow;
  try {
    [task] = await attachAssigneesToTasks([task], supabase, {
      currentEmail: actorEmail,
    });
  } catch (error) {
    warnings.push({
      code: "assignee_enrichment_failed",
      message: "The task was assigned but assignee details need a refresh.",
    });
    console.warn("Task assignment committed but assignee enrichment failed", error);
  }
  return NextResponse.json({ task, warnings });
}
