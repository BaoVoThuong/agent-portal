import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin, loadConfigActor } from "@/lib/table-config/access";
import { fetchTableColumnById } from "@/lib/table-config/queries";
import { broadcastTableConfigInvalidation } from "@/lib/table-config/realtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const actorResult = await loadConfigActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const { data, error } = await getSupabaseAdmin()
    .from("table_column_option")
    .select("id,column_id,label,color,position,created_at,updated_at,archived_at")
    .eq("column_id", id)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("label", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ options: data ?? [] });
}

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
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
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) return NextResponse.json({ error: "Option label is required." }, { status: 400 });

  const { data: last } = await supabase
    .from("table_column_option")
    .select("position")
    .eq("column_id", id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position =
    typeof body?.position === "number"
      ? Math.round(body.position)
      : ((last as { position?: number } | null)?.position ?? 0) + 10;

  const { data, error } = await supabase
    .from("table_column_option")
    .insert({
      column_id: id,
      label,
      color: cleanColor(body?.color),
      position,
    })
    .select("id,column_id,label,color,position,created_at,updated_at,archived_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastTableConfigInvalidation();
  return NextResponse.json({ option: data });
}

function cleanColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : null;
}
