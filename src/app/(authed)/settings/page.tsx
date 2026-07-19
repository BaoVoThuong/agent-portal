import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { getSupabaseAdmin } from "@/lib/supabase";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

function isLocalPasswordHash(value: string | null | undefined): boolean {
  return Boolean(value && /^\$2[aby]\$/.test(value));
}

export default async function SettingsPage() {
  const session = await requirePermission(PERMISSIONS.SETTINGS);
  const email = session?.user?.email ?? "";
  const { data } = email
    ? await getSupabaseAdmin()
        .from(PORTAL_ACCOUNT_TABLE)
        .select("email,name,agent_id,password_hash")
        .eq("email", email)
        .maybeSingle()
    : { data: null };

  const profile = data as {
    email?: string | null;
    name?: string | null;
    agent_id?: string | null;
    password_hash?: string | null;
  } | null;

  return (
    <SettingsClient
      profile={{
        email: profile?.email ?? email,
        name: profile?.name ?? session?.user?.name ?? "",
        agentId: profile?.agent_id ?? session?.user?.agentId ?? null,
        hasLocalPassword: isLocalPasswordHash(profile?.password_hash),
      }}
    />
  );
}
