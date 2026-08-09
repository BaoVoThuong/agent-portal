import type { SupabaseClient } from "@supabase/supabase-js";

export async function touchLastActivity(
  supabase: SupabaseClient,
  taskId: string,
  actorEmail: string,
  nowIso: string
): Promise<string> {
  const { data, error } = await supabase
    .from("tasks")
    // updated_at must move too. `last_activity_at` is a rendered List column,
    // so a comment/attachment genuinely changes what the row displays — and
    // `updated_at` is the token every PATCH sends back as
    // `expected_updated_at` for the 409 concurrency check. Leaving it behind
    // means the row's visible content and its version disagree: clients that
    // refresh see new content at an unchanged version, and any staleness
    // check keyed on the version silently drops the update. There is no DB
    // trigger maintaining this column — the database trigger clamps it.
    .update({
      last_activity_at: nowIso,
      last_activity_by_email: actorEmail,
      stale_reminded_at: null,
      updated_at: nowIso,
    })
    .eq("id", taskId)
    .select("updated_at")
    .single();
  if (error) throw new Error(error.message);
  return (data as { updated_at: string }).updated_at;
}
