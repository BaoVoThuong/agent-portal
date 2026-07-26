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
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";
import {
  toEnrollmentProgram,
  type EnrollmentOptionSetKey,
} from "@/lib/enrollment/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }

  const program = toEnrollmentProgram(
    new URL(request.url).searchParams.get("program")
  );
  const data = await fetchEnrollmentOptionData(program);
  return NextResponse.json(data);
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

  const program = toEnrollmentProgram(body?.program);
  const supabase = getSupabaseAdmin();
  const { data: setRow, error: setError } = await supabase
    .from("enrollment_option_sets")
    .select("id,is_stage")
    .eq("program", program)
    .eq("key", setKey)
    .maybeSingle();
  if (setError) return NextResponse.json({ error: setError.message }, { status: 500 });
  if (!setRow) return NextResponse.json({ error: "Option set not found." }, { status: 404 });

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
      color: cleanColor(body?.color),
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
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastEnrollmentChanged();
  return NextResponse.json({ option: data });
}

function isEnrollmentOptionSetKey(value: string): value is EnrollmentOptionSetKey {
  return value in ENROLLMENT_OPTION_LABELS;
}

function cleanColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : null;
}
