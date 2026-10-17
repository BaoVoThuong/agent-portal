import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  fetchPositionsWithHolders,
  parsePositionInput,
  positionWriteFailure,
} from "@/lib/admin/positions";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function canManagePositions() {
  const session = await auth();
  return can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER);
}

function failure(error: { code?: string; message: string }) {
  const mapped = positionWriteFailure(error);
  return NextResponse.json({ error: mapped.error }, { status: mapped.status });
}

// Rename or regroup. Only an unused, non-built-in Position: the check and the
// write happen in one locked statement (update_unused_position).
export async function PATCH(request: Request, context: RouteContext) {
  if (!(await canManagePositions())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const input = parsePositionInput(await request.json().catch(() => null));
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const { error } = await getSupabaseAdmin().rpc("update_unused_position", {
    p_id: id,
    p_name: input.name,
    p_kind: input.kind,
  });
  if (error) return failure(error);

  return NextResponse.json({ positions: await fetchPositionsWithHolders() });
}

// The foreign key from portal_account.position_id refuses to delete a
// Position anyone holds; built-in rows are excluded by the filter.
export async function DELETE(_request: Request, context: RouteContext) {
  if (!(await canManagePositions())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const { data, error } = await getSupabaseAdmin()
    .from("positions")
    .delete()
    .eq("id", id)
    .is("system_key", null)
    .select("id");
  if (error) return failure(error);
  if (!data || data.length === 0) {
    const { data: existing } = await getSupabaseAdmin()
      .from("positions")
      .select("system_key")
      .eq("id", id)
      .maybeSingle();
    return failure({ message: existing ? "POSITION_SYSTEM" : "POSITION_NOT_FOUND" });
  }

  return NextResponse.json({ positions: await fetchPositionsWithHolders() });
}
