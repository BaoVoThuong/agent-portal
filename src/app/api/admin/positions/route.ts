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

// The Position catalog belongs to Role Manager. Assigning a Position to an
// account is Account Manager's job and goes through the account write.
async function canManagePositions() {
  const session = await auth();
  return can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER);
}

export async function GET() {
  if (!(await canManagePositions())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ positions: await fetchPositionsWithHolders() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load positions." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!(await canManagePositions())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const input = parsePositionInput(await request.json().catch(() => null));
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const { error } = await getSupabaseAdmin()
    .from("positions")
    .insert({ name: input.name, kind: input.kind });
  if (error) {
    const failure = positionWriteFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }

  return NextResponse.json({ positions: await fetchPositionsWithHolders() }, { status: 201 });
}
