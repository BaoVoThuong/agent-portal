import { NextResponse } from "next/server";
import { requireApiGrant } from "@/lib/authz/guards";
import { fetchPermissions } from "@/lib/rbac/role-management";

export async function GET() {
  const guard = await requireApiGrant("role.manage");
  if (!guard.ok) return guard.response;

  try {
    const permissions = await fetchPermissions();
    return NextResponse.json({ permissions });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Unable to load permissions.",
      },
      { status: 500 }
    );
  }
}
