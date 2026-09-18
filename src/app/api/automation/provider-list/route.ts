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
import { RouteTiming } from "@/lib/server-timing";

export const dynamic = "force-dynamic";

/**
 * Provider List dùng chung quyền với Provider Finder — cùng một dữ liệu, cùng
 * một nhóm người dùng trong Automation Tool.
 */
async function gate(timing?: RouteTiming) {
  const session = timing
    ? await timing.measure("auth", () => auth())
    : await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false as const, status: 401, error: "Unauthorized" };
  if (!can(session.user.permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }
  return { ok: true as const, email };
}

export async function GET() {
  const timing = new RouteTiming("provider-list");
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("Server-Timing", timing.headerValue());
    timing.log(status);
    return response;
  };

  try {
    const actor = await gate(timing);
    if (!actor.ok) return respond({ error: actor.error }, actor.status);

    // 458 dòng sau khi làm sạch: nạp hết một lần rồi lọc/sắp xếp ngay trong trình
    // duyệt. Timing này giúp biết khi nào cần chuyển sang server-side pagination.
    const { data, error } = await timing.measure("provider_query", async () =>
      getSupabaseAdmin()
        .from(PROVIDER_TABLE)
        .select(PROVIDER_SELECT)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(5000),
    );
    if (error) return respond({ error: error.message }, 500);
    return respond({ providers: data ?? [] });
  } catch (error) {
    return respond(
      { error: error instanceof Error ? error.message : "Unable to load providers." },
      500,
    );
  }
}

export async function POST(request: Request) {
  const timing = new RouteTiming("provider-list-create");
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("Server-Timing", timing.headerValue());
    timing.log(status);
    return response;
  };

  try {
    const actor = await gate(timing);
    if (!actor.ok) return respond({ error: actor.error }, actor.status);

    const parsed = parseCreateProviderInput(
      await timing.measure("parse_body", () => request.json().catch(() => null)),
    );
    if (!parsed.ok) return respond({ error: parsed.error }, 400);
    const input = parsed.value;
    const supabase = getSupabaseAdmin();

    const fieldValues = Object.fromEntries(
      PROVIDER_TEXT_FIELDS.map((field) => [field, input[field]])
    );

    let writeContext: Awaited<ReturnType<typeof fetchWriteValidationContext>>;
    try {
      writeContext = await timing.measure("write_context", () =>
        fetchWriteValidationContext(
          {
            scope: "provider",
            mode: "create",
            touchedSystemKeys: Object.keys(fieldValues),
            touchedCustomKeys: Object.keys(input.customValues),
            submittedCustomValues: input.customValues,
          },
          supabase
        ),
      );
    } catch (error) {
      if (error instanceof TableConfigUnavailableError) {
        return respond({ error: error.message, code: error.code }, 503);
      }
      throw error;
    }

    const validated = validateCustomValues(input.customValues, writeContext);
    if (!validated.ok) {
      const first = validated.issues[0];
      return respond(
        { error: `${first.key}: ${first.reason.replace(/-/g, " ")}.` },
        400,
      );
    }

    const missingRequired = findMissingRequiredFieldsFromContext(writeContext, {
      fieldValues,
      customValues: validated.values,
    });
    if (missingRequired.length > 0) {
      return respond(
        { error: `${missingRequired.map((field) => field.label).join(", ")} required.` },
        400,
      );
    }

    // Khoá của bảng sạch là uuid do database sinh, nên hai người thêm cùng lúc
    // không còn giành nhau con số nào — bỏ hẳn vòng truy vấn "số dòng kế tiếp"
    // và nhánh xử lý trùng khoá đi kèm nó.
    const { data: provider, error: insertError } = await timing.measure(
      "provider_insert",
      async () =>
        supabase
          .from(PROVIDER_TABLE)
          .insert({
            ...buildProviderRow(input, { actorEmail: actor.email }),
            custom_values: validated.values,
          })
          .select(PROVIDER_SELECT)
          .single(),
    );
    if (insertError) {
      return respond({ error: insertError.message }, 500);
    }

    return respond({ provider });
  } catch (error) {
    return respond(
      { error: error instanceof Error ? error.message : "Unable to create provider." },
      500,
    );
  }
}
