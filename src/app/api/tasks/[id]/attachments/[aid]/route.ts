import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canMutateTask } from "@/lib/tasks/access";
import { removeTaskFile } from "@/lib/tasks/storage";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; aid: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, aid } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildTaskActor(session.user.permissions, email);

  const supabase = getSupabaseAdmin();
  const { data: task } = await supabase
    .from("tasks")
    .select("id,assignee_email")
    .eq("id", id)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canMutateTask(actor, task as Pick<TaskRow, "assignee_email">))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data: att } = await supabase
    .from("task_attachments")
    .select("id,task_id,storage_path,uploaded_by")
    .eq("id", aid)
    .maybeSingle();
  const attachment = att as
    | { task_id: string; storage_path: string; uploaded_by: string | null }
    | null;
  if (!attachment || attachment.task_id !== id)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Uploader or manager only.
  if (!actor.isManager && attachment.uploaded_by !== email)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await removeTaskFile(attachment.storage_path);
  const { error } = await supabase.from("task_attachments").delete().eq("id", aid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
