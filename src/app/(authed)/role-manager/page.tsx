import { requirePageGrant } from "@/lib/authz/page-guards";
import { fetchRolesWithPermissions } from "@/lib/rbac/role-management";
import RoleManagerClient from "./RoleManagerClient";

export const dynamic = "force-dynamic";

export default async function RoleManagerPage() {
  const principal = await requirePageGrant("role.manage");
  const roles = await fetchRolesWithPermissions();

  return (
    <RoleManagerClient
      initialRoles={roles}
      currentUserGrants={principal.grants}
      currentUserRoleIds={principal.roleIds}
    />
  );
}
