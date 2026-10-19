import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/** Mirror Time Off reads: Admin sees any request; a User sees their own. */
export function canViewTimeOffNotification(
  permissions: readonly string[],
  viewerAccountId: string | null,
  requesterId: string,
): boolean {
  return can(permissions, PERMISSIONS.TIME_OFF_ADMIN) ||
    (can(permissions, PERMISSIONS.TIME_OFF_USER) && viewerAccountId === requesterId);
}
