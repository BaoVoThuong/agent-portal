import { describe, expect, it } from "vitest";
import { canViewTimeOffNotification } from "./notification-access";

describe("canViewTimeOffNotification", () => {
  it("allows Time Off Admin to read any request notification", () => {
    expect(canViewTimeOffNotification(["timeoff.admin"], "admin", "employee")).toBe(true);
  });

  it("allows Time Off User only for their own request", () => {
    expect(canViewTimeOffNotification(["timeoff.user"], "employee", "employee")).toBe(true);
    expect(canViewTimeOffNotification(["timeoff.user"], "manager", "employee")).toBe(false);
  });

  it("redacts after the permission is removed", () => {
    expect(canViewTimeOffNotification([], "employee", "employee")).toBe(false);
  });
});
