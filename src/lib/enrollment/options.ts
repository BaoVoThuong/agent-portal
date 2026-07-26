import { getSupabaseAdmin } from "@/lib/supabase";
import type {
  EnrollmentOption,
  EnrollmentOptionSet,
  EnrollmentOptionSetKey,
  EnrollmentProgram,
} from "./types";

export const ENROLLMENT_OPTION_LABELS: Record<EnrollmentOptionSetKey, string> = {
  stage: "Stage",
  carrier: "Carrier",
  platform: "Platform",
  consent: "Consent",
  payment_status: "Payment",
  aca_status: "ACA",
};

export type EnrollmentOptionsBySet = Record<EnrollmentOptionSetKey, EnrollmentOption[]>;

export function emptyEnrollmentOptionsBySet(): EnrollmentOptionsBySet {
  return {
    stage: [],
    carrier: [],
    platform: [],
    consent: [],
    payment_status: [],
    aca_status: [],
  };
}

export async function fetchEnrollmentOptionData(
  program: EnrollmentProgram
): Promise<{
  sets: EnrollmentOptionSet[];
  options: EnrollmentOption[];
  optionsBySet: EnrollmentOptionsBySet;
}> {
  const supabase = getSupabaseAdmin();
  const setsRes = await supabase
    .from("enrollment_option_sets")
    .select("id,program,key,label,is_stage,created_at,updated_at")
    .eq("program", program)
    .order("label", { ascending: true });
  if (setsRes.error) throw new Error(setsRes.error.message);
  const sets = (setsRes.data ?? []) as EnrollmentOptionSet[];
  const setIds = sets.map((set) => set.id);

  const optionsRes = setIds.length
    ? await supabase
        .from("enrollment_options")
        .select("id,set_id,label,color,position,is_terminal,triggers_qc,archived_at")
        .in("set_id", setIds)
        .order("position", { ascending: true })
        .order("label", { ascending: true })
    : { data: [], error: null };
  if (optionsRes.error) throw new Error(optionsRes.error.message);

  const setKeyById = new Map(sets.map((set) => [set.id, set.key]));
  const options = ((optionsRes.data ?? []) as Omit<EnrollmentOption, "set_key">[])
    .map((option) => {
      const setKey = setKeyById.get(option.set_id);
      if (!setKey) return null;
      return { ...option, set_key: setKey };
    })
    .filter((option): option is EnrollmentOption => Boolean(option));

  const optionsBySet = emptyEnrollmentOptionsBySet();
  for (const option of options) {
    if (option.archived_at) continue;
    optionsBySet[option.set_key].push(option);
  }

  return { sets, options, optionsBySet };
}

export function optionById(options: EnrollmentOption[]): Map<string, EnrollmentOption> {
  return new Map(options.map((option) => [option.id, option]));
}

export function firstStageOption(optionsBySet: EnrollmentOptionsBySet): EnrollmentOption | null {
  return optionsBySet.stage[0] ?? null;
}

export async function fetchEnrollmentOption(
  optionId: string | null | undefined,
  program: EnrollmentProgram
): Promise<EnrollmentOption | null> {
  if (!optionId) return null;
  const { options } = await fetchEnrollmentOptionData(program);
  return options.find((option) => option.id === optionId) ?? null;
}

export async function assertEnrollmentOptionSet(
  optionId: string | null,
  expectedSet: EnrollmentOptionSetKey,
  program: EnrollmentProgram
): Promise<EnrollmentOption | null> {
  if (!optionId) return null;
  const option = await fetchEnrollmentOption(optionId, program);
  if (!option || option.set_key !== expectedSet || option.archived_at) {
    throw new Error(`Invalid ${ENROLLMENT_OPTION_LABELS[expectedSet]} option.`);
  }
  return option;
}
