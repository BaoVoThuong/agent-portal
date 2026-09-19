import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { parseEnrollmentDate } from "@/lib/enrollment/dates";
import {
  assertEnrollmentOptionSet,
  fetchEnrollmentOptionData,
  firstStageOption,
} from "@/lib/enrollment/options";
import {
  enrollmentOwnershipFieldLabel,
  validateEnrollmentOwnership,
} from "@/lib/enrollment/ownership";
import { sanitizeEnrollmentPatchForProgram } from "@/lib/enrollment/program-fields";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
import { enrollmentSchemaErrorResponse } from "@/lib/enrollment/schema-errors";
import { parseEnrollmentProgram, type EnrollmentProgram } from "@/lib/enrollment/types";
import {
  customValueIssuesMessage,
  isCustomValueRecord,
  validateCustomValues,
} from "@/lib/table-config/custom-values";
import {
  findMissingRequiredFieldsFromContext,
  missingRequiredFieldsMessage,
} from "@/lib/table-config/required";
import { fetchWriteValidationContext } from "@/lib/table-config/write-context";

export const dynamic = "force-dynamic";

/**
 * Trần thấp hơn Provider List (2.000) một cách CÓ Ý: mỗi dòng ở đây phải kiểm
 * option, kiểm người sở hữu và kiểm cột bắt buộc, nên nó tốn hơn nhiều.
 */
const MAX_ROWS = 1000;

const STRING_FIELDS = [
  "client_name",
  "description",
  "fub_link",
  "pcp_2025",
  "pcp_2026",
  "agent_email",
  "caller_email",
  "responsible_enroll_email",
] as const;

const OPTION_FIELDS = {
  stage_id: "stage",
  carrier_id: "carrier",
  platform_id: "platform",
  consent_id: "consent",
  payment_status_id: "payment_status",
  aca_status_id: "aca_status",
} as const;

/** Khoá cột trong table_column ứng với từng cột DB, cho kiểm tra Required. */
const COLUMN_KEY_BY_FIELD: Record<string, string> = {
  client_name: "client",
  description: "description",
  fub_link: "fub",
  due_date: "due",
  stage_id: "stage",
  carrier_id: "carrier",
  platform_id: "platform",
  consent_id: "consent",
  payment_status_id: "payment",
  aca_status_id: "aca",
  pcp_2025: "pcp2025",
  pcp_2026: "pcp2026",
  agent_email: "agent",
  caller_email: "caller",
  responsible_enroll_email: "responsible",
};

type IncomingRow = { row?: unknown; id?: unknown; body?: unknown };

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Nhập hồ sơ Enrollment từ file Excel.
 *
 * Hai khác biệt CÓ Ý so với việc tạo/sửa từng hồ sơ trên màn hình:
 *
 * 1. **Chỉ manager mới nhập được.** Sửa hàng loạt là thao tác cấp quản trị, và
 *    kiểm phạm vi theo từng agent cho vài trăm dòng thì vừa chậm vừa dễ lọt.
 * 2. **Không bắn thông báo cho từng dòng.** Nhập một file 300 dòng mà mỗi dòng
 *    gửi một thông báo "hồ sơ mới được giao" là làm ngập hộp thông báo của cả
 *    đội vì một lần nạp dữ liệu. Cuối lượt phát MỘT tín hiệu realtime để các
 *    bảng đang mở tự nạp lại.
 */
