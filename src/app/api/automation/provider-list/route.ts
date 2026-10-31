import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { canAddProviders, canViewProviders, providerWritesGoLive } from "@/lib/providers/access";
import { findProviderDuplicate, pendingProviderFields } from "@/lib/providers/backlog";
import { fetchBacklogProviderRows, fetchLiveProviderKeys } from "@/lib/providers/backlog-queries";
import { notifyProviderBacklogSubmitted } from "@/lib/providers/notifications";
import { buildProviderRow, parseCreateProviderInput } from "@/lib/providers/create";
import { PROVIDER_SELECT, PROVIDER_TABLE, PROVIDER_TEXT_FIELDS } from "@/lib/providers/types";
import { validateCustomValues } from "@/lib/table-config/custom-values";
import { findMissingRequiredFieldsFromContext } from "@/lib/table-config/required";
import {
  TableConfigUnavailableError,
  fetchWriteValidationContext,
} from "@/lib/table-config/write-context";
import { RouteTiming } from "@/lib/server-timing";
import { insertProviderActivity } from "@/lib/providers/collaboration";
import {
  PROVIDER_STAMP_TIME_ZONE,
  todayForColumn,
  trustedVerifiedStamp,
} from "@/lib/providers/form";
import { personLabel } from "@/lib/tasks/people";

export const dynamic = "force-dynamic";

/**
 * Provider List dùng chung quyền với Provider Finder — cùng một dữ liệu, cùng
 * một nhóm người dùng trong Automation Tool.
 */
async function gate(timing?: RouteTiming, options: { add?: boolean } = {}) {
  const session = timing
    ? await timing.measure("auth", () => auth())
    : await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false as const, status: 401, error: "Unauthorized" };
  if (!canViewProviders(session.user.permissions)) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }
  // Ai xem được bảng cũng thêm được (2026-10-26); khác nhau ở chỗ dòng vào
  // thẳng danh sách hay vào Backlog — xem lib/providers/access.ts.
  if (options.add && !canAddProviders(session.user.permissions)) {
    return { ok: false as const, status: 403, error: "You cannot add addresses." };
  }
  return {
    ok: true as const,
    email,
    name: session.user.name,
    goesLive: providerWritesGoLive(session.user.permissions),
  };
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
    // Backlog đi cùng chuyến: nhập file xong thì cả hai tab đều có thể đã đổi.
    const supabase = getSupabaseAdmin();
    const [live, backlog] = await Promise.all([
      timing.measure("provider_query", async () =>
        supabase
          .from(PROVIDER_TABLE)
          .select(PROVIDER_SELECT)
          .eq("pending", false)
          .is("archived_at", null)
          .order("updated_at", { ascending: false })
          .limit(5000),
      ),
      timing.measure("backlog_query", () => fetchBacklogProviderRows(supabase)),
    ]);
    if (live.error) return respond({ error: live.error.message }, 500);
    return respond({ providers: live.data ?? [], backlog });
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
    const actor = await gate(timing, { add: true });
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

    // Vào Backlog thì chưa ai duyệt: không đóng dấu Verified, người duyệt đóng
    // dấu lúc Verify (`pendingProviderFields`).
    const stamp = actor.goesLive
      ? trustedVerifiedStamp({
          currentNeedsReview: null,
          nextNeedsReview: input.needsReview ?? false,
          actorName: personLabel(
            actor.email,
            actor.name ? new Map([[actor.email, actor.name]]) : undefined,
          ),
          date: todayForColumn(
            writeContext.columns.find((column) => column.key === "date"),
            new Date(),
            PROVIDER_STAMP_TIME_ZONE,
          ),
        })
      : { verified_by: null, date: null };
    input.verified_by = stamp.verified_by;
    input.date = stamp.date;
    fieldValues.verified_by = stamp.verified_by;
    fieldValues.date = stamp.date;

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

    // Dòng vào Backlog mang sẵn dòng đã có mà nó trùng (nếu có), để người duyệt
    // chọn "Update existing" thay vì thêm một bản thứ hai.
    const pending = actor.goesLive
      ? null
      : pendingProviderFields(
          findProviderDuplicate(
            input,
            await timing.measure("duplicate_keys", () => fetchLiveProviderKeys(supabase)),
          ),
        );

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
            ...(pending ?? {}),
          })
          .select(PROVIDER_SELECT)
          .single(),
    );
    if (insertError) {
      return respond({ error: insertError.message }, 500);
    }
    const providerId = (provider as unknown as { id: string }).id;
    const actorEmail = actor.email.trim().toLowerCase();
    await timing.measure("activity", () =>
      insertProviderActivity(supabase, [
        { provider_id: providerId, actor_email: actorEmail, type: pending ? "submitted" : "created" },
      ])
    );
    if (pending) {
      after(async () => {
        try {
          await notifyProviderBacklogSubmitted({ providerId, actorEmail, count: 1 });
        } catch (error) {
          console.error("provider.backlog.notify_failed", {
            stage: "submitted",
            error: error instanceof Error ? error.message : "unknown error",
          });
        }
      });
    }

    return respond({ provider });
  } catch (error) {
    return respond(
      { error: error instanceof Error ? error.message : "Unable to create provider." },
      500,
    );
  }
}
