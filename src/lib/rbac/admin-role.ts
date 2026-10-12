/**
 * The one role the code knows by name. The name is used ONLY to identify that
 * role for four things: it is locked (view-only in Role Manager), it shows
 * the "Admin" label, at least one active account must hold it, and its
 * holders stay out of the CS assignment pool.
 *
 * It NEVER decides what anyone may do — permissions (role_permissions ticks)
 * do that. The Admin role simply holds every permission; each rollout that
 * adds a permission grants it to Admin as well.
 */
export const ADMIN_ROLE_NAME = "Admin";

/** Reserved-name check: trimmed and case-insensitive, so "admin " is Admin too. */
export function isAdminRoleName(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === ADMIN_ROLE_NAME.toLowerCase();
}
