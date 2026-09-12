import { describe, expect, it } from "vitest";
import {
  buildOrgForest,
  canAssignManager,
  countReports,
  countDirectReports,
  descendantIds,
  flattenForest,
  type OrgPerson,
} from "@/lib/org-chart/tree";

function person(id: string, managerId: string | null = null, name = id): OrgPerson {
  return {
    id,
    name,
    email: `${id}@example.com`,
    manager_id: managerId,
    is_active: true,
  };
}

// boss
//  ├─ lead
//  │   ├─ dev
//  │   └─ qa
//  └─ ops
const org = [
  person("boss"),
  person("lead", "boss"),
  person("dev", "lead"),
  person("qa", "lead"),
  person("ops", "boss"),
];

describe("descendantIds", () => {
  it("collects every level below a person, not just direct reports", () => {
    expect(descendantIds(org, "boss")).toEqual(
      new Set(["lead", "dev", "qa", "ops"]),
    );
  });

  it("returns nothing for a leaf", () => {
    expect(descendantIds(org, "dev")).toEqual(new Set());
  });

  // Trigger dưới database chặn vòng, nhưng hàm này vẫn phải dừng nếu gặp dữ
  // liệu hỏng — nếu không thì một dòng lỗi trong bảng làm treo cả trang.
  it("terminates on data that already contains a cycle", () => {
    const broken = [person("a", "b"), person("b", "a")];
    expect(descendantIds(broken, "a")).toEqual(new Set(["a", "b"]));
  });
});

describe("canAssignManager", () => {
  it("allows an ordinary move", () => {
    expect(canAssignManager(org, "dev", "ops")).toEqual({ ok: true });
  });

  it("allows detaching someone to the top", () => {
    expect(canAssignManager(org, "lead", null)).toEqual({ ok: true });
  });

  it("refuses making someone their own manager", () => {
    expect(canAssignManager(org, "lead", "lead")).toEqual({
      ok: false,
      reason: "self",
    });
  });

  // Cái bẫy thật của kéo thả: thả sếp vào ô của cấp dưới mình.
  it("refuses a move that would close a cycle", () => {
    expect(canAssignManager(org, "boss", "dev")).toEqual({
      ok: false,
      reason: "cycle",
    });
  });

  it("refuses unknown accounts on either side", () => {
    expect(canAssignManager(org, "ghost", "boss")).toEqual({
      ok: false,
      reason: "unknown_person",
    });
    expect(canAssignManager(org, "boss", "ghost")).toEqual({
      ok: false,
      reason: "unknown_person",
    });
  });

  it("refuses assigning an inactive account as manager", () => {
    const withInactive = [...org, { ...person("former-manager"), is_active: false }];
    expect(canAssignManager(withInactive, "dev", "former-manager")).toEqual({
      ok: false,
      reason: "inactive_manager",
    });
  });
});

describe("buildOrgForest", () => {
  it("nests reports under their manager and sorts siblings by name", () => {
    const { roots } = buildOrgForest(org);
    expect(roots.map((node) => node.person.id)).toEqual(["boss"]);
    expect(roots[0].reports.map((node) => node.person.id)).toEqual(["lead", "ops"]);
    expect(roots[0].reports[0].reports.map((node) => node.person.id)).toEqual([
      "dev",
      "qa",
    ]);
  });

  it("records depth so the view can indent without recomputing", () => {
    const depths = new Map(
      flattenForest(buildOrgForest(org).roots).map((node) => [node.person.id, node.depth]),
    );
    expect(depths.get("boss")).toBe(0);
    expect(depths.get("lead")).toBe(1);
    expect(depths.get("dev")).toBe(2);
  });

  // Người có manager đã rời khỏi danh sách phải NỔI LÊN thành gốc. Bỏ qua vế
  // này là họ biến mất khỏi sơ đồ mà không ai hay.
  it("promotes someone whose manager is no longer in the list", () => {
    const { roots } = buildOrgForest([person("kept", "gone-account")]);
    expect(roots.map((node) => node.person.id)).toEqual(["kept"]);
  });

  it("names the actual cycle and still renders its attached reports", () => {
    const { roots, orphanedByCycle } = buildOrgForest([
      person("boss"),
      person("a", "b"),
      person("b", "a"),
      person("report", "a"),
    ]);
    expect(roots.map((node) => node.person.id)).toEqual(["a", "boss"]);
    expect(orphanedByCycle.map((p) => p.id).sort()).toEqual(["a", "b"]);
    expect(flattenForest(roots).map((node) => node.person.id)).toContain("report");
  });

  it("reports nobody as orphaned for healthy data", () => {
    expect(buildOrgForest(org).orphanedByCycle).toEqual([]);
  });
});

describe("countReports", () => {
  it("counts every level, not just direct reports", () => {
    const { roots } = buildOrgForest(org);
    expect(countReports(roots[0])).toBe(4);
    expect(countReports(roots[0].reports[0])).toBe(2);
  });

  it("counts direct reports separately from the whole reporting line", () => {
    const { roots } = buildOrgForest(org);
    expect(countDirectReports(roots[0])).toBe(2);
    expect(countDirectReports(roots[0].reports[0])).toBe(2);
  });
});
