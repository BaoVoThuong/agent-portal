import { after, NextResponse } from "next/server";
import { isAllowedEmoji, normalizeEmojiInput } from "@/lib/tasks/emoji-search";
import type { ReactionRow } from "@/lib/tasks/reactions";
import {
  broadcastProviderCommentReaction,
  isProviderUuid,
  loadProviderCollabContext,
} from "@/lib/providers/collaboration";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };

async function readEmoji(request: Request): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as { emoji?: unknown } | null;
  if (typeof body?.emoji !== "string") return null;
  const emoji = normalizeEmojiInput(body.emoji);
  return isAllowedEmoji(emoji) ? emoji : null;
}

// Reaction cũng là "viết": chỉ tầng Manage (user chốt 25/10 — người chỉ xem
// đọc được comment nhưng không tham gia). Không gửi thông báo: chuông của
// Provider hiện chỉ báo @mention.
async function mutate(request: Request, context: Ctx, present: boolean) {
  const { id, cid } = await context.params;
  if (!isProviderUuid(cid)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const access = await loadProviderCollabContext(id, { write: true });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const emoji = await readEmoji(request);
  if (!emoji) return NextResponse.json({ error: "Unsupported emoji." }, { status: 400 });

  const { data, error } = await access.supabase.rpc("set_provider_comment_reaction_atomic", {
    p_comment_id: cid,
    p_provider_id: id,
    p_reactor_email: access.email,
    p_emoji: emoji,
    p_present: present,
  });
  if (error) {
    if (error.message.includes("COMMENT_NOT_FOUND")) {
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

  const reactions = ((data ?? []) as Array<ReactionRow & { changed?: boolean }>).map((row) => ({
    comment_id: row.comment_id,
    emoji: row.emoji,
    reactor_email: row.reactor_email,
  }));
  after(async () => {
    if (!(await broadcastProviderCommentReaction(id))) {
      console.error("Provider comment reaction committed with side-effect warnings", {
        providerId: id,
        commentId: cid,
        warnings: ["Reaction broadcast failed."],
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
