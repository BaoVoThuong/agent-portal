import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fetchActiveRolesByIds,
  fetchRolePermissionKeys,
  replaceUserRoles,
} from "@/lib/rbac/role-management";
import { checkAccountChange } from "@/lib/rbac/delegation";
import { parseCreateUserInput } from "@/lib/admin/user-input";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  let createdUserId: string | null = null;

  try {
    const session = await auth();

    if (
      !can(session?.user?.permissions, PERMISSIONS.ACCOUNT_MANAGER)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = parseCreateUserInput(await req.json());
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const {
      email: normalizedEmail,
      password,
      name,
      agentId: normalizedAgentId,
      roleIds: selectedRoleIds,
    } = parsed.value;

    console.info("[account-manager:create] request", {
      actor: session?.user?.email ?? null,
      email: normalizedEmail,
      roleIds: selectedRoleIds,
    });

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

    if (normalizedAgentId) {
      const { data: existingAgentId } = await supabase
        .from(PORTAL_ACCOUNT_TABLE)
        .select("id")
        .eq("agent_id", normalizedAgentId)
        .maybeSingle();

      if (existingAgentId) {
        return NextResponse.json(
          { error: "This Agent ID is already in use." },
          { status: 409 }
        );
      }
    }

    const selectedRoles = await fetchActiveRolesByIds(selectedRoleIds);
    if (selectedRoles.length !== selectedRoleIds.length) {
      return NextResponse.json(
        { error: "One or more selected roles are invalid or disabled." },
        { status: 400 }
      );
    }

    // Only hand out a role whose permissions fit inside your own.
    const delegation = checkAccountChange({
      actorPermissions: session?.user?.permissions ?? [],
      isSelf: false,
      targetPermissionKeys: [],
      nextRolePermissionKeys: await fetchRolePermissionKeys(selectedRoleIds[0]),
    });
    if (!delegation.ok) {
      return NextResponse.json({ error: delegation.error }, { status: delegation.status });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .insert([
        {
          email: normalizedEmail,
          name,
          agent_id: normalizedAgentId,
          password_hash: hashedPassword,
          is_active: true,
        },
      ])
      .select("id,email,name,agent_id,is_active,created_at")
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
      await replaceUserRoles(data.id, selectedRoleIds);
    }

    console.info("[account-manager:create] success", {
      email: normalizedEmail,
      userId: data.id,
      roleIds: selectedRoleIds,
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
