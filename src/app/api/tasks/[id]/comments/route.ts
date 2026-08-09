import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, isTaskViewAdmin, canViewTask } from "@/lib/tasks/access";
import {
  fetchTaskAssigneeEmails,
  fetchTaskAssignees,
  isTaskAssignee,
} from "@/lib/tasks/assignees";
import { resolveCommentRecipients, insertNotifications } from "@/lib/tasks/notifications";
import { parseMentions } from "@/lib/tasks/mentions";
import { fetchTaskParticipantEmails, isTaskParticipant } from "@/lib/tasks/participants";
import { actorSeesAllTasks, fetchAgentsForCs } from "@/lib/tasks/membership";
import { settleSideEffects } from "@/lib/tasks/mutation-result";
import { broadcastTaskRoom, broadcastTasksChanged } from "@/lib/tasks/realtime";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const COMMENT_COLUMNS =
  "id,task_id,parent_id,author_email,body,client_request_id,created_at,updated_at,deleted_at";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadActorAndTask(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("id,status,assignee_email,agent_email,reporter_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  return {
    actor,
    task: data as unknown as Pick<
      TaskRow,
      "id" | "status" | "assignee_email" | "agent_email" | "reporter_email"
    >,
    supabase,
  };
}

// View access including participants and agent membership.
async function canViewResolved(
  actor: ReturnType<typeof buildTaskActor>,
  task: Pick<TaskRow, "assignee_email" | "agent_email">,
  taskId: string
): Promise<boolean> {
  if (actor.isManager) return true;
  // Plain-CS see (and can comment on) the whole company queue; task edits stay gated.
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

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!(await canViewResolved(r.actor, r.task, id)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data, error } = await r.supabase
    .from("task_comments")
    .select(COMMENT_COLUMNS)
    .eq("task_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const comments = (data ?? []).map((c) => {
    const row = c as { id: string };
    return { ...(c as object), id: row.id, attachments: [] };
  });
  return NextResponse.json({ comments });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!(await canViewResolved(r.actor, r.task, id)))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  // An attachment-only comment is valid: the client creates the comment first,
  // then uploads files against its id, so the text can legitimately be empty.
  const hasAttachments = body?.hasAttachments === true;
  if (!text && !hasAttachments)
    return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  // Mentions are parsed from the body (server is the source of truth), then
  // validated against board members before the atomic command grants access.
  const taskMembers = await fetchTaskAssignees();
  const actionableEmails = new Set(taskMembers.map((member) => member.email));
  const validMentions = parseMentions(text).filter((m) => actionableEmails.has(m));

  const requestId =
    typeof body?.client_request_id === "string" ? body.client_request_id : null;
  if (requestId !== null && !UUID_RE.test(requestId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  const { data: created, error } = await r.supabase
    .rpc("create_task_comment_atomic", {
      p_task_id: id,
      p_author_email: r.actor.email,
      p_body: text,
      p_parent_id: typeof body?.parentId === "string" && body.parentId ? body.parentId : null,
      p_client_request_id: requestId,
      p_mentions: validMentions,
    })
    .single();
  if (error) {
    if (error.message.includes("INVALID_PARENT")) {
      return NextResponse.json({ error: "Invalid parent comment." }, { status: 400 });
    }
    if (error.message.includes("TASK_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const {
    comment,
    parent_updated_at: parentUpdatedAt,
    was_created: wasCreated,
  } = created as {
    comment: { id: string };
    parent_updated_at: string;
    was_created: boolean;
  };

  // The comment is durable at this point. Notifications and realtime are
  // useful but non-critical, so a provider outage returns a warning rather
  // than turning a committed comment into a misleading 500.
  const warnings = wasCreated
    ? await settleSideEffects([
        {
          code: "notification_failed",
          message: "The comment was saved but some people may not have been notified.",
          run: async () => {
            const [assigneeEmails, participantEmails] = await Promise.all([
              fetchTaskAssigneeEmails(id, r.supabase),
              fetchTaskParticipantEmails(id, r.supabase),
            ]);
            const activeOnly = (email: string | null | undefined) =>
              email && actionableEmails.has(email) ? email : null;
            const recipients = resolveCommentRecipients(
              {
                assignees: assigneeEmails.filter((email) => actionableEmails.has(email)),
                assignee_email: activeOnly(r.task.assignee_email),
                participants: participantEmails.filter((email) => actionableEmails.has(email)),
                reporter_email: activeOnly(r.task.reporter_email),
                agent_email: activeOnly(r.task.agent_email),
              },
              r.actor.email,
              validMentions
            );
            await insertNotifications(
              recipients.map((rec) => ({
                recipient_email: rec.email,
                task_id: id,
                type: rec.type,
                actor_email: r.actor.email,
                comment_id: comment.id,
              }))
            );
          },
        },
        {
          code: "broadcast_failed",
          message: "Other open tabs may need a refresh to see this comment.",
          run: async () => {
            await broadcastTasksChanged();
            await broadcastTaskRoom(id);
          },
        },
      ])
    : [];

  return NextResponse.json({ comment, parent_updated_at: parentUpdatedAt, warnings });
}
