import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { fetchTableColumns, resetTableLayoutsForScope } from "@/lib/table-config/queries";
import { broadcastTableConfigChanged } from "@/lib/table-config/realtime";
import { isTableScope } from "@/lib/table-config/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const body = await request.json().catch(() => null);
  const scope = isTableScope(body?.scope) ? body.scope : null;
  if (!scope) {
    return NextResponse.json({ error: "Invalid table scope." }, { status: 400 });
  }

  const columnKeys = normalizeStringArray(body?.column_keys);
  const columnIds = normalizeStringArray(body?.column_ids);
  if (!columnKeys && !columnIds) {
    return NextResponse.json({ error: "Column order is required." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const columns = await fetchTableColumns(scope, supabase);
  const orderedColumns = columnKeys
    ? mapOrderedColumns(columnKeys, new Map(columns.map((column) => [column.key, column])))
    : mapOrderedColumns(columnIds ?? [], new Map(columns.map((column) => [column.id, column])));

  if (!orderedColumns || orderedColumns.length !== columns.length) {
    return NextResponse.json({ error: "Invalid column order." }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const updates = await Promise.all(
    orderedColumns.map((column, index) =>
      supabase
        .from("table_column")
        .update({ position: index + 1, updated_at: nowIso })
        .eq("id", column.id)
        .eq("scope", scope)
        .is("archived_at", null)
    )
  );
  const updateError = updates.find((result) => result.error)?.error;
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const resetResult = await resetTableLayoutsForScope(scope, supabase);
  const warnings: string[] = [];
  if (!resetResult.ok) {
    warnings.push(`Layout reset failed after the column order commit: ${resetResult.error}`);
    console.error("Config column layout reset failed after reorder commit", {
      scope,
      error: resetResult.error,
    });
  }

  await broadcastTableConfigChanged();
  return NextResponse.json({ ok: true, scope, ...(warnings.length > 0 ? { warnings } : {}) });
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  return values.length === value.length ? values : null;
}

function mapOrderedColumns<T extends { id: string }>(
  orderedKeys: string[],
  columnsByKey: Map<string, T>
): T[] | null {
  const seen = new Set<string>();
  const orderedColumns: T[] = [];
  for (const key of orderedKeys) {
    if (seen.has(key)) return null;
    const column = columnsByKey.get(key);
    if (!column) return null;
    seen.add(key);
    orderedColumns.push(column);
  }
  return orderedColumns;
}
