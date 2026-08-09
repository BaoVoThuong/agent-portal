import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  loadEnrollmentActor,
  normalizeEnrollmentActorEmail,
  resolveEnrollmentCapabilities,
} from "@/lib/enrollment/access";
import {
  buildEnrollmentStoragePath,
  removeTaskFile,
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
import {
  broadcastEnrollmentChanged,
  broadcastEnrollmentRoom,
} from "@/lib/enrollment/realtime";
import { fetchEnrollmentRecordById } from "@/lib/enrollment/queries";
import type { EnrollmentRecord } from "@/lib/enrollment/types";
import { loadScopedEnrollmentRecord } from "@/lib/enrollment/scope";
import { isAgentOwnerOrAssistant } from "@/lib/tasks/membership";

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
  } else {
    const isAgentOwner = await isAgentOwnerOrAssistant(
      context.record.agent_email,
      context.actor.email
    );
    const actorEmail = normalizeEnrollmentActorEmail(context.actor.email);
    const capabilities = resolveEnrollmentCapabilities(context.actor, {
      isAgentOwner,
      isCaller:
        normalizeEnrollmentActorEmail(context.record.caller_email) === actorEmail,
      isResponsible:
        normalizeEnrollmentActorEmail(context.record.responsible_enroll_email) ===
        actorEmail,
      isCreator:
        normalizeEnrollmentActorEmail(context.record.created_by_email) === actorEmail,
    });
    if (!capabilities.canEditFields) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const dataBuffer = await file.arrayBuffer();
  const validation = validateAttachmentFile(file.name, dataBuffer);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const storagePath = buildEnrollmentStoragePath(id, file.name);
  let signedUrl: string;
  try {
    await uploadTaskFile(storagePath, dataBuffer, validation.contentType);
    // Sign before creating metadata so a signing failure cannot leave a DB row
    // that makes the next upload appear to have failed and invites duplicates.
    signedUrl = await signTaskFile(storagePath);
  } catch (error) {
    try {
      await removeTaskFile(storagePath);
    } catch (cleanupError) {
      console.error("Enrollment attachment cleanup failed after upload error", {
        recordId: id,
        storagePath,
        error: cleanupError,
      });
    }
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
  if (error) {
    try {
      await removeTaskFile(storagePath);
    } catch (cleanupError) {
      console.error("Enrollment attachment cleanup failed after metadata error", {
        recordId: id,
        storagePath,
        error: cleanupError,
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const mutationWarnings: string[] = [];
  if (!commentId) {
    const { error: activityError } = await context.supabase.from("enrollment_activity").insert({
      record_id: id,
      actor_email: context.actor.email,
      type: "attachment_added",
      meta: { file_name: file.name },
    });
    if (activityError) mutationWarnings.push(`Attachment activity failed: ${activityError.message}`);
    const recipients = uniqueEnrollmentNotificationRecipients(
      [context.record.caller_email, context.record.responsible_enroll_email],
      [context.actor.email]
    );
    try {
      await insertEnrollmentNotifications(
        recipients.map((recipient) => ({
          recipient_email: recipient,
          record_id: id,
          type: "attachment_added",
          actor_email: context.actor.email,
          detail: file.name,
        }))
      );
    } catch (notificationError) {
      mutationWarnings.push(
        `Attachment notification failed: ${notificationError instanceof Error ? notificationError.message : "unknown error"}`
      );
    }
  }

  try {
    await broadcastEnrollmentChanged(context.record.program);
    await broadcastEnrollmentRoom(id);
  } catch (broadcastError) {
    mutationWarnings.push(
      `Attachment broadcast failed: ${broadcastError instanceof Error ? broadcastError.message : "unknown error"}`
    );
  }
  let canonicalRecord: Awaited<ReturnType<typeof fetchEnrollmentRecordById>> = null;
  try {
    canonicalRecord = await fetchEnrollmentRecordById(id);
  } catch (reloadError) {
    mutationWarnings.push(
      `Attachment parent reload failed: ${reloadError instanceof Error ? reloadError.message : "unknown error"}`
    );
  }
  if (mutationWarnings.length > 0) {
    console.error("Enrollment attachment committed with side-effect warnings", {
      recordId: id,
      warnings: mutationWarnings,
    });
  }
  return NextResponse.json({
    attachment: {
      ...(data as object),
      url: signedUrl,
    },
    record: canonicalRecord,
    warnings: mutationWarnings,
  });
}

async function loadRecordContext(id: string) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return { error: actorResult.error, status: actorResult.status } as const;
  }

  const scoped = await loadScopedEnrollmentRecord(id, actorResult.actor);
  if (!scoped.ok) {
    return { error: scoped.error, status: scoped.status } as const;
  }
  const supabase = getSupabaseAdmin();

  return {
    actor: actorResult.actor,
    supabase,
    record: scoped.record as EnrollmentRecord,
  };
}
