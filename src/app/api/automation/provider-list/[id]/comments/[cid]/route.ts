import { after, NextResponse } from "next/server";
import {
  broadcastProviderRoom,
  isProviderUuid,
  loadProviderCollabContext,
} from "@/lib/providers/collaboration";
import { notifyProviderMentions } from "@/lib/providers/notifications";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, cid } = await params;
  const context = await loadAuthorContext(id, cid);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Comment is empty." }, { status: 400 });
  const expectedUpdatedAt =
    typeof body?.expected_updated_at === "string" ? body.expected_updated_at : null;

  const { data: edited, error } = await context.supabase
    .rpc("edit_provider_comment_atomic", {
      p_comment_id: cid,
      p_provider_id: id,
      p_actor_email: context.email,
      p_body: text,
      p_expected_updated_at: expectedUpdatedAt,
    })
    .single();
  if (error) {
    if (error.message.includes("COMMENT_CONFLICT")) {
      return NextResponse.json(
        { error: "This comment was edited somewhere else. Refresh to see the latest version." },
        { status: 409 }
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

  const { comment } = edited as { comment: Record<string, unknown> };
  after(async () => {
    const warnings: string[] = [];
    try {
      // Chỉ báo người được tag MỚI trong lần sửa này.
      await notifyProviderMentions({
        providerId: id,
        commentId: cid,
        actorEmail: context.email,
        body: text,
        previousBody: context.currentBody,
      });
    } catch (mentionError) {
      warnings.push(
        `Provider mention notification failed: ${mentionError instanceof Error ? mentionError.message : "unknown error"}`
      );
    }
    if (!(await broadcastProviderRoom(id))) warnings.push("Comment edit broadcast failed.");
    if (warnings.length > 0) {
      console.error("Provider comment edit committed with side-effect warnings", {
        providerId: id,
        commentId: cid,
        warnings,
      });
    }
  });
  return NextResponse.json({ comment, warnings: [] });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, cid } = await params;
  const context = await loadAuthorContext(id, cid);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const { error } = await context.supabase
    .rpc("delete_provider_comment_atomic", {
      p_comment_id: cid,
      p_provider_id: id,
      p_actor_email: context.email,
    })
    .single();
  if (error) {
    if (error.message.includes("FORBIDDEN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error.message.includes("COMMENT_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  after(async () => {
    if (!(await broadcastProviderRoom(id))) {
      console.error("Provider comment delete committed with side-effect warnings", {
        providerId: id,
        commentId: cid,
        warnings: ["Comment delete broadcast failed."],
      });
    }
  });
  return NextResponse.json({ ok: true, warnings: [] });
}

/** Chỉ tác giả sửa/xoá được comment của mình — RPC kiểm lại lần nữa dưới database. */
async function loadAuthorContext(id: string, cid: string) {
  if (!isProviderUuid(cid)) return { error: "Not found", status: 404 } as const;
  const context = await loadProviderCollabContext(id, { write: true });
  if (!context.ok) return { error: context.error, status: context.status } as const;

  const { data: comment, error } = await context.supabase
    .from("provider_comments")
    .select("provider_id,author_email,body")
    .eq("id", cid)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 } as const;
  const row = comment as { provider_id: string; author_email: string; body: string } | null;
  if (!row || row.provider_id !== id) return { error: "Not found", status: 404 } as const;
  if (row.author_email.trim().toLowerCase() !== context.email) {
    return { error: "Forbidden", status: 403 } as const;
  }
  return { supabase: context.supabase, email: context.email, currentBody: row.body };
}
