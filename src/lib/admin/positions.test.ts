import { describe, expect, it } from "vitest";
import { parsePositionInput, positionLockReason, positionWriteFailure } from "./positions";

describe("parsePositionInput", () => {
  it("trims the name and accepts a known group", () => {
    expect(parsePositionInput({ name: "  Team Lead ", kind: "other" })).toEqual({
      ok: true,
      name: "Team Lead",
      kind: "other",
    });
  });

  it("rejects a blank name, an unknown group and an over-long name", () => {
    expect(parsePositionInput({ name: " ", kind: "cs" }).ok).toBe(false);
    expect(parsePositionInput({ name: "Lead", kind: "admin" }).ok).toBe(false);
    expect(parsePositionInput({ name: "x".repeat(81), kind: "cs" }).ok).toBe(false);
    expect(parsePositionInput(null).ok).toBe(false);
  });
});

describe("positionLockReason", () => {
  const holder = { user_id: "u1", name: "Kay", email: "kay@example.com", is_active: false };

  it("locks built-in positions and positions anyone holds, disabled accounts included", () => {
    expect(positionLockReason({ system_key: "agent", holders: [] })).not.toBeNull();
    expect(positionLockReason({ system_key: null, holders: [holder] })).not.toBeNull();
  });

  it("leaves an unused custom position editable", () => {
    expect(positionLockReason({ system_key: null, holders: [] })).toBeNull();
  });
});

describe("positionWriteFailure", () => {
  it("maps the database guards to client-safe answers", () => {
    expect(positionWriteFailure({ message: "POSITION_IN_USE" }).status).toBe(409);
    expect(positionWriteFailure({ code: "23503", message: "fk" }).status).toBe(409);
    expect(positionWriteFailure({ code: "23505", message: "dup" }).status).toBe(409);
    expect(positionWriteFailure({ message: "POSITION_SYSTEM" }).status).toBe(400);
    expect(positionWriteFailure({ message: "POSITION_NOT_FOUND" }).status).toBe(404);
    expect(positionWriteFailure({ message: "boom" }).status).toBe(500);
  });
});
