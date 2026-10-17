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
import { changesMembership, parseAccountConfigRequest } from "@/lib/admin/account-config";
import { accountWriteFailure } from "@/lib/admin/account-write-errors";
import { invalidateTaskMembershipLookups } from "@/lib/tasks/membership";
import { broadcastTableConfigChanged } from "@/lib/table-config/realtime";
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

    const body = await req.json();
    const parsed = parseCreateUserInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    // Optional Position, manager and supported Agents. A new account has no
    // earlier values, so there is no `expected` snapshot to check.
    const config = parseAccountConfigRequest({
      positionId: body?.positionId,
      managerId: body?.managerId,
      assistedAgentEmails: body?.assistedAgentEmails,
    });
    if (!config.ok) {
      return NextResponse.json({ error: config.error }, { status: 400 });
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

    // Same write as Edit account (update_account_atomic), so a new Agent or
    // Assistant lands on task_agents / agent_members exactly as an edit would.
    // If it is refused, the account just created is removed again.
    if (createdUserId && Object.keys(config.patch).length > 0) {
      const { error: configError } = await supabase.rpc("update_account_atomic", {
        p_user_id: createdUserId,
        p_patch: config.patch,
        p_role_id: null,
      });
      if (configError) {
        const failure = accountWriteFailure(configError);
        const undo = await removeCreatedAccount(createdUserId);
        createdUserId = null;
        if (!undo.ok) {
          return NextResponse.json(
            {
              error: `${failure.error} The account ${normalizedEmail} was created but could not be removed again (${undo.error}). Disable it in Account Manager.`,
            },
            { status: 500 }
          );
        }
        return NextResponse.json({ error: failure.error }, { status: failure.status });
      }
      if (changesMembership(config.patch)) {
        invalidateTaskMembershipLookups();
        await broadcastTableConfigChanged();
      }
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

    const message = error instanceof Error ? error.message : "Internal Server Error";
    if (createdUserId) {
      const undo = await removeCreatedAccount(createdUserId);
      if (!undo.ok) {
        return NextResponse.json(
          {
            error: `${message} The account was created but could not be removed again (${undo.error}). Disable it in Account Manager.`,
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Undo a half-finished create: remove the account (its role goes with it,
 * user_roles cascades). The caller says so when this fails, instead of
 * reporting the create as rolled back.
 */
async function removeCreatedAccount(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from(PORTAL_ACCOUNT_TABLE)
      .delete()
      .eq("id", userId)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: "account not found" };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
