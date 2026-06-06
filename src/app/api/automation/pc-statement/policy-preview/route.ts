import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { fetchPcPolicySnapshot } from "@/lib/automation/pc-statement/policy-source";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export const runtime = "nodejs";

const DEFAULT_PREVIEW_LIMIT = 8;
const MAX_PREVIEW_LIMIT = 25;

function parsePreviewLimit(request: Request) {
  const { searchParams } = new URL(request.url);
  const value = Number(searchParams.get("limit") ?? DEFAULT_PREVIEW_LIMIT);

  if (!Number.isFinite(value) || value < 1) return DEFAULT_PREVIEW_LIMIT;
  return Math.min(Math.floor(value), MAX_PREVIEW_LIMIT);
}

export async function GET(request: Request) {
  const session = await auth();

  if (!can(session?.user?.permissions, PERMISSIONS.AUTOMATION_PC_STATEMENT)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = parsePreviewLimit(request);
  let snapshot;

  try {
    snapshot = await fetchPcPolicySnapshot();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to load P&C policy preview",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    headers: snapshot.headers,
    lastBlackRow: snapshot.lastBlackRow,
    oldPolicies: {
      count: snapshot.basePolicies.length,
      rows: snapshot.basePolicies
        .slice(0, limit)
        .map((row) => ({ values: row.rawValues })),
    },
    newPolicies: {
      count: snapshot.newPolicies.length,
      rows: snapshot.newPolicies
        .slice(0, limit)
        .map((row) => ({ values: row.rawValues })),
    },
  });
}
