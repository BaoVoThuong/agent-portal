import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { runBotAction } from "@/lib/slack-bot/actions";
import { runBotEnrollmentImport } from "@/lib/enrollment/bot-import";
import { POST } from "./route";

vi.mock("@/lib/slack-bot/actions", () => ({ runBotAction: vi.fn() }));
vi.mock("@/lib/enrollment/bot-import", () => ({ runBotEnrollmentImport: vi.fn() }));

const oldSecret = process.env.BOT_PORTAL_SECRET;
const secret = "test-secret-with-enough-entropy-123456789";
const url = "http://localhost/api/slack-bot/actions";
const post = (body: unknown, auth = `Bearer ${secret}`) =>
  POST(new Request(url, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  process.env.BOT_PORTAL_SECRET = secret;
  vi.clearAllMocks();
});
afterAll(() => {
  if (oldSecret === undefined) delete process.env.BOT_PORTAL_SECRET;
  else process.env.BOT_PORTAL_SECRET = oldSecret;
});

describe("Slack bot actions route", () => {
  it("rejects a wrong bot secret", async () => {
    const response = await post({}, "Bearer wrong");
    expect(response.status).toBe(401);
    expect(runBotAction).not.toHaveBeenCalled();
  });

  it("needs both the approver and the requester", async () => {
    expect((await post({ action: { kind: "account_active", account_email: "a@x.co", active: true }, approver_email: "b@x.co" })).status).toBe(400);
  });

  it("rejects an unknown action", async () => {
    expect((await post({ action: { kind: "sql", query: "drop" }, approver_email: "b@x.co", requester_email: "c@x.co" })).status).toBe(400);
    expect(runBotAction).not.toHaveBeenCalled();
  });

  it("runs access changes as the approver", async () => {
    vi.mocked(runBotAction).mockResolvedValue({ status: 200, body: { ok: true, summary: "done" } });
    const response = await post({
      action: { kind: "account_active", account_email: "A@x.co", active: true },
      approver_email: "Boss@x.co",
      requester_email: "c@x.co",
    });
    expect(response.status).toBe(200);
    expect(runBotAction).toHaveBeenCalledWith({ kind: "account_active", account_email: "a@x.co", active: true }, "boss@x.co");
  });

  it("runs a real Enrollment import as the requester, not the approver", async () => {
    vi.mocked(runBotEnrollmentImport).mockResolvedValue(NextResponse.json({ created: 3 }));
    const response = await post({
      action: { kind: "enrollment_import", program: "aca", rows: [["Client Name"], ["x"]], first_row: 1 },
      approver_email: "boss@x.co",
      requester_email: "Tami@x.co",
    });
    expect(response.status).toBe(200);
    expect(runBotEnrollmentImport).toHaveBeenCalledWith(
      { program: "aca", rows: [["Client Name"], ["x"]], first_row: 1, actor_email: "tami@x.co" },
      { dryRun: false },
    );
  });
});
