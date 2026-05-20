import { getSupabaseAdmin } from "@/lib/supabase";

const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

export function getClientIp(request: Request | undefined): string | null {
  if (!request) return null;
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || null;
  return request.headers.get("x-real-ip");
}

// Fails open on infrastructure errors so a DB hiccup never locks everyone out.
export async function isLoginRateLimited(email: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const { count, error } = await supabase
    .from("login_attempts")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .eq("success", false)
    .gte("created_at", since);

  if (error) return false;
  return (count ?? 0) >= MAX_FAILED_ATTEMPTS;
}

export async function recordLoginAttempt(
  email: string,
  ip: string | null,
  success: boolean
) {
  const supabase = getSupabaseAdmin();
  await supabase.from("login_attempts").insert({ email, ip, success });
}
