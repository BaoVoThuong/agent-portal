import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { PROVIDER_TEXT_FIELDS, type ProviderRow } from "./types";

/**
 * Activity của một provider: ai làm gì, lúc nào. Cùng tên loại với
 * `provider_activity_type_check` trong rollout 2026-10-25.
 *
 * Thuần (không I/O) để route ghi và dialog hiển thị dùng chung một luật.
 */
export const PROVIDER_ACTIVITY_TYPES = [
  "created",
  "field_changed",
  "archived",
  "comment_added",
  "comment_edited",
  "comment_deleted",
  // Backlog (rollout 2026-10-26): gửi vào Backlog, rồi một trong ba kết quả.
  "submitted",
  "approved",
  "merged",
  "rejected",
] as const;

export type ProviderActivityType = (typeof PROVIDER_ACTIVITY_TYPES)[number];

export type ProviderFieldChange = { key: string; from: unknown; to: unknown };

export type ProviderActivityRow = {
  id: string;
  actor_email: string;
  actor_name?: string | null;
  type: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type ProviderSnapshot = Partial<
  Pick<ProviderRow, (typeof PROVIDER_TEXT_FIELDS)[number] | "needs_review" | "custom_values">
>;

function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function stored(value: unknown): unknown {
  return isBlank(value) ? null : value;
}

/**
 * Những ô thật sự đổi giữa hai bản của cùng một dòng.
 *
 * So bản ĐÃ LƯU trước và sau (dòng database trả về), không so thân request:
 * form Sửa gửi lên mọi ô kể cả ô không đụng tới, và server còn chuẩn hoá giá trị
 * (cắt khoảng trắng, viết hoa bang) — so request là ghi "đổi" cho cả những ô
 * vẫn y nguyên. Trống / null / "" / [] coi là như nhau vì cùng hiện "—".
 * Toạ độ geocode bị xoá kèm khi sửa địa chỉ không phải là ô người dùng thấy,
 * nên không nằm trong danh sách so.
 */
export function providerFieldChanges(
  before: ProviderSnapshot,
  after: ProviderSnapshot
): ProviderFieldChange[] {
  const changes: ProviderFieldChange[] = [];
  for (const key of PROVIDER_TEXT_FIELDS) {
    if (!sameValue(before[key], after[key])) {
      changes.push({ key, from: stored(before[key]), to: stored(after[key]) });
    }
  }
  if (!sameValue(before.needs_review, after.needs_review)) {
    changes.push({
      key: "needs_review",
      from: stored(before.needs_review),
      to: stored(after.needs_review),
    });
  }
  const beforeCustom = before.custom_values ?? {};
  const afterCustom = after.custom_values ?? {};
  for (const key of new Set([...Object.keys(beforeCustom), ...Object.keys(afterCustom)])) {
    if (!sameValue(beforeCustom[key], afterCustom[key])) {
      changes.push({ key, from: stored(beforeCustom[key]), to: stored(afterCustom[key]) });
    }
  }
  return changes;
}

/** Danh sách thay đổi đọc từ `meta`; dòng hỏng thì bỏ qua thay vì làm vỡ cả feed. */
export function providerActivityChanges(meta: ProviderActivityRow["meta"]): ProviderFieldChange[] {
  const raw = meta?.changes;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (change): change is ProviderFieldChange =>
      Boolean(change) && typeof change === "object" && typeof change.key === "string"
  );
}

export function providerActivityFieldLabel(
  key: string,
  columns: readonly TableColumn[]
): string {
  return columns.find((column) => column.key === key)?.label ?? key.replaceAll("_", " ");
}

/** Một giá trị cũ/mới viết ra chữ, theo đúng nhãn lựa chọn mà bảng đang hiện. */
export function formatProviderActivityValue(
  value: unknown,
  column: TableColumn | undefined,
  options: readonly TableColumnOption[]
): string {
  if (isBlank(value)) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const columnOptions = column ? options.filter((option) => option.column_id === column.id) : [];
  const optionLabel = (item: string) =>
    columnOptions.find((option) => option.id === item)?.label ?? item;
  if (Array.isArray(value)) return value.map((item) => optionLabel(String(item))).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return optionLabel(String(value));
}
