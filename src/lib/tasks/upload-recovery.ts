import { getSupabaseAdmin } from "@/lib/supabase";
import { attachmentTouchesRecord } from "@/lib/enrollment/attachment-touch";
import { verifyDirectUpload } from "./direct-upload";
import { removeTaskFile, signTaskFile } from "./storage";
import {
  completeUploadIntent,
  failUploadIntent,
  recoverUploadIntents,
  type UploadIntent,
  type UploadIntentKind,
} from "./upload-intents";

/** Complete a Storage object using the actor and destination saved before its
 * signed token was issued. Any authorized viewer's detail read can repair it. */
export async function finalizeSavedIntent(
  intent: UploadIntent,
  emit: (intent: UploadIntent) => Promise<void> = emitRecoverySideEffects,
): Promise<boolean> {
  const verified = await verifyDirectUpload(intent.storage_path, intent.file_name, intent.size_bytes);
  if (!verified.ok) {
    if (verified.status === 400 && verified.error !== "The upload did not finish. Please try again.") {
      await failUploadIntent(intent, verified.error);
    }
    return false;
  }
  // Preserve the old invariant: a transient signing outage must leave the
  // object retryable rather than committing a row with no usable link.
  await signTaskFile(intent.storage_path);
  const supabase = getSupabaseAdmin();
  let newlyCreated = false;
  if (intent.kind === "task") {
    const { data, error } = await supabase.rpc("create_task_attachment_atomic", {
      p_task_id: intent.record_id,
      p_comment_id: intent.comment_id,
      p_storage_path: intent.storage_path,
      p_file_name: intent.file_name,
      p_mime_type: verified.contentType,
      p_size_bytes: verified.size,
      p_uploaded_by: intent.uploaded_by,
      p_client_request_id: intent.client_request_id,
    }).single();
    if (error) {
      if (/ATTACHMENT_(FILE|AGGREGATE|COUNT)_LIMIT|INVALID_COMMENT|TASK_NOT_FOUND/.test(error.message)) {
        await failUploadIntent(intent, "Attachment could not be added to this comment or task.");
        await removeTaskFile(intent.storage_path).catch(() => undefined);
        return false;
      }
      throw new Error(error.message);
    }
    newlyCreated = Boolean((data as { was_created?: boolean } | null)?.was_created);
  } else if (intent.kind === "lead") {
    const { error } = await supabase.rpc("create_lead_attachment_atomic", {
      p_lead_id: intent.record_id,
      p_storage_path: intent.storage_path,
      p_file_name: intent.file_name,
      p_mime_type: verified.contentType,
      p_size_bytes: verified.size,
      p_uploaded_by: intent.uploaded_by,
      p_client_request_id: intent.client_request_id,
    }).single();
    if (error) {
      if (/LEAD_ATTACHMENT_COUNT_LIMIT|ATTACHMENT_FILE_LIMIT|LEAD_NOT_FOUND/.test(error.message)) {
        await failUploadIntent(intent, "Attachment could not be added to this lead.");
        await removeTaskFile(intent.storage_path).catch(() => undefined);
        return false;
      }
      throw new Error(error.message);
    }
  } else {
    const { data: existing, error: lookupError } = await supabase
      .from("enrollment_attachments")
      .select("id,storage_path")
      .eq("record_id", intent.record_id)
      .eq("uploaded_by", intent.uploaded_by)
      .eq("client_request_id", intent.client_request_id)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (existing && existing.storage_path !== intent.storage_path) {
      throw new Error("Upload request already belongs to another object.");
    }
    if (!existing) {
      const { error } = await supabase.from("enrollment_attachments").insert({
        record_id: intent.record_id,
        comment_id: intent.comment_id,
        storage_path: intent.storage_path,
        file_name: intent.file_name,
        mime_type: verified.contentType,
        size_bytes: verified.size,
        uploaded_by: intent.uploaded_by,
        client_request_id: intent.client_request_id,
      });
      if (error && error.code !== "23505") {
        if (error.code === "23503") {
          await failUploadIntent(intent, "The comment or enrollment record no longer exists.");
          await removeTaskFile(intent.storage_path).catch(() => undefined);
          return false;
        }
        throw new Error(error.message);
      }
      if (error?.code === "23505") {
        const { data: replay, error: replayError } = await supabase
          .from("enrollment_attachments")
          .select("storage_path")
          .eq("record_id", intent.record_id)
          .eq("uploaded_by", intent.uploaded_by)
          .eq("client_request_id", intent.client_request_id)
          .maybeSingle();
        if (replayError || replay?.storage_path !== intent.storage_path) {
          throw new Error(replayError?.message ?? "Attachment request conflict.");
        }
      }
      if (!error && attachmentTouchesRecord(intent.comment_id)) {
        const { error: touchError } = await supabase.rpc("enrollment_touch_activity", {
          p_record_id: intent.record_id,
          p_actor_email: intent.uploaded_by,
          p_now: new Date().toISOString(),
        });
        if (touchError) console.warn("[attachment recovery] enrollment activity touch failed", touchError.message);
      }
      newlyCreated = !error;
    }
  }
  if (newlyCreated) {
    await emit(intent).catch((reason) =>
      console.warn("[attachment recovery] side effects failed", {
        kind: intent.kind, recordId: intent.record_id,
        reason: reason instanceof Error ? reason.message : "unknown",
      }),
    );
  }
  await completeUploadIntent(intent);
  return true;
}

