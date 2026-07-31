import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin, loadConfigActor } from "@/lib/table-config/access";
import { canActorExportImport } from "@/lib/table-config/export-access";
import { classifyImportRows } from "@/lib/table-config/import";
import { fetchTableColumns } from "@/lib/table-config/queries";
import { readSheetRows } from "@/lib/table-config/sheet-io";
import { isTableScope, toTableScope, type TableScope } from "@/lib/table-config/types";

export const dynamic = "force-dynamic";

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

  const rows = readSheetRows(Buffer.from(await file.arrayBuffer()));
  const [header, ...bodyRows] = rows;
  if (!header || bodyRows.length === 0) {
    return NextResponse.json({ error: "The file has no data rows." }, { status: 400 });
  }

  const mappedRows = bodyRows.map((row) => {
    const mapped: Record<string, string> = {};
    header.forEach((fileColumn, index) => {
      const targetKey = columnMapping[fileColumn];
      if (targetKey) mapped[targetKey] = row[index] ?? "";
    });
    return mapped;
  });
  const columns = await fetchTableColumns(scope);
  const existingByMatchValue = await fetchExistingMatchValues(scope, matchColumnKey);
  const classified = classifyImportRows(
    mappedRows,
    columns,
    matchColumnKey,
    existingByMatchValue
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
