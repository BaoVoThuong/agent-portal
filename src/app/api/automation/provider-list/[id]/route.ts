import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canManageProviders, canReviewProviderBacklog } from "@/lib/providers/access";
import { findProviderDuplicate } from "@/lib/providers/backlog";
import { fetchLiveProviderKeys } from "@/lib/providers/backlog-queries";
import { buildProviderPatch } from "@/lib/providers/patch";
import { PROVIDER_SELECT, PROVIDER_TABLE, type ProviderRow } from "@/lib/providers/types";
import { providerFieldChanges } from "@/lib/providers/activity";
import {
  PROVIDER_STAMP_TIME_ZONE,
  todayForColumn,
  trustedVerifiedStamp,
} from "@/lib/providers/form";
import { personLabel } from "@/lib/tasks/people";
import { insertProviderActivity } from "@/lib/providers/collaboration";
import { validateCustomValues } from "@/lib/table-config/custom-values";
import { findMissingRequiredFieldsFromContext } from "@/lib/table-config/required";
import {
  TableConfigUnavailableError,
  fetchWriteValidationContext,
} from "@/lib/table-config/write-context";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

/** Những ô `findProviderDuplicate` so. */
const DUPLICATE_KEY_FIELDS = ["doctors", "facility", "npi", "street", "zip_code"] as const;

/**
 * Sửa ô ngay trên bảng (quyền Provider Finder), và archive một dòng (quyền Manage).
 *
 * Dòng ở Backlog (`pending`) thì chặt hơn: chỉ người gửi và người duyệt được sửa
 * hay rút lại, vì đó là đề xuất của một người chứ chưa phải dữ liệu chung.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(session.user.permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid provider id." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  // Đọc cả dòng (không chỉ custom_values) để Activity ghi được "cũ → mới".
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
  const currentRow = current as unknown as ProviderRow;

  const parsed = buildProviderPatch(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const actorEmail = email.trim().toLowerCase();
  const isSubmitter = currentRow.created_by_email?.trim().toLowerCase() === actorEmail;
  if (
    currentRow.pending &&
    !isSubmitter &&
    !canReviewProviderBacklog(session.user.permissions)
  ) {
    return NextResponse.json(
      { error: "Only the person who sent this row or a Provider List manager can change it." },
      { status: 403 }
    );
  }
  // Xoá (archive) một address là việc của tầng Manage; sửa ô thì không cần.
  // Người gửi thì rút lại được dòng Backlog của chính mình.
  // Kiểm ở đây chứ không chỉ ẩn nút trên giao diện — ẩn nút không phải là quyền.
  if (
    "archived_at" in parsed.patch &&
    !canManageProviders(session.user.permissions) &&
    !(currentRow.pending && isSubmitter)
  ) {
    return NextResponse.json({ error: "You cannot delete addresses." }, { status: 403 });
  }
  const patch: Record<string, unknown> = { ...parsed.patch };
  // Dòng Backlog chỉ thành "đã soát" qua nút Verify của người duyệt
  // (review/route.ts) — ô Reviewed trên form không đi đường tắt được.
  if (currentRow.pending) delete patch.needs_review;
  const submittedCustomValues = parsed.customValues ?? {};

  let writeContext: Awaited<ReturnType<typeof fetchWriteValidationContext>>;
  try {
    writeContext = await fetchWriteValidationContext(
      {
        scope: "provider",
        mode: "patch",
        touchedSystemKeys: Object.keys(parsed.patch),
        touchedCustomKeys: Object.keys(submittedCustomValues),
        submittedCustomValues,
      },
      supabase
    );
  } catch (error) {
    if (error instanceof TableConfigUnavailableError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }
    throw error;
  }

  // Form gửi cả hai ô đã khóa để giữ payload đồng nhất, nhưng chỉ server mới
  // quyết định được người/ngày soát. Bỏ Reviewed thì giữ đúng dấu cũ.
  Object.assign(patch, trustedVerifiedStamp({
    currentNeedsReview: currentRow.needs_review,
    nextNeedsReview: typeof patch.needs_review === "boolean"
      ? patch.needs_review
      : currentRow.needs_review,
    currentVerifiedBy: currentRow.verified_by,
    currentDate: currentRow.date,
    actorName: personLabel(
      email,
      session.user.name ? new Map([[email, session.user.name]]) : undefined,
    ),
    date: todayForColumn(
      writeContext.columns.find((column) => column.key === "date"),
      new Date(),
      PROVIDER_STAMP_TIME_ZONE,
    ),
  }));

  if (parsed.customValues) {
    const validated = validateCustomValues(parsed.customValues, writeContext);
    if (!validated.ok) {
      const first = validated.issues[0];
      return NextResponse.json(
        { error: `${first.key}: ${first.reason.replace(/-/g, " ")}.` },
        { status: 400 }
      );
    }
    // Vá từng khoá, không thay cả object: bảng gửi lên đúng ô vừa sửa, ghi đè
    // cả cụm sẽ xoá mất những cột tuỳ chỉnh khác của dòng đó.
    patch.custom_values = {
      ...(currentRow.custom_values ?? {}),
      ...validated.values,
    };
  }

  // partial: true — chỉ kiểm những trường bắt buộc mà request này thật sự
  // đụng tới, nên một lần sửa ô không liên quan không bị chặn.
  const missingRequired = findMissingRequiredFieldsFromContext(writeContext, {
    fieldValues: parsed.patch,
    customValues: (patch.custom_values as Record<string, unknown>) ?? null,
    partial: true,
  });
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { error: `${missingRequired.map((field) => field.label).join(", ")} required.` },
      { status: 400 }
    );
  }

  // Sửa tên / NPI / địa chỉ của dòng Backlog thì dò trùng lại: tag Duplicate
  // phải nói về dòng như nó đang là, không phải như lúc mới gửi.
  if (
    currentRow.pending &&
    !("archived_at" in patch) &&
    DUPLICATE_KEY_FIELDS.some((key) => key in patch)
  ) {
    patch.duplicate_of = findProviderDuplicate(
      { ...currentRow, ...patch } as ProviderRow,
      (await fetchLiveProviderKeys(supabase)).filter((row) => row.id !== id),
    );
  }

  const { data: provider, error: updateError } = await supabase
    .from(PROVIDER_TABLE)
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by_email: actorEmail,
    })
    .eq("id", id)
    .eq("pending", currentRow.pending)
    .eq("updated_at", currentRow.updated_at)
    .is("archived_at", null)
    .select(PROVIDER_SELECT)
    .maybeSingle();
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!provider) {
    return NextResponse.json(
      { error: "This address changed while you were editing it. Reload and try again." },
      { status: 409 }
    );
  }

  // Ghi trong request (một lượt insert), không để after(): Activity là lịch sử
  // nghiệp vụ. Lỗi chỉ ghi log — lượt sửa đã lưu thì không báo hỏng.
  if ("archived_at" in parsed.patch) {
    await insertProviderActivity(supabase, [
      { provider_id: id, actor_email: actorEmail, type: "archived" },
    ]);
  } else {
    const changes = providerFieldChanges(currentRow, provider as unknown as ProviderRow);
    if (changes.length > 0) {
      await insertProviderActivity(supabase, [
        { provider_id: id, actor_email: actorEmail, type: "field_changed", meta: { changes } },
      ]);
    }
  }

  return NextResponse.json({ provider });
}
