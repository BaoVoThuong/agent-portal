import { NextResponse } from "next/server";
import { auth, invalidateRbacLookups } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fetchActiveRolesByIds,
  fetchRolePermissionKeys,
  fetchUserPermissionKeys,
  fetchUserRoleId,
} from "@/lib/rbac/role-management";
import { checkAccountChange } from "@/lib/rbac/delegation";
import { accountWriteFailure } from "@/lib/admin/account-write-errors";
import bcrypt from "bcryptjs";

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
    const { email, name, role, roleIds, is_active, password, agentId } =
      await req.json();
    const selectedRoleIds = Array.isArray(roleIds)
      ? roleIds.filter((item): item is string => typeof item === "string")
      : null;

    if (
      (email !== undefined ||
        name !== undefined ||
        role !== undefined ||
        roleIds !== undefined ||
        is_active !== undefined ||
        password !== undefined ||
        agentId !== undefined) &&
      !can(session.user.permissions, PERMISSIONS.ACCOUNT_MANAGER)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseAdmin();

    const { data: targetUser, error: targetError } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .select("id,email,is_active")
      .eq("id", id)
      .single();

    if (targetError || !targetUser) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const isSelf =
      targetUser.email.toLowerCase() === session.user.email.toLowerCase();

    // The legacy admin/agent switch is gone: roles change through roleIds only.
    if (role !== undefined) {
      return NextResponse.json(
        { error: "Use roleIds to change the role." },
        { status: 400 }
      );
    }

    // Email is the key that ties tasks, leads, enrollments and notifications
    // to a person (~40 tables), so it never changes. The same email (an old
    // form re-sending it) is ignored.
    if (
      email !== undefined &&
      (typeof email !== "string" ||
        email.trim().toLowerCase() !== targetUser.email.trim().toLowerCase())
    ) {
      return NextResponse.json(
        { error: "Email cannot be changed. Create a new account instead." },
        { status: 400 }
      );
    }

    const [targetPermissionKeys, currentRoleId] = await Promise.all([
      fetchUserPermissionKeys(id),
      fetchUserRoleId(id),
    ]);

    // A role counts as changed only when it differs from the current one, so an
    // edit form that re-sends the same roleIds never trips "your own role".
    let nextRole: { id: string; name: string } | null = null;
    let nextRolePermissionKeys: string[] | undefined;
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

      if (selectedRoleIds[0] !== currentRoleId) {
        nextRole = selectedRoles[0];
        nextRolePermissionKeys = await fetchRolePermissionKeys(nextRole.id);
      }
    }

    const delegation = checkAccountChange({
      actorPermissions: session.user.permissions ?? [],
      isSelf,
      targetPermissionKeys,
      nextRolePermissionKeys,
    });
    if (!delegation.ok) {
      return NextResponse.json({ error: delegation.error }, { status: delegation.status });
    }

    const updates: {
      name?: string | null;
      agent_id?: string | null;
      is_active?: boolean;
      password_hash?: string;
    } = {};

    if (name !== undefined) {
      updates.name =
        typeof name === "string" && name.trim() ? name.trim() : null;
    }

    if (agentId !== undefined) {
      if (agentId !== null && typeof agentId !== "string") {
        return NextResponse.json(
          { error: "Invalid Agent ID." },
          { status: 400 }
        );
      }

      const normalizedAgentId =
        typeof agentId === "string" ? agentId.trim() : "";

      if (normalizedAgentId) {
        const { data: existingAgentId, error: agentIdError } = await supabase
          .from(PORTAL_ACCOUNT_TABLE)
          .select("id")
          .eq("agent_id", normalizedAgentId)
          .neq("id", id)
          .maybeSingle();

        if (agentIdError) {
          return NextResponse.json(
            { error: agentIdError.message },
            { status: 500 }
          );
        }

        if (existingAgentId) {
          return NextResponse.json(
            { error: "This Agent ID is already in use." },
            { status: 409 }
          );
        }
      }

      updates.agent_id = normalizedAgentId || null;
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

    if (password !== undefined) {
      if (typeof password !== "string" || password.length < 8) {
        return NextResponse.json(
          { error: "Password must be at least 8 characters." },
          { status: 400 }
        );
      }

      updates.password_hash = await bcrypt.hash(password, 10);
    }

    const hasAccountUpdates = Object.keys(updates).length > 0;
    if (!hasAccountUpdates && roleIds === undefined) {
      return NextResponse.json(
        { error: "No account changes provided." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("update_account_atomic", {
      p_user_id: id,
      p_patch: updates,
      p_role_id: nextRole?.id ?? null,
    });

    if (error) {
      const failure = accountWriteFailure(error);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }

    invalidateRbacLookups();
    return NextResponse.json({ user: data });
  } catch (error) {
    console.error("[account-manager:update] failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
