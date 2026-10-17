import { describe, expect, it } from "vitest";
import { accountWriteFailure } from "./account-write-errors";

describe("accountWriteFailure", () => {
  it("maps invariant, personal lead and unique constraint errors", () => {
    expect(accountWriteFailure({ message: "LAST_ADMIN" })).toMatchObject({ status: 400 });
    expect(accountWriteFailure({ message: "AGENT_HAS_PERSONAL_LEADS" })).toMatchObject({ status: 409 });
    expect(accountWriteFailure({ code: "23505", message: "duplicate" })).toMatchObject({ status: 409 });
  });

  it("maps the Position, Assistant and manager guards to client-safe answers", () => {
    expect(accountWriteFailure({ message: "ACCOUNT_CONFIG_CONFLICT" })).toMatchObject({ status: 409 });
    expect(accountWriteFailure({ message: "ASSISTANT_NEEDS_AGENT" })).toMatchObject({ status: 400 });
    expect(accountWriteFailure({ message: "PORTAL_ACCOUNT_MANAGER_CYCLE" })).toMatchObject({ status: 400 });
    expect(accountWriteFailure({ code: "23514", message: "check" })).toMatchObject({ status: 400 });
    expect(accountWriteFailure({ message: "something else" })).toMatchObject({ status: 500 });
  });
});
