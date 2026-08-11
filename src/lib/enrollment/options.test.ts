import { describe, expect, it } from "vitest";
import {
  assertEnrollmentOptionSet,
  type EnrollmentOptionData,
} from "./options";
import type { EnrollmentOption } from "./types";

function option(overrides: Partial<EnrollmentOption> = {}): EnrollmentOption {
  return {
    id: "active-stage",
    set_id: "stage-set",
    set_key: "stage",
    label: "1 - Need quote",
    color: null,
    position: 10,
    is_terminal: false,
    triggers_qc: false,
    archived_at: null,
    ...overrides,
  };
}

function snapshot(options: EnrollmentOption[]): Pick<EnrollmentOptionData, "optionsById"> {
  return { optionsById: new Map(options.map((item) => [item.id, item])) };
}

describe("assertEnrollmentOptionSet snapshot validation", () => {
  it("accepts an active option without another database fetch", async () => {
    const active = option();
    await expect(
      assertEnrollmentOptionSet(
        active.id,
        "stage",
        "aca",
        snapshot([active])
      )
    ).resolves.toEqual(active);
  });

  it("rejects a valid option from the wrong set", async () => {
    const carrier = option({ id: "carrier", set_key: "carrier", label: "Carrier" });
    await expect(
      assertEnrollmentOptionSet(
        carrier.id,
        "stage",
        "aca",
        snapshot([carrier])
      )
    ).rejects.toThrow("Invalid Stage option.");
  });

  it("rejects archived options even when they remain in the snapshot map", async () => {
    const archived = option({ id: "archived", archived_at: "2026-08-11T00:00:00.000Z" });
    await expect(
      assertEnrollmentOptionSet(
        archived.id,
        "stage",
        "aca",
        snapshot([archived])
      )
    ).rejects.toThrow("Invalid Stage option.");
  });

  it("rejects an option absent from this program snapshot", async () => {
    await expect(
      assertEnrollmentOptionSet(
        "medicare-only-option",
        "stage",
        "aca",
        snapshot([])
      )
    ).rejects.toThrow("Invalid Stage option.");
  });
});
