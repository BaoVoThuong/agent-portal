import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { removeTaskFile } from "@/lib/enrollment/storage";
import { broadcastEnrollmentRoom } from "@/lib/enrollment/realtime";
import { loadScopedEnrollmentRecord } from "@/lib/enrollment/scope";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; aid: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, aid } = await params;
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const scoped = await loadScopedEnrollmentRecord(id, actorResult.actor);
  if (!scoped.ok) {
    return NextResponse.json({ error: scoped.error }, { status: scoped.status });
  }
  const supabase = getSupabaseAdmin();
  const { data: attachment, error: attachmentError } = await supabase
    .from("enrollment_attachments")
    .select("id,record_id,storage_path,uploaded_by")
    .eq("id", aid)
    .maybeSingle();
  if (attachmentError) {
    return NextResponse.json({ error: attachmentError.message }, { status: 500 });
  }
  const attachmentRow = attachment as
    | { record_id: string; storage_path: string; uploaded_by: string }
    | null;
  if (!attachmentRow || attachmentRow.record_id !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!actorResult.actor.isManager && attachmentRow.uploaded_by !== actorResult.actor.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Remove metadata first so a storage failure cannot leave a visible broken
  // attachment row. A failed cleanup is returned as a repair warning instead
  // of turning a committed delete into a retryable 5xx.
  const { data: deleted, error } = await supabase
    .from("enrollment_attachments")
    .delete()
    .eq("id", aid)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const warnings: string[] = [];
  const { error: touchError } = await supabase.rpc("enrollment_touch_activity", {
    p_record_id: id,
    p_actor_email: actorResult.actor.email,
    p_now: new Date().toISOString(),
  });
  if (touchError) warnings.push(`Attachment activity touch failed: ${touchError.message}`);
  try {
    await removeTaskFile(attachmentRow.storage_path);
  } catch (storageError) {
    warnings.push(
      `Attachment storage cleanup failed: ${storageError instanceof Error ? storageError.message : "unknown error"}`
    );
  }
  try {
    await broadcastEnrollmentRoom(id);
  } catch (broadcastError) {
    warnings.push(
      `Attachment broadcast failed: ${broadcastError instanceof Error ? broadcastError.message : "unknown error"}`
    );
  }
  if (warnings.length > 0) {
    console.error("Enrollment attachment delete committed with warnings", {
      recordId: id,
      attachmentId: aid,
      warnings,
    });
  }
  return NextResponse.json({ ok: true, warnings });
}
