import { PERMISSIONS } from "@/lib/rbac/permissions";
import { can } from "@/lib/rbac/client";

export function canActorExport(
  permissions: readonly string[] | undefined
): boolean {
  return can(permissions, PERMISSIONS.TASK_EXPORT);
}
