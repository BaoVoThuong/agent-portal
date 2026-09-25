import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { revokePushSubscriptions } from "@/lib/notifications/push-server";
import { bumpAccessVersion } from "@/lib/authz/versions";
import { grantsBeyondCeiling } from "@/lib/authz/delegation";
import { forbidden, requireApiGrant } from "@/lib/authz/guards";
import { effectiveRoleGrants } from "@/lib/authz/principal";
import {
  fetchAccountAccess,
  fetchRoleDefinition,
  fetchSystemRoleId,
  isSuperAdminRole,
  mapAuthzRpcError,
  SYSTEM_ROLE_KEYS,
} from "@/lib/rbac/role-management";
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

const ACCOUNT_COLUMNS = "id,email,name,agent_id,role,is_active,created_at";

function rpcFailure(message: string | undefined) {
  const mapped = mapAuthzRpcError(message);
  if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  return NextResponse.json({ error: message ?? "Unable to update account." }, { status: 500 });
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const guard = await requireApiGrant("account.manage");
    if (!guard.ok) return guard.response;
    const { principal } = guard;

    const { id } = await context.params;
    const { email, name, role, roleIds, is_active, password, agentId } =
      await req.json();

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
      targetUser.email.toLowerCase() === principal.email.toLowerCase();

    // Không quản được người có quyền cao hơn mình (trần uỷ quyền, S4).
    const targetAccess = await fetchAccountAccess(id);
    if (!isSelf && grantsBeyondCeiling(principal.grants, targetAccess.grants).length > 0) {
      return forbidden("You cannot manage an account with permissions you do not hold.");
    }

    const updates: {
      email?: string;
      name?: string | null;
      agent_id?: string;
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
      const normalizedAgentId =
        typeof agentId === "string" ? agentId.trim() : "";

      if (!normalizedAgentId) {
        return NextResponse.json(
          { error: "Agent ID is required." },
          { status: 400 }
        );
      }

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

      updates.agent_id = normalizedAgentId;
    }

    // Role mới: `roleIds` (Account Manager hiện tại) hoặc `role` legacy
    // ("admin" | "agent") từ client cũ → role hệ thống theo system_key.
    let nextRoleId: string | null = null;
    if (roleIds !== undefined) {
      const selectedRoleIds = Array.isArray(roleIds)
        ? roleIds.filter((item): item is string => typeof item === "string")
        : [];
      if (selectedRoleIds.length !== 1) {
        return NextResponse.json(
          { error: "Select exactly one active role." },
          { status: 400 }
        );
      }
      nextRoleId = selectedRoleIds[0];
    } else if (role !== undefined) {
      if (role !== "admin" && role !== "agent") {
        return NextResponse.json({ error: "Invalid role." }, { status: 400 });
      }
      nextRoleId = await fetchSystemRoleId(
        role === "admin" ? SYSTEM_ROLE_KEYS.SUPER_ADMIN : SYSTEM_ROLE_KEYS.DEFAULT_NEW_ACCOUNT
      );
      if (!nextRoleId) {
        return NextResponse.json({ error: "Invalid role." }, { status: 400 });
      }
    }

    if (nextRoleId) {
      const nextRole = await fetchRoleDefinition(nextRoleId);
      if (!nextRole || !nextRole.isActive) {
        return NextResponse.json(
          { error: "One or more selected roles are invalid or disabled." },
          { status: 400 }
        );
      }
      if (
        isSelf &&
        targetAccess.holdsSuperAdmin &&
        !isSuperAdminRole({ name: nextRole.name, system_key: nextRole.systemKey })
      ) {
        return NextResponse.json(
          { error: "You cannot remove your own admin role." },
          { status: 400 }
        );
      }
      const beyond = grantsBeyondCeiling(principal.grants, effectiveRoleGrants(nextRole));
      if (beyond.length > 0) {
        return NextResponse.json(
          { error: "You cannot assign a role with permissions you do not hold.", grants: beyond },
          { status: 403 }
        );
      }
    }

    let nextActive: boolean | null = null;
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

      nextActive = is_active;
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

    if (Object.keys(updates).length === 0 && !nextRoleId && nextActive === null) {
      return NextResponse.json(
        { error: "No account changes provided." },
        { status: 400 }
      );
    }

    // Role và trạng thái đi qua RPC nguyên tử: khoá chung, bất biến "còn ≥ 1
    // admin khôi phục", cột legacy, tăng access_version và audit trong CÙNG
    // transaction (S19, C18).
    if (nextRoleId || nextActive !== null) {
      const { error: rpcError } = await supabase.rpc("assign_account_access_atomic", {
        p_account_id: id,
        p_role_id: nextRoleId,
        p_is_active: nextActive,
        p_actor_account_id: principal.accountId,
        p_actor_email: principal.email,
      });
      if (rpcError) return rpcFailure(rpcError.message);
    }

    const { data, error } =
      Object.keys(updates).length > 0
        ? await supabase
            .from(PORTAL_ACCOUNT_TABLE)
            .update(updates)
            .eq("id", id)
            .select(ACCOUNT_COLUMNS)
            .single()
        : await supabase
            .from(PORTAL_ACCOUNT_TABLE)
            .select(ACCOUNT_COLUMNS)
            .eq("id", id)
            .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Đổi email → phiên của người này làm mới quyền ngay (role/trạng thái đã
    // được RPC tăng version).
    if (updates.email !== undefined) {
      await bumpAccessVersion([id]);
    }

    if (nextActive === false) {
      // Khoá account thì máy của người đó thôi nhận push ngay, không đợi
      // subscription tự hết hạn. Lỗi ở đây không làm hỏng việc khoá: phiên đã
      // bị chặn ở lần làm mới quyền kế tiếp và push đã lọc account active.
      await revokePushSubscriptions(targetUser.email).catch((revokeError) => {
        console.error("[account-manager:update] push revoke failed", {
          userId: id,
          error: revokeError instanceof Error ? revokeError.message : String(revokeError),
        });
      });
    }

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
    const guard = await requireApiGrant("account.manage");
    if (!guard.ok) return guard.response;
    const { principal } = guard;

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

    if (targetUser.email.toLowerCase() === principal.email.toLowerCase()) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 400 }
      );
    }

    const targetAccess = await fetchAccountAccess(id);
    if (grantsBeyondCeiling(principal.grants, targetAccess.grants).length > 0) {
      return forbidden("You cannot manage an account with permissions you do not hold.");
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

    // Xoá + bất biến admin khôi phục trong một transaction có khoá.
    const { error: deleteError } = await supabase.rpc("delete_account_atomic", {
      p_account_id: id,
      p_actor_account_id: principal.accountId,
      p_actor_email: principal.email,
    });
    if (deleteError) return rpcFailure(deleteError.message);

    await revokePushSubscriptions(targetUser.email).catch((revokeError) => {
      console.error("[account-manager:delete] push revoke failed", {
        userId: id,
        error: revokeError instanceof Error ? revokeError.message : String(revokeError),
      });
    });

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
