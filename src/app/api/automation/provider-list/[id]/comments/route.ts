import { after, NextResponse } from "next/server";
import {
  broadcastProviderRoom,
  isProviderUuid,
  loadProviderCollabContext,
} from "@/lib/providers/collaboration";
import { notifyProviderMentions } from "@/lib/providers/notifications";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const context = await loadProviderCollabContext(id, { write: true });
  if (!context.ok) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  // Provider không có đính kèm, nên comment không chữ là comment rỗng.
  if (!text) return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  const requestId =
    typeof body?.client_request_id === "string" ? body.client_request_id : null;
  if (requestId !== null && !isProviderUuid(requestId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }
  const parentId =
    typeof body?.parentId === "string" && body.parentId.trim() !== "" ? body.parentId : null;
  if (parentId !== null && !isProviderUuid(parentId)) {
    return NextResponse.json({ error: "Invalid parent comment." }, { status: 400 });
  }

  const { data: created, error } = await context.supabase
    .rpc("create_provider_comment_idempotent", {
      p_provider_id: id,
      p_author_email: context.email,
      p_body: text,
      p_parent_id: parentId,
      p_client_request_id: requestId,
    })
    .single();
  if (error) {
    if (error.message.includes("INVALID_PARENT")) {
      return NextResponse.json({ error: "Invalid parent comment." }, { status: 400 });
    }
    if (error.message.includes("PROVIDER_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { comment, was_created: wasCreated } = created as {
    comment: { id: string };
    was_created: boolean;
  };
  // CommentThread giữ dòng tạm (đã có tên người viết) rồi tải lại detail, nên
  // không cần tra tên ở đây.
  const payload = { comment: { ...comment, attachments: [], reactions: [] }, warnings: [] };
  if (!wasCreated) return NextResponse.json(payload);

  after(async () => {
    const warnings: string[] = [];
    try {
      await notifyProviderMentions({
        providerId: id,
        commentId: comment.id,
        actorEmail: context.email,
        body: text,
      });
    } catch (mentionError) {
      warnings.push(
        `Provider mention notification failed: ${mentionError instanceof Error ? mentionError.message : "unknown error"}`
      );
    }
    if (!(await broadcastProviderRoom(id))) warnings.push("Provider comment broadcast failed.");
    if (warnings.length > 0) {
      console.error("Provider comment committed with side-effect warnings", {
        providerId: id,
        commentId: comment.id,
        warnings,
      });
    }
  });
  return NextResponse.json(payload);
}
