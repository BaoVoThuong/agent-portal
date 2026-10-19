import { NextResponse } from "next/server";
import { auth, invalidateRbacLookups } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import {
  isAssignablePermissionKey,
  normalizeExclusivePermissionKeys,
  PERMISSIONS,
} from "@/lib/rbac/permissions";
import {
  countUsersForRole,
  fetchActiveRolesByIds,
  fetchRoleById,
  fetchRolePermissionKeys,
  fetchRolesWithPermissions,
} from "@/lib/rbac/role-management";
import { isAdminRoleName } from "@/lib/rbac/admin-role";
import { checkRolePermissionChange, permissionsNotHeld, rolePatchGrant } from "@/lib/rbac/delegation";
import { checkRoleDeletion } from "@/lib/rbac/role-deletion";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type RolePatchPayload = {
  name?: unknown;
  description?: unknown;
  is_active?: unknown;
  permissionKeys?: unknown;
};

function parsePermissionKeys(value: unknown) {
  if (!Array.isArray(value)) return null;
  return normalizeExclusivePermissionKeys(
    value.filter((item): item is string => typeof item === "string")
  ).filter(isAssignablePermissionKey);
}

// The Admin role is fixed and view-only: every permission, changed only by SQL
// rollouts. See lib/rbac/admin-role.ts.
function isProtectedRole(role: { name: string }) {
  return isAdminRoleName(role.name);
}

export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();

  if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const payload = (await req.json()) as RolePatchPayload;
    const permissionKeys = parsePermissionKeys(payload.permissionKeys);
    const updates: {
      name?: string;
      description?: string | null;
      is_active?: boolean;
    } = {};

    if (payload.name !== undefined) {
      const nextName = typeof payload.name === "string" ? payload.name.trim() : "";
      if (!nextName) {
        return NextResponse.json(
          { error: "Role name is required." },
          { status: 400 }
        );
      }
      updates.name = nextName;
    }

    if (payload.description !== undefined) {
      updates.description =
        typeof payload.description === "string" && payload.description.trim()
          ? payload.description.trim()
          : null;
    }

    if (payload.is_active !== undefined) {
      if (typeof payload.is_active !== "boolean") {
        return NextResponse.json(
          { error: "Invalid role status." },
          { status: 400 }
        );
      }
      updates.is_active = payload.is_active;
    }

    if (Object.keys(updates).length === 0 && permissionKeys === null) {
      return NextResponse.json({ error: "No role changes provided." }, { status: 400 });
    }

    const role = await fetchRoleById(id);
    if (isProtectedRole(role)) {
      return NextResponse.json(
        { error: "Admin cannot be edited." },
        { status: 400 }
      );
    }

    if (updates.name !== undefined && isAdminRoleName(updates.name)) {
      return NextResponse.json(
        { error: "Admin is a reserved role name." },
        { status: 400 }
      );
    }

    if (permissionKeys || (updates.is_active === true && !role.is_active)) {
      const grant = rolePatchGrant({
        roleIsActive: role.is_active,
        nextIsActive: updates.is_active,
        liveKeys: await fetchRolePermissionKeys(id),
        permissionKeys,
      });
      if (!grant) throw new Error("Missing permission grant check");
      const delegation = checkRolePermissionChange({
        actorPermissions: session?.user?.permissions ?? [],
        ...grant,
      });
      if (!delegation.ok) {
        return NextResponse.json({ error: delegation.error }, { status: delegation.status });
      }
    }

    const { error } = await getSupabaseAdmin().rpc("update_role_atomic", {
      p_role_id: id,
      p_patch: updates,
      p_permission_keys: permissionKeys,
    });
    if (error) {
      const duplicate = error.code === "23505";
      return NextResponse.json(
        { error: duplicate ? "A role with this name already exists." : error.message },
        { status: duplicate ? 409 : 500 }
      );
    }

    invalidateRbacLookups();
    const roles = await fetchRolesWithPermissions();
    return NextResponse.json({
      role: roles.find((item) => item.id === id),
      roles,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to update role." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, context: RouteContext) {
  const session = await auth();

  if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const role = await fetchRoleById(id);

    if (isProtectedRole(role)) {
      return NextResponse.json(
        { error: "Admin cannot be deleted." },
        { status: 400 }
      );
    }

    // Optional body { moveToRoleId }: where every account holding this role
    // goes first. A DELETE without a body is still valid for an empty role.
    const body = (await req.json().catch(() => null)) as { moveToRoleId?: unknown } | null;
    const requestedTarget =
      typeof body?.moveToRoleId === "string" && body.moveToRoleId.trim()
        ? body.moveToRoleId.trim()
        : null;

    const [holderCount, activeTargets] = await Promise.all([
      countUsersForRole(id),
      requestedTarget ? fetchActiveRolesByIds([requestedTarget]) : Promise.resolve([]),
    ]);
    const deletion = checkRoleDeletion({
      roleId: id,
      holderCount,
      moveToRoleId: requestedTarget,
      moveToRoleIsActive: activeTargets.length === 1,
    });
    if (!deletion.ok) {
      return NextResponse.json(
        { error: deletion.error, holderCount: deletion.holderCount },
        { status: deletion.status }
      );
    }

    let moved = 0;
    if (deletion.moveToRoleId) {
      const [sourceKeys, targetKeys] = await Promise.all([
        fetchRolePermissionKeys(id),
        fetchRolePermissionKeys(deletion.moveToRoleId),
      ]);
      const notHeld = permissionsNotHeld(session?.user?.permissions ?? [], [
        ...sourceKeys,
        ...targetKeys,
      ]);
      if (notHeld.length > 0) {
        return NextResponse.json(
          { error: `This role has permissions you do not have: ${notHeld.join(", ")}` },
          { status: 403 },
        );
      }
    }
    // The RPC rechecks current actor/target permissions and moves holders and
    // deletes the role in one transaction. The checks above provide useful UI
    // errors; they are not the authorization boundary.
    const { data, error } = await getSupabaseAdmin().rpc("delete_role_atomic", {
      p_role_id: id,
      p_move_to_role_id: deletion.moveToRoleId,
      p_actor_email: session?.user?.email ?? "",
    });
    if (error) {
      const forbidden = error.message.includes("ROLE_MOVE_FORBIDDEN") ||
        error.message.includes("ROLE_MANAGER_REQUIRED");
      const invalid = error.message.includes("ROLE_MOVE_TARGET_INVALID") ||
        error.message.includes("ROLE_STILL_HELD") ||
        error.message.includes("ROLE_PROTECTED");
      return NextResponse.json(
        { error: error.message },
        { status: forbidden ? 403 : invalid ? 409 : 500 },
      );
    }
    moved = Number(data ?? 0);
    invalidateRbacLookups();
    console.info("[role-manager:delete] deleted role", {
      actor: session?.user?.email ?? null,
      roleId: id,
      moveToRoleId: deletion.moveToRoleId,
      moved,
    });
    try {
      return NextResponse.json({ ok: true, moved, roles: await fetchRolesWithPermissions() });
    } catch (refreshError) {
      // The transaction already committed. Report success so the client does
      // not retry a delete that happened; it can refresh the directory later.
      console.warn("[role-manager:delete] role list refresh failed", {
        message: refreshError instanceof Error ? refreshError.message : "unknown",
      });
      return NextResponse.json({ ok: true, moved });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to delete role." },
      { status: 500 }
    );
  }
}
