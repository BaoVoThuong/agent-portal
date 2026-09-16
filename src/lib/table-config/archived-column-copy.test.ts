import { describe, expect, it } from "vitest";
import {
  describeArchivedColumnRestore,
  describeArchivedColumnTypeMismatch,
  type ArchivedColumnRestoreFacts,
} from "./archived-column-copy";

function facts(overrides: Partial<ArchivedColumnRestoreFacts> = {}): ArchivedColumnRestoreFacts {
  return {
    label: "Year",
    type: "text",
    archivedAt: "2026-08-16T02:40:16.456+00:00",
    optionCount: 0,
    layoutCount: 0,
    ...overrides,
  };
}

describe("describeArchivedColumnRestore", () => {
  // Đúng trường hợp có thật: cột Year của Health ACA, text, không option, và
  // scope đó không ai lưu layout. Câu chữ cũ hứa "options and settings" rồi doạ
  // reset layout — cả hai đều sai với trường hợp này.
  it("nói đúng cột rỗng: không hứa option, không doạ reset layout", () => {
    expect(describeArchivedColumnRestore(facts())).toBe(
      '"Year" is an archived text column, archived on Aug 16, 2026. ' +
        "Values already saved under this column become visible again. " +
        "No saved table layouts are affected."
    );
  });

  it("chỉ nhắc option khi cột là dropdown", () => {
    expect(describeArchivedColumnRestore(facts({ type: "dropdown", optionCount: 3 }))).toContain(
      "Restoring brings back 3 saved options."
    );
    expect(describeArchivedColumnRestore(facts({ type: "dropdown", optionCount: 0 }))).toContain(
      "It has no saved options left."
    );
    expect(describeArchivedColumnRestore(facts({ optionCount: 3 }))).not.toContain("option");
  });

  it("nêu đúng số layout sẽ bị xoá", () => {
    expect(describeArchivedColumnRestore(facts({ layoutCount: 1 }))).toContain(
      "1 saved table layout will be reset"
    );
    expect(describeArchivedColumnRestore(facts({ layoutCount: 4 }))).toContain(
      "4 saved table layouts will be reset"
    );
  });

  it("bỏ mốc thời gian khi dòng cũ không ghi lại, thay vì in 'Invalid Date'", () => {
    expect(describeArchivedColumnRestore(facts({ archivedAt: null }))).toContain(
      '"Year" is an archived text column. '
    );
    expect(describeArchivedColumnRestore(facts({ archivedAt: "không-phải-ngày" }))).not.toContain(
      "Invalid"
    );
  });
});

describe("describeArchivedColumnTypeMismatch", () => {
  // Trước đây nhánh này trả lỗi thô và người dùng tắc hẳn: không khôi phục được
  // vì sai kiểu, cũng không tạo mới được vì trùng tên.
  it("nêu cả hai lối đi, và nói rõ kiểu sửa được sau khi khôi phục", () => {
    const message = describeArchivedColumnTypeMismatch({ label: "Year", type: "text" }, "dropdown");
    expect(message).toContain("archived text column, not dropdown");
    expect(message).toContain("the type can be changed afterwards");
    expect(message).toContain("create a separate dropdown column");
  });
});
