import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE, type UserRole } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { assignDefaultRoleToUser } from "@/lib/rbac/access";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  hasActiveSuperAdminOtherThan,
  fetchActiveRolesByIds,
  replaceUserRoles,
} from "@/lib/rbac/role-management";
import {
  LEGACY_SUPER_ADMIN_ROLE_NAME,
  getLegacyRoleFromRoleNames,
  SYSTEM_ROLE_NAMES,
} from "@/lib/rbac/system-roles";
import bcrypt from "bcryptjs";

const roles: UserRole[] = ["admin", "agent"];

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const { email, name, role, roleIds, is_active, password } = await req.json();
    const selectedRoleIds = Array.isArray(roleIds)
      ? roleIds.filter((item): item is string => typeof item === "string")
      : null;

    if (
      (email !== undefined ||
        name !== undefined ||
        role !== undefined ||
        roleIds !== undefined ||
        is_active !== undefined ||
        password !== undefined) &&
      !can(session.user.permissions, PERMISSIONS.ACCOUNT_MANAGER)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();

    const { data: targetUser, error: targetError } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .select("id,email,role,is_active")
      .eq("id", id)
      .single();

    if (targetError || !targetUser) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const isSelf =
      targetUser.email.toLowerCase() === session.user.email.toLowerCase();
    const { data: targetUserRoles, error: targetRolesError } = await supabase
      .from("user_roles")
      .select("roles(name)")
      .eq("user_id", id);

    if (targetRolesError) {
      return NextResponse.json({ error: targetRolesError.message }, { status: 500 });
    }

    const targetHasSuperAdmin =
      targetUser.role === "admin" ||
      ((targetUserRoles ?? []) as unknown as Array<{ roles: { name: string } | null }>).some(
        (row) =>
          row.roles?.name === SYSTEM_ROLE_NAMES.SUPER_ADMIN ||
          row.roles?.name === LEGACY_SUPER_ADMIN_ROLE_NAME
      );
    const updates: {
      email?: string;
      name?: string | null;
      role?: UserRole;
      is_active?: boolean;
      password_hash?: string;
    } = {};

    if (email !== undefined) {
      const normalizedEmail =
        typeof email === "string" ? email.trim().toLowerCase() : "";

      if (!normalizedEmail) {
        return NextResponse.json(
          { error: "Email is required." },
          { status: 400 }
        );
      }

      if (normalizedEmail !== targetUser.email.toLowerCase()) {
        const { data: existingUser, error: existingUserError } = await supabase
          .from(PORTAL_ACCOUNT_TABLE)
          .select("id")
          .eq("email", normalizedEmail)
          .maybeSingle();

        if (existingUserError) {
          return NextResponse.json(
            { error: existingUserError.message },
            { status: 500 }
          );
        }

        if (existingUser) {
          return NextResponse.json(
            { error: "An account with this email already exists." },
            { status: 409 }
          );
        }
      }

      updates.email = normalizedEmail;
    }

    if (name !== undefined) {
      updates.name =
        typeof name === "string" && name.trim() ? name.trim() : null;
    }

    if (role !== undefined) {
      if (!roles.includes(role)) {
        return NextResponse.json({ error: "Invalid role." }, { status: 400 });
      }

      if (isSelf && role !== "admin") {
        return NextResponse.json(
          { error: "You cannot remove your own admin role." },
          { status: 400 }
        );
      }

      updates.role = role;
    }

    if (roleIds !== undefined) {
      if (!selectedRoleIds || selectedRoleIds.length !== 1) {
        return NextResponse.json(
          { error: "Select exactly one active role." },
          { status: 400 }
        );
      }

      const selectedRoles = await fetchActiveRolesByIds(selectedRoleIds);
      if (selectedRoles.length !== selectedRoleIds.length) {
        return NextResponse.json(
          { error: "One or more selected roles are invalid or disabled." },
          { status: 400 }
        );
      }

      const nextLegacyRole = getLegacyRoleFromRoleNames(
        selectedRoles.map((item) => item.name)
      );

      if (isSelf && nextLegacyRole !== "admin") {
        return NextResponse.json(
          { error: "You cannot remove your own admin role." },
          { status: 400 }
        );
      }

      updates.role = nextLegacyRole;
    }

    if (is_active !== undefined) {
      if (typeof is_active !== "boolean") {
        return NextResponse.json(
          { error: "Invalid account status." },
          { status: 400 }
        );
      }

      if (isSelf && !is_active) {
        return NextResponse.json(
          { error: "You cannot deactivate your own account." },
          { status: 400 }
        );
      }

      updates.is_active = is_active;
    }

    const willRemoveSuperAdmin =
      targetHasSuperAdmin &&
      ((updates.role !== undefined && updates.role !== "admin") ||
        updates.is_active === false);

    if (
      willRemoveSuperAdmin &&
      !(await hasActiveSuperAdminOtherThan(id))
    ) {
      return NextResponse.json(
        { error: "At least one active Admin account is required." },
        { status: 400 }
      );
    }

    if (password !== undefined) {
      if (typeof password !== "string" || password.length < 8) {
        return NextResponse.json(
          { error: "Password must be at least 8 characters." },
          { status: 400 }
        );
      }

      updates.password_hash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No account changes provided." },
        { status: 400 }
      );
    }

    if (selectedRoleIds) {
      await replaceUserRoles(id, selectedRoleIds);
    }

    const { data, error } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .update(updates)
      .eq("id", id)
      .select("id,email,name,role,is_active,created_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!selectedRoleIds && updates.role) {
      await supabase.from("user_roles").delete().eq("user_id", id);
      await assignDefaultRoleToUser(id, updates.role);
    }

    return NextResponse.json({ user: data });
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
