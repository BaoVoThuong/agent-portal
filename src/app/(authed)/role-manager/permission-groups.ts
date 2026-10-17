import { permissionImpliedBy } from "@/lib/rbac/permissions";
import type { PermissionRecord } from "@/lib/rbac/role-management";

export type PermissionGroup = {
  key: string;
  label: string;
  items: PermissionRecord[];
};

export function groupPermissions(permissions: PermissionRecord[]) {
  return permissions.reduce<PermissionGroup[]>((groups, permission) => {
    const existing = groups.find((group) => group.key === permission.group_key);
    if (existing) {
      existing.items.push(permission);
      return groups;
    }

    groups.push({
      key: permission.group_key,
      label: permission.group_label,
      items: [permission],
    });
    return groups;
  }, []);
}

// Manage includes Work: a Work box under a ticked Manage shows as ticked and
// locked, and is never saved on its own (normalizeExclusivePermissionKeys).
export function includedBy(permissionKey: string, selectedKeys: readonly string[]) {
  const manageKey = permissionImpliedBy(permissionKey);
  return manageKey && selectedKeys.includes(manageKey) ? manageKey : null;
}

export function isPermissionSelected(permissionKey: string, selectedKeys: readonly string[]) {
  return selectedKeys.includes(permissionKey) || includedBy(permissionKey, selectedKeys) !== null;
}
