import { NextResponse } from "next/server";
import { botSecretMatches } from "@/lib/enrollment/bot-secret";
import { runBotEnrollmentImport } from "@/lib/enrollment/bot-import";

export const dynamic = "force-dynamic";

/**
 * Chạy thử import Enrollment cho Slack bot (2026-11-14). KHÔNG ghi gì.
 * Logic ở lib/enrollment/bot-import.ts, dùng chung với import thật qua
 * /api/slack-bot/actions.
 *
 * Xác thực bằng BOT_PORTAL_SECRET, không bằng session.
 */
export async function POST(request: Request) {
  const secret = process.env.BOT_PORTAL_SECRET;
  if (!secret) return NextResponse.json({ error: "Dry run is not configured." }, { status: 503 });
  if (!botSecretMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runBotEnrollmentImport(await request.json().catch(() => null), { dryRun: true });
}
