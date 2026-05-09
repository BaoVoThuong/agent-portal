import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fetchRolesWithPermissions,
  replaceRolePermissions,
} from "@/lib/rbac/role-management";

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
  const permissionKeys = Array.isArray(payload.permissionKeys)
    ? payload.permissionKeys.filter(
        (permission): permission is string => typeof permission === "string"
      )
    : [];

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

    if (
      payload.permissionKeys.length > 0 &&
      !can(
        session?.user?.permissions,
        PERMISSIONS.ROLE_MANAGER
      )
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("roles")
      .insert([
        {
          name: payload.name,
          description: payload.description,
          is_active: payload.isActive,
          is_system: false,
        },
      ])
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const role = data as unknown as { id: string };
    await replaceRolePermissions(role.id, payload.permissionKeys);

    const roles = await fetchRolesWithPermissions();
    return NextResponse.json(
      { role: roles.find((item) => item.id === role.id), roles },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to create role." },
      { status: 500 }
    );
  }
}
