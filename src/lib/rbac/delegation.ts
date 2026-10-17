import { expandImpliedPermissions, isAssignablePermissionKey } from "@/lib/rbac/permissions";

/**
 * Delegation ceiling for Role Manager and Account Manager.
 *
 * Everything here is decided by permission ticks, never by role names: you may
 * only hand out — or touch an account holding — permissions you hold yourself.
 * The Admin role holds every permission, so this alone keeps Admin accounts
 * safe; there is no "if Admin" rule anywhere. Pure functions so they are unit
 * tested; routes load the permission lists and call these.
 */
export type DelegationResult =
  | { ok: true }
  | { ok: false; status: 400 | 403; error: string };

const OK: DelegationResult = { ok: true };

/** Keys the actor does not hold. Manage counts as holding the Work it includes. */
export function permissionsNotHeld(
  actorPermissions: readonly string[],
  keys: readonly string[]
): string[] {
  const held = new Set(expandImpliedPermissions(actorPermissions).filter(isAssignablePermissionKey));
  return [...new Set(expandImpliedPermissions(keys))].filter(
    (key) => isAssignablePermissionKey(key) && !held.has(key)
  );
}

/** Role Manager: you can only ADD permissions you hold. Removing is always allowed. */
export function checkRolePermissionChange(input: {
  actorPermissions: readonly string[];
  currentKeys: readonly string[];
  nextKeys: readonly string[];
}): DelegationResult {
  const current = new Set(expandImpliedPermissions(input.currentKeys));
  const added = input.nextKeys.filter((key) => !current.has(key));
  const notHeld = permissionsNotHeld(input.actorPermissions, added);
  return notHeld.length === 0
    ? OK
    : {
        ok: false,
        status: 403,
        error: `You cannot grant permissions you do not have: ${notHeld.join(", ")}`,
      };
}

/**
 * Account Manager: you may only touch an account whose permissions fit inside
 * your own, and only hand out a role that fits inside your own. Nobody changes
 * their own role.
 */
export function checkAccountChange(input: {
  actorPermissions: readonly string[];
  isSelf: boolean;
  targetPermissionKeys: readonly string[];
  /** Only when the role actually changes. */
  nextRolePermissionKeys?: readonly string[];
}): DelegationResult {
  if (
    !input.isSelf &&
    permissionsNotHeld(input.actorPermissions, input.targetPermissionKeys).length > 0
  ) {
    return { ok: false, status: 403, error: "This account has permissions you do not have." };
  }
  if (input.nextRolePermissionKeys) {
    if (input.isSelf) {
      return { ok: false, status: 400, error: "You cannot change your own role." };
    }
    const notHeld = permissionsNotHeld(input.actorPermissions, input.nextRolePermissionKeys);
    if (notHeld.length > 0) {
      return {
        ok: false,
        status: 403,
        error: `This role has permissions you do not have: ${notHeld.join(", ")}`,
      };
    }
  }
  return OK;
}

export function rolePatchGrant(input: {
  roleIsActive: boolean;
  nextIsActive: boolean | undefined;
  liveKeys: readonly string[];
  permissionKeys: readonly string[] | null;
}): { currentKeys: readonly string[]; nextKeys: readonly string[] } | null {
  const reactivating = input.nextIsActive === true && !input.roleIsActive;
  if (!input.permissionKeys && !reactivating) return null;
  return {
    currentKeys: reactivating ? [] : input.liveKeys,
    nextKeys: input.permissionKeys ?? input.liveKeys,
  };
}

export function checkMembershipChange(input: {
  actorPermissions: readonly string[];
  isSelf: boolean;
  targetPermissionKeys: readonly string[];
}): DelegationResult {
  if (input.isSelf) {
    return { ok: false, status: 400, error: "You cannot change your own Agent or Assistant membership." };
  }
  return checkAccountChange({
    actorPermissions: input.actorPermissions,
    isSelf: false,
    targetPermissionKeys: input.targetPermissionKeys,
  });
}
