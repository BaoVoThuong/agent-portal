import { describe, expect, it } from "vitest";
import { buildNewLeadRow, parseCreateLeadInput } from "./create";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("parseCreateLeadInput", () => {
  it("normalizes the lead fields without requiring Product", () => {
    const result = parseCreateLeadInput({
      full_name: " Jane Doe ", phone: "+1 (555) 123-4567", email: " JANE@EXAMPLE.COM ",
      event_id: UUID, status_id: UUID, assigned_to_email: " Agent@Example.com ",
      client_request_id: UUID, custom_values: { source: "web", qualified: true },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        fullName: "Jane Doe", phone: "5551234567", email: "jane@example.com",
        fubLink: null, description: null, eventId: UUID, eventName: null,
        leadType: null, statusId: UUID, assignedToEmail: "agent@example.com",
        collaboratorEmails: [], clientRequestId: UUID,
        customValues: { source: "web", qualified: true },
      },
    });
  });

  it("requires a valid phone", () => {
    expect(parseCreateLeadInput({ phone: "not a phone" })).toEqual({
      ok: false, error: "A valid phone number is required.",
    });
  });

  it("rejects malformed references and emails", () => {
    expect(parseCreateLeadInput({ phone: "5551234567", event_id: "event" })).toEqual({
      ok: false, error: "Event must be a valid UUID.",
    });
    expect(parseCreateLeadInput({ phone: "5551234567", email: "not-an-email" })).toEqual({
      ok: false, error: "Email must be a valid email address.",
    });
  });

  it("accepts empty optional values and supported custom values", () => {
    const empty = parseCreateLeadInput({ phone: "5551234567", full_name: "", email: "" });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.value.customValues).toEqual({});
    expect(parseCreateLeadInput({
      phone: "5551234567", custom_values: { insurance_needs: ["opt-1", "opt-2"] },
    })).toMatchObject({ ok: true, value: { customValues: { insurance_needs: ["opt-1", "opt-2"] } } });
    expect(parseCreateLeadInput({ phone: "5551234567", custom_values: { nested: { value: true } } })).toEqual({
      ok: false, error: 'Custom field "nested" has an unsupported value.',
    });
  });

  it("trims and limits the lead description", () => {
    const parsed = parseCreateLeadInput({ phone: "5551234567", description: " Call after 5pm " });
    expect(parsed.ok ? parsed.value.description : null).toBe("Call after 5pm");
    expect(parseCreateLeadInput({ phone: "5551234567", description: "x".repeat(10_001) })).toEqual({
      ok: false, error: "Description is too long.",
    });
  });
});

describe("event name and type", () => {
  const base = { phone: "7145550123" };

  it("trims typed Event names and treats blank as no Event", () => {
    const named = parseCreateLeadInput({ ...base, event_name: " Health Fair 2026 " });
    expect(named.ok ? named.value.eventName : null).toBe("Health Fair 2026");
    const blank = parseCreateLeadInput({ ...base, event_name: "   " });
    expect(blank.ok ? blank.value.eventName : "parse failed").toBeNull();
  });

  it("requires an Event for Event leads and drops it for Personal leads", () => {
    expect(parseCreateLeadInput({ ...base, lead_type: "event" }).ok).toBe(false);
    const personal = parseCreateLeadInput({ ...base, lead_type: "personal", event_id: UUID, event_name: "Fair" });
    expect(personal.ok && personal.value).toMatchObject({ leadType: "personal", eventId: null, eventName: null });
  });

  it("does not create an Event called Personal Lead and rejects unknown types", () => {
    const legacy = parseCreateLeadInput({ ...base, event_name: "Personal Lead" });
    expect(legacy.ok ? legacy.value.eventName : "parse failed").toBeNull();
    expect(parseCreateLeadInput({ ...base, lead_type: "referral" })).toEqual({ ok: false, error: "Invalid lead type." });
  });
});

describe("buildNewLeadRow", () => {
  const base = {
    eventId: UUID, statusId: UUID, fullName: "An Nguyen", phone: "7145550123",
    email: "an@x.com", fubLink: "https://app.followupboss.com/2/people/view/123",
    customValues: { secondary_phone: "7145550999" }, actorEmail: " Admin@Example.COM ",
    now: new Date("2026-09-02T10:00:00Z"),
  };

  it("builds a fresh unassigned row without retired Product data", () => {
    const row = buildNewLeadRow(base);
    expect(row.status_id).toBe(UUID);
    expect(row.created_by_email).toBe("admin@example.com");
    expect(row.updated_by_email).toBe("admin@example.com");
    expect(row.fub_link).toBe(base.fubLink);
    expect(row.assigned_to_email).toBeNull();
    expect(row.assigned_at).toBeNull();
    expect(row.assigned_by_email).toBeNull();
    expect(row).not.toHaveProperty("product");
    expect(row).not.toHaveProperty("products");
  });

  it("includes a client request id only when supplied", () => {
    expect(buildNewLeadRow(base)).not.toHaveProperty("client_request_id");
    expect(buildNewLeadRow({ ...base, clientRequestId: UUID }).client_request_id).toBe(UUID);
  });

  it("uses the supplied clock", () => {
    expect(buildNewLeadRow(base).updated_at).toBe("2026-09-02T10:00:00.000Z");
  });

  it("sets the initial Agent for a Personal lead", () => {
    const row = buildNewLeadRow({
      ...base,
      eventId: null,
      assignedToEmail: " Agent@Example.COM ",
    });
    expect(row.assigned_to_email).toBe("agent@example.com");
    expect(row.assigned_at).toBe("2026-09-02T10:00:00.000Z");
    expect(row.assigned_by_email).toBe("admin@example.com");
  });
});
