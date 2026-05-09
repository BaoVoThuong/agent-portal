import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE, type UserRole } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { assignDefaultRoleToUser } from "@/lib/rbac/access";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fetchActiveRolesByIds,
  replaceUserRoles,
} from "@/lib/rbac/role-management";
import { getLegacyRoleFromRoleNames } from "@/lib/rbac/system-roles";
import bcrypt from "bcryptjs";

const roles: UserRole[] = ["admin", "agent"];

export async function POST(req: Request) {
  let createdUserId: string | null = null;

  try {
    const session = await auth();

    if (
      !can(session?.user?.permissions, PERMISSIONS.ACCOUNT_MANAGER)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { email, password, name, role, roleIds } = await req.json();
    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const selectedRole = roles.includes(role) ? role : "agent";
    const selectedRoleIds = Array.isArray(roleIds)
      ? roleIds.filter((item): item is string => typeof item === "string")
      : [];

    console.info("[account-manager:create] request", {
      actor: session?.user?.email ?? null,
      email: normalizedEmail,
      roleIds: selectedRoleIds,
    });

    if (!normalizedEmail || typeof password !== "string") {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data: existingUser } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    const selectedRoles = selectedRoleIds.length
      ? await fetchActiveRolesByIds(selectedRoleIds)
      : [];

    if (selectedRoleIds.length > 0 && selectedRoles.length === 0) {
      return NextResponse.json(
        { error: "Select at least one active role." },
        { status: 400 }
      );
    }

    if (selectedRoles.length !== new Set(selectedRoleIds).size) {
      return NextResponse.json(
        { error: "One or more selected roles are invalid or disabled." },
        { status: 400 }
      );
    }

    const selectedRoleNames = selectedRoles.map((item) => item.name);
    const legacyRole: UserRole =
      selectedRoleIds.length > 0
        ? getLegacyRoleFromRoleNames(selectedRoleNames)
        : selectedRole;

    const hashedPassword = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .insert([
        {
          email: normalizedEmail,
          name: typeof name === "string" && name.trim() ? name.trim() : null,
          password_hash: hashedPassword,
          role: legacyRole,
          is_active: true,
        },
      ])
      .select("id,email,name,role,is_active,created_at")
      .single();

    if (error) {
      console.error("[account-manager:create] insert failed", {
        email: normalizedEmail,
        error: error.message,
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (data?.id) {
      createdUserId = data.id;
      if (selectedRoleIds.length > 0) {
        await replaceUserRoles(data.id, selectedRoleIds);
      } else {
        await assignDefaultRoleToUser(data.id, selectedRole);
      }
    }

    console.info("[account-manager:create] success", {
      email: normalizedEmail,
      userId: data.id,
      roleIds: selectedRoleIds,
      legacyRole,
    });

    return NextResponse.json({ user: data }, { status: 201 });
  } catch (error) {
    console.error("[account-manager:create] failed", {
      createdUserId,
      error: error instanceof Error ? error.message : String(error),
    });

    if (createdUserId) {
      const supabase = getSupabaseAdmin();
      await supabase.from(PORTAL_ACCOUNT_TABLE).delete().eq("id", createdUserId);
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
