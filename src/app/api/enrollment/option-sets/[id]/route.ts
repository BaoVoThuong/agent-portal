import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  canManageEnrollmentOptions,
  loadEnrollmentActor,
} from "@/lib/enrollment/access";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }
  if (!canManageEnrollmentOptions(actorResult.actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("label" in body) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return NextResponse.json({ error: "Label is required." }, { status: 400 });
    patch.label = label;
  }
  if ("color" in body) patch.color = cleanColor(body.color);
  if ("position" in body && typeof body.position === "number") {
    patch.position = Math.round(body.position);
  }
  if ("is_terminal" in body) patch.is_terminal = Boolean(body.is_terminal);
  if ("triggers_qc" in body) patch.triggers_qc = Boolean(body.triggers_qc);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("enrollment_options")
    .update(patch)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await broadcastEnrollmentChanged();
  return NextResponse.json({ option: data });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }
  if (!canManageEnrollmentOptions(actorResult.actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("enrollment_options")
    .update({ archived_at: nowIso, updated_at: nowIso })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await broadcastEnrollmentChanged();
  return NextResponse.json({ ok: true });
}

function cleanColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : null;
}
