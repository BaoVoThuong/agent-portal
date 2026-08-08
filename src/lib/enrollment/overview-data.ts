import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTableColumns } from "@/lib/table-config/queries";
import { aggregateEnrollmentOverview, defaultEnrollmentOverviewPeriod } from "./overview";
import { sortEnrollmentOptionsByLabel } from "./options";
import {
  type EnrollmentOverviewRecordInput,
  type EnrollmentOverviewRequiredColumn,
  type EnrollmentOverviewSnapshot,
} from "./overview-types";
import type { EnrollmentOption, EnrollmentProgram } from "./types";

const OVERVIEW_RECORD_COLUMNS =
  "id,program,client_name,description,fub_link,due_date,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,custom_values,agent_email,caller_email,responsible_enroll_email,qc_checked_at,closed_at,created_at,updated_at,archived_at";

function parseDateParam(value: string | null): string | null {
  if (value === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

export async function fetchEnrollmentOverview(
  program: EnrollmentProgram,
  periodParams?: { from?: string | null; to?: string | null },
  now = new Date()
): Promise<EnrollmentOverviewSnapshot> {
  const supabase = getSupabaseAdmin();
  const defaultPeriod = defaultEnrollmentOverviewPeriod(now);
  const hasExplicitPeriod =
    periodParams && (periodParams.from !== undefined || periodParams.to !== undefined);
  const from = hasExplicitPeriod ? parseDateParam(periodParams?.from ?? "") ?? "" : defaultPeriod.from;
  const to = hasExplicitPeriod ? parseDateParam(periodParams?.to ?? "") ?? "" : defaultPeriod.to;

  const [stageSetResult, recordsResult, tableColumns] = await Promise.all([
    supabase
      .from("enrollment_option_sets")
      .select("id")
      .eq("program", program)
      .eq("key", "stage")
      .maybeSingle(),
    supabase
      .from("enrollment_records")
      .select(OVERVIEW_RECORD_COLUMNS)
      .eq("program", program)
      .is("archived_at", null),
    fetchTableColumns(program),
  ]);

  if (stageSetResult.error) throw new Error(stageSetResult.error.message);
  if (recordsResult.error) throw new Error(recordsResult.error.message);

  const stageSet = stageSetResult.data as { id: string } | null;
  let stageOptions: EnrollmentOption[] = [];
  if (stageSet) {
    const { data, error } = await supabase
      .from("enrollment_options")
      .select("id,set_id,label,color,position,is_terminal,triggers_qc,archived_at")
      .eq("set_id", stageSet.id)
      .is("archived_at", null);
    if (error) throw new Error(error.message);
    stageOptions = sortEnrollmentOptionsByLabel(
      (data ?? []).map((option) => ({ ...option, set_key: "stage" as const }))
    );
  }

  const records = (recordsResult.data ?? []) as EnrollmentOverviewRecordInput[];
  const requiredColumns: EnrollmentOverviewRequiredColumn[] = tableColumns
    .filter((column) => column.required && !column.archived_at)
    .map((column) => ({
      key: column.key,
      label: column.label,
      type: column.type,
      is_system: column.is_system,
    }));

  return aggregateEnrollmentOverview({
    now,
    program,
    period: { from, to },
    accounts: [],
    stageOptions,
    records,
    requiredColumns,
  });
}
