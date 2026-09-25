import { NextResponse } from "next/server";
import { grantsBeyondCeiling, projectLegacyPermissions } from "@/lib/authz/delegation";
import { requireApiGrant } from "@/lib/authz/guards";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchRolesWithPermissions, mapAuthzRpcError } from "@/lib/rbac/role-management";
import { grantsForRpc, readRequestedGrants } from "./role-input";

type RolePayload = {
  name?: unknown;
  description?: unknown;
  is_active?: unknown;
  grants?: unknown;
  permissionKeys?: unknown;
};

export async function GET() {
  const guard = await requireApiGrant("role.manage");
  if (!guard.ok) return guard.response;

  try {
    const roles = await fetchRolesWithPermissions();
    return NextResponse.json({ roles });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to load roles." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const guard = await requireApiGrant("role.manage");
  if (!guard.ok) return guard.response;
  const { principal } = guard;

  try {
    const payload = (await req.json()) as RolePayload;
    const name = typeof payload.name === "string" ? payload.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Role name is required." }, { status: 400 });
    }
    const description =
      typeof payload.description === "string" && payload.description.trim()
        ? payload.description.trim()
        : null;
    const isActive = typeof payload.is_active === "boolean" ? payload.is_active : true;
    const grants = readRequestedGrants(payload, name) ?? [];

    // Trần uỷ quyền (S4): chỉ cấp được grant chính mình đang có.
    const beyond = grantsBeyondCeiling(principal.grants, grants);
    if (beyond.length > 0) {
      return NextResponse.json(
        { error: "You cannot grant permissions you do not hold.", grants: beyond },
        { status: 403 }
      );
    }

    const { data: roleId, error } = await getSupabaseAdmin().rpc("upsert_role_atomic", {
      p_role_id: null,
      p_name: name,
      p_description: description,
      p_is_active: isActive,
      p_grants: grantsForRpc(grants),
      p_legacy_keys: projectLegacyPermissions(grants),
      p_actor_account_id: principal.accountId,
      p_actor_email: principal.email,
    });
    if (error) {
      const mapped = mapAuthzRpcError(error.message);
      if (mapped) return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const roles = await fetchRolesWithPermissions();
    return NextResponse.json(
      { role: roles.find((item) => item.id === roleId), roles },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to create role." },
      { status: 500 }
    );
  }
}
