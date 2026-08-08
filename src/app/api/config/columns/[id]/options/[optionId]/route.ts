import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { fetchTableColumnById } from "@/lib/table-config/queries";
import { broadcastTableConfigInvalidation } from "@/lib/table-config/realtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; optionId: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id, optionId } = await params;
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const supabase = getSupabaseAdmin();
  const column = await fetchTableColumnById(id, supabase);
  if (!column) return NextResponse.json({ error: "Column not found." }, { status: 404 });
  if (column.type !== "dropdown" || column.is_system) {
    return NextResponse.json(
      { error: "Only custom dropdown columns can use custom options." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("label" in body) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return NextResponse.json({ error: "Option label is required." }, { status: 400 });
    patch.label = label;
  }
  if ("color" in body) patch.color = cleanColor(body.color);
  if ("position" in body) {
    if (typeof body.position !== "number") {
      return NextResponse.json({ error: "Position must be a number." }, { status: 400 });
    }
    patch.position = Math.round(body.position);
  }

  const { data, error } = await supabase
    .from("table_column_option")
    .update(patch)
    .eq("id", optionId)
    .eq("column_id", id)
    .select("id,column_id,label,color,position,created_at,updated_at,archived_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Option not found." }, { status: 404 });

  await broadcastTableConfigInvalidation();
  return NextResponse.json({ option: data });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id, optionId } = await params;
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const supabase = getSupabaseAdmin();
  const column = await fetchTableColumnById(id, supabase);
  if (!column) return NextResponse.json({ error: "Column not found." }, { status: 404 });
  if (column.type !== "dropdown" || column.is_system) {
    return NextResponse.json(
      { error: "Only custom dropdown columns can use custom options." },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("table_column_option")
    .update({ archived_at: nowIso, updated_at: nowIso })
    .eq("id", optionId)
    .eq("column_id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Option not found." }, { status: 404 });

  await broadcastTableConfigInvalidation();
  return NextResponse.json({ ok: true });
}

function cleanColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : null;
}
