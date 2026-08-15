import { describe, expect, it } from "vitest";
import {
  ASSISTANT_MEMBERSHIP_CODES,
  mapAssistantMembershipError,
} from "./membership-mutation";

describe("mapAssistantMembershipError", () => {
  it("returns stable contracts for invariant failures", () => {
    expect(mapAssistantMembershipError({ message: ASSISTANT_MEMBERSHIP_CODES.SELF })).toMatchObject({
      code: ASSISTANT_MEMBERSHIP_CODES.SELF,
      status: 400,
    });
    expect(mapAssistantMembershipError({ message: ASSISTANT_MEMBERSHIP_CODES.DUPLICATE })).toMatchObject({
      code: ASSISTANT_MEMBERSHIP_CODES.DUPLICATE,
      status: 409,
    });
    expect(mapAssistantMembershipError({ message: ASSISTANT_MEMBERSHIP_CODES.CYCLE })).toMatchObject({
      code: ASSISTANT_MEMBERSHIP_CODES.CYCLE,
      status: 409,
    });
  });

  it("does not expose raw database messages", () => {
    expect(mapAssistantMembershipError({ message: "some internal postgres detail" })).toEqual({
      code: "ASSISTANT_MEMBERSHIP_FAILED",
      error: "Could not update assistant membership.",
      status: 500,
    });
  });
});
