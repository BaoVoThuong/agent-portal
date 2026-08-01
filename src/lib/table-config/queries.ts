import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sortColumns } from "./columns";
import type { TableColumn, TableColumnOption, TableScope } from "./types";

type SupabaseErrorLike = { code?: string; message?: string } | null | undefined;

const TABLE_COLUMN_SELECT =
  "id,scope,key,label,type,is_system,position,pinned,hidden_default,show_in_detail,required,created_by_email,created_at,updated_at,archived_at";

const DEFAULT_TABLE_COLUMNS: Record<TableScope, TableColumn[]> = {
  cs: [
    col("cs", "key", "Key", "text", 10, false, true),
    col("cs", "summary", "Task", "text", 20, false, true),
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
    col("aca", "key", "Key", "text", 10, false, true),
    col("aca", "client", "Client Name", "text", 20, false, true),
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
    col("medicare", "key", "Key", "text", 10, false, true),
    col("medicare", "client", "Client Name", "text", 20, false, true),
    col("medicare", "stage", "Stage", "dropdown", 30),
    col("medicare", "responsible", "Assignee", "person", 50),
    col("medicare", "carrier", "Carrier", "dropdown", 70),
    col("medicare", "pcp2025", "PCP", "text", 110),
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
  const activeRows = await fetchActiveTableColumnRows(scope, supabase);
  if (!activeRows.ok) {
    if (isTableConfigMissingError(activeRows.error)) return defaultTableColumns(scope);
    throw new Error(activeRows.error?.message ?? "Could not fetch table columns.");
  }

  if (hasDefaultColumns(scope, activeRows.rows)) {
    return activeRows.rows.length > 0 ? sortColumns(activeRows.rows) : defaultTableColumns(scope);
  }

  const ensuredRows = await ensureTableColumns(scope, supabase);
  return ensuredRows.length > 0 ? sortColumns(ensuredRows) : defaultTableColumns(scope);
}

export async function ensureTableColumns(
  scope: TableScope,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<TableColumn[]> {
  const allRows = await fetchAllTableColumnRows(scope, supabase);
  if (!allRows.ok) {
    if (isTableConfigMissingError(allRows.error)) return defaultTableColumns(scope);
    throw new Error(allRows.error?.message ?? "Could not fetch table columns.");
  }

  const existingByKey = new Map(allRows.rows.map((column) => [column.key, column]));
  const defaults = defaultTableColumns(scope);
  const inserts = defaults
    .filter((column) => !existingByKey.has(column.key))
    .map((column) => ({
      scope: column.scope,
      key: column.key,
      label: column.label,
      type: column.type,
      is_system: column.is_system,
      position: column.position,
      pinned: column.pinned,
      hidden_default: column.hidden_default,
      show_in_detail: column.show_in_detail,
      required: column.required,
      created_by_email: column.created_by_email ?? null,
    }));
  const archivedDefaultIds = defaults
    .map((column) => existingByKey.get(column.key))
    .filter((column): column is TableColumn => Boolean(column?.archived_at))
    .map((column) => column.id);

  if (inserts.length > 0) {
    const { error } = await supabase
      .from("table_column")
      .upsert(inserts, { onConflict: "scope,key", ignoreDuplicates: true });
    if (error) throw new Error(error.message ?? "Could not create default columns.");
  }

  if (archivedDefaultIds.length > 0) {
    const { error } = await supabase
      .from("table_column")
      .update({ archived_at: null, updated_at: new Date().toISOString() })
      .in("id", archivedDefaultIds);
    if (error) throw new Error(error.message ?? "Could not restore default columns.");
  }

  const activeRows = await fetchActiveTableColumnRows(scope, supabase);
  if (!activeRows.ok) {
    if (isTableConfigMissingError(activeRows.error)) return defaultTableColumns(scope);
    throw new Error(activeRows.error?.message ?? "Could not fetch table columns.");
  }
  return activeRows.rows;
}

async function fetchActiveTableColumnRows(
  scope: TableScope,
  supabase: SupabaseClient
): Promise<
  | { ok: true; rows: TableColumn[] }
  | { ok: false; error: SupabaseErrorLike }
> {
  const { data, error } = await supabase
    .from("table_column")
    .select(TABLE_COLUMN_SELECT)
    .eq("scope", scope)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("label", { ascending: true });

  if (error) {
    return { ok: false, error };
  }

  return { ok: true, rows: (data ?? []) as unknown as TableColumn[] };
}

async function fetchAllTableColumnRows(
  scope: TableScope,
  supabase: SupabaseClient
): Promise<
  | { ok: true; rows: TableColumn[] }
  | { ok: false; error: SupabaseErrorLike }
> {
  const { data, error } = await supabase
    .from("table_column")
    .select(TABLE_COLUMN_SELECT)
    .eq("scope", scope);

  if (error) {
    return { ok: false, error };
  }

  return { ok: true, rows: (data ?? []) as unknown as TableColumn[] };
}

function hasDefaultColumns(scope: TableScope, rows: TableColumn[]): boolean {
  const existingKeys = new Set(rows.map((column) => column.key));
  return defaultTableColumns(scope).every((column) => existingKeys.has(column.key));
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
    .select(TABLE_COLUMN_SELECT)
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
  return fetchTableColumnOptionsForColumns(columns, supabase);
}

export async function fetchTableColumnsWithOptions(
  scope: TableScope,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<{ columns: TableColumn[]; options: TableColumnOption[] }> {
  const columns = await fetchTableColumns(scope, supabase);
  const options = await fetchTableColumnOptionsForColumns(columns, supabase);
  return { columns, options };
}

async function fetchTableColumnOptionsForColumns(
  columns: TableColumn[],
  supabase: SupabaseClient
): Promise<TableColumnOption[]> {
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
  // 42703 = Postgres undefined_column. A missing column (e.g. a migration that
  // hasn't been applied yet) means the schema is out of date, not "not set up
  // yet" — surface it as a real error instead of silently serving fake
  // system-<scope>-<key> rows, which later crash with an invalid UUID error
  // the moment a write (reorder/patch) tries to use one of those fake ids.
  if (error?.code === "42703") return false;
  const message = error?.message?.toLowerCase() ?? "";
  // Word-boundary check: "table_column" contains the substring "column" too
  // (joined by "_", itself a \w character), so a plain .includes("column")
  // would also match genuine table-missing messages. \bcolumn\b only matches
  // "column" as its own word, e.g. "column table_column.pinned does not exist".
  if (/\bcolumn\b/.test(message)) return false;

  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    (message.includes("table_column") && message.includes("schema cache")) ||
    (message.includes("table_column") && message.includes("does not exist"))
  );
}

export function isTableLayoutMissingError(error: SupabaseErrorLike): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    (message.includes("user_table_layout") &&
      (message.includes("schema cache") || message.includes("does not exist")))
  );
}

// A column's `hidden_default`/`pinned` is only a fallback for users who have
// never customized that table — see resolveLayout() in ./layout.ts, which
// prefers a saved per-user layout entry over hidden_default. Admin changes to
// these two fields are meant to apply to everyone (same intent as reordering
// columns), so wipe every user's saved layout for the scope whenever either
// field changes — otherwise anyone who already touched that table keeps
// seeing their stale choice and the admin's change looks like it did nothing.
export async function resetTableLayoutsForScope(
  scope: TableScope,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from("user_table_layout").delete().eq("scope", scope);
  if (error && !isTableLayoutMissingError(error)) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

function col(
  scope: TableScope,
  key: string,
  label: string,
  type: TableColumn["type"],
  position: number,
  hiddenDefault = false,
  pinned = false
): TableColumn {
  return {
    id: `system-${scope}-${key}`,
    scope,
    key,
    label,
    type,
    is_system: true,
    position,
    pinned,
    hidden_default: hiddenDefault,
    show_in_detail: false,
    required: false,
    archived_at: null,
  };
}
