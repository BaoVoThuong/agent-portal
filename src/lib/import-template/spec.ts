import type { WorkBook } from "xlsx";

/**
 * File mẫu Import có dropdown — phần thuần, không đụng thư viện ghi file.
 *
 * Mỗi template là một danh sách cột: tiêu đề, cờ Required, và (nếu có) bộ giá
 * trị cho dropdown. Không có dòng ví dụ: người điền hay chép nguyên dòng mẫu. `download.ts` biến nó thành file xlsx: sheet `Data` để điền,
 * sheet ẩn `Lists` chứa giá trị dropdown, sheet ẩn `_template` ghi template này
 * dựng từ cấu hình nào — để lúc Import nhận ra file tải từ lâu.
 */

export type TemplateDropdown = {
  values: readonly string[];
  /**
   * true: Excel chỉ CẢNH BÁO khi gõ giá trị ngoài danh sách. Dùng cho cột nhiều
   * lựa chọn ("A, B" không nằm trong danh sách nhưng hợp lệ) và cho cột mà
   * Import tự tạo lựa chọn mới. false: chặn hẳn.
   */
  allowOther: boolean;
  /**
   * false: danh sách này KHÔNG tính vào dấu phiên bản. Dành cho danh sách người
   * — thêm một nhân viên mới không làm file cũ thành sai.
   */
  tracked?: boolean;
};

export type TemplateColumnSpec = {
  header: string;
  /** Cột Required trong Table Config: cả cột được tô vàng trong file mẫu. */
  required?: boolean;
  dropdown?: TemplateDropdown;
};

export type ImportTemplateSpec = {
  /** Template của màn hình nào, vd. `enrollment:aca`, `provider`, `lead`. */
  kind: string;
  columns: TemplateColumnSpec[];
  /** Số dòng dữ liệu có dropdown — bằng trần số dòng của Import. */
  rows: number;
};

export const TEMPLATE_DATA_SHEET = "Data";
export const TEMPLATE_LISTS_SHEET = "Lists";
export const TEMPLATE_META_SHEET = "_template";

/** FNV-1a 32 bit: đủ để phát hiện cấu hình đã đổi, không dùng cho bảo mật. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Dấu phiên bản: đổi khi tiêu đề cột hoặc giá trị dropdown (trừ danh sách người)
 * đổi — tức là khi file cũ có thể điền ra giá trị Import không nhận.
 */
export function templateFingerprint(spec: ImportTemplateSpec): string {
  return fnv1a(
    JSON.stringify(
      spec.columns.map((column) => [
        column.header,
        column.dropdown && column.dropdown.tracked !== false
          ? [...column.dropdown.values]
          : null,
      ]),
    ),
  );
}

/** Ô `A1:B1` của sheet `_template` trong file đã tải. */
export type TemplateMarker = { kind: string; fingerprint: string };

export function readTemplateMarker(workbook: WorkBook): TemplateMarker | null {
  const sheet = workbook.Sheets[TEMPLATE_META_SHEET];
  if (!sheet) return null;
  const kind = String(sheet.A1?.v ?? "").trim();
  const fingerprint = String(sheet.B1?.v ?? "").trim();
  if (!kind || !fingerprint) return null;
  return { kind, fingerprint };
}

/**
 * File đang nhập so với template hiện tại. File không có dấu (Export, file tự
 * làm, template tải trước bản này) thì không nói gì: không có gì để so.
 */
export type TemplateFreshness =
  | { status: "current" | "unknown" }
  | { status: "outdated" }
  | { status: "other"; kind: string };

export function templateFreshness(
  marker: TemplateMarker | null,
  spec: ImportTemplateSpec,
): TemplateFreshness {
  if (!marker) return { status: "unknown" };
  if (marker.kind !== spec.kind) return { status: "other", kind: marker.kind };
  return marker.fingerprint === templateFingerprint(spec)
    ? { status: "current" }
    : { status: "outdated" };
}

/** Tên cột Excel từ chỉ số 0: 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let name = "";
  let rest = index + 1;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    name = String.fromCharCode(65 + digit) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}

/**
 * Nhãn người cho dropdown: tên, nhưng tên trùng (hai "Phi Nguyen") hoặc trống
 * thì dùng email — Import đọc được cả hai, còn tên trùng thì Import từ chối.
 * `sameName` là cách Import coi hai tên là một.
 */
export function personChoiceLabels(
  people: readonly { email: string; name?: string | null }[],
  sameName: (name: string) => string,
): string[] {
  const countByName = new Map<string, number>();
  const seenEmails = new Set<string>();
  const unique = people.filter((person) => {
    const email = person.email.trim().toLowerCase();
    if (!email || seenEmails.has(email)) return false;
    seenEmails.add(email);
    return true;
  });
  for (const person of unique) {
    const key = sameName(person.name?.trim() ?? "");
    if (key) countByName.set(key, (countByName.get(key) ?? 0) + 1);
  }
  const labels = unique.map((person) => {
    const name = person.name?.trim() ?? "";
    const key = sameName(name);
    return key && countByName.get(key) === 1 ? name : person.email.trim().toLowerCase();
  });
  return labels.sort((a, b) => a.localeCompare(b));
}

/** Bỏ nhãn trống và trùng, giữ thứ tự. */
export function distinctLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}
