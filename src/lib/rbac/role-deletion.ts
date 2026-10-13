export type RoleDeletionCheck =
  | { ok: true; moveToRoleId: string | null }
  | { ok: false; status: 400 | 409; error: string; holderCount?: number };

/**
 * A role can be deleted only when nobody holds it, or when every account
 * holding it — disabled ones included — is moved to another active role in the
 * same request. Deleting it outright would cascade through user_roles and
 * leave those accounts with no role at all, without anyone being told.
 *
 * Pure so it is unit tested; the route loads the counts and calls this.
 */
export function checkRoleDeletion(input: {
  roleId: string;
  /** Every account holding the role, disabled ones included. */
  holderCount: number;
  /** Where to move the holders, from the request body. */
  moveToRoleId: string | null;
  /** The target role exists and is active. */
  moveToRoleIsActive: boolean;
}): RoleDeletionCheck {
  if (input.holderCount === 0) return { ok: true, moveToRoleId: null };

  if (!input.moveToRoleId) {
    return {
      ok: false,
      status: 409,
      holderCount: input.holderCount,
      error: `This role is still assigned to ${input.holderCount} account(s). Move them to another role first.`,
    };
  }

  if (input.moveToRoleId === input.roleId || !input.moveToRoleIsActive) {
    return {
      ok: false,
      status: 400,
      error: "Choose another active role to move these accounts to.",
    };
  }

  return { ok: true, moveToRoleId: input.moveToRoleId };
}
