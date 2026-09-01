import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ILIKE treats % and _ as wildcards, so an event genuinely named "50% Off Fair"
 * would match half the table and resolve to the wrong row. The unique index is
 * on lower(btrim(name)), so the lookup has to be trimmed too or a name with a
 * stray space can never be found NOR created: the search misses, the insert
 * collides on the index, and the retry misses again.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/**
 * Find the event with this name, or create it. Matching ignores case and
 * surrounding space; a unique index on lower(btrim(name)) makes two people
 * typing the same name at the same moment collapse to one row rather than
 * racing, and the re-select after a conflict picks up whichever row won.
 *
 * Shared by the create route and the inline editor: two copies of a
 * find-or-create is two chances for the per-event report to split one event.
 */
export async function resolveEventByName(
  supabase: SupabaseClient,
  rawName: string,
  actorEmail: string
): Promise<{ ok: true; id: string; wasCreated: boolean } | { ok: false; error: string }> {
  const name = rawName.trim();
  if (!name) return { ok: false, error: "The event needs a name." };
  const pattern = escapeLikePattern(name);

  const existing = await supabase
    .from("lead_events")
    .select("id")
    .ilike("name", pattern)
    .is("archived_at", null)
    .limit(1);
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data?.[0])
    return { ok: true, id: existing.data[0].id as string, wasCreated: false };

  const created = await supabase
    .from("lead_events")
    .insert({ name, created_by_email: actorEmail })
    .select("id")
    .maybeSingle();
  if (created.data?.id)
    return { ok: true, id: created.data.id as string, wasCreated: true };

  // Someone else created the same event between the read and the insert.
  const retry = await supabase
    .from("lead_events")
    .select("id")
    .ilike("name", pattern)
    .is("archived_at", null)
    .limit(1);
  if (retry.error) return { ok: false, error: retry.error.message };
  if (retry.data?.[0])
    return { ok: true, id: retry.data[0].id as string, wasCreated: false };
  return { ok: false, error: created.error?.message ?? "Could not create that event." };
}
