import { describe, expect, it } from "vitest";
import { normalizePhone, parseLeadRows } from "./import-parse";

describe("normalizePhone", () => {
  it("reduces the many ways people write a US number to one", () => {
    expect(normalizePhone("(714) 555-0123")).toBe("7145550123");
    expect(normalizePhone("714.555.0123")).toBe("7145550123");
    expect(normalizePhone("+1 714 555 0123")).toBe("7145550123");
    expect(normalizePhone("1-714-555-0123")).toBe("7145550123");
  });

  it("returns null for anything that cannot be a number", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("N/A")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });

  it("keeps a number Excel turned into a float", () => {
    expect(normalizePhone(7145550123)).toBe("7145550123");
  });
});

describe("parseLeadRows", () => {
  const mapping = { full_name: "Name", phone: "Cell", email: "Email" };

  it("maps the named columns and keeps the rest as custom values", () => {
    const result = parseLeadRows(
      [{ Name: "An Nguyen", Cell: "(714) 555-0123", Email: "an@x.com", Language: "VI" }],
      mapping
    );
    expect(result.rows).toEqual([{
      full_name: "An Nguyen",
      phone: "7145550123",
      email: "an@x.com",
      custom_values: { Language: "VI" },
    }]);
    expect(result.skipped).toEqual([]);
  });

  it("skips a row with no usable phone and says which row", () => {
    const result = parseLeadRows(
      [{ Name: "No Phone", Cell: "N/A", Email: "x@x.com" }],
      mapping
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([{ row: 2, reason: "Missing phone number" }]);
  });

  it("drops a duplicate inside the same file, keeping the first", () => {
    const result = parseLeadRows(
      [
        { Name: "First", Cell: "714-555-0123" },
        { Name: "Second", Cell: "(714) 555 0123" },
      ],
      mapping
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].full_name).toBe("First");
    expect(result.skipped).toEqual([{ row: 3, reason: "Duplicate phone number in this file" }]);
  });

  it("lowercases email so the same person is not two people", () => {
    const result = parseLeadRows(
      [{ Name: "A", Cell: "7145550123", Email: "  An@X.COM " }],
      mapping
    );
    expect(result.rows[0].email).toBe("an@x.com");
  });
});
