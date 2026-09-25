import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { canActorExport, canActorImport, canActorImportEnrollment } from "./export-access";

describe("canActorExport", () => {
  it("allows a task.export holder", () => {
    expect(canActorExport([PERMISSIONS.TASK_EXPORT])).toBe(true);
  });

  it("denies a manager permission set without task.export", () => {
    expect(canActorExport([PERMISSIONS.TASK_MANAGE])).toBe(false);
  });

  it("denies empty and undefined permission sets", () => {
    expect(canActorExport([])).toBe(false);
    expect(canActorExport(undefined)).toBe(false);
  });
});

describe("canActorImport", () => {
  it("đòi đúng quyền task.import", () => {
    expect(canActorImport(["task.import"])).toBe(true);
    expect(canActorImport([])).toBe(false);
    expect(canActorImport(undefined)).toBe(false);
  });

  // Export chỉ ĐỌC, Import GHI ĐÈ hàng loạt. Suy quyền này từ quyền kia là cho
  // người chỉ được phép kéo dữ liệu ra cái quyền sửa hàng trăm dòng một lượt.
  it("KHÔNG suy ra từ Export, và ngược lại", () => {
    expect(canActorImport(["task.export"])).toBe(false);
    expect(canActorExport(["task.import"])).toBe(false);
  });

  it("quyền quản lý task cũng không tự cho quyền nhập", () => {
    expect(canActorImport(["task.manage", "task.work"])).toBe(false);
  });
});

describe("canActorImportEnrollment", () => {
  it("đòi CẢ task.import lẫn task manager", () => {
    expect(canActorImportEnrollment(["task.import"], { isManager: true })).toBe(true);
  });

  // Import ghi thẳng theo ID, bỏ qua scope/capability/activity log — cấp
  // task.import cho người thường không được biến thành cửa hậu sửa mọi hồ sơ.
  it("người thường có task.import vẫn bị từ chối", () => {
    expect(canActorImportEnrollment(["task.import", "task.work"], { isManager: false })).toBe(false);
  });

  it("manager thiếu task.import bị từ chối", () => {
    expect(canActorImportEnrollment(["task.manage"], { isManager: true })).toBe(false);
  });
});
