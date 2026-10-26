import type { ProviderFieldChange } from "./activity";
import { PROVIDER_TEXT_FIELDS, type ProviderRow } from "./types";

/**
 * Backlog của Provider List (2026-10-26): dòng do người KHÔNG có Provider List -
 * Manage thêm / nhập nằm chờ ở đây, người có Manage duyệt rồi mới vào danh sách.
 *
 * Thuần (không I/O) để route ghi và dialog hiển thị dùng chung một luật — màn
 * hình nói "sẽ đổi 3 ô" thì server phải đổi đúng 3 ô đó.
 */

/** Hai ô do người DUYỆT đóng dấu, không bao giờ chép từ dòng gửi lên. */
const REVIEW_STAMP_FIELDS = new Set<string>(["verified_by", "date"]);

/**
 * Cột hệ thống đặt cho một dòng vào Backlog. Chưa ai duyệt nên Reviewed tắt và
 * hai ô Verified để trống — người duyệt đóng dấu lúc Verify. Lấy từ đây chứ
 * không từ request: tin request thì ai cũng tự khai mình đã soát dòng đó.
 */
export function pendingProviderFields(duplicateOf: string | null) {
  return {
    pending: true,
    duplicate_of: duplicateOf,
    needs_review: true,
    verified_by: null,
    date: null,
  };
}

type DuplicateKeyFields = Pick<ProviderRow, "doctors" | "facility" | "npi" | "street" | "zip_code">;

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// "123 Main Street Suite 4" và "123 Main St Ste 4" là một địa chỉ. Chỉ gộp
// những từ viết tắt bưu điện hay gặp trong dữ liệu thật, không đoán thêm.
const STREET_ABBREVIATIONS: Record<string, string> = {
  street: "st",
  avenue: "ave",
  av: "ave",
  boulevard: "blvd",
  road: "rd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  place: "pl",
  highway: "hwy",
  freeway: "fwy",
  parkway: "pkwy",
  suite: "ste",
  building: "bldg",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
};

function streetKey(value: string | null | undefined): string {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean)
    .map((word) => STREET_ABBREVIATIONS[word] ?? word)
    .join(" ");
}

function zip5(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").slice(0, 5);
}

function digits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function nameKey(row: DuplicateKeyFields): string {
  return normalizeText(row.doctors) || normalizeText(row.facility);
}

/**
 * Dòng đã có trong danh sách mà dòng gửi lên trùng với — cùng một bác sĩ / cơ sở
 * ở cùng một địa chỉ. Trả id dòng đó, hoặc null.
 *
 * Cùng địa chỉ (Street + ZIP) là điều kiện cần: một bác sĩ có nhiều địa chỉ là
 * nhiều dòng thật, không phải trùng. Rồi cùng NPI khi CẢ HAI dòng có NPI — hai
 * NPI khác nhau ở chung toà nhà là hai bác sĩ; thiếu NPI thì so tên.
 */
export function findProviderDuplicate(
  candidate: DuplicateKeyFields,
  rows: readonly (DuplicateKeyFields & { id: string })[]
): string | null {
  const street = streetKey(candidate.street);
  const zip = zip5(candidate.zip_code);
  if (!street || !zip) return null;
  const npi = digits(candidate.npi);
  const name = nameKey(candidate);

  for (const row of rows) {
    if (zip5(row.zip_code) !== zip || streetKey(row.street) !== street) continue;
    const rowNpi = digits(row.npi);
    if (npi && rowNpi) {
      if (npi === rowNpi) return row.id;
      continue;
    }
    if (name && name === nameKey(row)) return row.id;
  }
  return null;
}

function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

type MergeRow = Pick<ProviderRow, (typeof PROVIDER_TEXT_FIELDS)[number] | "custom_values">;

/**
 * Những ô "Update existing" chép từ dòng chờ duyệt sang dòng đã có: ô dòng gửi
 * lên CÓ giá trị và khác dòng cũ. `from` là giá trị đang có, `to` là giá trị mới.
 *
 * Ô để trống không bao giờ xoá dữ liệu của dòng cũ — người gửi thường chỉ điền
 * phần họ biết, và một file nhập để trống một cột không có nghĩa là "xoá cột
 * này" ở mọi dòng. Muốn xoá một ô thì sửa thẳng ô đó trên bảng.
 */
export function providerMergeChanges(
  submitted: MergeRow,
  existing: MergeRow
): ProviderFieldChange[] {
  const changes: ProviderFieldChange[] = [];
  for (const key of PROVIDER_TEXT_FIELDS) {
    if (REVIEW_STAMP_FIELDS.has(key)) continue;
    const next = submitted[key];
    if (isBlank(next) || sameValue(next, existing[key])) continue;
    changes.push({ key, from: isBlank(existing[key]) ? null : existing[key], to: next });
  }
  const existingCustom = existing.custom_values ?? {};
  for (const [key, next] of Object.entries(submitted.custom_values ?? {})) {
    if (isBlank(next) || sameValue(next, existingCustom[key])) continue;
    changes.push({ key, from: isBlank(existingCustom[key]) ? null : existingCustom[key], to: next });
  }
  return changes;
}

/**
 * Dòng nhập CÓ ID (sửa dòng đã có) của người không có Manage: thành một dòng chờ
 * duyệt mang bản ĐỀ XUẤT — dòng cũ phủ thêm những ô có trong file. Nhờ vậy người
 * duyệt mở ra thấy trọn một dòng, và "Update existing" so được từng ô.
 *
 * Chỉ lấy các ô văn bản từ `patch`: `buildProviderPatch` còn thêm toạ độ geocode
 * (xoá khi đổi địa chỉ) — dòng chờ duyệt là dòng mới, toạ độ của nó vốn trống.
 */
export function proposedProviderValues(
  existing: MergeRow,
  patch: Record<string, unknown>,
  customValues: Record<string, unknown> | null
): MergeRow {
  const proposed = { custom_values: { ...(existing.custom_values ?? {}) } } as MergeRow;
  for (const key of PROVIDER_TEXT_FIELDS) {
    proposed[key] = key in patch ? ((patch[key] as string | null) ?? null) : existing[key];
  }
  if (customValues) Object.assign(proposed.custom_values, customValues);
  return proposed;
}
