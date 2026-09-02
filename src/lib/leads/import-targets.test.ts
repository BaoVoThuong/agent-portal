import { describe, expect, it } from "vitest";
import { buildLeadImportTargets } from "./import-targets";
import type { TableColumn } from "@/lib/table-config/types";

const col = (over: Partial<TableColumn>): TableColumn =>
  ({
    id: "id",
    scope: "lead",
    key: "x",
    label: "X",
    type: "text",
    is_system: true,
    position: 1,
    pinned: false,
    hidden_default: false,
    show_in_detail: true,
    required: false,
    archived_at: null,
    ...over,
  }) as TableColumn;

describe("buildLeadImportTargets", () => {
  it("nhận ba trường hệ thống mà file cấp được", () => {
    const out = buildLeadImportTargets([
      col({ key: "name", label: "Name" }),
      col({ key: "phone", label: "Phone" }),
      col({ key: "email", label: "Email" }),
    ]);
    expect(out.map((t) => t.key)).toEqual(["name", "phone", "email"]);
  });

  it("phone là cột bắt buộc duy nhất", () => {
    const out = buildLeadImportTargets([
      col({ key: "name" }),
      col({ key: "phone" }),
      col({ key: "email" }),
    ]);
    expect(out.find((t) => t.key === "phone")?.required).toBe(true);
    expect(out.find((t) => t.key === "name")?.required).toBe(false);
  });

  it("LOẠI cột do hệ thống tự sinh", () => {
    // Cho map `attempts` là để một file Excel nói dối về số lần đã gọi — con số
    // đó do việc ghi tương tác cộng lên, không phải do ai gõ vào.
    const out = buildLeadImportTargets([
      col({ key: "phone" }),
      col({ key: "attempts", label: "Attempts", type: "number" }),
      col({ key: "lastContact", label: "Last contact", type: "date" }),
      col({ key: "interactionHistory" }),
      col({ key: "createdAt" }),
      col({ key: "key" }),
    ]);
    expect(out.map((t) => t.key)).toEqual(["phone"]);
  });

  it("LOẠI cột đã chọn một lần cho cả file", () => {
    const out = buildLeadImportTargets([
      col({ key: "phone" }),
      col({ key: "product" }),
      col({ key: "event" }),
      col({ key: "assignee" }),
      col({ key: "status" }),
    ]);
    expect(out.map((t) => t.key)).toEqual(["phone"]);
  });

  it("nhận mọi cột custom chưa archive", () => {
    const out = buildLeadImportTargets([
      col({ key: "phone" }),
      col({ key: "secondary_phone", label: "Secondary Phone", is_system: false }),
      col({ key: "cu", label: "Cũ", is_system: false, archived_at: "2026-01-01" }),
    ]);
    expect(out.map((t) => t.key)).toEqual(["phone", "secondary_phone"]);
    expect(out.find((t) => t.key === "secondary_phone")?.isCustom).toBe(true);
  });

  it("giữ nhãn admin đặt, không tự chế nhãn", () => {
    // Admin đổi "Phone" thành "Mobile number" thì bảng map phải gọi đúng tên đó.
    const out = buildLeadImportTargets([col({ key: "phone", label: "Mobile number" })]);
    expect(out[0].label).toBe("Mobile number");
  });

  it("phone luôn có mặt kể cả khi config thiếu", () => {
    // Không có phone thì không import được dòng nào; thà hiện ô trống bắt chọn
    // còn hơn một bảng map thiếu mất trường bắt buộc.
    const out = buildLeadImportTargets([col({ key: "name" })]);
    expect(out.some((t) => t.key === "phone" && t.required)).toBe(true);
  });
});
