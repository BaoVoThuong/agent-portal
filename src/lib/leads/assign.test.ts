import { describe, expect, it } from "vitest";
import { MAX_ASSIGN_BATCH, validateAssignRequest } from "./assign";

const uuid = (n: number) => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

describe("validateAssignRequest", () => {
  it("accepts a normal batch and lowercases the target", () => {
    expect(validateAssignRequest({ lead_ids: [uuid(1), uuid(2)], to_email: "  CS@X.COM " })).toEqual({
      leadIds: [uuid(1), uuid(2)], toEmail: "cs@x.com", reason: null,
    });
  });

  it("allows clearing the owner", () => {
    expect(validateAssignRequest({ lead_ids: [uuid(1)], to_email: null })).toEqual({ leadIds: [uuid(1)], toEmail: null, reason: null });
  });

  it("rejects an empty selection", () => {
    expect(validateAssignRequest({ lead_ids: [], to_email: "cs@x.com" })).toEqual({ error: "Select at least one lead." });
  });

  it("rejects an id that is not a uuid", () => {
    expect(validateAssignRequest({ lead_ids: ["'; drop table leads; --"], to_email: null })).toEqual({ error: "One of the selected leads is not valid." });
  });

  it("rejects a batch past the cap", () => {
    const ids = Array.from({ length: MAX_ASSIGN_BATCH + 1 }, (_, i) => uuid(i + 1));
    expect(validateAssignRequest({ lead_ids: ids, to_email: null })).toEqual({ error: `Assign at most ${MAX_ASSIGN_BATCH} leads at a time.` });
  });

  it("drops a blank reason rather than storing an empty string", () => {
    expect(validateAssignRequest({ lead_ids: [uuid(1)], to_email: null, reason: "   " })).toEqual({ leadIds: [uuid(1)], toEmail: null, reason: null });
  });
});
