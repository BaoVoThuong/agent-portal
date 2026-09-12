import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requireAnyPermission } from "@/lib/rbac/server";
import OrgChartClient, { type OrgChartPerson } from "./OrgChartClient";

export const dynamic = "force-dynamic";

export default async function OrgChartPage() {
  const session = await requireAnyPermission([
    PERMISSIONS.ORG_CHART_VIEW,
    PERMISSIONS.ORG_CHART_MANAGE,
    // Các account manager hiện hữu vẫn vào được trong lúc quyền mới rollout.
    PERMISSIONS.ACCOUNT_MANAGER,
  ]);
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .select("id,email,name,agent_id,role,is_active,manager_id")
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);

  const people = (data ?? []) as unknown as OrgChartPerson[];
  const currentEmail = session.user.email?.toLocaleLowerCase() ?? "";
  const currentUserId =
    people.find((person) => person.email.toLocaleLowerCase() === currentEmail)?.id ??
    null;
  const canManage =
    can(session.user.permissions, PERMISSIONS.ORG_CHART_MANAGE) ||
    can(session.user.permissions, PERMISSIONS.ACCOUNT_MANAGER);

  return (
    <OrgChartClient
      initialPeople={people}
      currentUserId={currentUserId}
      canManage={canManage}
    />
  );
}
