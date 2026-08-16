import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  canManageEnrollmentOptions,
  loadEnrollmentActor,
} from "@/lib/enrollment/access";
import {
  ENROLLMENT_OPTION_LABELS,
  fetchEnrollmentOptionData,
} from "@/lib/enrollment/options";
import {
  broadcastTableConfigInvalidation,
} from "@/lib/table-config/realtime";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
import {
  ENROLLMENT_OPTION_SET_KEYS,
  enrollmentOptionSetKeysForProgram,
  parseEnrollmentProgram,
  type EnrollmentOptionSetKey,
} from "@/lib/enrollment/types";
import { validateEnrollmentOptionRules } from "@/lib/table-config/values";
import { parseConfiguredColor } from "@/lib/table-config/value-colors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const program = parseEnrollmentProgram(
    new URL(request.url).searchParams.get("program")
  );
  if (!program) {
    return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  }
  const data = await fetchEnrollmentOptionData(program);
  const invalidRuleOptionIds = data.options
    .filter((option) =>
      !validateEnrollmentOptionRules({
        program,
        setKey: option.set_key,
        isStage: option.set_key === "stage",
        isTerminal: option.is_terminal,
        triggersQc: option.triggers_qc,
      }).ok
    )
    .map((option) => option.id);
  return NextResponse.json({
    ...data,
    diagnostics: { invalidRuleOptionIds },
  });
}

export async function POST(request: Request) {
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
  const setKey = typeof body?.set_key === "string" ? body.set_key.trim() : "";
  if (!isEnrollmentOptionSetKey(setKey)) {
    return NextResponse.json({ error: "Invalid option set." }, { status: 400 });
  }
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json(
      { error: `${ENROLLMENT_OPTION_LABELS[setKey]} label is required.` },
      { status: 400 }
    );
  }

  const program = parseEnrollmentProgram(body?.program);
  if (!program) {
    return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  }
  if (!enrollmentOptionSetKeysForProgram(program).includes(setKey)) {
    return NextResponse.json(
      { error: "Option set is not available for this enrollment program." },
      { status: 400 }
    );
  }

  const colorResult = parseConfiguredColor(body?.color);
  if (!colorResult.ok) {
    return NextResponse.json({ error: colorResult.error }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: setRow, error: setError } = await supabase
    .from("enrollment_option_sets")
    .select("id,key,is_stage")
    .eq("program", program)
    .eq("key", setKey)
    .maybeSingle();
  if (setError) return NextResponse.json({ error: setError.message }, { status: 500 });
  if (!setRow) return NextResponse.json({ error: "Option set not found." }, { status: 404 });
  const ruleValidation = validateEnrollmentOptionRules({
    program,
    setKey,
    isStage: Boolean(setRow.is_stage),
    isTerminal: body?.is_terminal,
    triggersQc: body?.triggers_qc,
  });
  if (!ruleValidation.ok) return NextResponse.json({ error: ruleValidation.error }, { status: 400 });

  const { data: last } = await supabase
      .from("enrollment_options")
    .select("position")
    .eq("set_id", (setRow as { id: string }).id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("enrollment_options")
    .insert({
      set_id: (setRow as { id: string }).id,
      label,
      color: colorResult.color,
      position:
        typeof body?.position === "number"
          ? Math.round(body.position)
          : ((last as { position?: number } | null)?.position ?? 0) + 10,
      is_terminal:
        Boolean((setRow as { is_stage: boolean }).is_stage) &&
        Boolean(body?.is_terminal),
      triggers_qc:
        Boolean((setRow as { is_stage: boolean }).is_stage) &&
        Boolean(body?.triggers_qc),
      // Kept as a database compatibility column while terminal semantics are
      // unified on is_terminal. New options must never create a second flag.
      treat_as_terminal: false,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await Promise.all([
    broadcastEnrollmentChanged(program),
    broadcastTableConfigInvalidation(),
  ]);
  return NextResponse.json({ option: data });
}

function isEnrollmentOptionSetKey(value: string): value is EnrollmentOptionSetKey {
  return ENROLLMENT_OPTION_SET_KEYS.includes(value as EnrollmentOptionSetKey);
}
