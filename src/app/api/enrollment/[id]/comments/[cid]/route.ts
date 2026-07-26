import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { broadcastEnrollmentRoom } from "@/lib/enrollment/realtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };

const COMMENT_COLUMNS =
  "id,record_id,parent_id,author_email,body,created_at,updated_at,deleted_at";

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, cid } = await params;
  const context = await loadAuthorContext(id, cid);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  if (context.currentBody !== text) {
    await context.supabase.from("enrollment_comment_edits").insert({
      comment_id: cid,
      previous_body: context.currentBody,
      edited_by: context.email,
    });
  }

  const { data, error } = await context.supabase
    .from("enrollment_comments")
    .update({ body: text, updated_at: new Date().toISOString() })
    .eq("id", cid)
    .select(COMMENT_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastEnrollmentRoom(id);
  return NextResponse.json({ comment: data });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, cid } = await params;
  const context = await loadAuthorContext(id, cid);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const { error } = await context.supabase
    .from("enrollment_comments")
    .update({ body: "", deleted_at: new Date().toISOString() })
    .eq("id", cid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastEnrollmentRoom(id);
  return NextResponse.json({ ok: true });
}

async function loadAuthorContext(id: string, cid: string) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return { error: actorResult.error, status: actorResult.status } as const;
  }

  const supabase = getSupabaseAdmin();
  const [{ data: record }, { data: comment, error: commentError }] = await Promise.all([
    supabase
      .from("enrollment_records")
      .select("id")
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle(),
    supabase
      .from("enrollment_comments")
      .select("id,record_id,author_email,body")
      .eq("id", cid)
      .maybeSingle(),
  ]);
  if (commentError) return { error: commentError.message, status: 500 } as const;
  if (!record || !comment) return { error: "Not found", status: 404 } as const;

  const commentRow = comment as {
    record_id: string;
    author_email: string;
    body: string;
  };
  if (commentRow.record_id !== id) return { error: "Not found", status: 404 } as const;
  if (commentRow.author_email !== actorResult.actor.email) {
    return { error: "Forbidden", status: 403 } as const;
  }

  return {
    supabase,
    email: actorResult.actor.email,
    currentBody: commentRow.body,
  };
}
