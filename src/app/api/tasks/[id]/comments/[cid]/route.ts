import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canViewTask } from "@/lib/tasks/access";
import { isTaskAssignee } from "@/lib/tasks/assignees";
import { fetchTaskAssignees } from "@/lib/tasks/assignees";
import { actorSeesAllTasks, fetchAgentsForCs } from "@/lib/tasks/membership";
import { isTaskParticipant } from "@/lib/tasks/participants";
import { parseMentions } from "@/lib/tasks/mentions";
import { settleSideEffects } from "@/lib/tasks/mutation-result";
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
import { removeTaskFile } from "@/lib/tasks/storage";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };

async function canViewResolved(
  actor: ReturnType<typeof buildTaskActor>,
  task: Pick<TaskRow, "assignee_email" | "agent_email">,
  taskId: string
): Promise<boolean> {
  if (actor.isManager) return true;
  if (await actorSeesAllTasks(actor)) return true;
  const [isParticipant, isAssignee, agents] = await Promise.all([
    isTaskParticipant(taskId, actor.email),
    isTaskAssignee(taskId, actor.email),
    fetchAgentsForCs(actor.email),
  ]);
  const isAgentMember = Boolean(task.agent_email && agents.includes(task.agent_email));
  const isAgentOwner = Boolean(task.agent_email && task.agent_email === actor.email);
  return canViewTask(actor, task, {
    isParticipant,
    isAgentMember,
    isAgentOwner,
    isAssignee,
  });
}

async function loadAuthorContext(id: string, cid: string) {
  // 1. Session / email
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };

  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  const supabase = getSupabaseAdmin();

  // 2. Load comment (id, author_email, task_id)
  const { data: comment, error: cErr } = await supabase
    .from("task_comments")
    .select("id,author_email,task_id,body,updated_at,deleted_at")
    .eq("id", cid)
    .maybeSingle();
  if (cErr) return { error: cErr.message, status: 500 };
  if (!comment) return { error: "Not found", status: 404 };

  // 3. Comment must belong to the route task
  const cmnt = comment as {
    id: string;
    author_email: string;
    task_id: string;
    body: string;
    updated_at: string;
    deleted_at: string | null;
  };
  if (cmnt.task_id !== id) return { error: "Not found", status: 404 };

  // 4. Actor must be able to view the task
  const { data: task, error: tErr } = await supabase
    .from("tasks")
    .select("id,assignee_email,agent_email")
    .eq("id", id)
    .maybeSingle();
  if (tErr) return { error: tErr.message, status: 500 };
  if (!task) return { error: "Not found", status: 404 };
  if (
    !(await canViewResolved(
      actor,
      task as Pick<TaskRow, "assignee_email" | "agent_email">,
      id
    ))
  )
    return { error: "Forbidden", status: 403 };

  // 5. Actor must be the comment author
  if (cmnt.author_email !== email) return { error: "Forbidden", status: 403 };

  return {
    supabase,
    email,
    currentBody: cmnt.body,
    currentUpdatedAt: cmnt.updated_at,
  };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, cid } = await params;
  const ctx = await loadAuthorContext(id, cid);
  if ("error" in ctx)
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text)
    return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  const expectedUpdatedAt =
    typeof body?.expected_updated_at === "string" ? body.expected_updated_at : null;
  const taskMembers = await fetchTaskAssignees();
  const actionable = new Set(taskMembers.map((member) => member.email));
  const mentionsNow = parseMentions(text).filter((email) => actionable.has(email));
  const mentionsBefore = parseMentions(ctx.currentBody);
  const newMentions = mentionsNow.filter((email) => !mentionsBefore.includes(email));

  const { data: edited, error } = await ctx.supabase
    .rpc("edit_task_comment_atomic", {
      p_comment_id: cid,
      p_task_id: id,
      p_actor_email: ctx.email,
      p_body: text,
      p_expected_updated_at: expectedUpdatedAt,
      p_new_mentions: newMentions,
    })
    .single();
  if (error) {
    if (error.message.includes("COMMENT_CONFLICT")) {
      return NextResponse.json(
        { error: "This comment was edited somewhere else. Refresh to see the latest version." },
        { status: 409 },
      );
    }
    if (error.message.includes("FORBIDDEN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error.message.includes("COMMENT_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error.message.includes("COMMENT_DELETED")) {
      return NextResponse.json({ error: "Comment is deleted." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { comment, parent_updated_at: parentUpdatedAt } = edited as {
    comment: Record<string, unknown>;
    parent_updated_at: string;
  };
  const warnings = await settleSideEffects([
    {
      code: "broadcast_failed",
      message: "Other open tabs may need a refresh to see this edit.",
      run: async () => {
        await broadcastTasksChanged();
        await broadcastTaskRoom(id);
      },
    },
  ]);
  return NextResponse.json({ comment, parent_updated_at: parentUpdatedAt, warnings });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, cid } = await params;
  const ctx = await loadAuthorContext(id, cid);
  if ("error" in ctx)
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const { data: removed, error } = await ctx.supabase
    .rpc("delete_task_comment_atomic", {
      p_comment_id: cid,
      p_task_id: id,
      p_actor_email: ctx.email,
    })
    .single();
  if (error) {
    if (error.message.includes("FORBIDDEN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error.message.includes("COMMENT_NOT_FOUND") || error.message.includes("TASK_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { storage_paths: paths } = removed as { storage_paths: string[] };
  const warnings = await settleSideEffects([
    {
      code: "storage_cleanup_failed",
      message: "The comment was deleted but some stored files could not be removed.",
      run: async () => {
        const results = await Promise.allSettled(paths.map((path) => removeTaskFile(path)));
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      },
    },
    {
      code: "broadcast_failed",
      message: "Other open tabs may show a stale comment or attachment count until they refresh.",
      run: async () => {
        await broadcastTaskRoom(id);
        await broadcastTasksChanged();
      },
    },
  ]);
  return NextResponse.json({ ok: true, warnings });
}
