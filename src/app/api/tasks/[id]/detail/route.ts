import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canViewTask } from "@/lib/tasks/access";
import { loadTaskDetail } from "@/lib/tasks/detail";
import { fetchAgentsForCs, isAgentOwnerOrAssistant } from "@/lib/tasks/membership";
import { isTaskParticipant } from "@/lib/tasks/participants";
import { isTaskAssignee } from "@/lib/tasks/assignees";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  const supabase = getSupabaseAdmin();
  const { data: task, error } = await supabase
    .from("tasks")
    .select("id,assignee_email,agent_email")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const taskScope = task as Pick<TaskRow, "assignee_email" | "agent_email">;
  const detailOpts = {
    includeActivity: true,
    includeCommentAttachments: false,
    includeTaskAttachments: false,
  } as const;

  try {
    if (actor.isManager) {
      return NextResponse.json(await loadTaskDetail(supabase, id, detailOpts));
    }

    // Non-manager: scope checks and the detail load run together (one wave).
    // The response is gated on canViewTask; activity is owner/assistant-only, so
    // it's stripped for non-owners after the fact. Behaviour is identical to the
    // old sequential version — just parallelized.
    const [isAgentOwner, isParticipant, isAssignee, agents, detail] =
      await Promise.all([
        isAgentOwnerOrAssistant(taskScope.agent_email, actor.email),
        isTaskParticipant(id, actor.email),
        isTaskAssignee(id, actor.email, supabase),
        fetchAgentsForCs(actor.email),
        loadTaskDetail(supabase, id, detailOpts),
      ]);
    const isAgentMember = Boolean(
      taskScope.agent_email && agents.includes(taskScope.agent_email)
    );
    if (
      !canViewTask(actor, taskScope, {
        isParticipant,
        isAgentMember,
        isAgentOwner,
        isAssignee,
      })
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    return NextResponse.json(
      isAgentOwner ? detail : { ...detail, activity: [] }
    );
  } catch (detailError) {
    return NextResponse.json(
      {
        error:
          detailError instanceof Error
            ? detailError.message
            : "Unable to load task detail.",
      },
      { status: 500 }
    );
  }
}
