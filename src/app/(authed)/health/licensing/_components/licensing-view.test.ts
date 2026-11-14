import { describe, expect, it } from "vitest";
import type { LicensingAppointment, LicensingProduct } from "@/lib/health-licensing/types";
import {
  activeFilterCount,
  carrierCounts,
  DEFAULT_FILTERS,
  stateFills,
  tableStates,
  visibleAppointments,
  type LicensingFilters,
} from "./licensing-view";

const names = { TX: "Texas", NV: "Nevada", GA: "Georgia", OR: "Oregon", FL: "Florida" };
// "dental" không có trong danh sách sản phẩm = cột đã archive ở Table Configuration.
const products: LicensingProduct[] = [
  { columnId: "obamacare", key: "obamacare", label: "Obamacare", position: 10 },
  { columnId: "uhc", key: "uhc", label: "UHC", position: 20 },
];
let n = 0;
const appt = (
  stateCode: string,
  carrier: string,
  status: LicensingAppointment["status"],
  columnId = "obamacare",
  agentIds: string[] = [],
): LicensingAppointment => ({
  id: String(++n),
  stateCode,
  optionId: `${columnId}:${carrier}`,
  columnId,
  carrier,
  color: null,
  optionPosition: 0,
  status,
  appointedOn: null,
  note: null,
  agents: agentIds.map((accountId) => ({ accountId, name: accountId, appointedOn: null })),
  createdAt: "2026-11-14T00:00:00Z",
  createdByName: null,
  updatedAt: "2026-11-14T00:00:00Z",
  updatedByName: null,
});

const data = [
  appt("TX", "Ambetter", "active", "obamacare", ["a1"]),
  appt("TX", "UHC", "active", "uhc"),
  appt("NV", "Humana", "pending"),
  appt("GA", "Aetna", "terminated"),
  appt("OR", "Delta", "active", "dental"),
];
const rows = (f: LicensingFilters) => tableStates(visibleAppointments(data, products, f, names), products, f, names);

describe("licensing view", () => {
  it("colors active over pending, never terminated or hidden columns", () => {
    const fills = stateFills(data, products, DEFAULT_FILTERS, names);
    expect(fills.get("TX")).toEqual({ fill: "active", dim: false });
    expect(fills.get("NV")).toEqual({ fill: "pending", dim: false });
    expect(fills.has("GA")).toBe(false);
    expect(fills.has("OR")).toBe(false);
  });

  it("dims states with nothing matching the search, carrier or agent filter", () => {
    const search = stateFills(data, products, { ...DEFAULT_FILTERS, query: "amb" }, names);
    expect(search.get("TX")).toEqual({ fill: "active", dim: false });
    expect(search.get("NV")).toEqual({ fill: "none", dim: true });
    const byAgent = stateFills(data, products, { ...DEFAULT_FILTERS, agents: ["a1"] }, names);
    expect(byAgent.get("TX")?.dim).toBe(false);
    expect(byAgent.get("NV")?.dim).toBe(true);
  });

  it("lists table states by every filter", () => {
    expect(rows(DEFAULT_FILTERS)).toEqual(["NV", "TX"]);
    expect(rows({ ...DEFAULT_FILTERS, statuses: [] })).toEqual(["GA", "NV", "TX"]);
    expect(rows({ ...DEFAULT_FILTERS, carriers: ["Humana"] })).toEqual(["NV"]);
    expect(rows({ ...DEFAULT_FILTERS, products: ["uhc"] })).toEqual(["TX"]);
    expect(rows({ ...DEFAULT_FILTERS, states: ["TX", "GA"] })).toEqual(["TX"]);
    expect(rows({ ...DEFAULT_FILTERS, query: "nevada" })).toEqual(["NV"]);
    expect(rows({ ...DEFAULT_FILTERS, query: "tx" })).toEqual(["TX"]);
  });

  it("counts states per carrier, ignoring the carrier filter itself", () => {
    const extra = [...data, appt("FL", "Ambetter", "active")];
    expect(carrierCounts(extra, products, { ...DEFAULT_FILTERS, carriers: ["Humana"] }, names)).toEqual([
      { carrier: "Ambetter", states: 2 },
      { carrier: "Humana", states: 1 },
      { carrier: "UHC", states: 1 },
    ]);
  });

  it("counts filters that differ from the default", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, statuses: ["pending", "active"] })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, statuses: ["active"], carriers: ["UHC"] })).toBe(2);
  });
});
