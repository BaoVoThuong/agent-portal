import { describe, expect, it } from "vitest";
import {
  findProviderDuplicate,
  pendingProviderFields,
  proposedProviderValues,
  providerMergeChanges,
} from "./backlog";
import { PROVIDER_TEXT_FIELDS } from "./types";

type Row = Parameters<typeof providerMergeChanges>[0];

function row(values: Partial<Row> = {}): Row {
  const base = Object.fromEntries(PROVIDER_TEXT_FIELDS.map((key) => [key, null])) as unknown as Row;
  return { ...base, custom_values: {}, ...values };
}

describe("pendingProviderFields", () => {
  it("keeps a Backlog row unreviewed and unstamped until a manager verifies it", () => {
    expect(pendingProviderFields("existing-id")).toEqual({
      pending: true,
      duplicate_of: "existing-id",
      needs_review: true,
      verified_by: null,
      date: null,
    });
  });
});

describe("findProviderDuplicate", () => {
  const live = [
    {
      id: "a",
      doctors: "Dr. Anna Lee",
      facility: "Lee Family Clinic",
      npi: "1234567890",
      street: "100 Main Street Suite 4",
      zip_code: "77001-1234",
    },
    {
      id: "b",
      doctors: null,
      facility: "Sunrise Pharmacy",
      npi: null,
      street: "5 Oak Avenue",
      zip_code: "77002",
    },
  ];

  it("matches the same NPI at the same address, ignoring street abbreviations", () => {
    expect(
      findProviderDuplicate(
        { doctors: "Anna Lee MD", facility: null, npi: "1234567890", street: "100 main st. ste 4", zip_code: "77001" },
        live
      )
    ).toBe("a");
  });

  it("does not match two different NPIs in the same building", () => {
    expect(
      findProviderDuplicate(
        { doctors: "Dr. Anna Lee", facility: null, npi: "9999999999", street: "100 Main St Ste 4", zip_code: "77001" },
        live
      )
    ).toBeNull();
  });

  it("falls back to the name when either row has no NPI", () => {
    expect(
      findProviderDuplicate(
        { doctors: null, facility: "SUNRISE pharmacy", npi: null, street: "5 Oak Ave", zip_code: "77002" },
        live
      )
    ).toBe("b");
  });

  it("treats another address of the same doctor as a new row", () => {
    expect(
      findProviderDuplicate(
        { doctors: "Dr. Anna Lee", facility: null, npi: "1234567890", street: "200 Elm St", zip_code: "77001" },
        live
      )
    ).toBeNull();
  });

  it("never flags a row without a street or ZIP", () => {
    expect(
      findProviderDuplicate(
        { doctors: "Dr. Anna Lee", facility: null, npi: "1234567890", street: null, zip_code: "77001" },
        live
      )
    ).toBeNull();
  });
});

describe("providerMergeChanges", () => {
  it("copies only filled values that differ, and never the review stamp", () => {
    const existing = row({
      doctors: "Dr. Anna Lee",
      phone: "(713) 555-0100",
      obamacare: "Ambetter HMO",
      verified_by: "Ngan Nguyen",
      date: "04/06/2026",
      custom_values: { fax: "111" },
    });
    const submitted = row({
      doctors: "Dr. Anna Lee ",
      phone: null,
      obamacare: "Ambetter HMO, Oscar EPO",
      verified_by: "Someone",
      date: "10/26/2026",
      custom_values: { fax: "", languages: "Spanish" },
    });

    expect(providerMergeChanges(submitted, existing)).toEqual([
      { key: "obamacare", from: "Ambetter HMO", to: "Ambetter HMO, Oscar EPO" },
      { key: "languages", from: null, to: "Spanish" },
    ]);
  });
});

describe("proposedProviderValues", () => {
  it("overlays the import columns on the existing row and keeps the rest", () => {
    const existing = row({
      doctors: "Dr. Anna Lee",
      phone: "(713) 555-0100",
      custom_values: { fax: "111", languages: "English" },
    });
    const proposed = proposedProviderValues(
      existing,
      { phone: "(713) 555-0199", latitude: null },
      { languages: "Spanish" }
    );

    expect(proposed.doctors).toBe("Dr. Anna Lee");
    expect(proposed.phone).toBe("(713) 555-0199");
    expect(proposed.custom_values).toEqual({ fax: "111", languages: "Spanish" });
    expect("latitude" in proposed).toBe(false);
    // The existing row object is not mutated.
    expect(existing.custom_values).toEqual({ fax: "111", languages: "English" });
  });
});
