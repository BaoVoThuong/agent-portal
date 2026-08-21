import { after, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import {
  broadcastEnrollmentRoom,
  readEnrollmentMutationSourceId,
} from "@/lib/enrollment/realtime";
import { removeTaskFile } from "@/lib/enrollment/storage";
import { insertEnrollmentNotifications } from "@/lib/enrollment/notifications";
import { loadScopedEnrollmentRecord } from "@/lib/enrollment/scope";
import { parseMentions } from "@/lib/tasks/mentions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; cid: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const sourceId = readEnrollmentMutationSourceId(request);
  const { id, cid } = await params;
  const context = await loadAuthorContext(id, cid);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text) return NextResponse.json({ error: "Comment is empty." }, { status: 400 });

  const expectedUpdatedAt =
    typeof body?.expected_updated_at === "string" ? body.expected_updated_at : null;
  const { data: edited, error } = await context.supabase
    .rpc("edit_enrollment_comment_atomic", {
      p_comment_id: cid,
      p_record_id: id,
      p_actor_email: context.email,
      p_body: text,
      p_expected_updated_at: expectedUpdatedAt,
    })
    .single();
  if (error) {
    if (error.message.includes("COMMENT_CONFLICT")) {
      return NextResponse.json(
        { error: "This comment was edited somewhere else. Refresh to see the latest version." },
        { status: 409 },
      );
    }
    if (error.message.includes("FORBIDDEN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error.message.includes("COMMENT_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error.message.includes("COMMENT_DELETED")) {
      return NextResponse.json({ error: "Comment is deleted." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { comment, parent_updated_at: parentUpdatedAt } = edited as {
    comment: Record<string, unknown>;
    parent_updated_at: string;
  };
  const warnings: string[] = [];
  try {
    const { data: people, error: peopleError } = await context.supabase
      .from("portal_account")
      .select("email")
      .eq("is_active", true);
    if (peopleError) throw new Error(peopleError.message);
    const activeEmails = new Set(
      ((people ?? []) as { email: string }[]).map((person) => person.email.trim().toLowerCase()),
    );
    const mentionsNow = parseMentions(text).filter((email) => activeEmails.has(email.toLowerCase()));
    const mentionsBefore = parseMentions(context.currentBody);
    const newMentions = mentionsNow.filter(
      (email) => !mentionsBefore.some((previous) => previous.toLowerCase() === email.toLowerCase()),
    );
    if (newMentions.length > 0) {
      await insertEnrollmentNotifications(
        newMentions.map((recipient) => ({
          recipient_email: recipient,
          record_id: id,
          type: "mentioned" as const,
          actor_email: context.email,
          comment_id: cid,
        })),
      );
    }
  } catch (mentionError) {
    warnings.push(
      `Enrollment mention notification failed: ${mentionError instanceof Error ? mentionError.message : "unknown error"}`,
    );
  }
  after(async () => {
    const delivered = await broadcastEnrollmentRoom(id, sourceId);
    if (!delivered) {
      console.error("Enrollment comment edit broadcast failed after commit", {
        recordId: id,
        commentId: cid,
      });
    }
  });
  return NextResponse.json({ comment, parent_updated_at: parentUpdatedAt, warnings });
}

export async function DELETE(request: Request, { params }: Ctx) {
  const sourceId = readEnrollmentMutationSourceId(request);
  const { id, cid } = await params;
  const context = await loadAuthorContext(id, cid);
  if ("error" in context) {
    return NextResponse.json({ error: context.error }, { status: context.status });
  }

  const { data: deleted, error } = await context.supabase
    .rpc("delete_enrollment_comment_atomic", {
      p_comment_id: cid,
      p_record_id: id,
      p_actor_email: context.email,
    })
    .single();
  if (error) {
    if (error.message.includes("FORBIDDEN")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error.message.includes("COMMENT_NOT_FOUND")) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row = deleted as {
    storage_paths?: string[] | null;
    parent_updated_at?: string | null;
  };
  const cleanup = await Promise.allSettled(
    (row.storage_paths ?? []).map((path) => removeTaskFile(path)),
  );
  const warnings = cleanup
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) =>
      result.reason instanceof Error
        ? result.reason.message
        : "Could not remove comment attachment storage object.",
    );
  if (warnings.length > 0) {
    console.error("Enrollment comment attachment cleanup failed", {
      recordId: id,
      commentId: cid,
      warnings,
    });
  }
  after(async () => {
    const delivered = await broadcastEnrollmentRoom(id, sourceId);
    if (!delivered) {
      console.error("Enrollment comment delete broadcast failed after commit", {
        recordId: id,
        commentId: cid,
      });
    }
  });
  return NextResponse.json({
    ok: true,
    parent_updated_at: row.parent_updated_at ?? undefined,
    warnings,
  });
}

async function loadAuthorContext(id: string, cid: string) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return { error: actorResult.error, status: actorResult.status } as const;
  }

  const scoped = await loadScopedEnrollmentRecord(id, actorResult.actor);
  if (!scoped.ok) {
    return { error: scoped.error, status: scoped.status } as const;
  }
  const supabase = getSupabaseAdmin();
  const { data: comment, error: commentError } = await supabase
    .from("enrollment_comments")
    .select("id,record_id,author_email,body,updated_at,deleted_at")
    .eq("id", cid)
    .maybeSingle();
  if (commentError) return { error: commentError.message, status: 500 } as const;
  if (!comment) return { error: "Not found", status: 404 } as const;

  const commentRow = comment as {
    record_id: string;
    author_email: string;
    body: string;
    updated_at: string;
    deleted_at: string | null;
  };
  if (commentRow.record_id !== id) return { error: "Not found", status: 404 } as const;
  if (commentRow.author_email !== actorResult.actor.email) {
    return { error: "Forbidden", status: 403 } as const;
  }

  return {
    supabase,
    email: actorResult.actor.email,
    currentBody: commentRow.body,
    currentUpdatedAt: commentRow.updated_at,
  };
}
