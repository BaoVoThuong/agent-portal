import { describe, expect, it } from "vitest";
import type { TableColumn } from "@/lib/table-config/types";
import {
  toggleHiddenLeadListColumn,
  visibleLeadListColumns,
} from "./list-column-visibility";

function column(
  key: string,
  overrides: Partial<TableColumn> = {},
): TableColumn {
  return {
    id: key,
    scope: "lead",
    key,
    label: key,
    type: "text",
    is_system: true,
    position: 10,
    pinned: false,
    hidden_default: false,
    show_in_detail: false,
    required: false,
    archived_at: null,
    ...overrides,
  };
}

describe("lead list column visibility", () => {
  it("keeps Key and Name visible even if an old saved layout marked them hidden", () => {
    const columns = [column("key", { pinned: true }), column("name", { pinned: true }), column("email")];
    const visible = visibleLeadListColumns(columns, new Set(["key", "name", "email"]));

    expect(visible.map((item) => item.key)).toEqual(["key", "name"]);
  });

  it("applies personal hiding only after global and pinned visibility rules", () => {
    const columns = [
      column("key", { pinned: true }),
      column("name", { pinned: true }),
      column("phone"),
      column("assignee", { pinned: true }),
      column("createdAt", { hidden_default: true }),
    ];

    const visible = visibleLeadListColumns(columns, new Set(["phone", "assignee"]));

    expect(visible.map((item) => item.key)).toEqual(["key", "name", "assignee"]);
  });

  it("will not toggle the locked identity columns", () => {
    expect([...toggleHiddenLeadListColumn(new Set(), "name")]).toEqual([]);
    expect([...toggleHiddenLeadListColumn(new Set(["phone"]), "phone")]).toEqual([]);
    expect([...toggleHiddenLeadListColumn(new Set(), "phone")]).toEqual(["phone"]);
  });
});
