import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  canManageEnrollmentOptions,
  loadEnrollmentActor,
} from "@/lib/enrollment/access";
import { broadcastTableConfigChanged } from "@/lib/table-config/realtime";

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

  const supabase = getSupabaseAdmin();
  if ("label" in body) {
    const { data: option, error: optionError } = await supabase
      .from("enrollment_options")
      .select("set_id")
      .eq("id", id)
      .maybeSingle();
    if (optionError) return NextResponse.json({ error: optionError.message }, { status: 500 });
    if (!option) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: optionSet, error: optionSetError } = await supabase
      .from("enrollment_option_sets")
      .select("key")
      .eq("id", option.set_id)
      .maybeSingle();
    if (optionSetError) {
      return NextResponse.json({ error: optionSetError.message }, { status: 500 });
    }
    if (optionSet?.key === "stage" || optionSet?.key === "consent") {
      return NextResponse.json(
        { error: "Stage and Consent option labels are protected workflow identities." },
        { status: 409 }
      );
    }
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

  const { data, error } = await supabase
    .from("enrollment_options")
    .update(patch)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await broadcastTableConfigChanged();
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

  const supabase = getSupabaseAdmin();
  const { data: option, error: optionError } = await supabase
    .from("enrollment_options")
    .select("set_id")
    .eq("id", id)
    .maybeSingle();
  if (optionError) return NextResponse.json({ error: optionError.message }, { status: 500 });
  if (!option) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: optionSet, error: optionSetError } = await supabase
    .from("enrollment_option_sets")
    .select("key,is_stage")
    .eq("id", option.set_id)
    .maybeSingle();
  if (optionSetError) {
    return NextResponse.json({ error: optionSetError.message }, { status: 500 });
  }
  if (optionSet?.is_stage && optionSet.key === "stage") {
    const { count, error: countError } = await supabase
      .from("enrollment_options")
      .select("id", { count: "exact", head: true })
      .eq("set_id", option.set_id)
      .is("archived_at", null);
    if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "At least one active stage is required for this program." },
        { status: 409 }
      );
    }
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("enrollment_options")
    .update({ archived_at: nowIso, updated_at: nowIso })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await broadcastTableConfigChanged();
  return NextResponse.json({ ok: true });
}

function cleanColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : null;
}
