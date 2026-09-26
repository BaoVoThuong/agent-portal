import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { grantsBeyondCeiling } from "@/lib/authz/delegation";
import { requireApiGrant } from "@/lib/authz/guards";
import { effectiveRoleGrants } from "@/lib/authz/principal";
import {
  fetchRoleDefinition,
  fetchSystemRoleId,
  isSuperAdminRole,
  mapAuthzRpcError,
  SYSTEM_ROLE_KEYS,
} from "@/lib/rbac/role-management";
import { parseCreateUserInput } from "@/lib/admin/user-input";
import { normalizeAgentName } from "@/lib/agent-name";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
  let createdUserId: string | null = null;

  try {
    const guard = await requireApiGrant("account.manage");
    if (!guard.ok) return guard.response;
    const { principal } = guard;

    const parsed = parseCreateUserInput(await req.json());
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const {
      email: normalizedEmail,
      password,
      name,
      agentId: normalizedAgentId,
      commissionName,
      legacyRoleFallback,
      roleIds: selectedRoleIds,
    } = parsed.value;

    console.info("[account-manager:create] request", {
      actor: principal.email,
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

    // Tên hoa hồng là khoá phạm vi dữ liệu: trùng là hai account thấy dữ liệu của
    // nhau (S1). Kiểm trước khi tạo; RPC kiểm lại dưới khoá.
    if (commissionName) {
      const { data: takenName } = await supabase
        .from("agent_commission_names")
        .select("account_id")
        .eq("agent_name", normalizeAgentName(commissionName))
        .maybeSingle();
      if (takenName) {
        return NextResponse.json(
          { error: "Another account already uses this commission name." },
          { status: 409 }
        );
      }
    }

    // Không chọn role thì dùng role hệ thống theo system_key (không theo tên).
    const roleId =
      selectedRoleIds[0] ??
      (await fetchSystemRoleId(
        legacyRoleFallback === "admin"
          ? SYSTEM_ROLE_KEYS.SUPER_ADMIN
          : SYSTEM_ROLE_KEYS.DEFAULT_NEW_ACCOUNT
      ));
    const role = roleId ? await fetchRoleDefinition(roleId) : null;
    if (!role || !role.isActive) {
      return NextResponse.json(
        { error: "One or more selected roles are invalid or disabled." },
        { status: 400 }
      );
    }

    // Trần uỷ quyền (S4): không tạo được account mang quyền mình không có.
    const beyond = grantsBeyondCeiling(principal.grants, effectiveRoleGrants(role));
    if (beyond.length > 0) {
      return NextResponse.json(
        { error: "You cannot assign a role with permissions you do not hold.", grants: beyond },
        { status: 403 }
      );
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
          role: isSuperAdminRole({ name: role.name, system_key: role.systemKey })
            ? "admin"
            : "agent",
          is_active: true,
        },
      ])
      .select("id,email,name,agent_id,role,is_active,created_at")
      .single();

    if (error) {
      console.error("[account-manager:create] insert failed", {
        email: normalizedEmail,
        error: error.message,
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    createdUserId = data.id;
    const { error: assignError } = await supabase.rpc("assign_account_access_atomic", {
      p_account_id: data.id,
      p_role_id: role.id,
      p_is_active: null,
      p_actor_account_id: principal.accountId,
      p_actor_email: principal.email,
    });
    if (assignError) {
      // Không để lại account không có role (S19): lỗi thì bỏ account vừa tạo.
      await supabase.from(PORTAL_ACCOUNT_TABLE).delete().eq("id", data.id);
      createdUserId = null;
      const mapped = mapAuthzRpcError(assignError.message);
      return NextResponse.json(
        { error: mapped?.error ?? assignError.message },
        { status: mapped?.status ?? 500 }
      );
    }

    if (commissionName) {
      const { error: commissionError } = await supabase.rpc("set_commission_name_atomic", {
        p_account_id: data.id,
        p_agent_name: commissionName,
        p_actor_account_id: principal.accountId,
        p_actor_email: principal.email,
      });
      if (commissionError) {
        await supabase.from(PORTAL_ACCOUNT_TABLE).delete().eq("id", data.id);
        createdUserId = null;
        const mapped = mapAuthzRpcError(commissionError.message);
        return NextResponse.json(
          { error: mapped?.error ?? commissionError.message },
          { status: mapped?.status ?? 500 }
        );
      }
    }

    console.info("[account-manager:create] success", {
      email: normalizedEmail,
      userId: data.id,
      roleId: role.id,
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
