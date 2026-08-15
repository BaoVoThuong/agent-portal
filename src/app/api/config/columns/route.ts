import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin, loadConfigActor } from "@/lib/table-config/access";
import {
  applyColumnPatchInvariants,
  nextPosition,
  slugifyColumnKey,
} from "@/lib/table-config/columns";
import {
  fetchTableColumnOptions,
  fetchTableColumns,
  resetTableLayoutsForScope,
} from "@/lib/table-config/queries";
import { broadcastTableConfigInvalidation } from "@/lib/table-config/realtime";
import {
  isColumnType,
  isTableScope,
  parseTableScope,
  type ColumnType,
  type TableScope,
} from "@/lib/table-config/types";
import { archivedColumnConflictResponse } from "@/lib/table-config/mutation-errors";
import {
  layoutResetFailedWarning,
  type ConfigMutationWarning,
} from "@/lib/table-config/partial-success";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorResult = await loadConfigActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const scopeParam = new URL(request.url).searchParams.get("scope");
  if (!scopeParam) return NextResponse.json({ error: "Table scope is required." }, { status: 400 });

  const scope = parseTableScope(scopeParam);
  if (!scope) {
    return NextResponse.json({ error: "Invalid table scope." }, { status: 400 });
  }
  const [columns, options] = await Promise.all([
    fetchTableColumns(scope),
    fetchTableColumnOptions(scope),
  ]);
  return NextResponse.json({ scope, columns, options });
}

export async function POST(request: Request) {
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const body = await request.json().catch(() => null);
  const scope = isTableScope(body?.scope) ? body.scope : null;
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const type = isColumnType(body?.type) ? body.type : null;
  if (!scope) {
    return NextResponse.json({ error: "Invalid table scope." }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  if (body?.restore === true) {
    const archivedId = typeof body?.archived_column_id === "string" ? body.archived_column_id : "";
    if (!archivedId || !type) {
      return NextResponse.json({ error: "A column type and archived column are required." }, { status: 400 });
    }

    const { data: archivedColumn, error: archivedError } = await supabase
      .from("table_column")
      .select(TABLE_COLUMN_SELECT)
      .eq("id", archivedId)
      .eq("scope", scope)
      .not("archived_at", "is", null)
      .maybeSingle();
    if (archivedError) {
      return NextResponse.json({ error: "Could not load the archived column." }, { status: 500 });
    }
    if (!archivedColumn) {
      return NextResponse.json(
        { error: "The archived column no longer exists. Refresh configuration and try again.", code: "CONFIG_ARCHIVED_COLUMN_NOT_FOUND" },
        { status: 409 }
      );
    }
    if (archivedColumn.type !== type) {
      return NextResponse.json(
        { error: "The archived column has a different type. Choose that type to restore it.", code: "CONFIG_ARCHIVED_COLUMN_TYPE_MISMATCH" },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const { data: restoredColumn, error: restoreError } = await supabase
      .from("table_column")
      .update({ archived_at: null, updated_at: nowIso })
      .eq("id", archivedId)
      .eq("scope", scope)
      .not("archived_at", "is", null)
      .select(TABLE_COLUMN_SELECT)
      .single();
    if (restoreError || !restoredColumn) {
      return NextResponse.json({ error: "Could not restore the archived column." }, { status: 500 });
    }

    const resetResult = await resetTableLayoutsForScope(scope, supabase);
    const warnings: ConfigMutationWarning[] = [];
    if (!resetResult.ok) {
      warnings.push(layoutResetFailedWarning());
      console.error("Config column layout reset failed after restore", { scope, error: resetResult.error });
    }
    await broadcastTableConfigInvalidation();
    return NextResponse.json({
      ok: true,
      column: restoredColumn,
      restored: true,
      ...(warnings.length > 0 ? { warnings } : {}),
    });
  }

  if (!label) {
    return NextResponse.json({ error: "Column label is required." }, { status: 400 });
  }
  if (!type) {
    return NextResponse.json({ error: "Invalid column type." }, { status: 400 });
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("table_column")
    .select(TABLE_COLUMN_SELECT)
    .eq("scope", scope);
  if (existingError) {
    return NextResponse.json({ error: "Could not load existing columns." }, { status: 500 });
  }
  const columns = (existingRows ?? []) as Array<{
    id: string;
    scope: TableScope;
    key: string;
    label: string;
    type: ColumnType;
    is_system: boolean;
    position: number;
    archived_at: string | null;
  }>;
  const normalizedLabel = label.toLocaleLowerCase();
  const archivedColumn = columns.find(
    (column) =>
      Boolean(column.archived_at) &&
      (column.label.trim().toLocaleLowerCase() === normalizedLabel ||
        column.key === slugifyColumnKey(label))
  );
  if (archivedColumn) {
    return NextResponse.json(archivedColumnConflictResponse(archivedColumn), { status: 409 });
  }
  const activeColumns = columns.filter((column) => !column.archived_at);
  const key = uniqueKey(slugifyColumnKey(label), new Set(columns.map((column) => column.key)));
  const position =
    typeof body?.position === "number"
      ? Math.round(body.position)
      : nextPosition(activeColumns);
  const columnConfig = applyColumnPatchInvariants(
    { pinned: false, required: false, is_system: false },
    {
      pinned: Boolean(body?.pinned),
      hidden_default: Boolean(body?.hidden_default),
      show_in_detail: Boolean(body?.show_in_detail),
      required: Boolean(body?.required),
    }
  );

  const { data, error } = await supabase
    .from("table_column")
    .insert({
      scope,
      key,
      label,
      type,
      is_system: false,
      position,
      ...columnConfig,
      created_by_email: admin.actor.email,
    })
    .select(
      "id,scope,key,label,type,is_system,position,pinned,hidden_default,show_in_detail,required,created_by_email,created_at,updated_at,archived_at"
    )
    .single();
  if (error) return NextResponse.json({ error: "Could not add column." }, { status: 500 });

  await broadcastTableConfigInvalidation();
  return NextResponse.json({ column: data });
}

const TABLE_COLUMN_SELECT =
  "id,scope,key,label,type,is_system,position,pinned,hidden_default,show_in_detail,required,created_by_email,created_at,updated_at,archived_at";

function uniqueKey(baseKey: string, existing: ReadonlySet<string>): string {
  if (!existing.has(baseKey)) return baseKey;
  let index = 2;
  while (existing.has(`${baseKey}_${index}`)) index += 1;
  return `${baseKey}_${index}`;
}
