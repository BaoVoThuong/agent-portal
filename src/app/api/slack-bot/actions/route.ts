import { NextResponse } from "next/server";
import { botSecretMatches } from "@/lib/enrollment/bot-secret";
import { runBotEnrollmentImport } from "@/lib/enrollment/bot-import";
import { parseBotAction } from "@/lib/slack-bot/action-parse";
import { runBotAction } from "@/lib/slack-bot/actions";

export const dynamic = "force-dynamic";

/**
 * Slack bot thực hiện một thay đổi đã được duyệt (2026-11-15, giai đoạn 2).
 *
 * Bot chỉ gọi route này sau khi một người có quyền Approve bấm duyệt trong Slack
 * và bot đã kiểm người đó (không phải người yêu cầu, trừ owner; yêu cầu chưa hết hạn).
 * Route chạy thay đổi với quyền của người duyệt (`approver_email`) — xem
 * lib/slack-bot/actions.ts. Riêng import Enrollment chạy với quyền của người yêu cầu
 * (`requester_email`), đúng như khi họ tự bấm Import.
 *
 * Xác thực bằng BOT_PORTAL_SECRET, không bằng session.
 */
export async function POST(request: Request) {
  const secret = process.env.BOT_PORTAL_SECRET;
  if (!secret) return NextResponse.json({ error: "Bot actions are not configured." }, { status: 503 });
  if (!botSecretMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    approver_email?: unknown;
    requester_email?: unknown;
  } | null;
  const approverEmail = typeof body?.approver_email === "string" ? body.approver_email.trim().toLowerCase() : "";
  const requesterEmail = typeof body?.requester_email === "string" ? body.requester_email.trim().toLowerCase() : "";
  if (!approverEmail || !requesterEmail) {
    return NextResponse.json({ error: "approver_email and requester_email are required." }, { status: 400 });
  }

  const raw = body?.action as Record<string, unknown> | undefined;
  try {
    if (raw?.kind === "enrollment_import") {
      const outcome = await runBotEnrollmentImport(
        { program: raw.program, rows: raw.rows, first_row: raw.first_row, actor_email: requesterEmail },
        { dryRun: false },
      );
      console.info("[slack-bot:action] enrollment_import", { requesterEmail, approverEmail, status: outcome.status });
      return outcome;
    }

    const action = parseBotAction(raw);
    if (!action) return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    const result = await runBotAction(action, approverEmail);
    console.info("[slack-bot:action]", { kind: action.kind, requesterEmail, approverEmail, status: result.status });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("[slack-bot:action] failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "The change failed." }, { status: 500 });
  }
}
