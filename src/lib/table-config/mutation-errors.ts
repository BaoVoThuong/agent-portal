export const CONFIG_VALUE_INACTIVE_OR_MISSING = "CONFIG_VALUE_INACTIVE_OR_MISSING" as const;
export const CONFIG_DUPLICATE_OPTION_LABEL = "CONFIG_DUPLICATE_OPTION_LABEL" as const;
export const CONFIG_ARCHIVED_COLUMN_EXISTS = "CONFIG_ARCHIVED_COLUMN_EXISTS" as const;
export const CONFIG_ARCHIVED_COLUMN_NOT_FOUND = "CONFIG_ARCHIVED_COLUMN_NOT_FOUND" as const;
export const CONFIG_ARCHIVED_COLUMN_TYPE_MISMATCH = "CONFIG_ARCHIVED_COLUMN_TYPE_MISMATCH" as const;

export function inactiveConfigValueResponse(resource: string) {
  return {
    error: `${resource} is inactive or missing. Refresh the configuration and try again.`,
    code: CONFIG_VALUE_INACTIVE_OR_MISSING,
  } as const;
}

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

export function duplicateOptionLabelResponse() {
  return {
    error: "An active option with this label already exists in this column.",
    code: CONFIG_DUPLICATE_OPTION_LABEL,
  } as const;
}

type ArchivedColumnRow = {
  id: string;
  label: string;
  type: string;
  archived_at?: string | null;
};

/**
 * Số liệu để hộp thoại nói thật thay vì hứa chung chung. Server đếm tại chỗ;
 * thiếu thì coi như 0 — một con số sai lệch không được phép chặn đường tạo cột.
 */
type ArchivedColumnFacts = {
  option_count?: number;
  layout_count?: number;
};

function archivedColumnPayload(column: ArchivedColumnRow, facts: ArchivedColumnFacts) {
  return {
    id: column.id,
    label: column.label,
    type: column.type,
    archived_at: column.archived_at ?? null,
    option_count: facts.option_count ?? 0,
    layout_count: facts.layout_count ?? 0,
  };
}

export function archivedColumnConflictResponse(
  column: ArchivedColumnRow,
  facts: ArchivedColumnFacts = {}
) {
  return {
    error: "An archived column with this label already exists.",
    code: CONFIG_ARCHIVED_COLUMN_EXISTS,
    archived_column: archivedColumnPayload(column, facts),
  } as const;
}

/**
 * Trùng tên nhưng khác kiểu. Trước đây chỉ trả một câu lỗi thô và người dùng
 * tắc hẳn: không khôi phục được vì sai kiểu, cũng không tạo mới được vì trùng
 * tên. Trả kèm cột cũ để màn hình mời được cả hai lối đi.
 */
export function archivedColumnTypeMismatchResponse(
  column: ArchivedColumnRow,
  facts: ArchivedColumnFacts = {}
) {
  return {
    error: "The archived column with this label has a different type.",
    code: CONFIG_ARCHIVED_COLUMN_TYPE_MISMATCH,
    archived_column: archivedColumnPayload(column, facts),
  } as const;
}
