import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `patch_task_atomic` từng khai biến cục bộ tên `overdue_at` trong khi truy vấn
 * `task_overdue_events` — bảng có cột cùng tên. PL/pgSQL mặc định
 * variable_conflict = error, nên câu SELECT đó hỏng với 42702 và MỌI lần mở khoá
 * task quá hạn đều thất bại.
 *
 * Lỗi này đã xảy ra HAI lần:
 *   • 08/08/2026 sinh ra, 27/08 sửa — nhưng bản sửa nằm trên một nhánh không
 *     bao giờ merge, nên `schema.sql` vẫn hỏng.
 *   • 12/09/2026 rollout billing-stage chép thân hàm từ `schema.sql` rồi
 *     `create or replace` đè lên production, xoá mất bản sửa chỉ còn sống trong
 *     database. Không ai biết cho tới khi người dùng bấm Unlock ngày 16/09.
 *
 * Bài học: bản sửa sống trong database thì mong manh, vì bất kỳ file SQL nào
 * chép lại thân hàm cũng ghi đè được nó. Test này canh phần văn bản: MỌI bản
 * chép của hàm trong repo đều phải an toàn, không riêng `schema.sql`.
 */

const SUPABASE_DIR = fileURLToPath(new URL("../../../supabase", import.meta.url));

function sqlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sqlFiles(path);
    return entry.isFile() && entry.name.endsWith(".sql") ? [path] : [];
  });
}

/** Thân từng bản chép của hàm, kèm tên file để thông báo lỗi chỉ đúng chỗ. */
function functionBodies(): { file: string; body: string }[] {
  const out: { file: string; body: string }[] = [];
  for (const file of sqlFiles(SUPABASE_DIR)) {
    const text = readFileSync(file, "utf8");
    let from = 0;
    for (;;) {
      const start = text.indexOf("create or replace function patch_task_atomic", from);
      if (start === -1) break;
      const end = text.indexOf("\n$$;", start);
      if (end === -1) break;
      out.push({ file: file.slice(SUPABASE_DIR.length + 1), body: text.slice(start, end) });
      from = end;
    }
  }
  return out;
}

describe("patch_task_atomic không để biến cục bộ che tên cột", () => {
  const bodies = functionBodies();

  it("tìm thấy bản chép của hàm trong repo", () => {
    // Test này vô dụng nếu đường dẫn sai và không quét được file nào.
    expect(bodies.length).toBeGreaterThan(0);
  });

  it("không khai biến trần trùng tên cột của task_overdue_events", () => {
    for (const { file, body } of bodies) {
      expect(body, `${file}: biến 'overdue_at' che cột cùng tên → 42702`).not.toMatch(
        /^\s+overdue_at\s+timestamptz;/m
      );
      expect(body, `${file}: biến 'due_at' che cột cùng tên`).not.toMatch(
        /^\s+due_at\s+timestamptz;/m
      );
    }
  });

  it("dùng tên có hậu tố _value như các biến khác trong hàm", () => {
    for (const { file, body } of bodies) {
      expect(body, `${file}: thiếu overdue_at_value`).toContain("overdue_at_value timestamptz;");
      expect(body, `${file}: thiếu due_at_value`).toContain("due_at_value timestamptz;");
    }
  });

  it("đặt bí danh cho task_overdue_events để tham chiếu cột là tường minh", () => {
    for (const { file, body } of bodies) {
      expect(body, `${file}: truy vấn chưa có bí danh`).toContain(
        "from task_overdue_events as event"
      );
      expect(body, `${file}: còn tham chiếu cột không tường minh`).not.toContain(
        "order by overdue_at desc"
      );
    }
  });
});
