import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import type { AccountUser } from "@/lib/domain/account.types";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fetchRolesWithPermissions,
  type RoleOption,
} from "@/lib/rbac/role-management";
import { requirePermission } from "@/lib/rbac/server";
import {
  getDefaultSystemRoleName,
  SYSTEM_ROLE_NAMES,
} from "@/lib/rbac/system-roles";
import AccountManagerClient from "./AccountManagerClient";

export const dynamic = "force-dynamic";

type UserRoleRow = {
  user_id: string;
  role_id: string;
};

export type ManagedAccountUser = AccountUser & {
  role_ids: string[];
  roles: RoleOption[];
};

export default async function AccountManagerPage() {
  const session = await requirePermission(PERMISSIONS.ACCOUNT_MANAGER);

  if (!session.user.email) {
    redirect("/");
  }

  const supabase = getSupabaseAdmin();
  const [{ data, error }, roles, userRolesResponse] = await Promise.all([
    supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .select("id,email,name,agent_id,role,is_active,created_at")
      .order("created_at", { ascending: false }),
    fetchRolesWithPermissions(),
    supabase.from("user_roles").select("user_id,role_id"),
  ]);

  if (error) {
    throw new Error(error.message);
  }

  if (userRolesResponse.error) {
    throw new Error(userRolesResponse.error.message);
  }

  const availableRoles: RoleOption[] = roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    is_system: role.is_system,
    is_active: role.is_active,
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

          if (firstRole?.name === SYSTEM_ROLE_NAMES.SUPER_ADMIN) return -1;
          if (secondRole?.name === SYSTEM_ROLE_NAMES.SUPER_ADMIN) return 1;

          return (firstRole?.name ?? "").localeCompare(secondRole?.name ?? "");
        })
        .slice(0, 1);
      const fallbackRole = availableRoles.find((role) =>
        role.name === getDefaultSystemRoleName(user.role)
      );
      const roleIds =
        directRoleIds.length > 0
          ? directRoleIds
          : fallbackRole
            ? [fallbackRole.id]
            : [];

      return {
        ...user,
        role_ids: roleIds,
        roles: roleIds
          .map((roleId) => rolesById.get(roleId))
          .filter((role): role is RoleOption => Boolean(role)),
      };
    }
  );

  return (
    <AccountManagerClient
      currentUserEmail={session.user.email ?? ""}
      currentUserPermissions={session.user.permissions ?? []}
      initialUsers={users}
      availableRoles={availableRoles}
    />
  );
}
