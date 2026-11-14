import { describe, expect, it } from "vitest";
import { parseAppointmentDetails, parseNewAppointment, parseStateSelection } from "./validate";

const AGENT = "11111111-1111-4111-8111-111111111111";
const OPTION = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ctx = { optionIds: new Set([OPTION]), agentIds: new Set([AGENT]) };
const base = { status: "active" };

describe("parseAppointmentDetails", () => {
  it("normalizes an empty note and date", () => {
    expect(parseAppointmentDetails({ ...base, note: "  ", appointedOn: "" }, ctx)).toEqual({
      ok: true,
      value: { status: "active", appointedOn: null, note: null, agents: [] },
    });
  });

  it("rejects a bad status, impossible dates and unknown agents", () => {
    expect(parseAppointmentDetails({ status: "expired" }, ctx).ok).toBe(false);
    expect(parseAppointmentDetails({ ...base, appointedOn: "2026-02-30" }, ctx).ok).toBe(false);
    expect(parseAppointmentDetails({ ...base, agents: [{ accountId: OTHER }] }, ctx).ok).toBe(false);
  });

  it("keeps each agent once with its own date", () => {
    const r = parseAppointmentDetails(
      { ...base, agents: [{ accountId: AGENT, appointedOn: "2026-01-05" }, { accountId: AGENT }] },
      ctx,
    );
    expect(r.ok && r.value.agents).toEqual([{ accountId: AGENT, appointedOn: "2026-01-05" }]);
  });
});

describe("parseNewAppointment", () => {
  it("needs a real state and an active carrier option", () => {
    const ok = parseNewAppointment({ ...base, stateCode: "tx", optionId: OPTION }, ctx);
    expect(ok.ok && ok.value).toMatchObject({ stateCode: "TX", optionId: OPTION, status: "active" });
    expect(parseNewAppointment({ ...base, stateCode: "PR", optionId: OPTION }, ctx).ok).toBe(false);
    expect(parseNewAppointment({ ...base, stateCode: "TX", optionId: OTHER }, ctx).ok).toBe(false);
  });
});

describe("parseStateSelection", () => {
  const byColumn = new Map([
    ["col-a", new Set([OPTION])],
    ["col-b", new Set([OTHER])],
  ]);

  it("accepts carriers of the right product, once each", () => {
    expect(parseStateSelection({ selection: { "col-a": [OPTION, OPTION], "col-b": [] } }, byColumn)).toEqual({
      ok: true,
      value: { "col-a": [OPTION], "col-b": [] },
    });
  });

  it("rejects unknown products and carriers from another product", () => {
    expect(parseStateSelection({ selection: { "col-x": [] } }, byColumn).ok).toBe(false);
    expect(parseStateSelection({ selection: { "col-a": [OTHER] } }, byColumn).ok).toBe(false);
    expect(parseStateSelection({}, byColumn).ok).toBe(false);
  });
});
