import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin } from "@/lib/table-config/access";
import {
  applyColumnPatchInvariants,
  canEditColumnField,
} from "@/lib/table-config/columns";
import {
  ensureTableColumns,
  fetchTableColumnById,
  resetTableLayoutsForScope,
} from "@/lib/table-config/queries";
import { broadcastTableConfigChanged } from "@/lib/table-config/realtime";
import { isColumnType, isTableScope } from "@/lib/table-config/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const admin = await loadConfigAdmin();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const supabase = getSupabaseAdmin();
  const column = await fetchColumnForPatch(id, supabase);
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
  if ("pinned" in body) {
    if (!canEditColumnField(column, "pinned")) {
      return NextResponse.json({ error: "System column pinning cannot be edited." }, { status: 400 });
    }
    patch.pinned = Boolean(body.pinned);
  }
  if ("show_in_detail" in body) {
    if (!canEditColumnField(column, "show_in_detail")) {
      return NextResponse.json({ error: "System column detail visibility cannot be edited." }, { status: 400 });
    }
    patch.show_in_detail = Boolean(body.show_in_detail);
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
  // Derived-field invariants (Required/Pinned can never be Hidden; a required
  // custom column is forced into the form). Shared with the client's
  // optimistic update so both apply the identical rules — see
  // applyColumnPatchInvariants in lib/table-config/columns.ts.
  const finalPatch = applyColumnPatchInvariants(column, patch);

  const { data, error } = await supabase
    .from("table_column")
    .update(finalPatch)
    .eq("id", column.id)
    .select(
      "id,scope,key,label,type,is_system,position,pinned,hidden_default,show_in_detail,required,created_by_email,created_at,updated_at,archived_at"
    )
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Column not found." }, { status: 404 });

  // hidden_default/pinned are meant to apply to everyone, same as reordering
  // — but resolveLayout() prefers a user's saved layout entry over
  // hidden_default. Without this, anyone who already customized this table
  // keeps their old visibility and the admin's change looks like a no-op.
  // Checks finalPatch, not patch: the invariants above can ADD hidden_default
  // (Required/Pinned force it false), and that is exactly a visibility change
  // that must reset saved layouts. Previously the rules mutated `patch` in
  // place so this read them implicitly; keep that behaviour explicit.
  if ("hidden_default" in finalPatch || "pinned" in finalPatch) {
    const resetResult = await resetTableLayoutsForScope(column.scope, supabase);
    if (!resetResult.ok) {
      return NextResponse.json({ error: resetResult.error }, { status: 500 });
    }
  }

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
  if (column.required) {
    return NextResponse.json(
      { error: "Required columns cannot be archived — turn off Required first." },
      { status: 400 }
    );
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

async function fetchColumnForPatch(
  id: string,
  supabase: ReturnType<typeof getSupabaseAdmin>
) {
  const column = await fetchTableColumnById(id, supabase);
  if (column || !id.startsWith("system-")) return column;

  const idParts = id.split("-");
  const scope = idParts[1];
  const key = idParts.slice(2).join("-");
  if (!isTableScope(scope) || !key) return null;

  const columns = await ensureTableColumns(scope, supabase);
  return columns.find((candidate) => candidate.key === key) ?? null;
}
