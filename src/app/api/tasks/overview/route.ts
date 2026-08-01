import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { isTaskViewAdmin } from "@/lib/tasks/access";
import { fetchTaskOverview } from "@/lib/tasks/overview-data";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isTaskViewAdmin(session.user)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const dateRange = readDateRange(request);
    if ("error" in dateRange) {
      return NextResponse.json(
        { error: dateRange.error },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const snapshot = await fetchTaskOverview(new Date(), dateRange);
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load task overview." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

function readDateRange(request: NextRequest):
  | { from?: string; to?: string }
  | { error: string } {
  const from = request.nextUrl.searchParams.get("from")?.trim() ?? "";
  const to = request.nextUrl.searchParams.get("to")?.trim() ?? "";

  if (from && !isDateKey(from)) return { error: "Invalid from date." };
  if (to && !isDateKey(to)) return { error: "Invalid to date." };
  if (from && to && from > to) {
    return { error: "From date must be before to date." };
  }

  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
