import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildProviderRow, parseCreateProviderInput } from "@/lib/providers/create";
import { PORTAL_SOURCE, PROVIDER_SELECT, PROVIDER_TEXT_FIELDS } from "@/lib/providers/types";
import { validateCustomValues } from "@/lib/table-config/custom-values";
import { findMissingRequiredFieldsFromContext } from "@/lib/table-config/required";
import {
  TableConfigUnavailableError,
  fetchWriteValidationContext,
} from "@/lib/table-config/write-context";

export const dynamic = "force-dynamic";

/**
 * Provider List dùng chung quyền với Provider Finder — cùng một dữ liệu, cùng
 * một nhóm người dùng trong Automation Tool.
 */
async function gate() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false as const, status: 401, error: "Unauthorized" };
  if (!can(session.user.permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }
  return { ok: true as const, email };
}

export async function GET() {
  const actor = await gate();
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });

  // 889 dòng trên production: nạp hết một lần rồi lọc/sắp xếp ngay trong trình
  // duyệt. Thêm phân trang khi bảng thật sự lớn, không phải trước đó.
  const { data, error } = await getSupabaseAdmin()
    .from("provider_address")
    .select(PROVIDER_SELECT)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ providers: data ?? [] });
}

export async function POST(request: Request) {
  const actor = await gate();
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });

  const parsed = parseCreateProviderInput(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;
  const supabase = getSupabaseAdmin();

  const fieldValues = Object.fromEntries(
    PROVIDER_TEXT_FIELDS.map((field) => [field, input[field]])
  );

  let writeContext: Awaited<ReturnType<typeof fetchWriteValidationContext>>;
  try {
    writeContext = await fetchWriteValidationContext(
      {
        scope: "provider",
        mode: "create",
        touchedSystemKeys: Object.keys(fieldValues),
        touchedCustomKeys: Object.keys(input.customValues),
        submittedCustomValues: input.customValues,
      },
      supabase
    );
  } catch (error) {
    if (error instanceof TableConfigUnavailableError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 503 });
    }
    throw error;
  }

  const validated = validateCustomValues(input.customValues, writeContext);
  if (!validated.ok) {
    const first = validated.issues[0];
    return NextResponse.json(
      { error: `${first.key}: ${first.reason.replace(/-/g, " ")}.` },
      { status: 400 }
    );
  }

  const missingRequired = findMissingRequiredFieldsFromContext(writeContext, {
    fieldValues,
    customValues: validated.values,
  });
  if (missingRequired.length > 0) {
    return NextResponse.json(
      { error: `${missingRequired.map((field) => field.label).join(", ")} required.` },
      { status: 400 }
    );
  }

  // Số dòng kế tiếp TRONG phân vùng portal. Không đụng số của Sheet: hai phân
  // vùng độc lập, và khoá duy nhất chỉ đòi duy nhất trong cùng phân vùng.
  const { data: last, error: lastError } = await supabase
    .from("provider_address")
    .select("source_row_number")
    .eq("source_sheet_id", PORTAL_SOURCE.sheetId)
    .eq("source_gid", PORTAL_SOURCE.gid)
    .order("source_row_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) return NextResponse.json({ error: lastError.message }, { status: 500 });

  const nextRowNumber =
    ((last as { source_row_number?: number } | null)?.source_row_number ?? 0) + 1;

  const { data: provider, error: insertError } = await supabase
    .from("provider_address")
    .insert({
      ...buildProviderRow(input, { actorEmail: actor.email, nextRowNumber }),
      custom_values: validated.values,
    })
    .select(PROVIDER_SELECT)
    .single();
  if (insertError) {
    // 23505: hai người thêm cùng lúc và giành cùng một số dòng. Bảo họ thử lại
    // là đủ — lần sau số kế tiếp đã khác.
    if (insertError.code === "23505") {
      return NextResponse.json(
        { error: "Someone added a row at the same time. Try again." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ provider });
}
