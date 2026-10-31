import { describe, expect, it } from "vitest";
import {
  canAddProviders,
  canExportProviders,
  canImportProviders,
  canManageProviders,
  canReviewProviderBacklog,
  canViewProviders,
  providerWritesGoLive,
} from "./access";

const FINDER = "automation.provider_finder";
const MANAGE = "automation.provider_manage";

describe("provider list access", () => {
  // Backlog (2026-10-26): a Finder-only user adds and imports, but only into
  // the Backlog; they cannot review it, delete addresses or export.
  it("lets a Finder-only user add and import into the Backlog only", () => {
    const permissions = [FINDER];
    expect(canAddProviders(permissions)).toBe(true);
    expect(canImportProviders(permissions)).toBe(true);
    expect(providerWritesGoLive(permissions)).toBe(false);
    expect(canReviewProviderBacklog(permissions)).toBe(false);
    expect(canManageProviders(permissions)).toBe(false);
    expect(canExportProviders(permissions)).toBe(false);
  });

  it("lets Manage write straight into the list, review the Backlog and export", () => {
    const permissions = [FINDER, MANAGE];
    expect(canManageProviders(permissions)).toBe(true);
    expect(canAddProviders(permissions)).toBe(true);
    expect(canImportProviders(permissions)).toBe(true);
    expect(providerWritesGoLive(permissions)).toBe(true);
    expect(canReviewProviderBacklog(permissions)).toBe(true);
    expect(canExportProviders(permissions)).toBe(true);
  });

  // Manage covers Work (2026-10-31), like task.manage / task.work: a role
  // with only Manage ticked opens the list and does everything.
  it("lets Manage alone do everything, Finder included", () => {
    const permissions = [MANAGE];
    expect(canViewProviders(permissions)).toBe(true);
    expect(canManageProviders(permissions)).toBe(true);
    expect(canAddProviders(permissions)).toBe(true);
    expect(canImportProviders(permissions)).toBe(true);
    expect(providerWritesGoLive(permissions)).toBe(true);
    expect(canReviewProviderBacklog(permissions)).toBe(true);
    expect(canExportProviders(permissions)).toBe(true);
  });

  it("opens nothing without Finder or Manage", () => {
    expect(canViewProviders(["task.export", "task.import"])).toBe(false);
    expect(canAddProviders(["task.manage"])).toBe(false);
  });

  // No cross-module grant (2026-10-09): Task export / import open nothing in
  // the Provider List; only Provider List - Manage does.
  it("ignores task.export and task.import", () => {
    expect(canExportProviders([FINDER, "task.export"])).toBe(false);
    expect(providerWritesGoLive([FINDER, "task.import"])).toBe(false);
    expect(canManageProviders([FINDER, "task.export", "task.import"])).toBe(false);
  });

  it("treats missing permissions as no access", () => {
    expect(canManageProviders(undefined)).toBe(false);
    expect(canAddProviders(undefined)).toBe(false);
    expect(canImportProviders(undefined)).toBe(false);
    expect(canExportProviders(undefined)).toBe(false);
    expect(canReviewProviderBacklog(undefined)).toBe(false);
  });
});
