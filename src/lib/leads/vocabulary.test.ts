import { describe, expect, it } from "vitest";
import { validateStatusInput, validateTypeInput } from "./vocabulary";

describe("validateStatusInput", () => {
  it("accepts a status the admin named in their own language", () => {
    expect(validateStatusInput({ label: "  Đang chăm  ", kind: "open" })).toEqual({
      label: "Đang chăm", kind: "open", color: null, position: 0,
    });
  });

  it("refuses a kind the alert engine does not understand", () => {
    expect(validateStatusInput({ label: "X", kind: "maybe" })).toEqual({
      error: "Pick what this status means: open, scheduled, won, or lost.",
    });
  });

  it("refuses an empty label", () => {
    expect(validateStatusInput({ label: "   ", kind: "open" })).toEqual({ error: "The status needs a name." });
  });

  // Statuses used to be per-product and a request had to name a valid one.
  // One shared set replaced that, so a stray product field is simply ignored
  // rather than rejected -- an old client sending it still works.
  it("ignores a product field left over from the per-product sets", () => {
    expect(validateStatusInput({ product: "aca", label: "X", kind: "open" })).toEqual({
      label: "X", kind: "open", color: null, position: 0,
    });
  });
});

describe("validateTypeInput", () => {
  it("defaults a new type to NOT counting as contact", () => {
    expect(validateTypeInput({ label: "Zalo" })).toEqual({ label: "Zalo", counts_as_contact: false, color: null, position: 0 });
  });

  it("takes the flag when it is given", () => {
    expect(validateTypeInput({ label: "Zalo", counts_as_contact: true })).toEqual({ label: "Zalo", counts_as_contact: true, color: null, position: 0 });
  });

  it("refuses an empty label", () => {
    expect(validateTypeInput({ label: "" })).toEqual({ error: "The interaction type needs a name." });
  });
});
