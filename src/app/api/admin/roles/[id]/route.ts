import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  countUsersForRole,
  fetchRoleById,
  fetchRolesWithPermissions,
  replaceRolePermissions,
} from "@/lib/rbac/role-management";

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
  return value.filter((item): item is string => typeof item === "string");
}

export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();

  try {
    const { id } = await context.params;
    const payload = (await req.json()) as RolePatchPayload;
    const permissionKeys = parsePermissionKeys(payload.permissionKeys);
    const updates: {
      name?: string;
      description?: string | null;
      is_active?: boolean;
      updated_at: string;
    } = {
      updated_at: new Date().toISOString(),
    };

    if (payload.name !== undefined) {
      if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
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
      if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      updates.description =
        typeof payload.description === "string" && payload.description.trim()
          ? payload.description.trim()
          : null;
    }

    if (payload.is_active !== undefined) {
      if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (typeof payload.is_active !== "boolean") {
        return NextResponse.json(
          { error: "Invalid role status." },
          { status: 400 }
        );
      }
      updates.is_active = payload.is_active;
    }

    if (
      permissionKeys &&
      !can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = await fetchRoleById(id);
    if (
      role.is_system &&
      (Object.keys(updates).length > 1 || permissionKeys !== null)
    ) {
      return NextResponse.json(
        { error: "System roles cannot be edited." },
        { status: 400 }
      );
    }

    if (Object.keys(updates).length > 1) {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.from("roles").update(updates).eq("id", id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    if (permissionKeys) {
      await replaceRolePermissions(id, permissionKeys);
    }

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

export async function DELETE(_req: Request, context: RouteContext) {
  const session = await auth();

  if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const role = await fetchRoleById(id);

    if (role.is_system) {
      return NextResponse.json(
        { error: "System roles cannot be deleted." },
        { status: 400 }
      );
    }

    const userCount = await countUsersForRole(id);
    if (userCount > 0) {
      return NextResponse.json(
        { error: "Remove users from this role before deleting it." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("roles").delete().eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, roles: await fetchRolesWithPermissions() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to delete role." },
      { status: 500 }
    );
  }
}
