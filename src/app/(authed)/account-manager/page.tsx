import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import type { AccountUser } from "@/lib/domain/account.types";
import { grantsBeyondCeiling } from "@/lib/authz/delegation";
import { requirePageGrant } from "@/lib/authz/page-guards";
import {
  fetchRolesWithPermissions,
  type RoleOption,
} from "@/lib/rbac/role-management";
import AccountManagerClient from "./AccountManagerClient";

export const dynamic = "force-dynamic";

type UserRoleRow = {
  user_id: string;
  role_id: string;
};

export type AssignableRoleOption = RoleOption & {
  /** Nằm trong trần uỷ quyền của người đang dùng (S4). */
  assignable: boolean;
};

export type ManagedAccountUser = AccountUser & {
  role_ids: string[];
  roles: AssignableRoleOption[];
};

export default async function AccountManagerPage() {
  const principal = await requirePageGrant("account.manage");
  if (!principal.email) {
    redirect("/");
  }

  const supabase = getSupabaseAdmin();
  const [{ data, error }, roles, userRolesResponse, commissionResponse] = await Promise.all([
    supabase
    .from(PORTAL_ACCOUNT_TABLE)
    .select("id,email,name,agent_id,role,is_active,created_at")
      .order("created_at", { ascending: false }),
    fetchRolesWithPermissions(),
    supabase.from("user_roles").select("user_id,role_id"),
    supabase.from("agent_commission_names").select("account_id,agent_name"),
  ]);
  // Bảng chưa có (rollout Phase D chưa chạy) thì ẩn ô tên hoa hồng.
  const commissionNamesAvailable = !commissionResponse.error;
  const commissionNameById = new Map(
    ((commissionResponse.data ?? []) as { account_id: string; agent_name: string }[]).map(
      (row) => [row.account_id, row.agent_name]
    )
  );

  if (error) {
    throw new Error(error.message);
  }

  if (userRolesResponse.error) {
    throw new Error(userRolesResponse.error.message);
  }

  const availableRoles: AssignableRoleOption[] = roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    is_system: role.is_system,
    is_active: role.is_active,
    system_key: role.system_key ?? null,
    assignable: grantsBeyondCeiling(principal.grants, role.grants).length === 0,
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
      // Một account một role (unique index user_roles_one_role_per_user_idx).
      // Không có role thì hiện là không có role — không đoán theo cột legacy.
      const roleIds = [...(roleIdsByUserId.get(user.id) ?? [])].slice(0, 1);

      return {
        ...user,
        commission_name: commissionNameById.get(user.id) ?? null,
        role_ids: roleIds,
        roles: roleIds
          .map((roleId) => rolesById.get(roleId))
          .filter((role): role is AssignableRoleOption => Boolean(role)),
      };
    }
  );

  return (
    <AccountManagerClient
      currentUserEmail={principal.email}
      currentUserGrants={principal.grants}
      initialUsers={users}
      availableRoles={availableRoles}
      commissionNamesAvailable={commissionNamesAvailable}
    />
  );
}
