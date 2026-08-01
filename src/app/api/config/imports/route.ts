import { NextResponse } from "next/server";
import { fetchEnrollmentOptionData } from "@/lib/enrollment/options";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin, loadConfigActor } from "@/lib/table-config/access";
import { canActorExportImport } from "@/lib/table-config/export-access";
import { classifyImportRows, type ImportValueContext } from "@/lib/table-config/import";
import { fetchTableColumnsWithOptions } from "@/lib/table-config/queries";
import { readSheetRows } from "@/lib/table-config/sheet-io";
import {
  isTableScope,
  toTableScope,
  type TableColumn,
  type TableColumnOption,
  type TableScope,
} from "@/lib/table-config/types";
import { fetchTaskAgents, fetchTaskAssignees } from "@/lib/tasks/assignees";
import { STATUS_LABEL, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

const IMPORT_FILE_MAX_BYTES = 10 * 1024 * 1024;
const IMPORT_MAX_ROWS = 5_000;
const IMPORT_FILE_EXTENSIONS = new Set(["csv", "xls", "xlsx"]);

export async function GET(request: Request) {
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const scope = toTableScope(new URL(request.url).searchParams.get("scope"));
  const { data, error } = await getSupabaseAdmin()
    .from("import_request")
    .select(
      "id,scope,submitted_by_email,status,match_column_key,column_mapping,summary,reviewed_by_email,reviewed_at,reject_reason,created_at"
    )
    .eq("scope", scope)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(request: Request) {
  const actorResult = await loadConfigActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }
  if (!(await canActorExportImport(actorResult.actor))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  const file = form.get("file");
  const scopeRaw = form.get("scope");
  const matchColumnRaw = form.get("match_column_key");
  const mappingRaw = form.get("column_mapping");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File is required." }, { status: 400 });
  }
  const fileError = validateImportFile(file);
  if (fileError) return NextResponse.json({ error: fileError }, { status: 400 });

  const scope = typeof scopeRaw === "string" && isTableScope(scopeRaw) ? scopeRaw : null;
  if (!scope) return NextResponse.json({ error: "Invalid table scope." }, { status: 400 });
  const matchColumnKey =
    typeof matchColumnRaw === "string" ? matchColumnRaw.trim() : "";
  if (!matchColumnKey) {
    return NextResponse.json({ error: "Match column is required." }, { status: 400 });
  }
  const columnMapping = parseColumnMapping(mappingRaw);
  if (!columnMapping) {
    return NextResponse.json({ error: "Column mapping is invalid." }, { status: 400 });
  }

  let rows: string[][];
  try {
    rows = readSheetRows(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json(
      { error: "Could not read the import file. Upload a valid .xlsx, .xls, or .csv file." },
      { status: 400 }
    );
  }
  const [header, ...bodyRows] = rows;
  if (!header || bodyRows.length === 0) {
    return NextResponse.json({ error: "The file has no data rows." }, { status: 400 });
  }
  if (bodyRows.length > IMPORT_MAX_ROWS) {
    return NextResponse.json(
      { error: `Import has too many rows (max ${IMPORT_MAX_ROWS}).` },
      { status: 400 }
    );
  }

  const mappedRows = bodyRows.map((row) => {
    const mapped: Record<string, string> = {};
    header.forEach((fileColumn, index) => {
      const targetKey = columnMapping[fileColumn];
      if (targetKey) mapped[targetKey] = row[index] ?? "";
    });
    return mapped;
  });
  const { columns, options: tableColumnOptions } = await fetchTableColumnsWithOptions(scope);
  const [existingByMatchValue, ctxByColumnKey] = await Promise.all([
    fetchExistingMatchValues(scope, matchColumnKey),
    buildImportValueContexts(scope, columns, tableColumnOptions),
  ]);
  const classified = classifyImportRows(
    mappedRows,
    columns,
    matchColumnKey,
    existingByMatchValue,
    ctxByColumnKey
  );

  const supabase = getSupabaseAdmin();
  const { data: requestRow, error: requestError } = await supabase
    .from("import_request")
    .insert({
      scope,
      submitted_by_email: actorResult.actor.email,
      status: "pending",
      match_column_key: matchColumnKey,
      column_mapping: columnMapping,
      summary: classified.summary,
    })
    .select("id")
    .single();
  if (requestError) {
    return NextResponse.json({ error: requestError.message }, { status: 500 });
  }
  const requestId = (requestRow as { id: string }).id;
  const stagingRows = classified.rows.map((row) => ({
    request_id: requestId,
    action: row.action,
    target_record_id: row.targetRecordId,
    values: row.values,
    error_text: row.errors.join("; ") || null,
  }));
  if (stagingRows.length > 0) {
    const { error: rowsError } = await supabase
      .from("import_request_row")
      .insert(stagingRows);
    if (rowsError) {
      return NextResponse.json({ error: rowsError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    request: {
      id: requestId,
      scope,
      status: "pending",
      summary: classified.summary,
    },
    preview: classified.rows.slice(0, 20),
  });
}

function validateImportFile(file: File): string | null {
  if (file.size > IMPORT_FILE_MAX_BYTES) {
    return `Import file too large (max ${formatBytes(IMPORT_FILE_MAX_BYTES)}).`;
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !IMPORT_FILE_EXTENSIONS.has(extension)) {
    return "Unsupported import file type. Upload .xlsx, .xls, or .csv.";
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

function parseColumnMapping(value: FormDataEntryValue | null): Record<string, string> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const mapping: Record<string, string> = {};
    for (const [fileColumn, targetKey] of Object.entries(parsed)) {
      if (typeof targetKey === "string" && targetKey.trim()) {
        mapping[fileColumn] = targetKey.trim();
      }
    }
    return mapping;
  } catch {
    return null;
  }
}

async function buildImportValueContexts(
  scope: TableScope,
  columns: TableColumn[],
  tableColumnOptions: TableColumnOption[]
): Promise<Record<string, ImportValueContext>> {
  const [personContext, systemDropdownContexts, systemPersonContexts] = await Promise.all([
    fetchPersonValueContext(),
    scope === "cs"
      ? fetchTaskSystemDropdownContexts()
      : fetchEnrollmentSystemDropdownContexts(scope),
    scope === "cs"
      ? fetchTaskSystemPersonContexts()
      : Promise.resolve<Record<string, ImportValueContext>>({}),
  ]);
  const optionsByColumnId = new Map<string, TableColumnOption[]>();
  for (const option of tableColumnOptions) {
    const current = optionsByColumnId.get(option.column_id) ?? [];
    optionsByColumnId.set(option.column_id, [...current, option]);
  }

  const ctxByColumnKey: Record<string, ImportValueContext> = {};
  for (const column of columns) {
    const ctx: ImportValueContext = {};
    const systemDropdownContext = systemDropdownContexts[column.key];
    if (systemDropdownContext) {
      Object.assign(ctx, systemDropdownContext);
    } else if (!column.is_system && column.type === "dropdown") {
      Object.assign(
        ctx,
        dropdownContext(
          (optionsByColumnId.get(column.id) ?? []).map((option) => ({
            id: option.id,
            label: option.label,
          }))
        )
      );
    }

    const systemPersonContext = systemPersonContexts[column.key];
    if (systemPersonContext) {
      Object.assign(ctx, systemPersonContext);
    } else if (column.type === "person" || isSystemPersonColumn(scope, column.key)) {
      Object.assign(ctx, personContext);
    }

    if (Object.keys(ctx).length > 0) {
      ctxByColumnKey[column.key] = ctx;
    }
  }
  return ctxByColumnKey;
}

async function fetchPersonValueContext(): Promise<ImportValueContext> {
  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("email,name")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  const personEmails = new Set<string>();
  const personEmailByLabel = new Map<string, string>();
  const personLabelByEmail = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ email: string; name: string | null }>) {
    const email = row.email.trim().toLowerCase();
    if (!email) continue;
    const label = row.name?.trim() || email;
    personEmails.add(email);
    personLabelByEmail.set(email, label);
    personEmailByLabel.set(email, email);
    if (row.name?.trim()) {
      const normalizedLabel = row.name.trim().toLowerCase();
      if (!personEmailByLabel.has(normalizedLabel)) {
        personEmailByLabel.set(normalizedLabel, email);
      }
    }
  }

  return { personEmails, personEmailByLabel, personLabelByEmail };
}

async function fetchTaskSystemDropdownContexts(): Promise<Record<string, ImportValueContext>> {
  const { data, error } = await getSupabaseAdmin()
    .from("task_categories")
    .select("id,name")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  return {
    status: dropdownContext(
      TASK_STATUSES.map((status) => ({ id: status, label: STATUS_LABEL[status] }))
    ),
    priority: dropdownContext(
      TASK_PRIORITIES.map((priority) => ({ id: priority, label: titleCase(priority) }))
    ),
    category: dropdownContext(
      ((data ?? []) as Array<{ id: string; name: string }>).map((category) => ({
        id: category.id,
        label: category.name,
      }))
    ),
  };
}

async function fetchTaskSystemPersonContexts(): Promise<Record<string, ImportValueContext>> {
  const [assignees, agents, people] = await Promise.all([
    fetchTaskAssignees(),
    fetchTaskAgents(),
    fetchPersonValueContext(),
  ]);
  return {
    assignee: personContextFromPeople(assignees),
    agent: personContextFromPeople(agents),
    reporter: people,
  };
}

async function fetchEnrollmentSystemDropdownContexts(
  scope: Exclude<TableScope, "cs">
): Promise<Record<string, ImportValueContext>> {
  const { options } = await fetchEnrollmentOptionData(scope);
  const optionsByColumnKey = new Map<string, Array<{ id: string; label: string }>>();
  for (const option of options) {
    if (option.archived_at) continue;
    const columnKey = enrollmentOptionColumnKey(option.set_key);
    const current = optionsByColumnKey.get(columnKey) ?? [];
    optionsByColumnKey.set(columnKey, [...current, { id: option.id, label: option.label }]);
  }

  return Object.fromEntries(
    [...optionsByColumnKey.entries()].map(([key, values]) => [
      key,
      dropdownContext(values),
    ])
  );
}

function personContextFromPeople(
  people: Array<{ email: string; name: string | null }>
): ImportValueContext {
  const personEmails = new Set<string>();
  const personEmailByLabel = new Map<string, string>();
  const personLabelByEmail = new Map<string, string>();
  for (const person of people) {
    const email = person.email.trim().toLowerCase();
    if (!email) continue;
    const label = person.name?.trim() || email;
    personEmails.add(email);
    personLabelByEmail.set(email, label);
    personEmailByLabel.set(email, email);
    if (person.name?.trim()) {
      const normalizedLabel = person.name.trim().toLowerCase();
      if (!personEmailByLabel.has(normalizedLabel)) {
        personEmailByLabel.set(normalizedLabel, email);
      }
    }
  }
  return { personEmails, personEmailByLabel, personLabelByEmail };
}

function dropdownContext(
  options: Array<{ id: string; label: string }>
): ImportValueContext {
  const optionIds = new Set<string>();
  const optionIdByLabel = new Map<string, string>();
  for (const option of options) {
    const id = option.id.trim();
    const label = option.label.trim();
    if (!id) continue;
    optionIds.add(id);
    optionIdByLabel.set(id.toLowerCase(), id);
    if (label) optionIdByLabel.set(label.toLowerCase(), id);
  }
  return { typeOverride: "dropdown", optionIds, optionIdByLabel };
}

function enrollmentOptionColumnKey(setKey: string): string {
  switch (setKey) {
    case "payment_status":
      return "payment";
    case "aca_status":
      return "aca";
    default:
      return setKey;
  }
}

function isSystemPersonColumn(scope: TableScope, key: string): boolean {
  if (scope === "cs") return ["assignee", "agent", "reporter"].includes(key);
  return ["caller", "responsible", "createdBy", "updatedBy"].includes(key);
}

function titleCase(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

async function fetchExistingMatchValues(
  scope: TableScope,
  matchColumnKey: string
): Promise<Map<string, string>> {
  const supabase = getSupabaseAdmin();
  if (scope === "cs") {
    const { data, error } = await supabase
      .from("tasks")
      .select("id,title,fub_link,custom_values")
      .is("archived_at", null);
    if (error) throw new Error(error.message);
    return rowsToMatchMap(data ?? [], matchColumnKey, taskMatchValue);
  }

  const { data, error } = await supabase
    .from("enrollment_records")
    .select("id,client_name,fub_link,custom_values")
    .eq("program", scope)
    .is("archived_at", null);
  if (error) throw new Error(error.message);
  return rowsToMatchMap(data ?? [], matchColumnKey, enrollmentMatchValue);
}

function rowsToMatchMap<T>(
  rows: T[],
  key: string,
  accessor: (row: T, key: string) => unknown
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const id = (row as { id?: string }).id;
    const value = normalizeMatch(accessor(row, key));
    if (id && value && !map.has(value)) map.set(value, id);
  }
  return map;
}

function taskMatchValue(row: unknown, key: string): unknown {
  const task = row as {
    title?: string | null;
    fub_link?: string | null;
    custom_values?: Record<string, unknown> | null;
  };
  if (key === "summary") return task.title;
  if (key === "fub") return task.fub_link;
  return task.custom_values?.[key] ?? null;
}

function enrollmentMatchValue(row: unknown, key: string): unknown {
  const record = row as {
    client_name?: string | null;
    fub_link?: string | null;
    custom_values?: Record<string, unknown> | null;
  };
  if (key === "client") return record.client_name;
  if (key === "fub") return record.fub_link;
  return record.custom_values?.[key] ?? null;
}

function normalizeMatch(value: unknown): string {
  return value === null || value === undefined
    ? ""
    : String(value).trim().toLowerCase();
}
