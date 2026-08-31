import { describe, expect, it } from "vitest";
import { buildLeadPatch } from "./patch";

describe("buildLeadPatch", () => {
  it("trims text and turns an emptied field into null", () => {
    expect(buildLeadPatch({ full_name: "  Anh Nguyen  " })).toMatchObject({
      ok: true, patch: { full_name: "Anh Nguyen" },
    });
    expect(buildLeadPatch({ phone: "   " })).toMatchObject({
      ok: true, patch: { phone: null },
    });
  });

  it("lowercases an email and refuses one without an @", () => {
    expect(buildLeadPatch({ email: " Anh@Example.COM " })).toMatchObject({
      ok: true, patch: { email: "anh@example.com" },
    });
    expect(buildLeadPatch({ email: "not-an-email" })).toEqual({
      ok: false, error: "Enter a valid email address.",
    });
  });

  // Fail closed. Silently dropping an unknown key makes a typo look like a
  // save that worked, and the cell would show the new value until a refresh.
  it("refuses a field that is not editable in place", () => {
    expect(buildLeadPatch({ contact_attempt_count: 99 })).toEqual({
      ok: false, error: "contact_attempt_count cannot be edited here.",
    });
    expect(buildLeadPatch({ assigned_to_email: "a@b.com" })).toEqual({
      ok: false, error: "assigned_to_email cannot be edited here.",
    });
  });

  it("refuses an unknown product and a malformed status id", () => {
    expect(buildLeadPatch({ product: "life" })).toEqual({ ok: false, error: "Unknown product." });
    expect(buildLeadPatch({ status_id: "abc" })).toEqual({ ok: false, error: "Invalid status." });
  });

  it("normalises a follow-up date to ISO and rejects nonsense", () => {
    expect(buildLeadPatch({ next_follow_up_at: "2026-09-10" })).toMatchObject({
      ok: true, patch: { next_follow_up_at: "2026-09-10T00:00:00.000Z" },
    });
    expect(buildLeadPatch({ next_follow_up_at: "someday" })).toEqual({
      ok: false, error: "Enter a valid follow-up date.",
    });
  });

  it("carries event_name and custom_values separately from column writes", () => {
    const result = buildLeadPatch({ event_name: " Health Fair ", custom_values: { a: 1 } });
    expect(result).toMatchObject({
      ok: true, patch: {}, eventName: "Health Fair", customValues: { a: 1 },
    });
  });

  it("treats an empty body as nothing to do", () => {
    expect(buildLeadPatch({})).toEqual({ ok: false, error: "Nothing to update." });
  });
});
