import { NextResponse } from "next/server";
import { grantsBeyondCeiling, projectLegacyPermissions } from "@/lib/authz/delegation";
import { forbidden, requireApiGrant } from "@/lib/authz/guards";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  fetchRoleDefinition,
  fetchRolesWithPermissions,
  isSuperAdminRole,
  mapAuthzRpcError,
} from "@/lib/rbac/role-management";
import { effectiveRoleGrants } from "@/lib/authz/principal";
import { grantsForRpc, readRequestedGrants } from "../role-input";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type RolePatchPayload = {
  name?: unknown;
  description?: unknown;
  is_active?: unknown;
  grants?: unknown;
  permissionKeys?: unknown;
};

function rpcFailure(message: string | undefined) {
  const mapped = mapAuthzRpcError(message);
  if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  return NextResponse.json({ error: message ?? "Unable to save role." }, { status: 500 });
}

export async function PATCH(req: Request, context: RouteContext) {
  // Gác VÔ ĐIỀU KIỆN trước mọi tra cứu (S18): body rỗng từng trả về toàn bộ
  // danh mục role cho bất kỳ ai đã đăng nhập.
  const guard = await requireApiGrant("role.manage");
  if (!guard.ok) return guard.response;
  const { principal } = guard;

  try {
    const { id } = await context.params;
    const payload = (await req.json()) as RolePatchPayload;

    // Không tự nâng quyền qua role mình đang giữ (S4).
    if (principal.roleIds.includes(id)) {
      return forbidden("You cannot edit a role you hold.");
    }

    const supabase = getSupabaseAdmin();
    const [current, { data: row, error: rowError }] = await Promise.all([
      fetchRoleDefinition(id),
      supabase.from("roles").select("name,description,is_active").eq("id", id).maybeSingle(),
    ]);
    if (rowError) return NextResponse.json({ error: rowError.message }, { status: 500 });
    if (!current || !row) {
      return NextResponse.json({ error: "Role not found." }, { status: 404 });
    }
    if (isSuperAdminRole({ name: current.name, system_key: current.systemKey })) {
      return NextResponse.json({ error: "Admin cannot be edited." }, { status: 400 });
    }

    const currentRow = row as { name: string; description: string | null; is_active: boolean };
    const name =
      payload.name === undefined
        ? currentRow.name
        : typeof payload.name === "string"
          ? payload.name.trim()
          : "";
    if (!name) {
      return NextResponse.json({ error: "Role name is required." }, { status: 400 });
    }
    const description =
      payload.description === undefined
        ? currentRow.description
        : typeof payload.description === "string" && payload.description.trim()
          ? payload.description.trim()
          : null;
    if (payload.is_active !== undefined && typeof payload.is_active !== "boolean") {
      return NextResponse.json({ error: "Invalid role status." }, { status: 400 });
    }
    const isActive = payload.is_active ?? currentRow.is_active;
    const requested = readRequestedGrants(payload);
    if (!requested.ok) {
      return NextResponse.json({ error: requested.error, invalid: requested.invalid }, { status: 400 });
    }
    const grants = requested.grants;

    // Grant hiệu lực SAU khi sửa. Phải nằm trong trần của người sửa. (Từ Phase H
    // tên role không còn mang quyền, nên đổi tên không đổi grant.)
    const effectiveAfter = grants ?? effectiveRoleGrants(current);
    const beyond = grantsBeyondCeiling(principal.grants, effectiveAfter);
    if (beyond.length > 0) {
      return NextResponse.json(
        { error: "You cannot grant permissions you do not hold.", grants: beyond },
        { status: 403 }
      );
    }

    const { error } = await supabase.rpc("upsert_role_atomic", {
      p_role_id: id,
      p_name: name,
      p_description: description,
      p_is_active: isActive,
      p_grants: grants ? grantsForRpc(grants) : null,
      p_legacy_keys: grants ? projectLegacyPermissions(grants, name) : null,
      p_actor_account_id: principal.accountId,
      p_actor_email: principal.email,
    });
    if (error) return rpcFailure(error.message);

    const roles = await fetchRolesWithPermissions();
    return NextResponse.json({ role: roles.find((item) => item.id === id), roles });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to update role." },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const guard = await requireApiGrant("role.manage");
  if (!guard.ok) return guard.response;
  const { principal } = guard;

  try {
    const { id } = await context.params;
    const { error } = await getSupabaseAdmin().rpc("delete_role_atomic", {
      p_role_id: id,
      p_actor_account_id: principal.accountId,
      p_actor_email: principal.email,
    });
    if (error) return rpcFailure(error.message);

    return NextResponse.json({ ok: true, roles: await fetchRolesWithPermissions() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to delete role." },
      { status: 500 }
    );
  }
}
