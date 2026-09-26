import { describe, expect, it } from "vitest";
import { compatGrantsFor } from "@/lib/authz/test-actors";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { canActorExport, canActorImport } from "./export-access";

describe("canActorExport", () => {
  it("mỗi domain đòi grant export của chính nó", () => {
    expect(canActorExport(["task.export:*"], "task")).toBe(true);
    expect(canActorExport(["task.export:*"], "provider")).toBe(false);
    expect(canActorExport(["provider.export:*"], "enrollment")).toBe(false);
  });

  it("role cũ giữ task.export được export cả ba domain như trước", () => {
    const grants = compatGrantsFor([PERMISSIONS.TASK_EXPORT]);
    expect(canActorExport(grants, "task")).toBe(true);
    expect(canActorExport(grants, "enrollment")).toBe(true);
    expect(canActorExport(grants, "provider")).toBe(true);
  });

  it("manager thiếu task.export bị từ chối; rỗng/undefined bị từ chối", () => {
    expect(canActorExport(compatGrantsFor([PERMISSIONS.TASK_MANAGE], { taskAdmin: true }), "task")).toBe(false);
    expect(canActorExport([], "task")).toBe(false);
    expect(canActorExport(undefined, "task")).toBe(false);
  });
});

describe("canActorImport", () => {
  // Export chỉ ĐỌC, Import GHI ĐÈ hàng loạt. Suy quyền này từ quyền kia là cho
  // người chỉ được phép kéo dữ liệu ra cái quyền sửa hàng trăm dòng một lượt.
  it("KHÔNG suy ra từ Export, và ngược lại", () => {
    expect(canActorImport(compatGrantsFor([PERMISSIONS.TASK_EXPORT]), "provider")).toBe(false);
    expect(canActorExport(compatGrantsFor([PERMISSIONS.TASK_IMPORT]), "task")).toBe(false);
  });

  it("quyền quản lý task cũng không tự cho quyền nhập", () => {
    const grants = compatGrantsFor([PERMISSIONS.TASK_MANAGE, PERMISSIONS.TASK_WORK], { taskAdmin: true });
    expect(canActorImport(grants, "provider")).toBe(false);
    expect(canActorImport(grants, "enrollment")).toBe(false);
  });

  // Import Enrollment ghi thẳng theo ID (S6): task.import của người thường
  // không được biến thành cửa hậu sửa mọi hồ sơ.
  it("Enrollment: đòi task.import VÀ task admin; Provider: chỉ task.import", () => {
    const plain = compatGrantsFor([PERMISSIONS.TASK_IMPORT, PERMISSIONS.TASK_WORK]);
    expect(canActorImport(plain, "enrollment")).toBe(false);
    expect(canActorImport(plain, "provider")).toBe(true);
    const admin = compatGrantsFor([PERMISSIONS.TASK_IMPORT, PERMISSIONS.TASK_MANAGE], { taskAdmin: true });
    expect(canActorImport(admin, "enrollment")).toBe(true);
  });

  it("grant một domain không mở domain khác", () => {
    expect(canActorImport(["enrollment.import:*"], "provider")).toBe(false);
    expect(canActorImport(["provider.import:*"], "enrollment")).toBe(false);
  });
});
