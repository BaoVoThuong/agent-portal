import { NextResponse } from "next/server";
import type { ReactionRow } from "@/lib/tasks/reactions";
import { loadProviderCollabContext } from "@/lib/providers/collaboration";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Ảnh chụp reaction nhẹ mà CommentThread tải lại khi có tín hiệu realtime. */
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const context = await loadProviderCollabContext(id);
  if (!context.ok) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }
  const { data, error } = await context.supabase.rpc("provider_comment_reactions_for_provider", {
    p_provider_id: id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const response = NextResponse.json({ reactions: (data ?? []) as ReactionRow[] });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
