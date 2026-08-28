import { describe, expect, it } from "vitest";
import { parseCreateLeadInput } from "./create";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("parseCreateLeadInput", () => {
  it("normalizes the core lead fields", () => {
    const result = parseCreateLeadInput({
      product: "health",
      full_name: "  Jane Doe  ",
      phone: "+1 (555) 123-4567",
      email: " JANE@EXAMPLE.COM ",
      event_id: UUID,
      status_id: UUID,
      assigned_to_email: " Agent@Example.com ",
      client_request_id: UUID,
      custom_values: { source: "web", qualified: true },
    });

    expect(result).toEqual({
      ok: true,
      value: {
        product: "health",
        fullName: "Jane Doe",
        phone: "5551234567",
        email: "jane@example.com",
        eventId: UUID,
        statusId: UUID,
        assignedToEmail: "agent@example.com",
        clientRequestId: UUID,
        customValues: { source: "web", qualified: true },
      },
    });
  });

  it("requires a valid product and phone", () => {
    expect(parseCreateLeadInput({ product: "life", phone: "555" })).toEqual({
      ok: false,
      error: "Unknown product.",
    });
    expect(parseCreateLeadInput({ product: "pc", phone: "not a phone" })).toEqual({
      ok: false,
      error: "A valid phone number is required.",
    });
  });

  it("rejects malformed references and emails", () => {
    expect(parseCreateLeadInput({ product: "pc", phone: "5551234567", event_id: "event" })).toEqual({
      ok: false,
      error: "Event must be a valid UUID.",
    });
    expect(parseCreateLeadInput({ product: "pc", phone: "5551234567", email: "not-an-email" })).toEqual({
      ok: false,
      error: "Email must be a valid email address.",
    });
  });

  it("accepts empty optional values and rejects unsupported custom values", () => {
    const empty = parseCreateLeadInput({ product: "pc", phone: "5551234567", full_name: "", email: "" });
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(empty.value.fullName).toBeNull();
      expect(empty.value.email).toBeNull();
      expect(empty.value.customValues).toEqual({});
    }

    expect(parseCreateLeadInput({
      product: "pc",
      phone: "5551234567",
      custom_values: { nested: { value: true } },
    })).toEqual({
      ok: false,
      error: 'Custom field "nested" has an unsupported value.',
    });
  });
});
