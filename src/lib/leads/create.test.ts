import { describe, expect, it } from "vitest";
import { parseCreateLeadInput, resolveDialogProduct,
  buildNewLeadRow,
} from "./create";

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
        products: ["health"],
        fullName: "Jane Doe",
        phone: "5551234567",
        email: "jane@example.com",
        fubLink: null,
        description: null,
        eventId: UUID,
        eventName: null,
        leadType: null,
        statusId: UUID,
        assignedToEmail: "agent@example.com",
        collaboratorEmails: [],
        clientRequestId: UUID,
        customValues: { source: "web", qualified: true },
      },
    });
  });

  it("requires a valid product and phone", () => {
    expect(parseCreateLeadInput({ product: "aca", phone: "555" })).toEqual({
      ok: false,
      error: "Invalid product.",
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
      expect(empty.value.fubLink).toBeNull();
      expect(empty.value.description).toBeNull();
      expect(empty.value.customValues).toEqual({});
    }

    const withFub = parseCreateLeadInput({
      product: "pc",
      phone: "5551234567",
      fub_link: " https://app.followupboss.com/2/people/view/1234 ",
    });
    expect(withFub.ok ? withFub.value.fubLink : null).toBe(
      "https://app.followupboss.com/2/people/view/1234",
    );

    expect(parseCreateLeadInput({
      product: "pc",
      phone: "5551234567",
      custom_values: { nested: { value: true } },
    })).toEqual({
      ok: false,
      error: 'Custom field "nested" has an unsupported value.',
    });
  });

  // Cột chọn nhiều (Insurance Needs…) gửi mảng option id từ form Add lead.
  it("accepts a list of option ids for a multi-select field", () => {
    const parsed = parseCreateLeadInput({
      product: "pc",
      phone: "5551234567",
      custom_values: { insurance_needs: ["opt-1", "opt-2"] },
    });
    expect(parsed.ok && parsed.value.customValues).toEqual({
      insurance_needs: ["opt-1", "opt-2"],
    });
  });

  it("trims and limits the lead description", () => {
    const parsed = parseCreateLeadInput({
      product: "pc",
      phone: "5551234567",
      description: "  Call after 5pm  ",
    });
    expect(parsed.ok ? parsed.value.description : null).toBe("Call after 5pm");
    expect(parseCreateLeadInput({
      product: "pc",
      phone: "5551234567",
      description: "x".repeat(10_001),
    })).toEqual({ ok: false, error: "Description is too long." });
  });
});

describe("event name", () => {
  const base = { product: "pc", phone: "7145550123" };

  it("accepts a typed event name and trims it", () => {
    const result = parseCreateLeadInput({ ...base, event_name: "  Health Fair 2026 " });
    expect(result.ok ? result.value.eventName : "parse failed").toBe("Health Fair 2026");
  });

  // A blank box means "no event", not an event named "".
  it("treats an empty name as no event", () => {
    const blank = parseCreateLeadInput({ ...base, event_name: "   " });
    expect(blank.ok ? blank.value.eventName : "parse failed").toBe(null);
    const absent = parseCreateLeadInput(base);
    expect(absent.ok ? absent.value.eventName : "parse failed").toBe(null);
  });

  it("rejects a non-string name rather than coercing it", () => {
    const result = parseCreateLeadInput({ ...base, event_name: 42 });
    expect(result).toEqual({ ok: false, error: "Event name must be text." });
  });
});

