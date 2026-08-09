import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { broadcastEnrollmentRoom } from "@/lib/enrollment/realtime";
import { loadScopedEnrollmentRecord } from "@/lib/enrollment/scope";

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

  const { error: touchError } = await context.supabase.rpc("enrollment_touch_activity", {
    p_record_id: id,
    p_actor_email: context.email,
    p_now: new Date().toISOString(),
  });
  if (touchError) console.error("Enrollment comment edit activity touch failed", touchError);

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

  const { error: touchError } = await context.supabase.rpc("enrollment_touch_activity", {
    p_record_id: id,
    p_actor_email: context.email,
    p_now: new Date().toISOString(),
  });
  if (touchError) console.error("Enrollment comment delete activity touch failed", touchError);

  await broadcastEnrollmentRoom(id);
  return NextResponse.json({ ok: true });
}

async function loadAuthorContext(id: string, cid: string) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return { error: actorResult.error, status: actorResult.status } as const;
  }

  const scoped = await loadScopedEnrollmentRecord(id, actorResult.actor);
  if (!scoped.ok) {
    return { error: scoped.error, status: scoped.status } as const;
  }
  const supabase = getSupabaseAdmin();
  const { data: comment, error: commentError } = await supabase
    .from("enrollment_comments")
    .select("id,record_id,author_email,body")
    .eq("id", cid)
    .maybeSingle();
  if (commentError) return { error: commentError.message, status: 500 } as const;
  if (!comment) return { error: "Not found", status: 404 } as const;

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
