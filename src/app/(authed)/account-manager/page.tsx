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
import { fetchSelectedAgentEmails } from "@/lib/tasks/assignees";
import { buildTaskActor } from "@/lib/tasks/access";
import { fetchPositionOptions, type PositionOption } from "@/lib/admin/positions";
import type { AccountConfig, TaskAccess } from "@/lib/admin/account-config";

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
  /** Position assigned in Account Manager; describes the job, grants nothing. */
  position: PositionOption | null;
  managerName: string | null;
  managerEmail: string | null;
  config: AccountConfig;
  assistantEmails: string[];
  /** From the account's role; display only (Edit account warnings). */
  taskAccess: TaskAccess;
  /**
   * Would be in the CS auto-assign pool if not an Agent or Assistant: same
   * test as assign_unassigned_task (active, Task role other than Admin, queue
   * switch not off). Display only.
   */
  csPoolBase: boolean;
};

// Task's own reading of the keys (task.manage includes task.work), so this
// page never names another module's permissions. Display only.
function taskAccessOf(permissionKeys: readonly string[]): TaskAccess {
  const actor = buildTaskActor(permissionKeys, "");
  if (actor.isManager) return "manage";
  if (actor.isWorker) return "work";
  return "none";
}

type AccountRow = AccountUser & {
  position_id: string | null;
  manager_id: string | null;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The Agent list and Assistant links behind Edit account. They still decide
 * access; Edit account writes them through update_account_atomic.
 */
async function loadMembership(supabase: ReturnType<typeof getSupabaseAdmin>) {
  const [roster, links] = await Promise.all([
    fetchSelectedAgentEmails(),
    supabase.from("agent_members").select("agent_email,cs_email").eq("is_assistant", true),
  ]);
  if (links.error) throw new Error(links.error.message);
  const agentsByAssistant = new Map<string, string[]>();
  const assistantsByAgent = new Map<string, string[]>();
  for (const row of (links.data ?? []) as Array<{ agent_email: string; cs_email: string }>) {
    const agent = normalizeEmail(row.agent_email);
    const assistant = normalizeEmail(row.cs_email);
    agentsByAssistant.set(assistant, [...(agentsByAssistant.get(assistant) ?? []), agent]);
    assistantsByAgent.set(agent, [...(assistantsByAgent.get(agent) ?? []), assistant]);
  }
  return {
    roster: new Set([...roster].map(normalizeEmail)),
    agentsByAssistant,
    assistantsByAgent,
  };
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
    membership,
    positions,
    queueResponse,
  ] = await Promise.all([
    supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .select("id,email,name,agent_id,is_active,created_at,position_id,manager_id")
      .order("created_at", { ascending: false }),
    fetchRolesWithPermissions(),
    supabase.from("user_roles").select("user_id,role_id"),
    canManageAlerts
      ? supabase
          .from("notification_preferences")
          .select("email,sound_enabled,updated_by_email,updated_at")
      : Promise.resolve({ data: [], error: null }),
    loadMembership(supabase),
    fetchPositionOptions(),
    supabase.from("task_assignment_queue_members").select("email,is_enabled"),
  ]);
  if (queueResponse.error) throw new Error(queueResponse.error.message);
  const queueOffEmails = new Set(
    ((queueResponse.data ?? []) as Array<{ email: string; is_enabled: boolean }>)
      .filter((row) => !row.is_enabled)
      .map((row) => normalizeEmail(row.email)),
  );
  const taskAccessByRoleId = new Map(
    roles.map((role) => [role.id, role.is_active ? taskAccessOf(role.permissions.map((p) => p.key)) : ("none" as TaskAccess)]),
  );

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
  }));
  const rolesById = new Map(availableRoles.map((role) => [role.id, role]));
  const accounts = (data ?? []) as AccountRow[];
  const positionsById = new Map(positions.map((position) => [position.id, position]));
  const accountNameById = new Map(
    accounts.map((account) => [account.id, account.name?.trim() || account.email]),
  );
  const accountEmailById = new Map(accounts.map((account) => [account.id, account.email]));
  const roleIdsByUserId = new Map<string, string[]>();
  for (const row of (userRolesResponse.data ?? []) as unknown as UserRoleRow[]) {
    roleIdsByUserId.set(row.user_id, [
      ...(roleIdsByUserId.get(row.user_id) ?? []),
      row.role_id,
    ]);
  }

  const users = accounts.map<ManagedAccountUser>(
    ({ position_id, manager_id, ...user }) => {
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
      const roleId = roleIds[0];
      const taskAccess: TaskAccess =
        user.is_active && roleId ? taskAccessByRoleId.get(roleId) ?? "none" : "none";

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
        position: position_id ? positionsById.get(position_id) ?? null : null,
        managerName: manager_id ? accountNameById.get(manager_id) ?? null : null,
        managerEmail: manager_id ? accountEmailById.get(manager_id) ?? null : null,
        config: {
          positionId: position_id,
          managerId: manager_id,
          assistedAgentEmails: [
            ...new Set(membership.agentsByAssistant.get(normalizeEmail(user.email)) ?? []),
          ].sort(),
        },
        assistantEmails: [
          ...new Set(membership.assistantsByAgent.get(normalizeEmail(user.email)) ?? []),
        ].sort(),
        taskAccess,
        csPoolBase:
          taskAccess !== "none" &&
          !isAdminRoleName(roleId ? rolesById.get(roleId)?.name : null) &&
          !queueOffEmails.has(normalizeEmail(user.email)),
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
      positions={positions}
      taskAccessByRoleId={Object.fromEntries(taskAccessByRoleId)}
      agentOptions={accounts
        .filter((account) => account.is_active && membership.roster.has(normalizeEmail(account.email)))
        .map((account) => ({
          email: normalizeEmail(account.email),
          name: account.name?.trim() || account.email,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))}
    />
  );
}
