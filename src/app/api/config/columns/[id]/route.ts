import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { canEditColumnField } from "@/lib/table-config/columns";
import { fetchTableColumnById } from "@/lib/table-config/queries";
import { broadcastTableConfigChanged } from "@/lib/table-config/realtime";
import { isColumnType } from "@/lib/table-config/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const supabase = getSupabaseAdmin();
  const column = await fetchTableColumnById(id, supabase);
  if (!column) return NextResponse.json({ error: "Column not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("label" in body) {
    if (!canEditColumnField(column, "label")) {
      return NextResponse.json({ error: "System column label cannot be edited." }, { status: 400 });
    }
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return NextResponse.json({ error: "Label is required." }, { status: 400 });
    patch.label = label;
  }
  if ("position" in body) {
    if (!canEditColumnField(column, "position")) {
      return NextResponse.json({ error: "System column position cannot be edited." }, { status: 400 });
    }
    if (typeof body.position !== "number") {
      return NextResponse.json({ error: "Position must be a number." }, { status: 400 });
    }
    patch.position = Math.round(body.position);
  }
  if ("hidden_default" in body) {
    if (!canEditColumnField(column, "hidden_default")) {
      return NextResponse.json({ error: "System column visibility cannot be edited." }, { status: 400 });
    }
    patch.hidden_default = Boolean(body.hidden_default);
  }
  if ("type" in body) {
    if (!canEditColumnField(column, "type")) {
      return NextResponse.json({ error: "System column type cannot be edited." }, { status: 400 });
    }
    if (!isColumnType(body.type)) {
      return NextResponse.json({ error: "Invalid column type." }, { status: 400 });
    }
    patch.type = body.type;
  }
  if ("required" in body) {
    if (!canEditColumnField(column, "required")) {
      return NextResponse.json({ error: "System column required flag cannot be edited." }, { status: 400 });
    }
    patch.required = Boolean(body.required);
  }

  const { data, error } = await supabase
    .from("table_column")
    .update(patch)
    .eq("id", id)
    .select(
      "id,scope,key,label,type,is_system,position,hidden_default,required,created_by_email,created_at,updated_at,archived_at"
    )
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Column not found." }, { status: 404 });

  await broadcastTableConfigChanged();
  return NextResponse.json({ column: data });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const supabase = getSupabaseAdmin();
  const column = await fetchTableColumnById(id, supabase);
  if (!column) return NextResponse.json({ error: "Column not found." }, { status: 404 });
  if (column.is_system) {
    return NextResponse.json({ error: "System columns cannot be archived." }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("table_column")
    .update({ archived_at: nowIso, updated_at: nowIso })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Column not found." }, { status: 404 });

  await broadcastTableConfigChanged();
  return NextResponse.json({ ok: true });
}
