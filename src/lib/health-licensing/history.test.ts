import { describe, expect, it } from "vitest";
import { describeLicensingEvent, type LicensingEventRow } from "./history";

const ctx = {
  productLabel: (key: string) => ({ obamacare: "Obamacare", uhc: "UHC" })[key] ?? key,
  personName: (id: string) => ({ a1: "Linh Tran", a2: "Hoa Vu", me: "Bao Vo" })[id] ?? null,
};
const row = (patch: Partial<LicensingEventRow>): LicensingEventRow => ({
  id: 1,
  action: "appointment.update",
  state_code: "TX",
  product_key: "obamacare",
  before: null,
  after: null,
  created_at: "2026-11-14T10:00:00Z",
  actor_id: "me",
  ...patch,
});
const snap = (extra: Record<string, unknown> = {}) => ({
  carrier: "Ambetter",
  state_code: "TX",
  product_key: "obamacare",
  status: "active",
  appointed_on: null,
  note: null,
  agents: [],
  ...extra,
});

describe("describeLicensingEvent", () => {
  it("words an edit as the fields that changed", () => {
    const entry = describeLicensingEvent(
      row({
        before: snap({ status: "pending", agents: [{ account_id: "a1" }] }),
        after: snap({ appointed_on: "2026-01-05", note: "SHL only", agents: [{ account_id: "a2" }] }),
      }),
      ctx,
    );
    expect(entry.actorName).toBe("Bao Vo");
    expect(entry.summary).toBe("edited Ambetter · Obamacare · TX");
    expect(entry.carrier).toBe("Ambetter");
    expect(entry.changes).toEqual([
      "Status: Pending → Active",
      "Appointed on: none → Jan 5, 2026",
      "Note: SHL only",
      "Agents: + Hoa Vu, − Linh Tran",
    ]);
  });

  it("words create, delete, import and column changes", () => {
    expect(describeLicensingEvent(row({ action: "appointment.create", after: snap() }), ctx).summary).toBe(
      "added Ambetter · Obamacare · TX",
    );
    expect(describeLicensingEvent(row({ action: "appointment.delete", before: snap() }), ctx).summary).toBe(
      "removed Ambetter · Obamacare · TX",
    );
    const imported = describeLicensingEvent(
      row({ action: "appointment.import", actor_id: null, after: { count: 283, source: "Appointment list.csv" } }),
      ctx,
    );
    expect(imported).toMatchObject({ actorName: null, summary: "imported 283 appointments from Appointment list.csv" });
    const columns = describeLicensingEvent(
      row({
        action: "products.update",
        before: [
          { key: "obamacare", label: "Obamacare", is_active: true },
          { key: "uhc", label: "UHC", is_active: true },
        ] as unknown as Record<string, unknown>,
        after: [
          { key: "uhc", label: "UHC", is_active: false },
          { key: "obamacare", label: "ACA", is_active: true },
          { key: "dental", label: "Dental", is_active: true },
        ] as unknown as Record<string, unknown>,
      }),
      ctx,
    );
    expect(columns.changes).toEqual(["Hid UHC", "Renamed Obamacare to ACA", "Added column Dental", "Changed the column order"]);
  });
});
