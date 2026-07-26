import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { removeTaskFile } from "@/lib/enrollment/storage";
import { broadcastEnrollmentRoom } from "@/lib/enrollment/realtime";

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

  const supabase = getSupabaseAdmin();
  const [{ data: record }, { data: attachment, error: attachmentError }] =
    await Promise.all([
      supabase
        .from("enrollment_records")
        .select("id")
        .eq("id", id)
        .is("archived_at", null)
        .maybeSingle(),
      supabase
        .from("enrollment_attachments")
        .select("id,record_id,storage_path,uploaded_by")
        .eq("id", aid)
        .maybeSingle(),
    ]);
  if (attachmentError) {
    return NextResponse.json({ error: attachmentError.message }, { status: 500 });
  }
  const attachmentRow = attachment as
    | { record_id: string; storage_path: string; uploaded_by: string }
    | null;
  if (!record || !attachmentRow || attachmentRow.record_id !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!actorResult.actor.isManager && attachmentRow.uploaded_by !== actorResult.actor.email) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await removeTaskFile(attachmentRow.storage_path);
  const { error } = await supabase.from("enrollment_attachments").delete().eq("id", aid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastEnrollmentRoom(id);
  return NextResponse.json({ ok: true });
}
