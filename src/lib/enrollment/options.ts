import { getSupabaseAdmin } from "@/lib/supabase";
import { enrollmentOptionSetKeysForProgram } from "./types";
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

export type EnrollmentOptionData = {
  sets: EnrollmentOptionSet[];
  options: EnrollmentOption[];
  optionsBySet: EnrollmentOptionsBySet;
  optionsById: Map<string, EnrollmentOption>;
};

const enrollmentOptionLabelCollator = new Intl.Collator("en-US", {
  numeric: true,
  sensitivity: "base",
});

export function compareEnrollmentOptionText(first: string, second: string): number {
  return enrollmentOptionLabelCollator.compare(first.trim(), second.trim());
}

/**
 * Thứ tự của một nhóm option: theo `position` trước, nhãn sau.
 *
 * Trước 2026-09-09 hàm này chỉ so NHÃN. ACA và Medicare vẫn ra đúng thứ tự quy
 * trình, nhưng chỉ vì admin đã tự đánh số vào nhãn ("1-Need quote", "2-Quoted",
 * …) và collator bật `numeric`. Nói cách khác thứ tự đúng là nhờ quy ước đặt
 * tên, không phải nhờ dữ liệu.
 *
 * Medicaid không đánh số (nhãn là "URGENT", "Hold", "Approved", …) nên sắp theo
 * nhãn cho ra thứ tự bảng chữ cái — và vì stage mặc định lúc tạo hồ sơ là phần
 * tử ĐẦU TIÊN của danh sách này, hồ sơ Medicaid mới sẽ mặc định là "Approved".
 *
 * `position` chính là thứ tự admin kéo-thả trong /config, nên nó mới là nguồn
 * đúng. Với ACA/Medicare thì position đã khớp sẵn số trong nhãn (10, 20, 30 …)
 * nên đổi sang đây không làm xê dịch gì của họ.
 */
export function compareEnrollmentOptions(
  first: Pick<EnrollmentOption, "id" | "label" | "position">,
  second: Pick<EnrollmentOption, "id" | "label" | "position">
): number {
  return (
    first.position - second.position ||
    compareEnrollmentOptionText(first.label, second.label) ||
    first.id.localeCompare(second.id)
  );
}

export function sortEnrollmentOptions(
  options: EnrollmentOption[]
): EnrollmentOption[] {
  return [...options].sort(compareEnrollmentOptions);
}

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
): Promise<EnrollmentOptionData> {
  const supabase = getSupabaseAdmin();
  const setsRes = await supabase
    .from("enrollment_option_sets")
    .select("id,program,key,label,is_stage,created_at,updated_at")
    .eq("program", program)
    .in("key", [...enrollmentOptionSetKeysForProgram(program)])
    .order("label", { ascending: true });
  if (setsRes.error) throw new Error(setsRes.error.message);
  const sets = (setsRes.data ?? []) as EnrollmentOptionSet[];
  const setIds = sets.map((set) => set.id);

  const optionsRes = setIds.length
    ? await supabase
        .from("enrollment_options")
        .select("id,set_id,label,color,position,is_terminal,triggers_qc,archived_at")
        .in("set_id", setIds)
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
  for (const option of sortEnrollmentOptions(options)) {
    if (option.archived_at) continue;
    optionsBySet[option.set_key].push(option);
  }

  const sortedOptions = sortEnrollmentOptions(options);
  return { sets, options: sortedOptions, optionsBySet, optionsById: optionById(sortedOptions) };
}

export function optionById(options: EnrollmentOption[]): Map<string, EnrollmentOption> {
  return new Map(options.map((option) => [option.id, option]));
}

/**
 * Stage mặc định khi tạo hồ sơ mới: stage đứng đầu theo `position`.
 * `optionsBySet` đã được sắp bằng compareEnrollmentOptions nên chỉ cần phần tử
 * đầu — nhưng ý nghĩa "đầu tiên" giờ là thứ tự quy trình, không phải bảng chữ cái.
 */
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
  program: EnrollmentProgram,
  snapshot?: Pick<EnrollmentOptionData, "optionsById">
): Promise<EnrollmentOption | null> {
  if (!optionId) return null;
  const option = snapshot
    ? snapshot.optionsById.get(optionId) ?? null
    : await fetchEnrollmentOption(optionId, program);
  if (!option || option.set_key !== expectedSet || option.archived_at) {
    throw new Error(`Invalid ${ENROLLMENT_OPTION_LABELS[expectedSet]} option.`);
  }
  return option;
}
