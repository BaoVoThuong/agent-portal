import { describe, expect, it } from "vitest";
import {
  ENROLLMENT_RECORD_FIELDS,
  isEnrollmentFieldApplicable,
  programsMissingFieldPolicy,
  sanitizeEnrollmentPatchForProgram,
} from "./program-fields";

describe("sanitizeEnrollmentPatchForProgram", () => {
  it("clears Medicare-inapplicable fields", () => {
    expect(
      sanitizeEnrollmentPatchForProgram("medicare", {
        client_name: "Client",
        caller_email: "caller@example.com",
        pcp_2026: "PCP",
        payment_status_id: "payment-1",
        aca_status_id: "aca-1",
        consent_id: "consent-1",
        platform_id: "platform-1",
      })
    ).toEqual({
      client_name: "Client",
      caller_email: null,
      pcp_2026: null,
      payment_status_id: null,
      aca_status_id: null,
      consent_id: null,
      platform_id: null,
    });
  });

  it("preserves ACA fields", () => {
    expect(
      sanitizeEnrollmentPatchForProgram("aca", {
        caller_email: "caller@example.com",
        pcp_2026: "PCP",
      })
    ).toEqual({
      caller_email: "caller@example.com",
      pcp_2026: "PCP",
    });
  });

  it("adds nulls for dirty Medicare fields already on the record", () => {
    expect(
      sanitizeEnrollmentPatchForProgram(
        "medicare",
        { client_name: "Updated" },
        { caller_email: "caller@example.com", pcp_2026: null }
      )
    ).toEqual({
      client_name: "Updated",
      caller_email: null,
    });
  });

  // `carrier_ids` là cột NOT NULL: gán null là lỗi DB. Medicaid bỏ hẳn nó và
  // chỉ gửi carrier_id = null — trigger làm rỗng mảng theo.
  it("Medicaid drops carrier_ids instead of nulling it", () => {
    expect(
      sanitizeEnrollmentPatchForProgram("medicaid", {
        client_name: "Client",
        carrier_ids: ["carrier-1"],
      })
    ).toEqual({ client_name: "Client" });
    // Hồ sơ lỡ mang hãng thì carrier_id = null dọn cả hai cột qua trigger.
    expect(
      sanitizeEnrollmentPatchForProgram(
        "medicaid",
        { carrier_ids: ["carrier-1"] },
        { carrier_id: "carrier-1" }
      )
    ).toEqual({ carrier_id: null });
  });

  it("ACA and Medicare keep carrier_ids", () => {
    for (const program of ["aca", "medicare"] as const) {
      expect(
        sanitizeEnrollmentPatchForProgram(program, { carrier_ids: ["c1", "c2"] })
      ).toEqual({ carrier_ids: ["c1", "c2"] });
    }
  });
});

describe("chính sách trường theo chương trình", () => {
  it("mọi chương trình đều phải khai báo", () => {
    expect(programsMissingFieldPolicy()).toEqual([]);
  });

  it("Medicaid không có Carrier/PCP/Caller và các trường riêng của ACA", () => {
    for (const field of [
      "caller_email",
      "carrier_id",
      "pcp_2025",
      "pcp_2026",
      "platform_id",
      "consent_id",
      "payment_status_id",
      "aca_status_id",
    ] as const) {
      expect(isEnrollmentFieldApplicable("medicaid", field)).toBe(false);
    }
  });

  it("ACA vẫn dùng đủ bộ — thay đổi này không đụng ACA", () => {
    for (const field of ENROLLMENT_RECORD_FIELDS) {
      expect(isEnrollmentFieldApplicable("aca", field)).toBe(true);
    }
  });

  it("patch của Medicaid bị xoá sạch trường lạc chương trình", () => {
    const patch = sanitizeEnrollmentPatchForProgram("medicaid", {
      client_name: "Test",
      carrier_id: "carrier-1",
      caller_email: "a@b.c",
      pcp_2025: "PCP",
    });
    expect(patch).toEqual({
      client_name: "Test",
      carrier_id: null,
      caller_email: null,
      pcp_2025: null,
    });
  });
});
