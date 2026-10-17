import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

function isLocalPasswordHash(value: string | null | undefined): boolean {
  return Boolean(value && /^\$2[aby]\$/.test(value));
}

export default async function SettingsPage() {
  // Every signed-in account has Settings; no permission gates it (2026-10-17).
  const session = await getSession();
  if (!session?.user?.email) redirect("/signin");
  const email = session.user.email;
  const supabase = getSupabaseAdmin();
  const [{ data, error }, { data: notificationPreference }] = await Promise.all([
    supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .select("email,name,agent_id,password_hash,avatar_url,is_active")
      .eq("email", email)
      .maybeSingle(),
    supabase
      .from("notification_preferences")
      .select("sound_enabled")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle(),
  ]);

  const profile = data as {
    email?: string | null;
    name?: string | null;
    agent_id?: string | null;
    password_hash?: string | null;
    avatar_url?: string | null;
    is_active?: boolean | null;
  } | null;
  if (error) throw new Error(error.message);
  // A disabled or deleted account can retain a session until it expires.
  if (!profile || profile.is_active !== true) redirect("/unauthorized");
  return (
    <SettingsClient
      profile={{
        email: profile?.email ?? email,
        name: profile?.name ?? session?.user?.name ?? "",
        agentId: profile?.agent_id ?? session?.user?.agentId ?? null,
        hasLocalPassword: isLocalPasswordHash(profile?.password_hash),
        avatarUrl: profile?.avatar_url ?? null,
      }}
      // Khoá CÔNG của VAPID — đưa xuống trình duyệt là đúng thiết kế; khoá tư
      // nằm ở server và không bao giờ rời khỏi đó.
      vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
      alertsMuted={notificationPreference?.sound_enabled === false}
    />
  );
}
