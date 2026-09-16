import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildProviderPatch } from "@/lib/providers/patch";
import { PROVIDER_SELECT, isPortalRow } from "@/lib/providers/types";
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

/** Sửa ô ngay trên bảng, và archive một dòng. Cùng quyền với Provider Finder. */
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
  const { data: current, error: currentError } = await supabase
    .from("provider_address")
    .select("id,source_sheet_id,custom_values")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (currentError) {
    return NextResponse.json({ error: currentError.message }, { status: 500 });
  }
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const currentRow = current as {
    source_sheet_id: string;
    custom_values?: Record<string, unknown> | null;
  };

  const parsed = buildProviderPatch(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const patch: Record<string, unknown> = { ...parsed.patch };
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

  const { data: provider, error: updateError } = await supabase
    .from("provider_address")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by_email: email.trim().toLowerCase(),
    })
    .eq("id", id)
    .select(PROVIDER_SELECT)
    .single();
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    provider,
    // Dòng đến từ Sheet bị thay mới mỗi đêm, nên chỉnh sửa tay trên nó chỉ sống
    // tới 02:00 CT. Nói ngay lúc lưu, chứ không để người dùng phát hiện vào
    // sáng hôm sau.
    warning: isPortalRow(currentRow)
      ? undefined
      : "This row comes from the Google Sheet. The nightly sync will overwrite this edit until the sync is turned off.",
  });
}
