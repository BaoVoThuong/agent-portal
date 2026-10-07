import { describe, expect, it } from "vitest";
import {
  canExportProviders,
  canImportProviders,
  canManageProviders,
} from "./access";

const FINDER = "automation.provider_finder";
const MANAGE = "automation.provider_manage";

describe("provider list access", () => {
  it("lets a Finder-only user view and edit but not manage, export or import", () => {
    const permissions = [FINDER];
    expect(canManageProviders(permissions)).toBe(false);
    expect(canExportProviders(permissions)).toBe(false);
    expect(canImportProviders(permissions)).toBe(false);
  });

  it("lets Manage add / delete addresses and export / import the Provider List", () => {
    const permissions = [FINDER, MANAGE];
    expect(canManageProviders(permissions)).toBe(true);
    expect(canExportProviders(permissions)).toBe(true);
    expect(canImportProviders(permissions)).toBe(true);
  });

  it("does not let Manage work without Provider Finder", () => {
    const permissions = [MANAGE, "task.export", "task.import"];
    expect(canManageProviders(permissions)).toBe(false);
    expect(canExportProviders(permissions)).toBe(false);
    expect(canImportProviders(permissions)).toBe(false);
  });

  it("keeps task.export and task.import working for Finder users", () => {
    expect(canExportProviders([FINDER, "task.export"])).toBe(true);
    expect(canImportProviders([FINDER, "task.export"])).toBe(false);
    expect(canImportProviders([FINDER, "task.import"])).toBe(true);
    expect(canManageProviders([FINDER, "task.export", "task.import"])).toBe(false);
  });

  it("treats missing permissions as no access", () => {
    expect(canManageProviders(undefined)).toBe(false);
    expect(canExportProviders(undefined)).toBe(false);
    expect(canImportProviders(undefined)).toBe(false);
  });
});
