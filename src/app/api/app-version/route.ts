import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/app-version";

export const dynamic = "force-dynamic";

/** The deployment now serving, for NewVersionBanner. Inlined at build, so each deployment answers with its own id. */
export function GET() {
  return NextResponse.json(
    { version: APP_VERSION || null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
