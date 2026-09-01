import { describe, expect, it } from "vitest";
import { buildLeadPatch, checkFollowUpInvariant } from "./patch";

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

  it("allows an unknown product to be cleared and products to be classified later", () => {
    expect(buildLeadPatch({ product: null })).toMatchObject({
      ok: true,
      patch: { product: null },
    });
    expect(buildLeadPatch({ products: ["pc", "health", "pc"] })).toMatchObject({
      ok: true,
      patch: { products: ["pc", "health"] },
    });
    expect(buildLeadPatch({ products: [] })).toMatchObject({
      ok: true,
      patch: { products: [] },
    });
    expect(buildLeadPatch({ products: ["life"] })).toEqual({
      ok: false,
      error: "Unknown product.",
    });
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

describe("checkFollowUpInvariant", () => {
  const at = "2026-09-10T00:00:00.000Z";

  it("refuses a call-back status with no date", () => {
    expect(
      checkFollowUpInvariant({ nextStatusKind: "scheduled", nextFollowUpAt: null, followUpTouched: false })
    ).toEqual({ ok: false, error: "That status needs a follow-up date. Open the lead to log it." });
  });

  it("accepts a call-back status that has a date", () => {
    expect(
      checkFollowUpInvariant({ nextStatusKind: "scheduled", nextFollowUpAt: at, followUpTouched: true })
    ).toEqual({ ok: true, clearFollowUp: false });
  });

  // The hole C4 found: the old route only checked when status_id was sent, so a
  // request carrying only next_follow_up_at could hang a date on an Open lead —
  // and resolveLeadAlerts reads the date whatever the status, so that lead would
  // start showing overdue for a call nobody promised.
  it("refuses a date being set on a status that cannot carry one", () => {
    expect(
      checkFollowUpInvariant({ nextStatusKind: "open", nextFollowUpAt: at, followUpTouched: true })
    ).toEqual({ ok: false, error: "Only a call-back status can carry a follow-up date." });
    expect(
      checkFollowUpInvariant({ nextStatusKind: null, nextFollowUpAt: at, followUpTouched: true })
    ).toEqual({ ok: false, error: "Only a call-back status can carry a follow-up date." });
  });

  // Marking a lead Won while a call-back is outstanding is normal work.
  it("clears a leftover date when moving off a call-back status", () => {
    expect(
      checkFollowUpInvariant({ nextStatusKind: "won", nextFollowUpAt: at, followUpTouched: false })
    ).toEqual({ ok: true, clearFollowUp: true });
  });

  it("leaves an ordinary edit alone", () => {
    expect(
      checkFollowUpInvariant({ nextStatusKind: "open", nextFollowUpAt: null, followUpTouched: false })
    ).toEqual({ ok: true, clearFollowUp: false });
  });
});

describe("buildLeadPatch phone parity with create", () => {
  it("normalises a formatted number the way Create does", () => {
    expect(buildLeadPatch({ phone: "(714) 555-0123" })).toMatchObject({
      ok: true, patch: { phone: "7145550123" },
    });
  });

  it("refuses something that is not a phone number", () => {
    expect(buildLeadPatch({ phone: "abc" })).toEqual({
      ok: false, error: "Enter a valid phone number.",
    });
  });

  it("still allows clearing the field", () => {
    expect(buildLeadPatch({ phone: "  " })).toMatchObject({ ok: true, patch: { phone: null } });
  });
});
