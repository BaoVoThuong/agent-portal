import { describe, expect, it } from "vitest";
import { canActorExport } from "./export-access";

describe("canActorExport", () => {
  it("allows managers only", async () => {
    await expect(
      canActorExport({
        email: "manager@example.com",
        isManager: true,
        isWorker: true,
      })
    ).resolves.toBe(true);
    await expect(
      canActorExport({
        email: "worker@example.com",
        isManager: false,
        isWorker: true,
      })
    ).resolves.toBe(false);
  });
});
