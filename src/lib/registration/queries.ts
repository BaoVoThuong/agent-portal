import { readAllRowsById } from "@/lib/pagination/all-rows";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { Entry } from "@/lib/domain/entry.types";
import type { PcEntry } from "@/lib/domain/pc-entry.types";

type RegistrationTable = "health_entries" | "pc_entries";
type RegistrationRow = Entry | PcEntry;

export async function fetchRegistrationEntries<T extends RegistrationRow>(
  table: RegistrationTable,
  visibilityFilter?: string,
): Promise<T[]> {
  const supabase = getSupabaseAdmin();
  const result = await readAllRowsById<T>(async (afterId, pageSize, withCount) => {
    let query = supabase.from(table)
      .select("*", withCount ? { count: "exact" } : undefined);
    if (visibilityFilter) query = query.or(visibilityFilter);
    if (afterId) query = query.gt("id", afterId);
    const page = await query.order("id").limit(pageSize);
    return { ...page, data: page.data as unknown as T[] | null };
  });
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []).sort((a, b) =>
    b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
  );
}
