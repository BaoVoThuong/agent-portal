import { describe, expect, it } from "vitest";
import { checkRoleDeletion } from "@/lib/rbac/role-deletion";

describe("checkRoleDeletion", () => {
  it("deletes a role nobody holds without moving anyone", () => {
    expect(
      checkRoleDeletion({ roleId: "r1", holderCount: 0, moveToRoleId: null, moveToRoleIsActive: false })
    ).toEqual({ ok: true, moveToRoleId: null });
  });

  it("ignores a target role when nobody holds the role", () => {
    expect(
      checkRoleDeletion({ roleId: "r1", holderCount: 0, moveToRoleId: "r2", moveToRoleIsActive: true })
    ).toEqual({ ok: true, moveToRoleId: null });
  });

  it("refuses to delete a held role without a role to move the holders to", () => {
    expect(
      checkRoleDeletion({ roleId: "r1", holderCount: 3, moveToRoleId: null, moveToRoleIsActive: false })
    ).toMatchObject({ ok: false, status: 409, holderCount: 3 });
  });

  it("refuses to move the holders into the role being deleted", () => {
    expect(
      checkRoleDeletion({ roleId: "r1", holderCount: 2, moveToRoleId: "r1", moveToRoleIsActive: true })
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a target role that is disabled or missing", () => {
    expect(
      checkRoleDeletion({ roleId: "r1", holderCount: 2, moveToRoleId: "r2", moveToRoleIsActive: false })
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("moves the holders to an active role, then deletes", () => {
    expect(
      checkRoleDeletion({ roleId: "r1", holderCount: 2, moveToRoleId: "r2", moveToRoleIsActive: true })
    ).toEqual({ ok: true, moveToRoleId: "r2" });
  });
});
