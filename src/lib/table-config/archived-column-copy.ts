import type { ColumnType } from "./types";

/**
 * Câu chữ cho hộp thoại "cột này từng tồn tại".
 *
 * Bản đầu hứa chung chung: "restores the archived column with its existing
 * options and settings" — trong khi cột Year của Health ACA là text, không có
 * option nào, và không hồ sơ nào còn giá trị. Người quản trị đọc một lời hứa
 * rỗng rồi lại thấy một lời doạ ("saved table layouts will be reset") mà không
 * biết nó đụng bao nhiêu người. Hàm này nói đúng những gì SẼ xảy ra, dựa trên
 * số liệu server đếm được ngay lúc đó.
 *
 * Thuần, không I/O: server đếm, client chỉ dựng câu.
 */

export type ArchivedColumnRestoreFacts = {
  label: string;
  type: ColumnType;
  /** Lúc cột bị archive. null khi dòng cũ không ghi lại mốc này. */
  archivedAt: string | null;
  /** Option còn dùng được của cột. Chỉ dropdown mới có. */
  optionCount: number;
  /** Số layout người dùng đã lưu cho scope này — khôi phục sẽ xoá sạch. */
  layoutCount: number;
};

function formatArchivedDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // UTC cố định để câu chữ không đổi theo máy người đọc.
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function describeArchivedColumnRestore(facts: ArchivedColumnRestoreFacts): string {
  const when = formatArchivedDate(facts.archivedAt);
  const parts = [
    when
      ? `"${facts.label}" is an archived ${facts.type} column, archived on ${when}.`
      : `"${facts.label}" is an archived ${facts.type} column.`,
  ];
  // Chỉ dropdown mới có option; nói về option ở cột text là vô nghĩa.
  if (facts.type === "dropdown") {
    parts.push(
      facts.optionCount > 0
        ? `Restoring brings back ${plural(facts.optionCount, "saved option")}.`
        : "It has no saved options left."
    );
  }
  parts.push("Values already saved under this column become visible again.");
  parts.push(
    facts.layoutCount > 0
      ? `${plural(facts.layoutCount, "saved table layout")} will be reset so everyone sees the column.`
      : "No saved table layouts are affected."
  );
  return parts.join(" ");
}

export function describeArchivedColumnTypeMismatch(
  facts: Pick<ArchivedColumnRestoreFacts, "label" | "type">,
  requestedType: ColumnType
): string {
  return (
    `"${facts.label}" already exists as an archived ${facts.type} column, not ${requestedType}. ` +
    `Restore it as ${facts.type} — the type can be changed afterwards — or create a separate ` +
    `${requestedType} column with the same name.`
  );
}
