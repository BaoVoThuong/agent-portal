import { describe, expect, it } from "vitest";
import {
  PROVIDER_LIST_LOCKED_COLUMN_KEYS,
  toggleHiddenProviderListColumn,
  visibleProviderListColumns,
} from "@/lib/providers/list-columns";
import type { TableColumn } from "@/lib/table-config/types";

function column(key: string, overrides: Partial<TableColumn> = {}): TableColumn {
  return {
    id: `system-provider-${key}`,
    scope: "provider",
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

describe("toggleHiddenProviderListColumn", () => {
  it("ẩn rồi hiện lại một cột thường", () => {
    const hidden = toggleHiddenProviderListColumn(new Set(), "city");
    expect(hidden.has("city")).toBe(true);
    expect(toggleHiddenProviderListColumn(hidden, "city").has("city")).toBe(false);
  });

  it("không ẩn được cột định danh", () => {
    for (const key of PROVIDER_LIST_LOCKED_COLUMN_KEYS) {
      expect(toggleHiddenProviderListColumn(new Set(), key).has(key), key).toBe(false);
    }
  });

  it("không sửa tập hợp đang truyền vào", () => {
    const current = new Set<string>();
    toggleHiddenProviderListColumn(current, "city");
    expect(current.size).toBe(0);
  });
});

describe("visibleProviderListColumns", () => {
  it("cấu hình chung thắng: hidden_default luôn bị loại", () => {
    const columns = [column("city"), column("date", { hidden_default: true })];
    expect(visibleProviderListColumns(columns, new Set()).map((c) => c.key)).toEqual(["city"]);
  });

  it("lựa chọn cá nhân ẩn được cột thường", () => {
    const columns = [column("city"), column("state")];
    expect(
      visibleProviderListColumns(columns, new Set(["state"])).map((c) => c.key)
    ).toEqual(["city"]);
  });

  it("cột định danh và cột admin ghim vẫn ở lại dù bị đánh ẩn", () => {
    const columns = [column("doctors"), column("npi", { pinned: true }), column("city")];
    expect(
      visibleProviderListColumns(columns, new Set(["doctors", "npi", "city"])).map((c) => c.key)
    ).toEqual(["doctors", "npi"]);
  });
});
