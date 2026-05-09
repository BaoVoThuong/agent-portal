export function can(
  permissions: readonly string[] | undefined,
  permission: string
) {
  if (!permissions) return false;
  if (permissions.includes(permission)) return true;
  if (permission.endsWith(".own")) {
    return permissions.includes(permission.replace(/\.own$/, ".all"));
  }
  return false;
}

export function canAny(
  permissions: readonly string[] | undefined,
  required: readonly string[]
) {
  return required.some((permission) => can(permissions, permission));
}
