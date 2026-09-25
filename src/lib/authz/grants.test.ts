import { describe, expect, it } from "vitest";
import {
  decodeGrant,
  encodeGrant,
  grantedScopes,
  hasGrant,
  normalizeGrants,
  scopeMatches,
} from "./grants";

describe("encode/decode grant", () => {
  it("mã hoá action:scope và giải mã lại", () => {
    expect(encodeGrant({ action: "task.read", scope: "assigned" })).toBe("task.read:assigned");
    expect(decodeGrant("task.read:assigned")).toEqual({ action: "task.read", scope: "assigned" });
    expect(decodeGrant("task.export:*")).toEqual({ action: "task.export", scope: "*" });
  });

  it("từ chối action lạ, scope không được phép, chuỗi hỏng", () => {
    expect(decodeGrant("task.nope:all")).toBeNull();
    expect(decodeGrant("task.export:all")).toBeNull();
    expect(decodeGrant("task.read:own")).toBeNull();
    expect(decodeGrant("task.read")).toBeNull();
    expect(decodeGrant("task.read:")).toBeNull();
  });

  it("normalizeGrants bỏ rác, khử trùng, sắp xếp", () => {
    expect(
      normalizeGrants(["task.read:all", "bogus", "task.read:all", "lead.read:assigned"])
    ).toEqual(["lead.read:assigned", "task.read:all"]);
  });
});

describe("hasGrant / grantedScopes", () => {
  const grants = ["task.read:assigned", "task.read:shared_queue", "task.export:*"];

  it("không truyền scope = có ở bất kỳ scope nào", () => {
    expect(hasGrant(grants, "task.read")).toBe(true);
    expect(hasGrant(grants, "task.assign")).toBe(false);
  });

  it("truyền scope = đúng scope đó, `all` không tự bao scope hẹp", () => {
    expect(hasGrant(grants, "task.read", "assigned")).toBe(true);
    expect(hasGrant(grants, "task.read", "all")).toBe(false);
    expect(hasGrant(["task.read:all"], "task.read", "assigned")).toBe(false);
  });

  it("tiền tố action không bị nhầm với action dài hơn", () => {
    expect(hasGrant(["task.read.extra:all"], "task.read")).toBe(false);
  });

  it("grantedScopes liệt kê đúng", () => {
    expect(grantedScopes(grants, "task.read").sort()).toEqual(["assigned", "shared_queue"]);
  });
});

describe("scopeMatches", () => {
  it("scope all hoặc * luôn khớp", () => {
    expect(scopeMatches(["task.assign:all"], "task.assign")).toBe(true);
    expect(scopeMatches(["task.export:*"], "task.export")).toBe(true);
  });

  it("scope quan hệ chỉ khớp khi quan hệ đúng", () => {
    const grants = ["task.assign:agent_owned"];
    expect(scopeMatches(grants, "task.assign", { agent_owned: true })).toBe(true);
    expect(scopeMatches(grants, "task.assign", { assistant_for_agent: true })).toBe(false);
    expect(scopeMatches(grants, "task.assign", {})).toBe(false);
  });

  it("không có grant thì không khớp dù quan hệ đúng", () => {
    expect(scopeMatches([], "task.assign", { agent_owned: true })).toBe(false);
  });
});
