import { describe, expect, it } from "vitest";
import { canExportImport } from "./permissions";

describe("canExportImport", () => {
  it("allows managers and non-assistant workers", () => {
    expect(canExportImport({ isManager: true, isWorker: true, isAssistant: true }))
      .toBe(true);
    expect(canExportImport({ isManager: false, isWorker: true, isAssistant: false }))
      .toBe(true);
  });

  it("blocks assistants and non-workers", () => {
    expect(canExportImport({ isManager: false, isWorker: true, isAssistant: true }))
      .toBe(false);
    expect(canExportImport({ isManager: false, isWorker: false, isAssistant: false }))
      .toBe(false);
  });
});
