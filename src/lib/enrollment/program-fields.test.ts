import { describe, expect, it } from "vitest";
import { sanitizeEnrollmentPatchForProgram } from "./program-fields";

describe("sanitizeEnrollmentPatchForProgram", () => {
  it("clears Medicare-inapplicable fields", () => {
    expect(
      sanitizeEnrollmentPatchForProgram("medicare", {
        client_name: "Client",
        caller_email: "caller@example.com",
        pcp_2026: "PCP",
        payment_status_id: "payment-1",
        aca_status_id: "aca-1",
        consent_id: "consent-1",
        platform_id: "platform-1",
      })
    ).toEqual({
      client_name: "Client",
      caller_email: null,
      pcp_2026: null,
      payment_status_id: null,
      aca_status_id: null,
      consent_id: null,
      platform_id: null,
    });
  });

  it("preserves ACA fields", () => {
    expect(
      sanitizeEnrollmentPatchForProgram("aca", {
        caller_email: "caller@example.com",
        pcp_2026: "PCP",
      })
    ).toEqual({
      caller_email: "caller@example.com",
      pcp_2026: "PCP",
    });
  });

  it("adds nulls for dirty Medicare fields already on the record", () => {
    expect(
      sanitizeEnrollmentPatchForProgram(
        "medicare",
        { client_name: "Updated" },
        { caller_email: "caller@example.com", pcp_2026: null }
      )
    ).toEqual({
      client_name: "Updated",
      caller_email: null,
    });
  });
});
