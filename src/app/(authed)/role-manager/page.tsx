import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import {
  fetchPermissions,
  fetchRolesWithPermissions,
} from "@/lib/rbac/role-management";
import { fetchPositionsWithHolders } from "@/lib/admin/positions";
import { getSupabaseAdmin } from "@/lib/supabase";
import RoleManagerClient from "./RoleManagerClient";

export const dynamic = "force-dynamic";

export default async function RoleManagerPage() {
  const session = await requirePermission(PERMISSIONS.ROLE_MANAGER);
  const [roles, permissions, positions, peopleResponse] = await Promise.all([
    fetchRolesWithPermissions(),
    fetchPermissions(),
    fetchPositionsWithHolders(),
    getSupabaseAdmin().from("portal_account").select("id,name,email"),
  ]);
  if (peopleResponse.error) throw new Error(peopleResponse.error.message);

  return (
    <RoleManagerClient
      initialRoles={roles}
      permissions={permissions}
      currentUserPermissions={session.user.permissions ?? []}
      initialPositions={positions}
      initialPeople={peopleResponse.data ?? []}
    />
  );
}
