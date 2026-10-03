import { describe, expect, it } from "vitest";
import type { TableColumn } from "./types";
import { withoutRetiredLeadColumns } from "./queries";

const column = (key: string): TableColumn => ({
  id: key,
  scope: "lead",
  key,
  label: key,
  type: "text",
  is_system: true,
  position: 0,
  pinned: false,
  hidden_default: false,
  show_in_detail: false,
  required: false,
  created_by_email: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  archived_at: null,
});

describe("withoutRetiredLeadColumns", () => {
  it("hides stale Product rows while the database rollout is pending", () => {
    expect(withoutRetiredLeadColumns("lead", [
      column("name"), column("product"), column("products"),
    ]).map((item) => item.key)).toEqual(["name"]);
  });

  it("leaves other table scopes unchanged", () => {
    const csColumn = { ...column("product"), scope: "cs" as const };
    expect(withoutRetiredLeadColumns("cs", [csColumn])).toEqual([csColumn]);
  });
});
