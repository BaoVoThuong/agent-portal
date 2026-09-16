import { describe, expect, it } from "vitest";
import {
  PROVIDER_LIST_LOCKED_COLUMN_KEYS,
  initialHiddenProviderColumnKeys,
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
  // Đổi luật 17/09/2026: `hidden_default` chỉ là giá trị khởi đầu. Bảng này có
  // nhiều cột thưa dữ liệu nên mặc định ẩn; bắt người dùng nhờ admin mới xem
  // được là sai với một lựa chọn thuần cá nhân.
  it("cột hidden_default vẫn hiện được khi người dùng bỏ tick ẩn", () => {
    const columns = [column("city"), column("date", { hidden_default: true })];
    expect(visibleProviderListColumns(columns, new Set()).map((c) => c.key)).toEqual([
      "city",
      "date",
    ]);
  });

  it("mới mở bảng thì cột hidden_default nằm sẵn trong tập ẩn", () => {
    const columns = [
      column("city"),
      column("date", { hidden_default: true }),
      column("npi", { hidden_default: true, pinned: true }),
      column("doctors", { hidden_default: true }),
    ];
    const initial = initialHiddenProviderColumnKeys(columns);
    expect([...initial]).toEqual(["date"]);
    // Cột ghim và cột định danh không bao giờ bị nhét vào tập ẩn.
    expect(visibleProviderListColumns(columns, initial).map((c) => c.key)).toEqual([
      "city",
      "npi",
      "doctors",
    ]);
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