export async function POST(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json({ error: actorResult.error }, { status: actorResult.status });
  }
  if (!actorResult.actor.isManager) {
    return NextResponse.json(
      { error: "Only managers can import enrollment records." },
      { status: 403 }
    );
  }

  const payload = (await request.json().catch(() => null)) as {
    program?: unknown;
    rows?: unknown;
  } | null;
  const program = parseEnrollmentProgram(payload?.program);
  if (!program) {
    return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  }
  if (!payload || !Array.isArray(payload.rows)) {
    return NextResponse.json({ error: "rows must be an array." }, { status: 400 });
  }
  if (payload.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `At most ${MAX_ROWS} rows per import.` },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const optionData = await fetchEnrollmentOptionData(program);
  const nowIso = new Date().toISOString();
  const failed: { row: number; error: string }[] = [];
  let created = 0;
  let updated = 0;

  for (const raw of payload.rows as IncomingRow[]) {
    const excelRow = typeof raw.row === "number" ? raw.row : 0;
    const body = raw.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      failed.push({ row: excelRow, error: "Invalid row." });
      continue;
    }
    const input = body as Record<string, unknown>;
    const recordId = typeof raw.id === "string" && raw.id ? raw.id : null;

    try {
      const patch = await buildRowPatch(input, program, optionData);
      if ("error" in patch) {
        failed.push({ row: excelRow, error: patch.error });
        continue;
      }

      const submittedCustomValues =
        input.custom_values !== undefined
          ? isCustomValueRecord(input.custom_values)
            ? input.custom_values
            : null
          : {};
      if (submittedCustomValues === null) {
        failed.push({ row: excelRow, error: "Invalid custom values." });
        continue;
      }

      const writeContext = await fetchWriteValidationContext(
        {
          scope: program,
          mode: recordId ? "patch" : "create",
          touchedSystemKeys: Object.keys(patch.value).flatMap(
            (field) => COLUMN_KEY_BY_FIELD[field] ?? []
          ),
          touchedCustomKeys: Object.keys(submittedCustomValues),
          submittedCustomValues,
        },
        supabase
      );

      const customValidation = validateCustomValues(submittedCustomValues, writeContext);
      if (!customValidation.ok) {
        failed.push({
          row: excelRow,
          error: customValueIssuesMessage(customValidation.issues),
        });
        continue;
      }

      const fieldValues: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(patch.value)) {
        const columnKey = COLUMN_KEY_BY_FIELD[field];
        if (columnKey) fieldValues[columnKey] = value;
      }
      const missingRequired = findMissingRequiredFieldsFromContext(writeContext, {
        fieldValues,
        customValues: customValidation.values,
        // Sửa thì chỉ kiểm những ô mà file này thật sự đụng tới — một file hai
        // cột không nên bị chặn vì một ô nó không hề nhắc đến.
        partial: Boolean(recordId),
      });
      if (missingRequired.length > 0) {
        failed.push({ row: excelRow, error: missingRequiredFieldsMessage(missingRequired) });
        continue;
      }

      const ownershipError = await checkOwnership(patch.value);
      if (ownershipError) {
        failed.push({ row: excelRow, error: ownershipError });
        continue;
      }

      const record: Record<string, unknown> = { ...patch.value };
      if (Object.keys(customValidation.values).length > 0) {
        if (recordId) {
          const { data: current } = await supabase
            .from("enrollment_records")
            .select("custom_values")
            .eq("id", recordId)
            .maybeSingle();
          record.custom_values = {
            ...(((current as { custom_values?: Record<string, unknown> } | null)
              ?.custom_values) ?? {}),
            ...customValidation.values,
          };
        } else {
          record.custom_values = customValidation.values;
        }
      }

      if (!recordId && !record.stage_id) {
        // Giống hệt màn hình tạo hồ sơ: thiếu stage thì rơi về stage đầu quy
        // trình. Để null thì hồ sơ vừa nhập không xuất hiện ở bất kỳ cột stage
        // nào và người dùng tưởng nhập hụt.
        record.stage_id = firstStageOption(optionData.optionsBySet)?.id ?? null;
      }

      const sanitized = sanitizeEnrollmentPatchForProgram(program, record);

      if (recordId) {
        const { data, error } = await supabase
          .from("enrollment_records")
          .update({
            ...sanitized,
            updated_at: nowIso,
            updated_by_email: actorResult.actor.email,
          })
          .eq("id", recordId)
          .eq("program", program)
          .select("id")
          .maybeSingle();
        if (error) {
          failed.push({ row: excelRow, error: error.message });
          continue;
        }
        if (!data) {
          failed.push({ row: excelRow, error: "No record found with this ID." });
          continue;
        }
        updated += 1;
        continue;
      }

      const { data, error } = await supabase.rpc("create_enrollment_atomic", {
        p_record: { ...sanitized, program },
        p_actor_email: actorResult.actor.email,
        p_activity: [{ type: "created", meta: { source: "import" } }],
        p_now: nowIso,
      });
      const schemaResponse = enrollmentSchemaErrorResponse(error);
      if (schemaResponse) return schemaResponse;
      if (error || !data) {
        failed.push({
          row: excelRow,
          error: error?.message ?? "Could not create the record.",
        });
        continue;
      }
      created += 1;
    } catch (rowError) {
      failed.push({
        row: excelRow,
        error: rowError instanceof Error ? rowError.message : "Could not import this row.",
      });
    }
  }

  if (created > 0 || updated > 0) {
    // MỘT tín hiệu cho cả lượt, không phải mỗi dòng một cái.
    await broadcastEnrollmentChanged(program).catch(() => undefined);
  }

  return NextResponse.json({ created, updated, failed });
}

async function buildRowPatch(
  input: Record<string, unknown>,
  program: EnrollmentProgram,
  optionData: Awaited<ReturnType<typeof fetchEnrollmentOptionData>>
): Promise<{ value: Record<string, unknown> } | { error: string }> {
  const value: Record<string, unknown> = {};

  for (const field of STRING_FIELDS) {
    if (!(field in input)) continue;
    value[field] = cleanText(input[field]);
  }

  if ("due_date" in input) {
    const parsed = parseEnrollmentDate(input.due_date);
    if (parsed.error) return { error: parsed.error };
    value.due_date = parsed.value;
  }

  for (const [field, setKey] of Object.entries(OPTION_FIELDS)) {
    if (!(field in input)) continue;
    const requested = cleanText(input[field]);
    if (!requested) {
      value[field] = null;
      continue;
    }
    try {
      const option = await assertEnrollmentOptionSet(
        requested,
        setKey,
        program,
        optionData
      );
      value[field] = option?.id ?? null;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Invalid option." };
    }
  }

  return { value };
}

async function checkOwnership(patch: Record<string, unknown>): Promise<string | null> {
  const invalid = await validateEnrollmentOwnership({
    agent_email: (patch.agent_email as string | null) ?? null,
    caller_email: (patch.caller_email as string | null) ?? null,
    responsible_enroll_email: (patch.responsible_enroll_email as string | null) ?? null,
  });
  if (!invalid) return null;
  return `${enrollmentOwnershipFieldLabel(invalid.field)} must be an active account${
    invalid.field === "agent_email" ? " selected as a task agent" : ""
  }.`;
}
