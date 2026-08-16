import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  canManageEnrollmentOptions,
  loadEnrollmentActor,
} from "@/lib/enrollment/access";
import {
  broadcastTableConfigInvalidation,
} from "@/lib/table-config/realtime";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
import { inactiveConfigValueResponse } from "@/lib/table-config/mutation-errors";
import { validateEnrollmentOptionRules } from "@/lib/table-config/values";
import { parseConfiguredColor } from "@/lib/table-config/value-colors";

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
  let optionSet: { key: string; program: string; is_stage: boolean } | null = null;
  if (
    "label" in body ||
    "is_terminal" in body ||
    "triggers_qc" in body ||
    "treat_as_terminal" in body
  ) {
    const { data: option, error: optionError } = await supabase
      .from("enrollment_options")
      .select("set_id")
      .eq("id", id)
      .is("archived_at", null)
      .maybeSingle();
    if (optionError) return NextResponse.json({ error: "Could not load the option." }, { status: 500 });
    if (!option) return NextResponse.json(inactiveConfigValueResponse("Option"), { status: 409 });

    const { data: optionSetRow, error: optionSetError } = await supabase
      .from("enrollment_option_sets")
      .select("key,program,is_stage")
      .eq("id", option.set_id)
      .maybeSingle();
    if (optionSetError) {
      return NextResponse.json({ error: "Could not load the option set." }, { status: 500 });
    }
    if (!optionSetRow) return NextResponse.json(inactiveConfigValueResponse("Option"), { status: 409 });
    if ("label" in body && (optionSetRow.key === "stage" || optionSetRow.key === "consent")) {
      return NextResponse.json(
        { error: "Stage and Consent option labels are protected workflow identities." },
        { status: 409 }
      );
    }
    // Keep the local variable available to the patch builder below.
    optionSet = optionSetRow as { key: string; program: string; is_stage: boolean };
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ("label" in body) {
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) return NextResponse.json({ error: "Label is required." }, { status: 400 });
    patch.label = label;
  }
  if ("color" in body) {
    const colorResult = parseConfiguredColor(body.color);
    if (!colorResult.ok) {
      return NextResponse.json({ error: colorResult.error }, { status: 400 });
    }
    patch.color = colorResult.color;
  }
  if ("position" in body && typeof body.position === "number") {
    patch.position = Math.round(body.position);
  }
  if ("is_terminal" in body) patch.is_terminal = Boolean(body.is_terminal);
  if ("triggers_qc" in body) patch.triggers_qc = Boolean(body.triggers_qc);
  // Keep legacy rows from retaining the retired dashboard-only semantics when
  // they are edited through the current API.
  if (optionSet) patch.treat_as_terminal = false;
  const ruleValidation = validateEnrollmentOptionRules({
    program: optionSet?.program ?? "",
    setKey: optionSet?.key ?? "",
    isStage: Boolean(optionSet?.is_stage),
    isTerminal: body.is_terminal,
    triggersQc: body.triggers_qc,
  });
  if (!ruleValidation.ok) {
    return NextResponse.json({ error: ruleValidation.error }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("enrollment_options")
    .update(patch)
    .eq("id", id)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update option." }, { status: 500 });
  if (!data) return NextResponse.json(inactiveConfigValueResponse("Option"), { status: 409 });

  await Promise.all([
    broadcastEnrollmentChanged(),
    broadcastTableConfigInvalidation(),
  ]);
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
    .is("archived_at", null)
    .maybeSingle();
  if (optionError) return NextResponse.json({ error: "Could not load the option." }, { status: 500 });
  if (!option) return NextResponse.json(inactiveConfigValueResponse("Option"), { status: 409 });

  const { data: optionSet, error: optionSetError } = await supabase
    .from("enrollment_option_sets")
    .select("key,is_stage")
    .eq("id", option.set_id)
    .maybeSingle();
  if (optionSetError) {
    return NextResponse.json({ error: "Could not load the option set." }, { status: 500 });
  }
  if (optionSet?.is_stage && optionSet.key === "stage") {
    const { count, error: countError } = await supabase
      .from("enrollment_options")
      .select("id", { count: "exact", head: true })
      .eq("set_id", option.set_id)
      .is("archived_at", null);
    if (countError) return NextResponse.json({ error: "Could not verify the active stages." }, { status: 500 });
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
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Could not archive option." }, { status: 500 });
  if (!data) return NextResponse.json(inactiveConfigValueResponse("Option"), { status: 409 });

  await Promise.all([
    broadcastEnrollmentChanged(),
    broadcastTableConfigInvalidation(),
  ]);
  return NextResponse.json({ ok: true });
}
