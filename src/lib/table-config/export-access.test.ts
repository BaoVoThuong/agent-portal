import { describe, expect, it } from "vitest";
import { canActorExportImport } from "./export-access";

describe("canActorExportImport", () => {
  it("allows managers only", async () => {
    await expect(
      canActorExportImport({
        email: "manager@example.com",
        isManager: true,
        isWorker: true,
      })
    ).resolves.toBe(true);
    await expect(
      canActorExportImport({
        email: "worker@example.com",
        isManager: false,
        isWorker: true,
      })
    ).resolves.toBe(false);
  });
});
