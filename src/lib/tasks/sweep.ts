import { readAllRowsById } from "@/lib/pagination/all-rows";
import { getSupabaseAdmin } from "@/lib/supabase";

export type TaskSweepFilter =
  | { op: "eq"; column: string; value: string }
  | { op: "lte"; column: string; value: string }
  | { op: "is"; column: string; value: null }
  | { op: "not"; column: string; operator: string; value: string | null }
  | { op: "in"; column: string; values: string[] };

/** Complete task set for reminder sweeps; no silent 1,000-row cutoff. */
export async function fetchTaskSweepRows<T extends { id: string }>(
  columns: string,
  filters: readonly TaskSweepFilter[],
): Promise<T[]> {
  const supabase = getSupabaseAdmin();
  const result = await readAllRowsById<T>(async (afterId, pageSize, withCount) => {
    let query = supabase.from("tasks")
      .select(columns, withCount ? { count: "exact" } : undefined);
    for (const filter of filters) {
      if (filter.op === "eq") query = query.eq(filter.column, filter.value);
      else if (filter.op === "lte") query = query.lte(filter.column, filter.value);
      else if (filter.op === "is") query = query.is(filter.column, filter.value);
      else if (filter.op === "in") query = query.in(filter.column, filter.values);
      else query = query.not(filter.column, filter.operator, filter.value);
    }
    if (afterId) query = query.gt("id", afterId);
    const page = await query.order("id").limit(pageSize);
    return { ...page, data: page.data as unknown as T[] | null };
  });
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}
