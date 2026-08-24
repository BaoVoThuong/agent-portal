import { after, NextResponse } from "next/server";
import {
  isAllowedEmoji,
  normalizeEmojiInput,
} from "@/lib/tasks/emoji-search";
import { settleSideEffects } from "@/lib/tasks/mutation-result";
import {
  insertNotifications,
  uniqueNotificationRecipients,
} from "@/lib/tasks/notifications";
import { authorizeTaskReactionAccess } from "@/lib/tasks/reaction-access";
import type { ReactionRow } from "@/lib/tasks/reactions";
import {
  broadcastTaskCommentReaction,
  readTaskMutationSourceId,
} from "@/lib/tasks/realtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };

/**
 * PUT adds and DELETE removes a reaction. Both operations are idempotent and
 * notify only the comment author when a new reaction is added. The database
 * RPC locks the active comment while mutating so a concurrent soft-delete
 * cannot leave orphaned reaction state behind.
 */

async function readEmoji(req: Request): Promise<string | null> {
  const body = (await req.json().catch(() => null)) as
    | { emoji?: unknown }
    | null;
  if (typeof body?.emoji !== "string") return null;
  const emoji = normalizeEmojiInput(body.emoji);
  return isAllowedEmoji(emoji) ? emoji : null;
}

async function mutate(
  req: Request,
  context: Ctx,
  present: boolean,
): Promise<NextResponse> {
  const { id, cid } = await context.params;
  const access = await authorizeTaskReactionAccess(id);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  const emoji = await readEmoji(req);
  if (!emoji) {
    return NextResponse.json({ error: "Unsupported emoji." }, { status: 400 });
  }

  const { data, error } = await access.supabase.rpc(
    "set_task_comment_reaction_atomic",
    {
      p_comment_id: cid,
      p_task_id: id,
      p_reactor_email: access.email,
      p_emoji: emoji,
      p_present: present,
    },
  );
  if (error) {
    if (
      error.message.includes("COMMENT_NOT_FOUND") ||
      error.message.includes("TASK_NOT_FOUND")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (
      error.message.includes("INVALID_REACTOR_EMAIL") ||
      error.message.includes("INVALID_EMOJI")
    ) {
      return NextResponse.json({ error: "Invalid reaction." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rawReactions = (data ?? []) as Array<ReactionRow & { changed?: boolean }>;
  const reactionChanged = present && rawReactions.some((row) => row.changed === true);
  const reactions = rawReactions.map((row) => ({
    comment_id: row.comment_id,
    emoji: row.emoji,
    reactor_email: row.reactor_email,
  }));
  const sourceId = readTaskMutationSourceId(req);
  after(async () => {
    const warnings = await settleSideEffects([
      ...(reactionChanged
        ? [
            {
              code: "reaction_notification_failed",
              message:
                "The reaction was saved but the comment author may not have been notified.",
              run: async () => {
                const { data: comment, error: commentError } = await access.supabase
                  .from("task_comments")
                  .select("author_email")
                  .eq("id", cid)
                  .eq("task_id", id)
                  .maybeSingle();
                if (commentError) throw new Error(commentError.message);
                const recipients = uniqueNotificationRecipients(
                  [comment?.author_email?.trim().toLowerCase()],
                  [access.email],
                );
                return insertNotifications(
                  recipients.map((recipient) => ({
                    recipient_email: recipient,
                    task_id: id,
                    type: "reacted" as const,
                    actor_email: access.email,
                    comment_id: cid,
                    detail: emoji,
                  })),
                );
              },
            },
          ]
        : []),
      {
        code: "reaction_broadcast_failed",
        message: "The reaction was saved but other viewers may need a refresh.",
        run: () => broadcastTaskCommentReaction(id, sourceId),
      },
    ]);
    if (warnings.length > 0) {
      console.error("Task comment reaction committed with side-effect warnings", {
        taskId: id,
        commentId: cid,
        warnings,
      });
    }
  });
  return NextResponse.json({ reactions: reactions as ReactionRow[], warnings: [] });
}

export async function PUT(req: Request, context: Ctx) {
  return mutate(req, context, true);
}

export async function DELETE(req: Request, context: Ctx) {
  return mutate(req, context, false);
}
