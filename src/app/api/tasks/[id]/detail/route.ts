import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canViewTask } from "@/lib/tasks/access";
import { loadTaskDetail } from "@/lib/tasks/detail";
import {
  actorSeesAllTasks,
  fetchAgentsForCs,
  isAgentOwnerOrAssistant,
} from "@/lib/tasks/membership";
import { fetchTaskListMetadata } from "@/lib/tasks/queries";
import { isTaskParticipant } from "@/lib/tasks/participants";
import { isTaskAssignee } from "@/lib/tasks/assignees";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const url = new URL(req.url);
  const beforeCreatedAt = url.searchParams.get("comments_before_created_at");
  const beforeId = url.searchParams.get("comments_before_id");
  const isUuid = (value: string | null) =>
    Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
  const commentsBefore =
    beforeCreatedAt && beforeId && !Number.isNaN(Date.parse(beforeCreatedAt)) && isUuid(beforeId)
      ? { created_at: beforeCreatedAt, id: beforeId }
      : undefined;
  const highlightCommentId = isUuid(url.searchParams.get("comment_id"))
    ? url.searchParams.get("comment_id")
    : undefined;
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
    // Comment attachments are rendered inline in the thread, so they must be
    // signed and returned with the comments themselves.
    includeCommentAttachments: true,
    // Task-level (non-comment) attachments have no UI on the task drawer —
    // every task file is attached through a comment. Skip signing them.
    includeTaskAttachments: false,
  } as const;
  const loadDetailAndMetadata = async (includeActivity: boolean) => {
    const [detail, metadataRows] = await Promise.all([
      loadTaskDetail(supabase, id, {
        ...detailOpts,
        includeActivity,
        commentsBefore,
        highlightCommentId,
      }),
      fetchTaskListMetadata([id], supabase),
    ]);
    const metadata = metadataRows[0];
    return {
      ...detail,
      metadata: {
        last_activity_by_email: metadata?.last_activity_by_email ?? null,
        comment_count: metadata?.comment_count ?? 0,
        attachment_count: metadata?.attachment_count ?? 0,
      },
    };
  };

  try {
    if (actor.isManager) {
      return NextResponse.json(await loadDetailAndMetadata(true));
    }

    // Only scope predicates are independent. Resolve them before any comments,
    // activity, metadata, or signed attachment URLs are loaded; an unauthorized
    // request must not perform privileged reads and then discard the result.
    const [isAgentOwner, isParticipant, isAssignee, agents, seeAll] =
      await Promise.all([
        isAgentOwnerOrAssistant(taskScope.agent_email, actor.email),
        isTaskParticipant(id, actor.email),
        isTaskAssignee(id, actor.email, supabase),
        fetchAgentsForCs(actor.email),
        actorSeesAllTasks(actor),
      ]);
    const isAgentMember = Boolean(
      taskScope.agent_email && agents.includes(taskScope.agent_email)
    );
    // Plain-CS (company-wide queue) can read any task; owner/assignee/participant
    // gating still applies to everyone else. Activity stays owner-only below.
    if (
      !seeAll &&
      !canViewTask(actor, taskScope, {
        isParticipant,
        isAgentMember,
        isAgentOwner,
        isAssignee,
      })
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }
    const detail = await loadDetailAndMetadata(isAgentOwner);
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
