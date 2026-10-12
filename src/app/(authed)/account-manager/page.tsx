import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import type { AccountUser } from "@/lib/domain/account.types";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { can } from "@/lib/rbac/client";
import {
  fetchRolesWithPermissions,
  type RoleOption,
} from "@/lib/rbac/role-management";
import { requirePermission } from "@/lib/rbac/server";
import { isAdminRoleName } from "@/lib/rbac/admin-role";
import AccountManagerClient from "./AccountManagerClient";
import type { AgentMembershipData, AssistantMember } from "./AgentMembershipSection";
import {
  fetchTaskAgentCandidates,
  fetchTaskAgents,
  fetchTaskAssignees,
} from "@/lib/tasks/assignees";

export const dynamic = "force-dynamic";

type UserRoleRow = {
  user_id: string;
  role_id: string;
};

function isMissingNotificationPreferencesTable(error: {
  code?: string;
  message?: string;
} | null): boolean {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "PGRST205" ||
    message.includes("schema cache") ||
    message.includes("notification_preferences")
  );
}

export type ManagedAccountUser = AccountUser & {
  role_ids: string[];
  roles: RoleOption[];
  alertsMuted: boolean;
  alertsUpdatedBy: string | null;
  alertsUpdatedAt: string | null;
};

/**
 * Agents + Assistant membership (chuyển từ Table Configuration 2026-10-03).
 * Thuộc trang Account Manager nên dùng ĐÚNG quyền của trang này
 * (`management.account_manager`) — cùng cổng với `/api/config/agents|assistants`.
 * Trước 2026-10-09 phần này gác bằng quyền Task (task manager): một quyền chéo
 * cho phép người không vào được trang vẫn gọi thẳng API để sửa Agent/Assistant.
 */
async function loadAgentMembership(
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<AgentMembershipData> {
  try {
    const [agents, candidates, assignees, membersResult] = await Promise.all([
      fetchTaskAgents(),
      fetchTaskAgentCandidates(),
      fetchTaskAssignees(),
      supabase
        .from("agent_members")
        .select("agent_email,cs_email,is_assistant")
        .eq("is_assistant", true),
    ]);
    if (membersResult.error) throw new Error(membersResult.error.message);
    return {
      agents,
      candidates,
      assignees,
      members: (membersResult.data ?? []) as AssistantMember[],
      available: true,
    };
  } catch {
    return {
      agents: [],
      candidates: [],
      assignees: [],
      members: [],
      available: false,
      error: "Could not load agents. Retry after checking the connection or permissions.",
    };
  }
}

export default async function AccountManagerPage() {
  const session = await requirePermission(PERMISSIONS.ACCOUNT_MANAGER);

  if (!session.user.email) {
    redirect("/");
  }

  const supabase = getSupabaseAdmin();
  const canManageAlerts = can(
    session.user.permissions,
    PERMISSIONS.NOTIFICATION_ALERTS,
  );
  const [
    { data, error },
    roles,
    userRolesResponse,
    notificationPreferencesResponse,
    agentMembership,
  ] = await Promise.all([
    supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .select("id,email,name,agent_id,is_active,created_at")
      .order("created_at", { ascending: false }),
    fetchRolesWithPermissions(),
    supabase.from("user_roles").select("user_id,role_id"),
    canManageAlerts
      ? supabase
          .from("notification_preferences")
          .select("email,sound_enabled,updated_by_email,updated_at")
      : Promise.resolve({ data: [], error: null }),
    loadAgentMembership(supabase),
  ]);

  if (error) {
    throw new Error(error.message);
  }

  if (userRolesResponse.error) {
    throw new Error(userRolesResponse.error.message);
  }
  if (
    notificationPreferencesResponse.error &&
    !isMissingNotificationPreferencesTable(notificationPreferencesResponse.error)
  ) {
    throw new Error(notificationPreferencesResponse.error.message);
  }

  const notificationPreferencesByEmail = new Map(
    ((notificationPreferencesResponse.error
      ? []
      : notificationPreferencesResponse.data ?? []) as Array<{
      email: string;
      sound_enabled: boolean | null;
      updated_by_email: string | null;
      updated_at: string | null;
    }>).map((preference) => [preference.email.trim().toLowerCase(), preference]),
  );

  const availableRoles: RoleOption[] = roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    is_system: role.is_system,
    is_active: role.is_active,
    is_default: role.is_default,
  }));
  const rolesById = new Map(availableRoles.map((role) => [role.id, role]));
  const roleIdsByUserId = new Map<string, string[]>();
  for (const row of (userRolesResponse.data ?? []) as unknown as UserRoleRow[]) {
    roleIdsByUserId.set(row.user_id, [
      ...(roleIdsByUserId.get(row.user_id) ?? []),
      row.role_id,
    ]);
  }

  const users = ((data ?? []) as AccountUser[]).map<ManagedAccountUser>(
    (user) => {
      const directRoleIds = [...(roleIdsByUserId.get(user.id) ?? [])]
        .sort((firstRoleId, secondRoleId) => {
          const firstRole = rolesById.get(firstRoleId);
          const secondRole = rolesById.get(secondRoleId);

          if (isAdminRoleName(firstRole?.name)) return -1;
          if (isAdminRoleName(secondRole?.name)) return 1;

          return (firstRole?.name ?? "").localeCompare(secondRole?.name ?? "");
        })
        .slice(0, 1);
      // No fallback to the legacy portal_account.role column any more: an
      // account without a role shows "No role" instead of a guessed one.
      const roleIds = directRoleIds;

      return {
        ...user,
        role_ids: roleIds,
        roles: roleIds
          .map((roleId) => rolesById.get(roleId))
          .filter((role): role is RoleOption => Boolean(role)),
        alertsMuted:
          notificationPreferencesByEmail.get(user.email.toLowerCase())
            ?.sound_enabled === false,
        alertsUpdatedBy:
          notificationPreferencesByEmail.get(user.email.toLowerCase())
            ?.updated_by_email ?? null,
        alertsUpdatedAt:
          notificationPreferencesByEmail.get(user.email.toLowerCase())
            ?.updated_at ?? null,
      };
    }
  );

  return (
    <AccountManagerClient
      currentUserEmail={session.user.email ?? ""}
      currentUserPermissions={session.user.permissions ?? []}
      canManageAlerts={canManageAlerts}
      initialUsers={users}
      availableRoles={availableRoles}
      agentMembership={agentMembership}
    />
  );
}
