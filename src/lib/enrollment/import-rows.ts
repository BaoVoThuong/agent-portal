import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
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
import { readCarrierIdsInput } from "@/lib/enrollment/carriers";
import { sanitizeEnrollmentPatchForProgram } from "@/lib/enrollment/program-fields";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
import { enrollmentSchemaErrorResponse } from "@/lib/enrollment/schema-errors";
import type { EnrollmentProgram } from "@/lib/enrollment/types";
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
import { reminderResetForDueChange } from "@/lib/enrollment/due-schedule";

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

// Carrier không nằm ở đây: nó chọn được nhiều hãng — xem buildRowPatch.
const OPTION_FIELDS = {
  stage_id: "stage",
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
  carrier_ids: "carrier",
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

export type EnrollmentImportRowInput = { row?: unknown; id?: unknown; body?: unknown };

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export type EnrollmentImportResult = { created: number; updated: number; failed: { row: number; error: string }[] };

/** Dry run shares validation with import; database write constraints can only be caught by a real import. */
export async function processEnrollmentImportRows(input: {
  program: EnrollmentProgram;
  rows: EnrollmentImportRowInput[];
  actorEmail: string;
  dryRun: boolean;
}): Promise<{ ok: true; result: EnrollmentImportResult } | { ok: false; response: NextResponse }> {
  const { program, rows, actorEmail, dryRun } = input;
  const supabase = getSupabaseAdmin();
  const optionData = await fetchEnrollmentOptionData(program);
  const nowIso = new Date().toISOString();
  const failed: { row: number; error: string }[] = [];
  let created = 0;
  let updated = 0;

  for (const raw of rows) {
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
      let currentDueDate: string | null = null;
      let currentCustomValues: Record<string, unknown> = {};
      if (recordId) {
        const { data: current, error: currentError } = await supabase
          .from("enrollment_records")
          .select("custom_values,due_date")
          .eq("id", recordId)
          .eq("program", program)
          .maybeSingle();
        if (currentError) throw new Error(currentError.message);
        if (!current) {
          failed.push({ row: excelRow, error: "No record found with this ID." });
          continue;
        }
        currentDueDate = current.due_date;
        currentCustomValues = isCustomValueRecord(current.custom_values)
          ? current.custom_values
          : {};
      }
      if (Object.keys(customValidation.values).length > 0) {
        if (recordId) {
          record.custom_values = {
            ...currentCustomValues,
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

      if (dryRun) {
        if (recordId) updated += 1;
        else created += 1;
        continue;
      }

      if (recordId) {
        const { data, error } = await supabase
          .from("enrollment_records")
          .update({
            ...sanitized,
            ...reminderResetForDueChange(currentDueDate, sanitized.due_date as string | null | undefined),
            updated_at: nowIso,
            updated_by_email: actorEmail,
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
        p_actor_email: actorEmail,
        p_activity: [{ type: "created", meta: { source: "import" } }],
        p_now: nowIso,
      });
      const schemaResponse = enrollmentSchemaErrorResponse(error);
      if (schemaResponse) return { ok: false, response: schemaResponse };
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

  if (!dryRun && (created > 0 || updated > 0)) {
    await broadcastEnrollmentChanged(program).catch(() => undefined);
  }
  return { ok: true, result: { created, updated, failed } };
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

  const carrierIds = readCarrierIdsInput(input);
  if (carrierIds === null) return { error: "Invalid Carrier option." };
  if (carrierIds !== undefined) {
    try {
      for (const id of carrierIds) {
        await assertEnrollmentOptionSet(id, "carrier", program, optionData);
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Invalid option." };
    }
    value.carrier_ids = carrierIds;
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
