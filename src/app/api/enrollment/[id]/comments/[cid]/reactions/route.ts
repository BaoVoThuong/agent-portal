import { after, NextResponse } from "next/server";
import {
  isAllowedEmoji,
  normalizeEmojiInput,
} from "@/lib/tasks/emoji-search";
import { authorizeEnrollmentReactionAccess } from "@/lib/enrollment/reaction-access";
import { filterEnrollmentRecipientsWithAccess } from "@/lib/enrollment/recipient-access";
import {
  insertEnrollmentNotifications,
  uniqueEnrollmentNotificationRecipients,
} from "@/lib/enrollment/notifications";
import type { ReactionRow } from "@/lib/tasks/reactions";
import {
  broadcastEnrollmentCommentReaction,
  readEnrollmentMutationSourceId,
} from "@/lib/enrollment/realtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };

async function readEmoji(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as {
    emoji?: unknown;
  } | null;
  if (typeof body?.emoji !== "string") return null;
  const emoji = normalizeEmojiInput(body.emoji);
  return isAllowedEmoji(emoji) ? emoji : null;
}

async function mutate(
  request: Request,
  context: Ctx,
  present: boolean,
): Promise<NextResponse> {
  const sourceId = readEnrollmentMutationSourceId(request);
  const { id, cid } = await context.params;
  const access = await authorizeEnrollmentReactionAccess(id);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const emoji = await readEmoji(request);
  if (!emoji) {
    return NextResponse.json({ error: "Unsupported emoji." }, { status: 400 });
  }

  const { data, error } = await access.supabase.rpc(
    "set_enrollment_comment_reaction_atomic",
    {
      p_comment_id: cid,
      p_record_id: id,
      p_reactor_email: access.email,
      p_emoji: emoji,
      p_present: present,
    },
  );
  if (error) {
    if (
      error.message.includes("COMMENT_NOT_FOUND") ||
      error.message.includes("ENROLLMENT_NOT_FOUND")
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
  after(async () => {
    const warnings: string[] = [];
    if (reactionChanged) {
      try {
        const { data: comment, error: commentError } = await access.supabase
          .from("enrollment_comments")
          .select("author_email")
          .eq("id", cid)
          .eq("record_id", id)
          .maybeSingle();
        if (commentError) throw new Error(commentError.message);
        const { data: recordRow, error: recordError } = await access.supabase
          .from("enrollment_records")
          .select("agent_email,caller_email,responsible_enroll_email,created_by_email")
          .eq("id", id)
          .maybeSingle();
        if (recordError) throw new Error(recordError.message);
        // Tác giả bình luận có thể đã ra khỏi scope của hồ sơ từ lúc viết (S15).
        const recipients = recordRow
          ? await filterEnrollmentRecipientsWithAccess(
              recordRow as {
                agent_email: string | null;
                caller_email: string | null;
                responsible_enroll_email: string | null;
                created_by_email: string;
              },
              uniqueEnrollmentNotificationRecipients([comment?.author_email], [access.email]),
            )
          : [];
        await insertEnrollmentNotifications(
          recipients.map((recipient) => ({
            recipient_email: recipient,
            record_id: id,
            type: "reacted" as const,
            actor_email: access.email,
            comment_id: cid,
            detail: emoji,
          })),
        );
      } catch (notificationError) {
        warnings.push(
          `Reaction notification failed: ${notificationError instanceof Error ? notificationError.message : "unknown error"}`,
        );
      }
    }
    const delivered = await broadcastEnrollmentCommentReaction(id, sourceId);
    if (!delivered) {
      warnings.push("Reaction broadcast failed.");
    }
    if (warnings.length > 0) {
      console.error("Enrollment comment reaction committed with side-effect warnings", {
        recordId: id,
        commentId: cid,
        warnings,
      });
    }
  });
  return NextResponse.json({ reactions: reactions as ReactionRow[], warnings: [] });
}

export async function PUT(request: Request, context: Ctx) {
  return mutate(request, context, true);
}

export async function DELETE(request: Request, context: Ctx) {
  return mutate(request, context, false);
}
