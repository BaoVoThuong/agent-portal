import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import {
  fetchPermissions,
  fetchRolesWithPermissions,
} from "@/lib/rbac/role-management";
import { fetchPositionsWithHolders } from "@/lib/admin/positions";
import RoleManagerClient from "./RoleManagerClient";

export const dynamic = "force-dynamic";

export default async function RoleManagerPage() {
  const session = await requirePermission(PERMISSIONS.ROLE_MANAGER);
  const [roles, permissions, positions] = await Promise.all([
    fetchRolesWithPermissions(),
    fetchPermissions(),
    fetchPositionsWithHolders(),
  ]);

  return (
    <RoleManagerClient
      initialRoles={roles}
      permissions={permissions}
      currentUserPermissions={session.user.permissions ?? []}
      initialPositions={positions}
    />
  );
}
