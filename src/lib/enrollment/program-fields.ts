import { ENROLLMENT_PROGRAMS, type EnrollmentProgram } from "./types";

/**
 * Trường nào KHÔNG thuộc chương trình nào — một nguồn sự thật cho cả API lẫn UI.
 *
 * Trước 2026-09-09 file này chỉ biết tới Medicare, và mọi chương trình khác mặc
 * nhiên được coi là "giống ACA". Vì vậy khi Medicaid ra đời nó thừa hưởng nguyên
 * bộ Carrier / Platform / Consent / Payment / AC / PCP của ACA — cả trong danh
 * sách cột, form tạo hồ sơ lẫn màn chi tiết — dù bảng nghiệp vụ của nó không có
 * những khái niệm đó.
 *
 * Nay mỗi chương trình phải tự khai. Thêm chương trình thứ tư mà quên khai thì
 * TypeScript báo thiếu khoá, chứ không lặng lẽ nhận bộ của ACA.
 */
export const ENROLLMENT_RECORD_FIELDS = [
  "caller_email",
  "carrier_id",
  "pcp_2025",
  "pcp_2026",
  "platform_id",
  "consent_id",
  "payment_status_id",
  "aca_status_id",
] as const;

export type EnrollmentRecordField = (typeof ENROLLMENT_RECORD_FIELDS)[number];

export const INAPPLICABLE_FIELDS_BY_PROGRAM: Record<
  EnrollmentProgram,
  readonly EnrollmentRecordField[]
> = {
  // ACA dùng đủ bộ.
  aca: [],
  medicare: [
    "caller_email",
    "pcp_2026",
    "platform_id",
    "consent_id",
    "payment_status_id",
    "aca_status_id",
  ],
  // Bảng Medicaid: Name / Who need? / Renewal Date / End Date / Status /
  // Program / Link / People / Agent / Complete. Không có Carrier, không có PCP,
  // không có Caller — "People" của nó là Responsible.
  medicaid: [
    "caller_email",
    "carrier_id",
    "pcp_2025",
    "pcp_2026",
    "platform_id",
    "consent_id",
    "payment_status_id",
    "aca_status_id",
  ],
};

/** Giữ lại tên cũ cho chỗ đang import; ngữ nghĩa không đổi. */
export const MEDICARE_INAPPLICABLE_FIELDS = INAPPLICABLE_FIELDS_BY_PROGRAM.medicare;

export function isEnrollmentFieldApplicable(
  program: EnrollmentProgram,
  field: EnrollmentRecordField
): boolean {
  return !INAPPLICABLE_FIELDS_BY_PROGRAM[program].includes(field);
}

/**
 * Xoá khỏi patch những trường chương trình này không có.
 *
 * Không dựa vào việc UI đã ẩn ô nhập: một request gửi thẳng vào API vẫn phải
 * không ghi được dữ liệu lạc chương trình.
 */
export function sanitizeEnrollmentPatchForProgram<T extends Record<string, unknown>>(
  program: EnrollmentProgram,
  patch: T,
  current?: Partial<Record<EnrollmentRecordField, unknown>>
): T {
  const inapplicable = INAPPLICABLE_FIELDS_BY_PROGRAM[program];
  if (inapplicable.length === 0) return patch;

  const next: Record<string, unknown> = { ...patch };
  for (const field of inapplicable) {
    if (field in next || current?.[field] != null) {
      next[field] = null;
    }
  }
  return next as T;
}

/** Mọi chương trình đều phải khai — dùng trong test để chặn việc quên. */
export function programsMissingFieldPolicy(): EnrollmentProgram[] {
  return ENROLLMENT_PROGRAMS.filter(
    (program) => INAPPLICABLE_FIELDS_BY_PROGRAM[program] === undefined
  );
}
