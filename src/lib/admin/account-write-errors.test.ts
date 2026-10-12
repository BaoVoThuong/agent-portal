import { describe, expect, it } from "vitest";
import { accountWriteFailure } from "./account-write-errors";

describe("accountWriteFailure", () => {
  it("maps invariant, personal lead and unique constraint errors", () => {
    expect(accountWriteFailure({ message: "LAST_ADMIN" })).toMatchObject({ status: 400 });
    expect(accountWriteFailure({ message: "AGENT_HAS_PERSONAL_LEADS" })).toMatchObject({ status: 409 });
    expect(accountWriteFailure({ code: "23505", message: "duplicate" })).toMatchObject({ status: 409 });
  });
});
