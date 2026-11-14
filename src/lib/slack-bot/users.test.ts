import { describe, expect, it } from "vitest";
import { parseSlackBotUserInput, slackBotWriteFailure } from "./users";

const base = {
  slack_email: "  Khang416@Gmail.com ",
  portal_account_id: "6f1c1f0e-8c1a-4d1b-9e55-0a1b2c3d4e5f",
  can_diagnose: true,
  can_change_access: true,
  can_edit_code: false,
  can_approve: true,
  note: "  Health support ",
};

describe("parseSlackBotUserInput", () => {
  it("trims and lower-cases the email and trims the note", () => {
    const result = parseSlackBotUserInput(base);
    expect(result).toEqual({
      ok: true,
      value: { ...base, slack_email: "khang416@gmail.com", note: "Health support" },
    });
  });

  it("accepts an outside email with nothing ticked (Ask only)", () => {
    const result = parseSlackBotUserInput({ slack_email: "someone@outside.com", portal_account_id: null });
    expect(result).toEqual({
      ok: true,
      value: {
        slack_email: "someone@outside.com",
        portal_account_id: null,
        can_diagnose: false,
        can_change_access: false,
        can_edit_code: false,
        can_approve: false,
        note: null,
      },
    });
  });

  it("rejects write abilities without a portal account", () => {
    for (const flag of ["can_change_access", "can_edit_code", "can_approve"] as const) {
      const result = parseSlackBotUserInput({ slack_email: "a@b.co", portal_account_id: null, [flag]: true });
      expect(result).toEqual({
        ok: false,
        error: "Change access, Edit code and Approve need a linked portal account.",
      });
    }
  });

  it("rejects a malformed email or account id", () => {
    expect(parseSlackBotUserInput({ slack_email: "not-an-email" })).toEqual({ ok: false, error: "Enter a valid Slack email." });
    expect(parseSlackBotUserInput({ slack_email: "a@b.co", portal_account_id: "abc" })).toEqual({
      ok: false,
      error: "Invalid portal account.",
    });
  });

  it("rejects non-boolean flags instead of guessing", () => {
    expect(parseSlackBotUserInput({ slack_email: "a@b.co", can_diagnose: "yes" })).toEqual({
      ok: false,
      error: "Invalid Slack bot permissions.",
    });
  });
});

describe("slackBotWriteFailure", () => {
  it("maps the unique email index to 409", () => {
    expect(slackBotWriteFailure({ code: "23505", message: "duplicate key" })).toEqual({
      status: 409,
      error: "This Slack email is already on the list.",
    });
  });

  it("maps the linked-account check to 400", () => {
    expect(
      slackBotWriteFailure({ code: "23514", message: 'violates check constraint "slack_bot_users_linked_for_write"' }),
    ).toEqual({ status: 400, error: "Change access, Edit code and Approve need a linked portal account." });
  });

  it("keeps other errors as 500", () => {
    expect(slackBotWriteFailure({ message: "boom" })).toEqual({ status: 500, error: "boom" });
  });
});
