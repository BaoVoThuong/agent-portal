import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask, isTaskViewAdmin } from "./access";
import { isTaskAssignee } from "./assignees";
import { actorSeesAllTasks, fetchAgentsForCs } from "./membership";
import { isTaskParticipant } from "./participants";
import { normalizeReactionEmail } from "./reactions";
import type { TaskRow } from "./types";

type ReactionAccessSuccess = {
  ok: true;
  email: string;
  supabase: ReturnType<typeof getSupabaseAdmin>;
};

type ReactionAccessFailure = {
  ok: false;
  error: string;
  status: 401 | 403 | 404 | 500;
};

export type ReactionAccessResult =
  | ReactionAccessSuccess
  | ReactionAccessFailure;

/** Resolve the same task visibility boundary used by the detail endpoint. */
export async function authorizeTaskReactionAccess(
  taskId: string,
): Promise<ReactionAccessResult> {
  try {
    const session = await auth();
    const sessionEmail = session?.user?.email;
    if (!sessionEmail) {
      return { ok: false, error: "Unauthorized", status: 401 };
    }

    const actor = buildTaskActor(session.user.permissions, sessionEmail, {
      isAdmin: isTaskViewAdmin(session.user),
    });
    const supabase = getSupabaseAdmin();
    const { data: task, error } = await supabase
      .from("tasks")
      .select("id,assignee_email,agent_email,reporter_email")
      .eq("id", taskId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message, status: 500 };
    if (!task) return { ok: false, error: "Not found", status: 404 };

    if (!actor.isManager) {
      const taskScope = task as Pick<
        TaskRow,
        "assignee_email" | "agent_email" | "reporter_email"
      >;
      const [isParticipant, isAssignee, assistantAgents, seesAll] =
        await Promise.all([
          isTaskParticipant(taskId, actor.email),
          isTaskAssignee(taskId, actor.email, supabase),
          fetchAgentsForCs(actor.email),
          actorSeesAllTasks(actor),
        ]);
      const normalizedActorEmail = normalizeReactionEmail(actor.email);
      const agentEmail = normalizeReactionEmail(taskScope.agent_email ?? "");
      const isAgentOwner = Boolean(
        agentEmail &&
          (agentEmail === normalizedActorEmail ||
            assistantAgents.some(
              (candidate) => normalizeReactionEmail(candidate) === agentEmail,
            )),
      );
      const isAgentMember = Boolean(
        agentEmail &&
          assistantAgents.some(
            (candidate) => normalizeReactionEmail(candidate) === agentEmail,
          ),
      );
      if (
        !seesAll &&
        !canViewTask(actor, taskScope, {
          isParticipant,
          isAssignee,
          isAgentMember,
          isAgentOwner,
          isReporter: taskScope.reporter_email === actor.email,
        })
      ) {
        return { ok: false, error: "Forbidden", status: 403 };
      }
    }

    return {
      ok: true,
      email: normalizeReactionEmail(sessionEmail),
      supabase,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to authorize task access.",
      status: 500,
    };
  }
}
