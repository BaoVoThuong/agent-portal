import type { UserRole } from "@/lib/config";

export const SYSTEM_ROLE_NAMES = {
  SUPER_ADMIN: "Admin",
  AGENT: "Agent",
} as const;

export const LEGACY_SUPER_ADMIN_ROLE_NAME = "Super Admin";

export function getDefaultSystemRoleName(legacyRole: UserRole) {
  return legacyRole === "admin"
    ? SYSTEM_ROLE_NAMES.SUPER_ADMIN
    : SYSTEM_ROLE_NAMES.AGENT;
}

export function getLegacyRoleFromRoleNames(roleNames: readonly string[]): UserRole {
  return roleNames.includes(SYSTEM_ROLE_NAMES.SUPER_ADMIN) ||
    roleNames.includes(LEGACY_SUPER_ADMIN_ROLE_NAME)
    ? "admin"
    : "agent";
}
