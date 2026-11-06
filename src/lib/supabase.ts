import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin(dbTimeoutMs?: number) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    ...(dbTimeoutMs ? { db: { timeout: dbTimeoutMs } } : {}),
  });
}
