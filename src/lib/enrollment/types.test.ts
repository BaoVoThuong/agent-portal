import { describe, expect, it } from "vitest";
import {
  ENROLLMENT_OPTION_SET_KEYS,
  ENROLLMENT_PROGRAMS,
  ENROLLMENT_PROGRAM_LABELS,
  enrollmentOptionSetKeysForProgram,
  parseEnrollmentProgram,
  toEnrollmentProgram,
} from "@/lib/enrollment/types";

describe("enrollment program parsing", () => {
  it("accepts only supported programs at API boundaries", () => {
    expect(parseEnrollmentProgram("aca")).toBe("aca");
    expect(parseEnrollmentProgram("medicare")).toBe("medicare");
    expect(parseEnrollmentProgram("medicaid")).toBe("medicaid");
  });

  it("rejects missing, invalid, and mistyped values", () => {
    expect(parseEnrollmentProgram(null)).toBeNull();
    expect(parseEnrollmentProgram(undefined)).toBeNull();
    expect(parseEnrollmentProgram("")).toBeNull();
    expect(parseEnrollmentProgram("cs")).toBeNull();
    expect(parseEnrollmentProgram({ program: "aca" })).toBeNull();
  });

  it("keeps the explicit ACA default for page navigation only", () => {
    expect(toEnrollmentProgram(null)).toBe("aca");
    expect(toEnrollmentProgram("medicare")).toBe("medicare");
  });
});

describe("Medicaid — cùng backend với ACA, khác data schema", () => {
  it("là một chương trình đầy đủ, có nhãn riêng", () => {
    expect(ENROLLMENT_PROGRAMS).toContain("medicaid");
    expect(ENROLLMENT_PROGRAM_LABELS.medicaid).toBe("Health Medicaid Enrollment");
  });

  it("chỉ có Stage là nhóm option hệ thống", () => {
    // Bảng Medicaid là Name / Who need? / Renewal Date / End Date / Status /
    // Program / Link / People / Agent / Complete. Trong đó chỉ "Status" đi qua
    // cơ chế Stage; "Who need?" và "Program" là cột tuỳ chỉnh nên giá trị nằm ở
    // table_column_option, không phải enrollment_options.
    expect(enrollmentOptionSetKeysForProgram("medicaid")).toEqual(["stage"]);
  });

  it("KHÔNG thừa hưởng các nhóm option của ACA", () => {
    const keys = enrollmentOptionSetKeysForProgram("medicaid");
    for (const acaOnly of ["carrier", "platform", "consent", "payment_status", "aca_status"]) {
      expect(keys).not.toContain(acaOnly);
    }
    // Còn ACA thì vẫn đủ bộ — thay đổi này không đụng gì tới ACA.
    expect(enrollmentOptionSetKeysForProgram("aca")).toEqual(ENROLLMENT_OPTION_SET_KEYS);
  });
});
