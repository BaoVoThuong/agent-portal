import { after, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import {
  insertEnrollmentNotifications,
  uniqueEnrollmentNotificationRecipients,
} from "@/lib/enrollment/notifications";
import {
  broadcastEnrollmentChanged,
  broadcastEnrollmentRoom,
  readEnrollmentMutationSourceId,
} from "@/lib/enrollment/realtime";
import { loadScopedEnrollmentRecord } from "@/lib/enrollment/scope";
import { parseMentions } from "@/lib/tasks/mentions";
import type { EnrollmentRecord } from "@/lib/enrollment/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const COMMENT_COLUMNS =
  "id,record_id,parent_id,author_email,body,client_request_id,created_at,updated_at,deleted_at";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    .is("deleted_at", null)
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
  const sourceId = readEnrollmentMutationSourceId(request);
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

  const requestId =
    typeof body?.client_request_id === "string" ? body.client_request_id : null;
  if (requestId !== null && !UUID_RE.test(requestId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  const { data: created, error } = await loaded.supabase
    .rpc("create_enrollment_comment_idempotent", {
      p_record_id: id,
      p_author_email: loaded.actor.email,
      p_body: text,
      p_parent_id:
        typeof body?.parentId === "string" && body.parentId.trim() !== ""
          ? body.parentId
          : null,
      p_client_request_id: requestId,
    })
    .single();
  if (error) {
    if (error.message.includes("INVALID_PARENT")) {
      return NextResponse.json({ error: "Invalid parent comment." }, { status: 400 });
    }
    if (error.message.includes("ENROLLMENT_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const {
    comment,
    parent_updated_at: parentUpdatedAt,
    was_created: wasCreated,
  } = created as {
    comment: { id: string };
    parent_updated_at: string;
    was_created: boolean;
  };
  if (!wasCreated) {
    return NextResponse.json({
      comment: { ...(comment as object), attachments: [] },
      parent_updated_at: parentUpdatedAt,
      warnings: [],
    });
  }

  after(async () => {
    const warnings: string[] = [];
    try {
      const { error: activityError } = await loaded.supabase.from("enrollment_activity").insert({
        record_id: id,
        actor_email: loaded.actor.email,
        type: "comment_added",
        meta: null,
      });
      if (activityError) {
        warnings.push(`Enrollment comment activity failed: ${activityError.message}`);
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

      await insertEnrollmentNotifications([
        ...mentionRecipients.map((recipient) => ({
          recipient_email: recipient,
          record_id: id,
          type: "mentioned" as const,
          actor_email: loaded.actor.email,
          comment_id: comment.id,
        })),
        ...baseRecipients.map((recipient) => ({
          recipient_email: recipient,
          record_id: id,
          type: mentionSet.has(recipient) ? ("mentioned" as const) : ("commented" as const),
          actor_email: loaded.actor.email,
          comment_id: comment.id,
        })),
      ]);
    } catch (error) {
      warnings.push(
        `Enrollment comment side effect failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }

    try {
      const delivered = await Promise.all([
        broadcastEnrollmentChanged(loaded.record.program, sourceId),
        broadcastEnrollmentRoom(id, sourceId),
      ]);
      if (!delivered.every(Boolean)) {
        warnings.push("Enrollment comment broadcast failed.");
      }
    } catch (error) {
      warnings.push(
        `Enrollment comment broadcast failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }

    if (warnings.length > 0) {
      console.error("Enrollment comment committed with side-effect warnings", {
        recordId: id,
        commentId: comment.id,
        warnings,
      });
    }
  });
  return NextResponse.json({
    comment: { ...(comment as object), attachments: [] },
    // The comment moved the record's updated_at above, which is the token
    // PATCH sends as expected_updated_at for the 409 concurrency check. Same
    // field name as the CS comments route so the shared CommentThread reads
    // one field for both.
    parent_updated_at: parentUpdatedAt,
    warnings: [],
  });
}

async function loadContext(id: string) {
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
