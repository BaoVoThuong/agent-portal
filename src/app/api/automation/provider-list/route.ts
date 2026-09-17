import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildProviderRow, parseCreateProviderInput } from "@/lib/providers/create";
import { PROVIDER_SELECT, PROVIDER_TABLE, PROVIDER_TEXT_FIELDS } from "@/lib/providers/types";
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

  // 458 dòng sau khi làm sạch: nạp hết một lần rồi lọc/sắp xếp ngay trong trình
  // duyệt. Thêm phân trang khi bảng thật sự lớn, không phải trước đó.
  const { data, error } = await getSupabaseAdmin()
    .from(PROVIDER_TABLE)
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

  // Khoá của bảng sạch là uuid do database sinh, nên hai người thêm cùng lúc
  // không còn giành nhau con số nào — bỏ hẳn vòng truy vấn "số dòng kế tiếp"
  // và nhánh xử lý trùng khoá đi kèm nó.
  const { data: provider, error: insertError } = await supabase
    .from(PROVIDER_TABLE)
    .insert({
      ...buildProviderRow(input, { actorEmail: actor.email }),
      custom_values: validated.values,
    })
    .select(PROVIDER_SELECT)
    .single();
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ provider });
}
