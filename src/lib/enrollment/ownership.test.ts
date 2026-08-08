import { describe, expect, it } from "vitest";
import { findInvalidEnrollmentOwnership } from "@/lib/enrollment/ownership";

describe("findInvalidEnrollmentOwnership", () => {
  const active = new Set(["active@example.com", "agent@example.com"]);
  const taskAgents = new Set(["agent@example.com"]);

  it("requires agent values to be active selected task agents", () => {
    expect(
      findInvalidEnrollmentOwnership(
        { agent_email: "inactive@example.com" },
        active,
        taskAgents
      )
    ).toEqual({ field: "agent_email", email: "inactive@example.com" });
    expect(
      findInvalidEnrollmentOwnership(
        { agent_email: "active@example.com" },
        active,
        taskAgents
      )
    ).toEqual({ field: "agent_email", email: "active@example.com" });
  });

  it("accepts active caller/responsible values and empty fields", () => {
    expect(
      findInvalidEnrollmentOwnership(
        {
          agent_email: null,
          caller_email: "ACTIVE@example.com",
          responsible_enroll_email: "",
        },
        active,
        taskAgents
      )
    ).toBeNull();
  });
});
