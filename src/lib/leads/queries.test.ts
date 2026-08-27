import { describe, expect, it } from "vitest";
import { buildLeadActor } from "./access";
import { buildLeadListFilter, LEAD_PAGE_SIZE } from "./queries";

const manager = buildLeadActor(["lead.manage"], "mgr@x.com");
const agent = buildLeadActor(["lead.work"], "cs@x.com");

describe("buildLeadListFilter", () => {
  it("pins an agent to their own leads whatever they ask for", () => {
    expect(buildLeadListFilter(agent, {
      product: "pc",
      assigned_to: "someone@else.com",
    }).assignedTo).toBe("cs@x.com");
  });

  it("lets a manager filter by any agent", () => {
    expect(buildLeadListFilter(manager, {
      product: "pc",
      assigned_to: "someone@else.com",
    }).assignedTo).toBe("someone@else.com");
  });

  it("leaves a manager unfiltered when no agent is named", () => {
    expect(buildLeadListFilter(manager, { product: "pc" }).assignedTo).toBeNull();
  });

  it("defaults to page one", () => {
    const filter = buildLeadListFilter(manager, { product: "pc" });
    expect(filter.limit).toBe(LEAD_PAGE_SIZE);
    expect(filter.offset).toBe(0);
  });

  it("clamps a hostile page size instead of trusting it", () => {
    expect(buildLeadListFilter(manager, { product: "pc", limit: "99999" }).limit)
      .toBe(LEAD_PAGE_SIZE);
    expect(buildLeadListFilter(manager, { product: "pc", limit: "-5" }).limit)
      .toBe(LEAD_PAGE_SIZE);
    expect(buildLeadListFilter(manager, { product: "pc", limit: "10" }).limit)
      .toBe(10);
  });

  it("falls back to pc for an unknown product", () => {
    expect(buildLeadListFilter(manager, { product: "banana" }).product).toBe("pc");
  });
});
