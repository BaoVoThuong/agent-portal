import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sortColumns } from "./columns";
import type { TableColumn, TableColumnOption, TableScope } from "./types";

type SupabaseErrorLike = { code?: string; message?: string } | null | undefined;

const DEFAULT_TABLE_COLUMNS: Record<TableScope, TableColumn[]> = {
  cs: [
    col("cs", "key", "Key", "text", 10),
    col("cs", "summary", "Task", "text", 20),
    col("cs", "assignee", "Assignee", "person", 30),
    col("cs", "category", "Category", "dropdown", 40),
    col("cs", "status", "Stage", "dropdown", 50),
    col("cs", "priority", "Priority", "dropdown", 60),
    col("cs", "slaRemaining", "Time Progress", "text", 70),
    col("cs", "agent", "Agent", "person", 80),
    col("cs", "reporter", "Opened by", "person", 90),
    col("cs", "created", "Created date", "date", 100),
    col("cs", "activity", "Last activity", "date", 110),
    col("cs", "review", "QC", "checkbox", 120),
  ],
  aca: [
    col("aca", "key", "Key", "text", 10),
    col("aca", "client", "Client Name", "text", 20),
    col("aca", "stage", "Stage", "dropdown", 30),
    col("aca", "caller", "Caller", "person", 40),
    col("aca", "responsible", "Responsible Enroll", "person", 50),
    col("aca", "payment", "Payment status", "dropdown", 60),
    col("aca", "carrier", "Carrier", "dropdown", 70),
    col("aca", "aca", "AC", "dropdown", 80),
    col("aca", "consent", "Consent", "checkbox", 90),
    col("aca", "platform", "Platform", "dropdown", 100),
    col("aca", "pcp2025", "PCP 2025", "text", 110),
    col("aca", "pcp2026", "PCP 2026", "text", 120),
    col("aca", "due", "Due Date", "date", 130),
    col("aca", "fub", "FUB Link", "link", 140),
    col("aca", "createdBy", "Created by", "person", 150, true),
    col("aca", "createdAt", "Created time", "date", 160, true),
    col("aca", "updatedBy", "Last edited by", "person", 170, true),
    col("aca", "updated", "Last edited time", "date", 180, true),
    col("aca", "qc", "QC", "checkbox", 190),
  ],
  medicare: [
    col("medicare", "key", "Key", "text", 10),
    col("medicare", "client", "Client Name", "text", 20),
    col("medicare", "stage", "Stage", "dropdown", 30),
    col("medicare", "caller", "Caller", "person", 40, true),
    col("medicare", "responsible", "Assignee", "person", 50),
    col("medicare", "payment", "Payment status", "dropdown", 60, true),
    col("medicare", "carrier", "Carrier", "dropdown", 70),
    col("medicare", "aca", "AC", "dropdown", 80, true),
    col("medicare", "consent", "Consent", "checkbox", 90, true),
    col("medicare", "platform", "Platform", "dropdown", 100, true),
    col("medicare", "pcp2025", "PCP", "text", 110),
    col("medicare", "pcp2026", "PCP 2026", "text", 120, true),
    col("medicare", "due", "Due Date", "date", 130),
    col("medicare", "fub", "FUB Link", "link", 140),
    col("medicare", "createdBy", "Created by", "person", 150, true),
    col("medicare", "createdAt", "Created time", "date", 160, true),
    col("medicare", "updatedBy", "Last edited by", "person", 170, true),
    col("medicare", "updated", "Last edited time", "date", 180, true),
    col("medicare", "qc", "QC", "checkbox", 190),
  ],
};

export function defaultTableColumns(scope: TableScope): TableColumn[] {
  return DEFAULT_TABLE_COLUMNS[scope].map((column) => ({ ...column }));
}

export async function fetchTableColumns(
  scope: TableScope,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<TableColumn[]> {
  const { data, error } = await supabase
    .from("table_column")
    .select(
      "id,scope,key,label,type,is_system,position,hidden_default,required,created_by_email,created_at,updated_at,archived_at"
    )
    .eq("scope", scope)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("label", { ascending: true });

  if (error) {
    if (isTableConfigMissingError(error)) return defaultTableColumns(scope);
    throw new Error(error.message ?? "Could not fetch table columns.");
  }

  const rows = (data ?? []) as unknown as TableColumn[];
  return rows.length > 0 ? sortColumns(rows) : defaultTableColumns(scope);
}

export async function fetchAllTableColumns(
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<Record<TableScope, TableColumn[]>> {
  const scopes: TableScope[] = ["cs", "aca", "medicare"];
  const entries = await Promise.all(
    scopes.map(async (scope) => [scope, await fetchTableColumns(scope, supabase)] as const)
  );
  return Object.fromEntries(entries) as Record<TableScope, TableColumn[]>;
}

export async function fetchTableColumnById(
  id: string,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<TableColumn | null> {
  const { data, error } = await supabase
    .from("table_column")
    .select(
      "id,scope,key,label,type,is_system,position,hidden_default,required,created_by_email,created_at,updated_at,archived_at"
    )
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    if (isTableConfigMissingError(error)) return null;
    throw new Error(error.message ?? "Could not fetch table column.");
  }
  return (data ?? null) as TableColumn | null;
}

export async function fetchTableColumnOptions(
  scope: TableScope,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<TableColumnOption[]> {
  const columns = await fetchTableColumns(scope, supabase);
  const ids = columns.map((column) => column.id).filter((id) => !id.startsWith("system-"));
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("table_column_option")
    .select("id,column_id,label,color,position,created_at,updated_at,archived_at")
    .in("column_id", ids)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("label", { ascending: true });

  if (error) {
    if (isTableConfigMissingError(error)) return [];
    throw new Error(error.message ?? "Could not fetch table column options.");
  }
  return (data ?? []) as unknown as TableColumnOption[];
}

export async function fetchAllTableColumnOptions(
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<Record<TableScope, TableColumnOption[]>> {
  const scopes: TableScope[] = ["cs", "aca", "medicare"];
  const entries = await Promise.all(
    scopes.map(async (scope) => [scope, await fetchTableColumnOptions(scope, supabase)] as const)
  );
  return Object.fromEntries(entries) as Record<TableScope, TableColumnOption[]>;
}

export function isTableConfigMissingError(error: SupabaseErrorLike): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("table_column") && message.includes("schema cache") ||
    message.includes("table_column") && message.includes("does not exist")
  );
}

function col(
  scope: TableScope,
  key: string,
  label: string,
  type: TableColumn["type"],
  position: number,
  hiddenDefault = false
): TableColumn {
  return {
    id: `system-${scope}-${key}`,
    scope,
    key,
    label,
    type,
    is_system: true,
    position,
    hidden_default: hiddenDefault,
    required: false,
    archived_at: null,
  };
}
