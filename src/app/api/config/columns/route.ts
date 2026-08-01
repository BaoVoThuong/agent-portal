import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin, loadConfigActor } from "@/lib/table-config/access";
import { nextPosition, slugifyColumnKey } from "@/lib/table-config/columns";
import {
  fetchAllTableColumns,
  fetchTableColumnOptions,
  fetchTableColumns,
} from "@/lib/table-config/queries";
import { broadcastTableConfigChanged } from "@/lib/table-config/realtime";
import { isColumnType, isTableScope, toTableScope } from "@/lib/table-config/types";

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
  if (!scopeParam) {
    const columns = await fetchAllTableColumns();
    return NextResponse.json({ columns });
  }

  const scope = toTableScope(scopeParam);
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
  if (!label) {
    return NextResponse.json({ error: "Column label is required." }, { status: 400 });
  }
  if (!type) {
    return NextResponse.json({ error: "Invalid column type." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const columns = await fetchTableColumns(scope, supabase);
  const key = uniqueKey(slugifyColumnKey(label), new Set(columns.map((column) => column.key)));
  const position =
    typeof body?.position === "number"
      ? Math.round(body.position)
      : nextPosition(columns);

  const { data, error } = await supabase
    .from("table_column")
    .insert({
      scope,
      key,
      label,
      type,
      is_system: false,
      position,
      pinned: Boolean(body?.pinned),
      hidden_default: Boolean(body?.pinned) ? false : Boolean(body?.hidden_default),
      show_in_detail: Boolean(body?.show_in_detail),
      required: Boolean(body?.required),
      created_by_email: admin.actor.email,
    })
    .select(
      "id,scope,key,label,type,is_system,position,pinned,hidden_default,show_in_detail,required,created_by_email,created_at,updated_at,archived_at"
    )
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastTableConfigChanged();
  return NextResponse.json({ column: data });
}

function uniqueKey(baseKey: string, existing: ReadonlySet<string>): string {
  if (!existing.has(baseKey)) return baseKey;
  let index = 2;
  while (existing.has(`${baseKey}_${index}`)) index += 1;
  return `${baseKey}_${index}`;
}
