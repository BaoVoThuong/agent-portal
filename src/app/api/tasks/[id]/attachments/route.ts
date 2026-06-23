import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildTaskActor, canViewTask, canMutateTask } from "@/lib/tasks/access";
import { buildStoragePath, uploadTaskFile, signTaskFile } from "@/lib/tasks/storage";
import type { TaskRow } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const MAX_BYTES = 15 * 1024 * 1024; // 15MB

async function loadActorAndTask(id: string) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { error: "Unauthorized" as const, status: 401 };
  const actor = buildTaskActor(session.user.permissions, email);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("tasks")
    .select("id,assignee_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Not found", status: 404 };
  return { actor, task: data as unknown as Pick<TaskRow, "id" | "assignee_email">, supabase };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canViewTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { data, error } = await r.supabase
    .from("task_attachments")
    .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("task_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const attachments = await Promise.all(
    (data ?? []).map(async (a) => {
      const row = a as {
        id: string;
        file_name: string;
        mime_type: string | null;
        size_bytes: number | null;
        storage_path: string;
        created_at: string;
      };
      return {
        id: row.id,
        file_name: row.file_name,
        mime_type: row.mime_type,
        size_bytes: row.size_bytes,
        created_at: row.created_at,
        url: await signTaskFile(row.storage_path),
      };
    })
  );
  return NextResponse.json({ attachments });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await loadActorAndTask(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!canMutateTask(r.actor, r.task))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File))
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (file.size > MAX_BYTES)
    return NextResponse.json({ error: "File too large (max 15MB)." }, { status: 400 });

  const path = buildStoragePath(id, file.name);
  const contentType = file.type || "application/octet-stream";
  await uploadTaskFile(path, await file.arrayBuffer(), contentType);

  const { data, error } = await r.supabase
    .from("task_attachments")
    .insert({
      task_id: id,
      storage_path: path,
      file_name: file.name,
      mime_type: contentType,
      size_bytes: file.size,
      uploaded_by: r.actor.email,
    })
    .select("id,file_name,mime_type,size_bytes,created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await r.supabase.from("task_activity").insert({
    task_id: id,
    actor_email: r.actor.email,
    type: "attachment_added",
    meta: { file_name: file.name },
  });

  return NextResponse.json({
    attachment: { ...(data as object), url: await signTaskFile(path) },
  });
}
