import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import {
  isAssignablePermissionKey,
  normalizeExclusivePermissionKeys,
  PERMISSIONS,
} from "@/lib/rbac/permissions";
import {
  fetchRolesWithPermissions,
} from "@/lib/rbac/role-management";
import { isAdminRoleName } from "@/lib/rbac/admin-role";
import { checkRolePermissionChange } from "@/lib/rbac/delegation";

type RolePayload = {
  name?: unknown;
  description?: unknown;
  is_active?: unknown;
  permissionKeys?: unknown;
};

function normalizePayload(payload: RolePayload) {
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const description =
    typeof payload.description === "string" && payload.description.trim()
      ? payload.description.trim()
      : null;
  const isActive =
    typeof payload.is_active === "boolean" ? payload.is_active : true;
  const permissionKeys = normalizeExclusivePermissionKeys(
    Array.isArray(payload.permissionKeys)
      ? payload.permissionKeys.filter(
          (permission): permission is string => typeof permission === "string"
        )
      : []
  ).filter(isAssignablePermissionKey);

  return { name, description, isActive, permissionKeys };
}

export async function GET() {
  const session = await auth();

  if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const roles = await fetchRolesWithPermissions();
    return NextResponse.json({ roles });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to load roles." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const session = await auth();

  if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = normalizePayload((await req.json()) as RolePayload);

    if (!payload.name) {
      return NextResponse.json(
        { error: "Role name is required." },
        { status: 400 }
      );
    }

    if (isAdminRoleName(payload.name)) {
      return NextResponse.json(
        { error: "Admin is a reserved role name." },
        { status: 400 }
      );
    }

    const delegation = checkRolePermissionChange({
      actorPermissions: session?.user?.permissions ?? [],
      currentKeys: [],
      nextKeys: payload.permissionKeys,
    });
    if (!delegation.ok) {
      return NextResponse.json({ error: delegation.error }, { status: delegation.status });
    }

    const { data: roleId, error } = await getSupabaseAdmin().rpc("create_role_atomic", {
      p_name: payload.name,
      p_description: payload.description,
      p_is_active: payload.isActive,
      p_permission_keys: payload.permissionKeys,
    });

    if (error) {
      const duplicate = error.code === "23505";
      return NextResponse.json(
        { error: duplicate ? "A role with this name already exists." : error.message },
        { status: duplicate ? 409 : 500 }
      );
    }

    const roles = await fetchRolesWithPermissions();
    return NextResponse.json(
      { role: roles.find((item) => item.id === roleId), roles },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to create role." },
      { status: 500 }
    );
  }
}
