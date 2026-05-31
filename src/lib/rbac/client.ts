export function can(
  permissions: readonly string[] | undefined,
  permission: string
) {
  if (!permissions) return false;
  return permissions.includes(permission);
}

export function canAny(
  permissions: readonly string[] | undefined,
  required: readonly string[]
) {
  return required.some((permission) => can(permissions, permission));
}
