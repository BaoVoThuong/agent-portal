import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fetchPermissions } from "@/lib/rbac/role-management";

export async function GET() {
  const session = await auth();

  if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
