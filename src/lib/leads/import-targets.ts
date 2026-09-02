import type { TableColumn } from "@/lib/table-config/types";

export type LeadImportTarget = {
  /** `name` | `phone` | `email` | khoá của một cột custom. */
  key: string;
  /** Nhãn admin đặt trong Table Config. */
  label: string;
  required: boolean;
  isCustom: boolean;
  /**
   * Cho phép ghép NHIỀU cột nguồn vào trường này.
   *
   * Chỉ mở cho trường chữ. File hay tách "First Name" / "Last Name" trong khi
   * đích chỉ có một ô Name — không ghép được thì phải vứt một nửa dữ liệu.
   *
   * KHÔNG mở cho phone và email: `normalizePhone` bỏ hết ký tự không phải số,
   * nên ghép hai cột điện thoại ra một chuỗi 20 chữ số vô nghĩa; email ghép lại
   * thì không còn là email. Ghép ở đó là làm hỏng dữ liệu chứ không phải tiện lợi.
   */
  allowsMultiple: boolean;
};

/** Ba trường hệ thống mà một file import cấp được. */
const IMPORTABLE_SYSTEM_KEYS = ["name", "phone", "email"] as const;

/**
 * Danh sách cột đích cho bảng map.
 *
 * Cố ý KHÔNG lấy nguyên bảng Table Config. Hai nhóm bị loại:
 *
 *  - **Chọn một lần cho cả file** (`product`, `event`, `assignee`, `status`):
 *    người dùng đã chọn trong dialog, đưa vào bảng map là hỏi hai lần một câu.
 *
 *  - **Do hệ thống tự sinh** (`attempts`, `lastContact`, `interactionHistory`,
 *    `createdAt`, `key`): cho map vào là mở đường ghi đè dữ liệu vận hành bằng
 *    một file Excel. `attempts` do việc ghi tương tác cộng lên; `lastContact` do
 *    lần liên hệ gần nhất quyết định. Một file import không được nói dối về
 *    những chuyện đó.
 *
 * Cột custom thì nhận hết — chúng sinh ra chính là để chứa dữ liệu ngoài.
 */
export function buildLeadImportTargets(
  columns: readonly TableColumn[]
): LeadImportTarget[] {
  const active = columns.filter((column) => !column.archived_at);
  const byKey = new Map(active.map((column) => [column.key, column]));

  const targets: LeadImportTarget[] = [];
  for (const key of IMPORTABLE_SYSTEM_KEYS) {
    const column = byKey.get(key);
    // `phone` phải có mặt kể cả khi config thiếu: không có nó thì không import
    // được dòng nào, và một bảng map thiếu trường bắt buộc thì vô dụng.
    if (!column && key !== "phone") continue;
    targets.push({
      key,
      label: column?.label ?? "Phone",
      required: key === "phone",
      isCustom: false,
      allowsMultiple: key === "name",
    });
  }

  for (const column of active) {
    if (column.is_system) continue;
    targets.push({
      key: column.key,
      label: column.label,
      required: false,
      isCustom: true,
      // Cột custom kiểu số/ngày/checkbox ghép lại là ra rác; chỉ chữ mới ghép được.
      allowsMultiple: column.type === "text",
    });
  }
  return targets;
}