describe("lead type", () => {
  const base = { product: "pc", phone: "7145550123" };

  it("drops the event of a personal lead", () => {
    const result = parseCreateLeadInput({
      ...base,
      lead_type: "personal",
      event_id: UUID,
      event_name: "Health Fair",
    });
    expect(result.ok && result.value).toMatchObject({
      leadType: "personal",
      eventId: null,
      eventName: null,
    });
  });

  // Không có event thì lead sẽ hiện là Personal — "Event lead" trống event là
  // tự mâu thuẫn, nên chặn ngay ở đây.
  it("requires an event for an event lead", () => {
    const result = parseCreateLeadInput({ ...base, lead_type: "event" });
    expect(result.ok).toBe(false);
  });

  it("does not create an event called Personal Lead", () => {
    const legacy = parseCreateLeadInput({ ...base, event_name: "Personal Lead" });
    expect(legacy.ok ? legacy.value.eventName : "parse failed").toBe(null);
    const asEvent = parseCreateLeadInput({ ...base, lead_type: "event", event_name: "personal lead" });
    expect(asEvent.ok).toBe(false);
  });

  it("keeps the old contract when the client sends no type", () => {
    const result = parseCreateLeadInput(base);
    expect(result.ok ? result.value.leadType : "parse failed").toBe(null);
  });

  it("rejects an unknown type", () => {
    expect(parseCreateLeadInput({ ...base, lead_type: "referral" })).toEqual({
      ok: false,
      error: "Invalid lead type.",
    });
  });
});

describe("resolveDialogProduct", () => {
  it("uses the filtered product when the screen is already scoped", () => {
    expect(resolveDialogProduct("pc", null)).toBe("pc");
    // A filter wins over a stale choice: the badge on screen is what people read.
    expect(resolveDialogProduct("pc", "health")).toBe("pc");
  });

  // The bug: on the merged All-products screen both dialogs fell back to
  // "health", filing a P&C campaign as Health with nothing on screen saying so.
  it("asks instead of guessing when no product is filtered", () => {
    expect(resolveDialogProduct(null, null)).toBeNull();
  });

  it("takes the explicit choice once one is made", () => {
    expect(resolveDialogProduct(null, "pc")).toBe("pc");
    expect(resolveDialogProduct(null, "health")).toBe("health");
  });
});

describe("buildNewLeadRow", () => {
  const base = {
    product: "health" as const,
    eventId: "event-1",
    statusId: "status-new",
    fullName: "An Nguyen",
    phone: "7145550123",
    email: "an@x.com",
    fubLink: "https://app.followupboss.com/2/people/view/123",
    customValues: { secondary_phone: "7145550999" },
    actorEmail: "  Admin@Example.COM ",
    now: new Date("2026-09-02T10:00:00Z"),
  };

  it("đặt status mặc định được truyền vào", () => {
    // Đây là chỗ Create và Import từng lệch: Import không đặt gì cả, nên
    // 91/121 lead trong DB không có status.
    expect(buildNewLeadRow(base).status_id).toBe("status-new");
  });

  it("ghi người thao tác vào CẢ created_by lẫn updated_by, đã thường hoá", () => {
    const row = buildNewLeadRow(base);
    expect(row.created_by_email).toBe("admin@example.com");
    expect(row.updated_by_email).toBe("admin@example.com");
  });

  it("ghi FUB link vào cột hệ thống", () => {
    expect(buildNewLeadRow(base).fub_link).toBe(
      "https://app.followupboss.com/2/people/view/123",
    );
    expect(buildNewLeadRow({ ...base, fubLink: undefined }).fub_link).toBeNull();
  });

  it("luôn insert CHƯA GÁN", () => {
    // Cả hai đường đều gán SAU khi insert. Set sẵn ở đây thì RPC đọc chính
    // người đó làm "chủ cũ" và ghi lịch sử "từ X sang X".
    const row = buildNewLeadRow(base);
    expect(row.assigned_to_email).toBeNull();
    expect(row.assigned_at).toBeNull();
    expect(row.assigned_by_email).toBeNull();
  });

  it("products suy ra từ product, Unknown khi chưa phân loại", () => {
    expect(buildNewLeadRow(base).products).toEqual(["health"]);
    const unclassified = buildNewLeadRow({ ...base, product: null });
    expect(unclassified.products).toEqual(["unknown"]);
    expect(unclassified.product).toBe("unknown");
  });

  it("chỉ kèm client_request_id khi có", () => {
    expect("client_request_id" in buildNewLeadRow(base)).toBe(false);
    expect(
      buildNewLeadRow({ ...base, clientRequestId: "token-1" }).client_request_id
    ).toBe("token-1");
  });

  it("updated_at theo mốc truyền vào", () => {
    expect(buildNewLeadRow(base).updated_at).toBe("2026-09-02T10:00:00.000Z");
  });
});
