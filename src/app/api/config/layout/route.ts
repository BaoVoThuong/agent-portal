import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigActor } from "@/lib/table-config/access";
import { serializeLayout, type LayoutEntry } from "@/lib/table-config/layout";
import { fetchTableColumns } from "@/lib/table-config/queries";
import { isTableScope, parseTableScope } from "@/lib/table-config/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorResult = await loadConfigActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const scope = parseTableScope(new URL(request.url).searchParams.get("scope"));
  if (!scope) {
    return NextResponse.json({ error: "Invalid table scope." }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("user_table_layout")
    .select("layout,updated_at")
    .eq("user_email", actorResult.actor.email)
    .eq("scope", scope)
    .maybeSingle();
  if (error) {
    if (isLayoutMissingError(error)) {
      return NextResponse.json({ scope, layout: null });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    scope,
    layout: Array.isArray((data as { layout?: unknown } | null)?.layout)
      ? (data as { layout: unknown[] }).layout
      : null,
    updated_at: (data as { updated_at?: string } | null)?.updated_at ?? null,
  });
}

export async function PUT(request: Request) {
  const actorResult = await loadConfigActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const body = await request.json().catch(() => null);
  if (!isTableScope(body?.scope)) {
    return NextResponse.json({ error: "Invalid table scope." }, { status: 400 });
  }

  const hasExpectedVersion =
    body && Object.prototype.hasOwnProperty.call(body, "expected_updated_at");
  if (
    hasExpectedVersion &&
    body.expected_updated_at !== null &&
    typeof body.expected_updated_at !== "string"
  ) {
    return NextResponse.json({ error: "Invalid layout version." }, { status: 400 });
  }

  const scope = body.scope;
  const layout = normalizeLayout(body?.layout);
  if (!layout) {
    return NextResponse.json({ error: "Invalid layout." }, { status: 400 });
  }

  const columns = await fetchTableColumns(scope);
  const validKeys = new Set(columns.map((column) => column.key));
  const filteredLayout = serializeLayout(
    layout
      .filter((entry) => validKeys.has(entry.column_key))
      .sort((a, b) => a.position - b.position)
      .map((entry) => {
        const column = columns.find((candidate) => candidate.key === entry.column_key)!;
        return {
          ...column,
          width: entry.width,
          hidden: entry.hidden,
        };
      })
  );

  const nowIso = new Date().toISOString();
  const supabase = getSupabaseAdmin();
  const layoutRow = {
    user_email: actorResult.actor.email,
    scope,
    layout: filteredLayout,
    updated_at: nowIso,
  };
  type LayoutWriteRow = { layout: unknown; updated_at: string };
  let data: LayoutWriteRow | null = null;
  let error: { code?: string; message?: string } | null = null;

  if (!hasExpectedVersion) {
    const result = await supabase
      .from("user_table_layout")
      .upsert(layoutRow, { onConflict: "user_email,scope" })
      .select("layout,updated_at")
      .single();
    data = result.data as LayoutWriteRow | null;
    error = result.error;
  } else if (body.expected_updated_at === null) {
    const result = await supabase
      .from("user_table_layout")
      .insert(layoutRow)
      .select("layout,updated_at")
      .maybeSingle();
    data = result.data as LayoutWriteRow | null;
    error = result.error;
  } else {
    const result = await supabase
      .from("user_table_layout")
      .update(layoutRow)
      .eq("user_email", actorResult.actor.email)
      .eq("scope", scope)
      .eq("updated_at", body.expected_updated_at)
      .select("layout,updated_at")
      .maybeSingle();
    data = result.data as LayoutWriteRow | null;
    error = result.error;
  }

  if (error?.code === "23505") {
    return NextResponse.json(
      { error: "Layout changed elsewhere. Reload before saving again." },
      { status: 409 }
    );
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: "Layout changed elsewhere. Reload before saving again." },
      { status: 409 }
    );
  }

  return NextResponse.json({ scope, layout: data.layout, updated_at: data.updated_at });
}

export async function DELETE(request: Request) {
  const actorResult = await loadConfigActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const scope = parseTableScope(new URL(request.url).searchParams.get("scope"));
  if (!scope) {
    return NextResponse.json({ error: "Invalid table scope." }, { status: 400 });
  }
  const { error } = await getSupabaseAdmin()
    .from("user_table_layout")
    .delete()
    .eq("user_email", actorResult.actor.email)
    .eq("scope", scope);
  if (error && !isLayoutMissingError(error)) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, scope });
}

function normalizeLayout(value: unknown): LayoutEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: LayoutEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    if (typeof row.column_key !== "string") return null;
    if (typeof row.position !== "number") return null;
    const width =
      typeof row.width === "number" && Number.isFinite(row.width)
        ? Math.max(60, Math.round(row.width))
        : null;
    entries.push({
      column_key: row.column_key,
      position: Math.round(row.position),
      width,
      hidden: Boolean(row.hidden),
    });
  }
  return entries;
}

function isLayoutMissingError(error: { code?: string; message?: string }): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (message.includes("user_table_layout") &&
      (message.includes("schema cache") || message.includes("does not exist")))
  );
}
