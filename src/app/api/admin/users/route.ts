import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import { grantsBeyondCeiling } from "@/lib/authz/delegation";
import { requireApiGrant } from "@/lib/authz/guards";
import { effectiveRoleGrants } from "@/lib/authz/principal";
import {
  fetchRoleDefinition,
  fetchSystemRoleId,
  mapAuthzRpcError,
  SYSTEM_ROLE_KEYS,
} from "@/lib/rbac/role-management";
import { parseCreateUserInput } from "@/lib/admin/user-input";
import { normalizeAgentName } from "@/lib/agent-name";
import bcrypt from "bcryptjs";

export async function POST(req: Request) {
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
    // MỘT transaction: tạo account, gán role (khoá chung + audit), tên hoa hồng.
    // Lỗi ở bất kỳ bước nào thì không còn gì (review C P2-04) — hết cảnh xoá bù.
    const { data: createdId, error: createError } = await supabase.rpc("create_account_atomic", {
      p_email: normalizedEmail,
      p_name: name,
      p_agent_id: normalizedAgentId,
      p_password_hash: hashedPassword,
      p_role_id: role.id,
      p_commission_name: commissionName ?? null,
      p_actor_account_id: principal.accountId,
      p_actor_email: principal.email,
    });
    if (createError) {
      const mapped = mapAuthzRpcError(createError.message);
      return NextResponse.json(
        { error: mapped?.error ?? createError.message },
        { status: mapped?.status ?? 500 }
      );
    }

    const { data, error } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .select("id,email,name,agent_id,role,is_active,created_at")
      .eq("id", createdId as string)
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.info("[account-manager:create] success", {
      email: normalizedEmail,
      userId: data.id,
      roleId: role.id,
    });

    return NextResponse.json({ user: data }, { status: 201 });
  } catch (error) {
    console.error("[account-manager:create] failed", {
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
