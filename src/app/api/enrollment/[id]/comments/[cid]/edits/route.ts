import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id, cid } = await params;
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data: comment, error: commentError } = await supabase
    .from("enrollment_comments")
    .select("record_id")
    .eq("id", cid)
    .maybeSingle();
  if (commentError) {
    return NextResponse.json({ error: commentError.message }, { status: 500 });
  }
  if (!comment || (comment as { record_id: string }).record_id !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("enrollment_comment_edits")
    .select("id,previous_body,edited_by,edited_at")
    .eq("comment_id", cid)
    .order("edited_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ edits: data ?? [] });
}
