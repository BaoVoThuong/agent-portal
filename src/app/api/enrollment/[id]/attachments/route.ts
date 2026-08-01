import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  canMutateEnrollmentRecord,
  loadEnrollmentActor,
} from "@/lib/enrollment/access";
import {
  buildEnrollmentStoragePath,
  signTaskFile,
  uploadTaskFile,
} from "@/lib/enrollment/storage";
import {
  attachmentTooLargeMessage,
  TASK_ATTACHMENT_MAX_BYTES,
  validateAttachmentFile,
} from "@/lib/tasks/attachments";
import {
  insertEnrollmentNotifications,
  uniqueEnrollmentNotificationRecipients,
} from "@/lib/enrollment/notifications";
import { broadcastEnrollmentRoom } from "@/lib/enrollment/realtime";
import { fetchEnrollmentRecordById } from "@/lib/enrollment/queries";
import type { EnrollmentRecord } from "@/lib/enrollment/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const context = await loadRecordContext(id);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const { data, error } = await context.supabase
    .from("enrollment_attachments")
    .select("id,file_name,mime_type,size_bytes,storage_path,created_at")
    .eq("record_id", id)
    .is("comment_id", null)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const attachments = await Promise.all(
    ((data ?? []) as {
      id: string;
      file_name: string;
      mime_type: string | null;
      size_bytes: number | null;
      storage_path: string;
      created_at: string;
    }[]).map(async (row) => ({
      id: row.id,
      file_name: row.file_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
      url: await signTaskFile(row.storage_path),
    }))
  );

  return NextResponse.json({ attachments });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const context = await loadRecordContext(id);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > TASK_ATTACHMENT_MAX_BYTES) {
    return NextResponse.json(
      { error: attachmentTooLargeMessage() },
      { status: 400 }
    );
  }

  const rawCommentId = form?.get("comment_id");
  const commentId =
    typeof rawCommentId === "string" && rawCommentId.trim() !== ""
      ? rawCommentId.trim()
      : null;

  if (commentId) {
    const { data: comment } = await context.supabase
      .from("enrollment_comments")
      .select("id,record_id,author_email")
      .eq("id", commentId)
      .maybeSingle();
    const commentRow = comment as
      | { record_id: string; author_email: string }
      | null;
    if (
      !commentRow ||
      commentRow.record_id !== id ||
      commentRow.author_email !== context.actor.email
    ) {
      return NextResponse.json({ error: "Invalid comment." }, { status: 400 });
    }
  } else if (!canMutateEnrollmentRecord(context.actor, context.record)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dataBuffer = await file.arrayBuffer();
  const validation = validateAttachmentFile(file.name, dataBuffer);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const storagePath = buildEnrollmentStoragePath(id, file.name);
  try {
    await uploadTaskFile(storagePath, dataBuffer, validation.contentType);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not upload attachment.",
      },
      { status: 500 }
    );
  }

  const { data, error } = await context.supabase
    .from("enrollment_attachments")
    .insert({
      record_id: id,
      comment_id: commentId,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: validation.contentType,
      size_bytes: file.size,
      uploaded_by: context.actor.email,
    })
    .select("id,file_name,mime_type,size_bytes,created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!commentId) {
    await context.supabase.from("enrollment_activity").insert({
      record_id: id,
      actor_email: context.actor.email,
      type: "attachment_added",
      meta: { file_name: file.name },
    });
    const recipients = uniqueEnrollmentNotificationRecipients(
      [context.record.caller_email, context.record.responsible_enroll_email],
      [context.actor.email]
    );
    await insertEnrollmentNotifications(
      recipients.map((recipient) => ({
        recipient_email: recipient,
        record_id: id,
        type: "attachment_added",
        actor_email: context.actor.email,
        detail: file.name,
      }))
    );
  }

  await broadcastEnrollmentRoom(id);
  return NextResponse.json({
    attachment: {
      ...(data as object),
      url: await signTaskFile(storagePath),
    },
    record: await fetchEnrollmentRecordById(id),
  });
}

async function loadRecordContext(id: string) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return { error: actorResult.error, status: actorResult.status } as const;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("enrollment_records")
    .select("*")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 } as const;
  if (!data) return { error: "Not found", status: 404 } as const;

  return {
    actor: actorResult.actor,
    supabase,
    record: data as EnrollmentRecord,
  };
}
