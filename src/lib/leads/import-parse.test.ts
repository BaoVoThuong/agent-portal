import { describe, expect, it } from "vitest";
import { normalizePhone, parseLeadRows } from "./import-parse";

describe("normalizePhone", () => {
  it("reduces the many ways people write a US number to one", () => {
    expect(normalizePhone("(714) 555-0123")).toBe("7145550123");
    expect(normalizePhone("714.555.0123")).toBe("7145550123");
    expect(normalizePhone("+1 714 555 0123")).toBe("7145550123");
    expect(normalizePhone("1-714-555-0123")).toBe("7145550123");
  });

  it("returns null for anything that cannot be a number", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("N/A")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });

  it("keeps a number Excel turned into a float", () => {
    expect(normalizePhone(7145550123)).toBe("7145550123");
  });
});

describe("parseLeadRows", () => {
  const mapping = { name: ["Name"], phone: ["Cell"], email: ["Email"] };

  it("chỉ đưa cột ĐƯỢC MAP vào custom values", () => {
    const result = parseLeadRows(
      [{ Name: "An Nguyen", Cell: "(714) 555-0123", Email: "an@x.com", Language: "VI" }],
      { ...mapping, language: ["Language"] }
    );
    expect(result.rows).toEqual([{
      // Dòng 1 là tiêu đề, nên dòng dữ liệu đầu tiên là 2 — cùng con số mà
      // `skipped` đang dùng, để hai bên chỉ vào cùng một dòng trong file.
      row: 2,
      full_name: "An Nguyen",
      phone: "7145550123",
      email: "an@x.com",
      custom_values: { language: "VI" },
    }]);
    expect(result.skipped).toEqual([]);
  });

  it("skips a row with no usable phone and says which row", () => {
    const result = parseLeadRows(
      [{ Name: "No Phone", Cell: "N/A", Email: "x@x.com" }],
      mapping
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([{ row: 2, reason: "Missing phone number" }]);
  });

  it("drops a duplicate inside the same file, keeping the first", () => {
    const result = parseLeadRows(
      [
        { Name: "First", Cell: "714-555-0123" },
        { Name: "Second", Cell: "(714) 555 0123" },
      ],
      mapping
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].full_name).toBe("First");
    expect(result.skipped).toEqual([{ row: 3, reason: "Duplicate phone number in this file" }]);
  });

  it("lowercases email so the same person is not two people", () => {
    const result = parseLeadRows(
      [{ Name: "A", Cell: "7145550123", Email: "  An@X.COM " }],
      mapping
    );
    expect(result.rows[0].email).toBe("an@x.com");
  });
});

describe("cột custom", () => {
  it("lấy giá trị từ cột ĐƯỢC MAP, lưu dưới khoá cột đích", () => {
    // Bản trước nhặt theo tên đã slugify — một phỏng đoán. Nay người dùng nói
    // rõ cột nào đi đâu, nên khoá lưu là khoá cột đích chứ không phải slug của
    // tiêu đề file.
    const result = parseLeadRows(
      [{ Name: "A", Cell: "7145550123", "SDT phu": "714-555-9999" }],
      { name: ["Name"], phone: ["Cell"], secondary_phone: ["SDT phu"] }
    );
    expect(result.rows[0].custom_values).toEqual({
      secondary_phone: "714-555-9999",
    });
  });

  it("cột KHÔNG được map thì bị bỏ hẳn", () => {
    // Trước đây `Notes` tự rơi vào custom_values.notes theo tên. Giữ cả hai cơ
    // chế là để chúng cùng quyết một chuyện rồi mâu thuẫn nhau.
    const result = parseLeadRows(
      [{ Name: "A", Cell: "7145550123", Notes: "gọi lại sau" }],
      { name: ["Name"], phone: ["Cell"] }
    );
    expect(result.rows[0].custom_values).toEqual({});
  });

  it("ba trường hệ thống không lọt vào custom values", () => {
    const result = parseLeadRows(
      [{ Name: "A", Cell: "7145550123", Email: "a@x.com" }],
      { name: ["Name"], phone: ["Cell"], email: ["Email"] }
    );
    expect(result.rows[0].custom_values).toEqual({});
  });
});

describe("ghép nhiều cột nguồn", () => {
  it("First Name + Last Name ghép thành một ô Name", () => {
    // Ca người dùng nêu: file tách họ và tên, đích chỉ có một ô Name. Không
    // ghép được thì phải vứt một nửa dữ liệu.
    const result = parseLeadRows(
      [{ "First Name": "An", "Last Name": "Nguyen", Cell: "7145550123" }],
      { name: ["First Name", "Last Name"], phone: ["Cell"] }
    );
    expect(result.rows[0].full_name).toBe("An Nguyen");
  });

  it("thiếu một nửa thì không để lại dấu cách thừa", () => {
    const result = parseLeadRows(
      [{ "First Name": "An", "Last Name": "", Cell: "7145550123" }],
      { name: ["First Name", "Last Name"], phone: ["Cell"] }
    );
    expect(result.rows[0].full_name).toBe("An");
  });

  it("một cột nguồn thì giữ nguyên KIỂU gốc cho cột custom", () => {
    // Số Excel phải vẫn là số, nếu không validateCustomValues sẽ loại dòng đó
    // ở cột kiểu number.
    const result = parseLeadRows(
      [{ Cell: "7145550123", Diem: 42 }],
      { phone: ["Cell"], diem: ["Diem"] }
    );
    expect(result.rows[0].custom_values.diem).toBe(42);
  });
});
