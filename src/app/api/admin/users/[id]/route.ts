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

type SupabaseAdminClient = ReturnType<typeof getSupabaseAdmin>;
type CountProbeResult = PromiseLike<{
  count: number | null;
  error: { message: string } | null;
}>;

function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function findEmailReference(
  supabase: SupabaseAdminClient,
  email: string
): Promise<string | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const quotedEmail = quotePostgrestValue(normalizedEmail);
  const probes: { label: string; run: () => CountProbeResult }[] = [
    {
      label: "tasks",
      run: () =>
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .or(
            [
              `assignee_email.eq.${quotedEmail}`,
              `agent_email.eq.${quotedEmail}`,
              `reporter_email.eq.${quotedEmail}`,
              `done_reviewed_by_email.eq.${quotedEmail}`,
            ].join(",")
          ),
    },
    {
      label: "task assignees",
      run: () =>
        supabase
          .from("task_assignees")
          .select("task_id", { count: "exact", head: true })
          .eq("email", normalizedEmail),
    },
    {
      label: "task participants",
      run: () =>
        supabase
          .from("task_participants")
          .select("task_id", { count: "exact", head: true })
          .eq("email", normalizedEmail),
    },
    {
      label: "task comments",
      run: () =>
        supabase
          .from("task_comments")
          .select("id", { count: "exact", head: true })
          .eq("author_email", normalizedEmail),
    },
    {
      label: "task activity",
      run: () =>
        supabase
          .from("task_activity")
          .select("id", { count: "exact", head: true })
          .eq("actor_email", normalizedEmail),
    },
    {
      label: "task stage history",
      run: () =>
        supabase
          .from("task_stage_cycles")
          .select("id", { count: "exact", head: true })
          .or(
            [
              `started_by_email.eq.${quotedEmail}`,
              `ended_by_email.eq.${quotedEmail}`,
            ].join(",")
          ),
    },
    {
      label: "task assignment history",
      run: () =>
        supabase
          .from("task_assignment_cycles")
          .select("id", { count: "exact", head: true })
          .or(
            [
              `email.eq.${quotedEmail}`,
              `assigned_by_email.eq.${quotedEmail}`,
              `unassigned_by_email.eq.${quotedEmail}`,
            ].join(",")
          ),
    },
    {
      label: "task overdue history",
      run: () =>
        supabase
          .from("task_overdue_events")
          .select("id", { count: "exact", head: true })
          .eq("resolved_by_email", normalizedEmail),
    },
    {
      label: "task notifications",
      run: () =>
        supabase
          .from("task_notifications")
          .select("id", { count: "exact", head: true })
          .or(
            [
              `recipient_email.eq.${quotedEmail}`,
              `actor_email.eq.${quotedEmail}`,
            ].join(",")
          ),
    },
    {
      label: "task agents",
      run: () =>
        supabase
          .from("task_agents")
          .select("email", { count: "exact", head: true })
          .eq("email", normalizedEmail),
    },
    {
      label: "agent groups",
      run: () =>
        supabase
          .from("agent_members")
          .select("agent_email", { count: "exact", head: true })
          .or(
            [
              `agent_email.eq.${quotedEmail}`,
              `cs_email.eq.${quotedEmail}`,
            ].join(",")
          ),
    },
    {
      label: "health registration entries",
      run: () =>
        supabase
          .from("health_entries")
          .select("id", { count: "exact", head: true })
          .eq("agent_email", normalizedEmail),
    },
    {
      label: "P&C registration entries",
      run: () =>
        supabase
          .from("pc_entries")
          .select("id", { count: "exact", head: true })
          .eq("agent_email", normalizedEmail),
    },
  ];

  for (const probe of probes) {
    const { count, error } = await probe.run();
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) return probe.label;
  }
  return null;
}

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
      email?: string;
      name?: string | null;
      agent_id?: string | null;
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

        const reference = await findEmailReference(supabase, targetUser.email);
        if (reference) {
          return NextResponse.json(
            {
              error:
                `This account is linked to ${reference}. ` +
                "Deactivate it or create a new account instead of changing the email.",
            },
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

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const session = await auth();

    if (
      !session?.user?.email ||
      !can(session.user.permissions, PERMISSIONS.ACCOUNT_MANAGER)
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: targetUser, error: targetError } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .select("id,email")
      .eq("id", id)
      .single();

    if (targetError || !targetUser) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (targetUser.email.toLowerCase() === session.user.email.toLowerCase()) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 400 }
      );
    }

    const delegation = checkAccountChange({
      actorPermissions: session.user.permissions ?? [],
      isSelf: false,
      targetPermissionKeys: await fetchUserPermissionKeys(id),
    });
    if (!delegation.ok) {
      return NextResponse.json({ error: delegation.error }, { status: delegation.status });
    }

    const reference = await findEmailReference(supabase, targetUser.email);
    if (reference) {
      return NextResponse.json(
        {
          error:
            `This account is linked to ${reference}. ` +
            "Deactivate the account instead of deleting it.",
        },
        { status: 409 }
      );
    }

    const { error: deleteError } = await supabase.rpc("delete_account_atomic", {
      p_user_id: id,
    });

    if (deleteError) {
      const failure = accountWriteFailure(deleteError);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }

    invalidateRbacLookups();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[account-manager:delete] failed", {
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
