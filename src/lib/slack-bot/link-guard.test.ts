import { describe, expect, it } from "vitest";
import { checkSlackBotLink } from "./link-guard";

const account = { id: "a1", email: "dung.ha@epsins.co", is_active: true };

describe("checkSlackBotLink", () => {
  it("allows no link at all", () => {
    expect(
      checkSlackBotLink({ actorEmail: "x@y.co", actorPermissions: [], account: null, accountPermissionKeys: [] }),
    ).toEqual({ ok: true });
  });

  it("allows linking an account whose permissions the actor also holds", () => {
    expect(
      checkSlackBotLink({
        actorEmail: "bao.vo@excelplannings.com",
        actorPermissions: ["task.manage", "slack_bot.manage"],
        account,
        accountPermissionKeys: ["task.manage"],
      }),
    ).toEqual({ ok: true });
  });

  it("blocks linking an account with permissions the actor lacks", () => {
    expect(
      checkSlackBotLink({
        actorEmail: "someone@epsins.co",
        actorPermissions: ["slack_bot.manage"],
        account,
        accountPermissionKeys: ["management.role_manager"],
      }),
    ).toEqual({ ok: false, status: 403, error: "This account has permissions you do not have." });
  });

  it("blocks linking a disabled account", () => {
    expect(
      checkSlackBotLink({
        actorEmail: "bao.vo@excelplannings.com",
        actorPermissions: ["slack_bot.manage"],
        account: { ...account, is_active: false },
        accountPermissionKeys: [],
      }),
    ).toEqual({ ok: false, status: 400, error: "Link an active account." });
  });
});
