import { describe, expect, it } from "vitest";
import { buildOrgTree, countReports, type OrgNode, type OrgPerson } from "./org-tree";

function person(id: string, overrides: Partial<OrgPerson> = {}): OrgPerson {
  return { id, email: `${id}@x.com`, isActive: true, managerId: null, assistedAgentEmails: [], ...overrides };
}

const nameOf = (id: string) => id;

function shape(nodes: OrgNode[]): unknown {
  return nodes.map((node) => (node.children.length ? { [node.id]: shape(node.children) } : node.cycle ? `${node.id}*` : node.id));
}

describe("buildOrgTree", () => {
  it("puts people under their manager and keeps people without one at the top", () => {
    const tree = buildOrgTree(
      [person("dung"), person("ann", { managerId: "dung" }), person("kathy", { managerId: "dung" }), person("khang")],
      nameOf,
    );
    expect(shape(tree)).toEqual([{ dung: ["ann", "kathy"] }, "khang"]);
  });

  it("puts an Assistant under every Agent they support, not under manager_id", () => {
    const tree = buildOrgTree(
      [
        person("phi"),
        person("que"),
        person("boss"),
        person("cheryl", { managerId: "boss", assistedAgentEmails: ["phi@x.com", "QUE@x.com "] }),
      ],
      nameOf,
    );
    expect(shape(tree)).toEqual(["boss", { phi: ["cheryl"] }, { que: ["cheryl"] }]);
  });

  it("does not loop when an Agent's manager is their own Assistant", () => {
    const tree = buildOrgTree(
      [person("agent", { managerId: "asst" }), person("asst", { assistedAgentEmails: ["agent@x.com"] })],
      nameOf,
    );
    expect(tree).toHaveLength(1);
    expect(shape(tree)).toEqual([{ agent: [{ asst: ["agent*"] }] }]);
  });

  it("treats a manager outside the list (or missing) as no manager", () => {
    expect(shape(buildOrgTree([person("ann", { managerId: "gone" })], nameOf))).toEqual(["ann"]);
  });
});

describe("countReports", () => {
  it("counts each person under a node once", () => {
    const [phi] = buildOrgTree(
      [person("phi"), person("a", { assistedAgentEmails: ["phi@x.com"] }), person("b", { managerId: "a" })],
      nameOf,
    );
    expect(countReports(phi)).toBe(2);
  });
});
