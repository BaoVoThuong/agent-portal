import type { SupabaseClient } from "@supabase/supabase-js";

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
  name: string,
  actorEmail: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const existing = await supabase
    .from("lead_events")
    .select("id")
    .ilike("name", name)
    .is("archived_at", null)
    .limit(1);
  if (existing.error) return { ok: false, error: existing.error.message };
  if (existing.data?.[0]) return { ok: true, id: existing.data[0].id as string };

  const created = await supabase
    .from("lead_events")
    .insert({ name, created_by_email: actorEmail })
    .select("id")
    .maybeSingle();
  if (created.data?.id) return { ok: true, id: created.data.id as string };

  // Someone else created the same event between the read and the insert.
  const retry = await supabase
    .from("lead_events")
    .select("id")
    .ilike("name", name)
    .is("archived_at", null)
    .limit(1);
  if (retry.error) return { ok: false, error: retry.error.message };
  if (retry.data?.[0]) return { ok: true, id: retry.data[0].id as string };
  return { ok: false, error: created.error?.message ?? "Could not create that event." };
}
