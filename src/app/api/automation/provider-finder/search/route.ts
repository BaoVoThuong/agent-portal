import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { runProviderSearch } from "@/lib/provider-finder/search";
import type { SearchRequest } from "@/lib/provider-finder/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await auth();
  if (!can(session?.user?.permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const input = (await request.json()) as SearchRequest;
    const { status, body } = await runProviderSearch(input);
    return NextResponse.json(body, { status });
  } catch (err) {
    // Giữ đúng behavior cũ: lỗi parse body -> 500 với logs rỗng.
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Provider search failed",
        logs: [],
      },
      { status: 500 }
    );
  }
}
