import { describe, expect, it } from "vitest";
import {
  findMissingRequiredFieldsFromContext,
  isRequiredValueFilled,
} from "@/lib/table-config/required";

describe("isRequiredValueFilled", () => {
  it("treats a deliberate false checkbox as filled", () => {
    expect(isRequiredValueFilled("checkbox", false)).toBe(true);
  });

  it("treats an unset checkbox value as missing", () => {
    expect(isRequiredValueFilled("checkbox", null)).toBe(false);
    expect(isRequiredValueFilled("checkbox", undefined)).toBe(false);
    expect(isRequiredValueFilled("checkbox", "")).toBe(false);
  });

  it("supports nullable option ids used by Consent", () => {
    expect(isRequiredValueFilled("checkbox", "consent-yes")).toBe(true);
  });
});

describe("findMissingRequiredFieldsFromContext", () => {
  it("allows an empty Agent only when Table Config marks it optional", () => {
    const agentColumn = {
      key: "agent", label: "Agent", type: "person", is_system: true, archived_at: null,
    };
    const options = { fieldValues: { agent: null }, partial: false };
    expect(findMissingRequiredFieldsFromContext({
      columns: [{ ...agentColumn, required: false }] as never,
    }, options)).toEqual([]);
    expect(findMissingRequiredFieldsFromContext({
      columns: [{ ...agentColumn, required: true }] as never,
    }, options)).toEqual([{ key: "agent", label: "Agent" }]);
    expect(findMissingRequiredFieldsFromContext({
      columns: [{ ...agentColumn, required: false }] as never,
    }, { ...options, partial: true })).toEqual([]);
    expect(findMissingRequiredFieldsFromContext({
      columns: [{ ...agentColumn, required: true }] as never,
    }, { ...options, partial: true })).toEqual([{ key: "agent", label: "Agent" }]);
  });

  it("checks required system and custom values without a database read", () => {
    const missing = findMissingRequiredFieldsFromContext(
      {
        columns: [
          { key: "summary", label: "Client", type: "text", required: true, is_system: true, archived_at: null },
          { key: "custom", label: "Custom", type: "text", required: true, is_system: false, archived_at: null },
        ] as never,
      },
      { fieldValues: { summary: "ok" }, customValues: {}, partial: false }
    );
    expect(missing.map((field) => field.key)).toEqual(["custom"]);
  });
});
