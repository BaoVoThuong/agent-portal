import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import {
  insertEnrollmentNotifications,
  uniqueEnrollmentNotificationRecipients,
} from "@/lib/enrollment/notifications";
import {
  broadcastEnrollmentChanged,
  broadcastEnrollmentRoom,
} from "@/lib/enrollment/realtime";
import { fetchEnrollmentRecordById } from "@/lib/enrollment/queries";
import { resolveEnrollmentParentUpdatedAt } from "@/lib/enrollment/comments";
import { parseMentions } from "@/lib/tasks/mentions";
import type { EnrollmentRecord } from "@/lib/enrollment/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const COMMENT_COLUMNS =
  "id,record_id,parent_id,author_email,body,created_at,updated_at,deleted_at";

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const loaded = await loadContext(id);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const { data, error } = await loaded.supabase
    .from("enrollment_comments")
    .select(COMMENT_COLUMNS)
    .eq("record_id", id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    comments: ((data ?? []) as { id: string }[]).map((comment) => ({
      ...(comment as object),
      attachments: [],
    })),
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const loaded = await loadContext(id);
  if ("error" in loaded) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  // An attachment-only comment is valid: the client creates the comment first,
  // then uploads files against its id, so the text can legitimately be empty.
  const hasAttachments = body?.hasAttachments === true;
  if (!text && !hasAttachments)
    return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  let parentId: string | null = null;
  if (typeof body?.parentId === "string" && body.parentId.trim() !== "") {
    const { data: parent } = await loaded.supabase
      .from("enrollment_comments")
      .select("id,record_id,parent_id")
      .eq("id", body.parentId)
      .maybeSingle();
    const parentRow = parent as
      | { record_id: string; parent_id: string | null }
      | null;
    if (!parentRow || parentRow.record_id !== id || parentRow.parent_id !== null) {
      return NextResponse.json({ error: "Invalid parent comment." }, { status: 400 });
    }
    parentId = body.parentId;
  }

  const { data: comment, error } = await loaded.supabase
    .from("enrollment_comments")
    .insert({
      record_id: id,
      parent_id: parentId,
      author_email: loaded.actor.email,
      body: text,
    })
    .select(COMMENT_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const nowIso = new Date().toISOString();
  const mutationWarnings: string[] = [];
  const { data: touchedParent, error: parentError } = await loaded.supabase
    .from("enrollment_records")
    .update({
      updated_at: nowIso,
      updated_by_email: loaded.actor.email,
    })
    .eq("id", id)
    .select("updated_at")
    .maybeSingle();
  if (parentError) {
    mutationWarnings.push(`Enrollment parent update failed: ${parentError.message}`);
  } else if (!touchedParent) {
    mutationWarnings.push("Enrollment parent update returned no row.");
  }
  const { error: activityError } = await loaded.supabase.from("enrollment_activity").insert({
    record_id: id,
    actor_email: loaded.actor.email,
    type: "comment_added",
    meta: null,
  });
  if (activityError) {
    mutationWarnings.push(`Enrollment comment activity failed: ${activityError.message}`);
  }

  const [peopleRes, authorsRes] = await Promise.all([
    loaded.supabase.from("portal_account").select("email").eq("is_active", true),
    loaded.supabase
      .from("enrollment_comments")
      .select("author_email")
      .eq("record_id", id)
      .is("deleted_at", null),
  ]);
  const activeEmails = new Set(
    ((peopleRes.data ?? []) as { email: string }[]).map((person) => person.email)
  );
  const mentions = parseMentions(text).filter((email) => activeEmails.has(email));
  const mentionSet = new Set(mentions);
  const threadWatchers = ((authorsRes.data ?? []) as { author_email: string }[]).map(
    (row) => row.author_email
  );
  const baseRecipients = uniqueEnrollmentNotificationRecipients(
    [
      loaded.record.caller_email,
      loaded.record.responsible_enroll_email,
      ...threadWatchers,
    ],
    [loaded.actor.email, ...mentions]
  );
  const mentionRecipients = uniqueEnrollmentNotificationRecipients(mentions, [
    loaded.actor.email,
  ]);

  try {
    await insertEnrollmentNotifications([
      ...mentionRecipients.map((recipient) => ({
        recipient_email: recipient,
        record_id: id,
        type: "mentioned" as const,
        actor_email: loaded.actor.email,
        comment_id: (comment as { id: string }).id,
      })),
      ...baseRecipients.map((recipient) => ({
        recipient_email: recipient,
        record_id: id,
        type: mentionSet.has(recipient) ? ("mentioned" as const) : ("commented" as const),
        actor_email: loaded.actor.email,
        comment_id: (comment as { id: string }).id,
      })),
    ]);
  } catch (error) {
    mutationWarnings.push(
      `Enrollment comment notification failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }

  try {
    await broadcastEnrollmentChanged(loaded.record.program);
    await broadcastEnrollmentRoom(id);
  } catch (error) {
    mutationWarnings.push(
      `Enrollment comment broadcast failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  let canonicalRecord: EnrollmentRecord | null = null;
  try {
    canonicalRecord = await fetchEnrollmentRecordById(id);
  } catch (error) {
    mutationWarnings.push(
      `Enrollment canonical reload failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
  const canonicalParentUpdatedAt = resolveEnrollmentParentUpdatedAt(
    canonicalRecord?.updated_at,
    (touchedParent as { updated_at?: string | null } | null)?.updated_at
  );
  if (mutationWarnings.length > 0) {
    console.error("Enrollment comment committed with side-effect warnings", {
      recordId: id,
      warnings: mutationWarnings,
    });
  }
  return NextResponse.json({
    comment: { ...(comment as object), attachments: [] },
    record: canonicalRecord,
    // The comment moved the record's updated_at above, which is the token
    // PATCH sends as expected_updated_at for the 409 concurrency check. Same
    // field name as the CS comments route so the shared CommentThread reads
    // one field for both.
    parent_updated_at: canonicalParentUpdatedAt,
    warnings: mutationWarnings,
  });
}

async function loadContext(id: string) {
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
