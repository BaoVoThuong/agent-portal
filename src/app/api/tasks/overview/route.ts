import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isTaskViewAdmin } from "@/lib/tasks/access";
import { fetchTaskOverview } from "@/lib/tasks/overview-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isTaskViewAdmin(session.user)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const snapshot = await fetchTaskOverview();
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
