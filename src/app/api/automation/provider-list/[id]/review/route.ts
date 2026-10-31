import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canReviewProviderBacklog, canViewProviders } from "@/lib/providers/access";
import { providerMergeChanges } from "@/lib/providers/backlog";
import { providerFieldChanges } from "@/lib/providers/activity";
import { insertProviderActivity, isProviderUuid } from "@/lib/providers/collaboration";
import { PROVIDER_STAMP_TIME_ZONE, todayForColumn } from "@/lib/providers/form";
import { notifyProviderBacklogDecision } from "@/lib/providers/notifications";
import { buildProviderPatch } from "@/lib/providers/patch";
import {
  PROVIDER_SELECT,
  PROVIDER_TABLE,
  PROVIDER_TEXT_FIELDS,
  type ProviderRow,
} from "@/lib/providers/types";
import { fetchTableColumns } from "@/lib/table-config/queries";
import { personLabel } from "@/lib/tasks/people";

export const dynamic = "force-dynamic";

const MAX_REASON_LENGTH = 500;

type Ctx = { params: Promise<{ id: string }> };
type ReviewAction = "approve" | "merge" | "reject";

function isReviewAction(value: unknown): value is ReviewAction {
  return value === "approve" || value === "merge" || value === "reject";
}

/**
 * Duyệt một dòng Backlog — chỉ người có Provider List - Manage.
 *
 *   approve  Verify: dòng vào danh sách (giữ nguyên id, nên comment / activity
 *            đi theo), Reviewed bật, Verified by / date đóng dấu người duyệt.
 *            Cũng là "Add as new" của một dòng bị tag Duplicate.
 *   merge    Update existing: chép phần khác biệt (`providerMergeChanges`) sang
 *            dòng đã có mà nó trùng, đóng dấu Verified trên dòng đó, rồi đóng
 *            dòng Backlog lại.
 *   reject   Đóng dòng Backlog (archive), kèm lý do nếu có.
 *
 * Mọi lượt ghi đều có điều kiện `pending = true AND archived_at IS NULL`: hai
 * người duyệt cùng lúc thì người sau nhận 409, không ai duyệt một dòng hai lần.
 */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewProviders(session.user.permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canReviewProviderBacklog(session.user.permissions)) {
    return NextResponse.json(
      { error: "Only Provider List managers can review the Backlog." },
      { status: 403 }
    );
  }
  if (!isProviderUuid(id)) {
    return NextResponse.json({ error: "Invalid provider id." }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: unknown; reason?: unknown }
    | null;
  if (!isReviewAction(body?.action)) {
    return NextResponse.json({ error: "Unknown review action." }, { status: 400 });
  }
  const action = body.action;
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, MAX_REASON_LENGTH)
      : null;

  const supabase = getSupabaseAdmin();
  const { data: current, error: currentError } = await supabase
    .from(PROVIDER_TABLE)
    .select(PROVIDER_SELECT)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (currentError) {
    return NextResponse.json({ error: currentError.message }, { status: 500 });
  }
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const submission = current as unknown as ProviderRow;
  if (!submission.pending) {
    return NextResponse.json(
      { error: "This row is no longer in the Backlog." },
      { status: 409 }
    );
  }

  const actorEmail = email.trim().toLowerCase();
  const now = new Date().toISOString();
  const alreadyReviewed = NextResponse.json(
    { error: "Someone already reviewed this row. Reload the Backlog." },
    { status: 409 }
  );
  const notifySubmitter = (input: {
    providerId: string;
    type: "approved" | "rejected";
    detail?: string | null;
  }) =>
    after(async () => {
      try {
        await notifyProviderBacklogDecision({
          ...input,
          actorEmail,
          submitterEmail: submission.created_by_email,
        });
      } catch (error) {
        console.error("provider.backlog.notify_failed", {
          stage: input.type,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    });

  if (action === "reject") {
    const { data, error } = await supabase
      .from(PROVIDER_TABLE)
      .update({ archived_at: now, updated_at: now, updated_by_email: actorEmail })
      .eq("id", id)
      .eq("pending", true)
      .is("archived_at", null)
      .select("id")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return alreadyReviewed;
    await insertProviderActivity(supabase, [
      { provider_id: id, actor_email: actorEmail, type: "rejected", meta: reason ? { reason } : null },
    ]);
    notifySubmitter({ providerId: id, type: "rejected", detail: reason });
    return NextResponse.json({ removedBacklogId: id });
  }

  // Verify thì đóng dấu người duyệt, đúng cách ô Reviewed trên form vẫn làm:
  // tên chứ không phải email, ngày theo giờ văn phòng.
  const columns = await fetchTableColumns("provider");
  const stamp = {
    needs_review: false,
    verified_by: personLabel(
      email,
      session.user.name ? new Map([[email, session.user.name]]) : undefined
    ),
    date: todayForColumn(
      columns.find((column) => column.key === "date"),
      new Date(),
      PROVIDER_STAMP_TIME_ZONE
    ),
  };

  if (action === "approve") {
    const { data, error } = await supabase
      .from(PROVIDER_TABLE)
      .update({
        ...stamp,
        pending: false,
        duplicate_of: null,
        updated_at: now,
        updated_by_email: actorEmail,
      })
      .eq("id", id)
      .eq("pending", true)
      .is("archived_at", null)
      .select(PROVIDER_SELECT)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return alreadyReviewed;
    await insertProviderActivity(supabase, [
      { provider_id: id, actor_email: actorEmail, type: "approved" },
    ]);
    notifySubmitter({ providerId: id, type: "approved" });
    return NextResponse.json({ provider: data, removedBacklogId: id });
  }

  // merge — "Update existing".
  if (!submission.duplicate_of) {
    return NextResponse.json(
      { error: "This row does not match an address in the list. Verify it instead." },
      { status: 400 }
    );
  }
  const { data: existingData, error: existingError } = await supabase
    .from(PROVIDER_TABLE)
    .select(PROVIDER_SELECT)
    .eq("id", submission.duplicate_of)
    .eq("pending", false)
    .is("archived_at", null)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }
  if (!existingData) {
    return NextResponse.json(
      { error: "The matching address is no longer in the list. Verify this row as new instead." },
      { status: 409 }
    );
  }
  const existing = existingData as unknown as ProviderRow;

  const changes = providerMergeChanges(submission, existing);
  const textFields = new Set<string>(PROVIDER_TEXT_FIELDS);
  const textPatch = Object.fromEntries(
    changes.filter((change) => textFields.has(change.key)).map((change) => [change.key, change.to])
  );
  const customChanges = Object.fromEntries(
    changes.filter((change) => !textFields.has(change.key)).map((change) => [change.key, change.to])
  );
  // Qua đúng đường chuẩn hoá của lượt sửa tay: cùng luật cắt chuỗi, viết hoa
  // bang, và xoá toạ độ geocode khi địa chỉ đổi.
  const parsed = buildProviderPatch({ ...textPatch, ...stamp });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const mergePatch: Record<string, unknown> = { ...parsed.patch };
  if (Object.keys(customChanges).length > 0) {
    mergePatch.custom_values = { ...(existing.custom_values ?? {}), ...customChanges };
  }

  // Cả hai dòng được khoá, kiểm phiên bản rồi ghi trong cùng transaction.
  // Nếu đích vừa bị sửa hoặc một người khác đã duyệt, không chép bản cũ đè lên.
  const { data: updated, error: updateError } = await supabase.rpc(
    "merge_provider_backlog_atomic",
    {
      p_submission_id: id,
      p_target_id: existing.id,
      p_submission_updated_at: submission.updated_at,
      p_target_updated_at: existing.updated_at,
      p_patch: mergePatch,
      p_actor_email: actorEmail,
    }
  );
  if (updateError) {
    const conflict = updateError.message.includes("BACKLOG_CONFLICT");
    return NextResponse.json(
      {
        error: conflict
          ? "This row or its matching address changed. Reload the Backlog and review again."
          : updateError.message,
      },
      { status: conflict ? 409 : 500 }
    );
  }
  if (!updated) return NextResponse.json({ error: "Could not update the address." }, { status: 500 });

  const savedChanges = providerFieldChanges(existing, updated as ProviderRow);
  await insertProviderActivity(supabase, [
    ...(savedChanges.length > 0
      ? [
          {
            provider_id: existing.id,
            actor_email: actorEmail,
            type: "field_changed" as const,
            meta: {
              changes: savedChanges,
              source: "backlog",
              submission_id: id,
              submitted_by: submission.created_by_email,
            },
          },
        ]
      : []),
    { provider_id: id, actor_email: actorEmail, type: "merged", meta: { into: existing.id } },
  ]);
  notifySubmitter({ providerId: existing.id, type: "approved", detail: "merged" });
  return NextResponse.json({ provider: updated, removedBacklogId: id });
}
