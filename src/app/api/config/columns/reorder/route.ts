import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { resetTableLayoutsForScope } from "@/lib/table-config/queries";
import { broadcastTableConfigInvalidation } from "@/lib/table-config/realtime";
import { isTableScope } from "@/lib/table-config/types";
import {
  normalizeColumnKeyArray,
  validateColumnOrderRequest,
} from "@/lib/table-config/column-order";

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

  const expectedColumnKeys = normalizeColumnKeyArray(body?.expected_column_keys);
  const columnKeys = normalizeColumnKeyArray(body?.column_keys);
  if (!expectedColumnKeys || !columnKeys) {
    return NextResponse.json({ error: "Expected and desired column order are required." }, { status: 400 });
  }
  const requestValidation = validateColumnOrderRequest(expectedColumnKeys, columnKeys);
  if (!requestValidation.ok) {
    return NextResponse.json({ error: "Invalid column order." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error: reorderError } = await supabase.rpc("reorder_table_columns_atomic", {
    p_scope: scope,
    p_expected_column_keys: expectedColumnKeys,
    p_column_keys: columnKeys,
  });
  if (reorderError) {
    if (reorderError.message === "COLUMN_ORDER_STALE") {
      return NextResponse.json(
        { error: "Column order changed elsewhere. Refresh and try again.", code: "COLUMN_ORDER_STALE" },
        { status: 409 }
      );
    }
    if (reorderError.message === "COLUMN_ORDER_INVALID") {
      return NextResponse.json({ error: "Invalid column order." }, { status: 400 });
    }
    return NextResponse.json({ error: "Could not update column order." }, { status: 500 });
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

  await broadcastTableConfigInvalidation();
  return NextResponse.json({
    ok: true,
    scope,
    canonical_order: data,
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}
