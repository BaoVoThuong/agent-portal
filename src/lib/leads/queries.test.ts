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
    }).ownerEmails).toEqual(["cs@x.com"]);
  });

  // An Assistant works their agent's leads, so the scope is a list, not one
  // email. The caller resolves it from agent_members; the filter only applies it.
  it("widens an agent to the agents they assist", () => {
    expect(
      buildLeadListFilter(agent, { product: "pc" }, ["cs@x.com", "boss@x.com"])
        .ownerEmails
    ).toEqual(["cs@x.com", "boss@x.com"]);
  });

  // Narrower, never wider: a caller that has not resolved membership still
  // gets the old single-owner scope rather than an unfiltered queue.
  it("falls back to the actor's own email when no scope is passed", () => {
    expect(buildLeadListFilter(agent, { product: "pc" }).ownerEmails).toEqual([
      "cs@x.com",
    ]);
  });

  it("lets a manager filter by any agent", () => {
    expect(buildLeadListFilter(manager, {
      product: "pc",
      assigned_to: "someone@else.com",
    }).ownerEmails).toEqual(["someone@else.com"]);
  });

  it("leaves a manager unfiltered when no agent is named", () => {
    expect(buildLeadListFilter(manager, { product: "pc" }).ownerEmails).toBeNull();
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

  // Superseded by the "product filter" block below: Event Leads is one list,
  // so an unrecognised product means "no filter", not a default product.
  it("treats an unknown product as no filter", () => {
    expect(buildLeadListFilter(manager, { product: "banana" }).product).toBeNull();
  });

  it("accepts a supported alert filter and ignores an unknown one", () => {
    expect(buildLeadListFilter(manager, { product: "pc", alert: "stale" }).alert).toBe("stale");
    expect(buildLeadListFilter(manager, { product: "pc", alert: "not-an-alert" }).alert).toBeNull();
  });
});

describe("product filter", () => {
  const manager = buildLeadActor(["lead.manage"], "mgr@x.com");

  // Event Leads is one list. A missing product means "all of them", not a
  // default — reading it as "pc" made the merged screen show nothing at all,
  // because every lead in the pilot data was Health.
  it("means every product when none is given", () => {
    expect(buildLeadListFilter(manager, {}).product).toBeNull();
    expect(buildLeadListFilter(manager, { product: "" }).product).toBeNull();
    expect(buildLeadListFilter(manager, { product: "banana" }).product).toBeNull();
  });

  it("narrows to the named product", () => {
    expect(buildLeadListFilter(manager, { product: "pc" }).product).toBe("pc");
    expect(buildLeadListFilter(manager, { product: "health" }).product).toBe("health");
  });
});