async function emitRecoverySideEffects(intent: UploadIntent): Promise<void> {
  if (intent.kind === "task") {
    const [realtime, assignees, membership, notifications] = await Promise.all([
      import("./realtime"),
      import("./assignees"),
      import("./membership"),
      import("./notifications"),
    ]);
    const supabase = getSupabaseAdmin();
    await Promise.all([
      realtime.broadcastTaskRoom(intent.record_id),
      realtime.broadcastTasksChanged(),
    ]);
    if (intent.comment_id || intent.silent) return;
    const { data: task, error } = await supabase.from("tasks")
      .select("agent_email,reporter_email")
      .eq("id", intent.record_id)
      .maybeSingle();
    if (error || !task) return;
    const [assigned, assistants] = await Promise.all([
      assignees.fetchTaskAssigneeEmails(intent.record_id, supabase),
      membership.fetchAgentAssistantEmails(task.agent_email),
    ]);
    const recipients = notifications.uniqueNotificationRecipients(
      [...assigned, task.reporter_email, ...assistants],
      [intent.uploaded_by],
    );
    await notifications.insertNotifications(recipients.map((recipient) => ({
      recipient_email: recipient,
      task_id: intent.record_id,
      type: "attachment_added" as const,
      actor_email: intent.uploaded_by,
      detail: intent.file_name,
    })));
  } else if (intent.kind === "enrollment") {
    const [realtime, notifications] = await Promise.all([
      import("@/lib/enrollment/realtime"),
      import("@/lib/enrollment/notifications"),
    ]);
    const supabase = getSupabaseAdmin();
    const { data: record, error } = await supabase.from("enrollment_records")
      .select("*")
      .eq("id", intent.record_id)
      .maybeSingle();
    if (error || !record) return;
    await Promise.all([
      realtime.broadcastEnrollmentChanged(record.program),
      realtime.broadcastEnrollmentRoom(intent.record_id),
    ]);
    if (intent.comment_id) return;
    await supabase.from("enrollment_activity").insert({
      record_id: intent.record_id,
      actor_email: intent.uploaded_by,
      type: "attachment_added",
      meta: { file_name: intent.file_name },
    });
    const recipients = notifications.uniqueEnrollmentNotificationRecipients(
      notifications.enrollmentRecordOwnerEmails(record),
      [intent.uploaded_by],
    );
    await notifications.insertEnrollmentNotifications(recipients.map((recipient) => ({
      recipient_email: recipient,
      record_id: intent.record_id,
      type: "attachment_added" as const,
      actor_email: intent.uploaded_by,
      detail: intent.file_name,
    })));
  }
}

export async function recoverSavedAttachments(
  kind: UploadIntentKind,
  recordId: string,
): Promise<number> {
  try {
    return await recoverUploadIntents(kind, recordId, finalizeSavedIntent);
  } catch (reason) {
    // A missing migration or transient DB outage must not take down detail
    // reads. The pending object can be recovered on a later request.
    console.warn("[attachment recovery] unavailable", {
      kind, recordId,
      reason: reason instanceof Error ? reason.message : "unknown",
    });
    return 0;
  }
}
