import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser-side anon client, used ONLY to join the Realtime socket for notification
// pings. It cannot read tables (RLS denies the anon role) and carries no content.
// Returns null when the public env vars aren't configured → callers fall back to
// polling.
let cached: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
