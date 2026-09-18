import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { RouteTiming } from "@/lib/server-timing";
import { runProviderSearch } from "@/lib/provider-finder/search";
import type { SearchRequest } from "@/lib/provider-finder/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const timing = new RouteTiming("provider-finder-search");
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status });
    response.headers.set("Server-Timing", timing.headerValue());
    timing.log(status);
    return response;
  };

  try {
    const session = await timing.measure("auth", () => auth());
    if (!can(session?.user?.permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const input = await timing.measure(
      "parse_body",
      async () => (await request.json()) as SearchRequest,
    );
    const { status, body } = await timing.measure("search", () =>
      runProviderSearch(input),
    );
    const stageLog = Array.isArray(body.logs)
      ? body.logs.find((entry) => entry.startsWith("search breakdown:"))
      : null;
    if (stageLog) {
      console.info(`[perf:provider-finder-search:stages] ${stageLog}`);
    }
    return respond(body, status);
  } catch (err) {
    // Giữ đúng behavior cũ: lỗi parse body -> 500 với logs rỗng.
    return respond(
      {
        error: err instanceof Error ? err.message : "Provider search failed",
        logs: [],
      },
      500,
    );
  }
}
