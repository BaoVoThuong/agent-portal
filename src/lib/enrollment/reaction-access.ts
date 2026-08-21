import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "./access";
import { loadScopedEnrollmentRecord } from "./scope";
import { normalizeReactionEmail } from "@/lib/tasks/reactions";

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

export type EnrollmentReactionAccessResult =
  | ReactionAccessSuccess
  | ReactionAccessFailure;

/** Reactions inherit the same scoped-record visibility boundary as comments. */
export async function authorizeEnrollmentReactionAccess(
  recordId: string,
): Promise<EnrollmentReactionAccessResult> {
  try {
    const actorResult = await loadEnrollmentActor();
    if (!actorResult.ok) {
      return {
        ok: false,
        error: actorResult.error,
        status: actorResult.status,
      };
    }
    const scoped = await loadScopedEnrollmentRecord(recordId, actorResult.actor);
    if (!scoped.ok) {
      return { ok: false, error: scoped.error, status: scoped.status };
    }
    return {
      ok: true,
      email: normalizeReactionEmail(actorResult.actor.email),
      supabase: getSupabaseAdmin(),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to authorize enrollment access.",
      status: 500,
    };
  }
}
