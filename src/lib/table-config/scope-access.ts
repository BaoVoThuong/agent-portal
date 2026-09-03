import type { TableScope } from "./types";

/** Bảng Health do quyền task quản; bảng lead do quyền lead quản. */
const TASK_SCOPES: readonly TableScope[] = ["cs", "aca", "medicare"];
const LEAD_SCOPES: readonly TableScope[] = ["lead"];

/**
 * Người này được sửa cấu hình bảng của những scope nào.
 *
 * Một màn hình cấu hình phục vụ cả bốn scope, nhưng **quyền vẫn tách**: hai tài
 * khoản trên production chỉ có `lead.manage` và không có `task.manage`. Gộp màn
 * hình mà gộp luôn quyền là hoặc chặn mất họ, hoặc cấp cho họ quyền sửa cấu
 * hình Health CS / ACA / Medicare — cả hai đều sai.
 *
 * Nhận CỜ ĐÃ TÍNH chứ không nhận danh sách quyền thô: `isTaskAdmin` đến từ
 * `loadConfigAdmin()` (đòi `task.manage` VÀ vai trò task-admin), `isLeadManager`
 * từ `canManageLeads()`. Tự suy ra ở đây là dựng một luật quyền thứ hai bên cạnh
 * luật đang chạy, và hai luật thì sớm muộn cũng lệch.
 *
 * Thứ tự trả về cố định: danh sách bảng trong dropdown phải giống nhau giữa hai
 * lần tải, nếu không người dùng học vị trí rồi bấm nhầm.
 */
export function configScopesFor(input: {
  isTaskAdmin: boolean;
  isLeadManager: boolean;
}): TableScope[] {
  const scopes: TableScope[] = [];
  if (input.isTaskAdmin) scopes.push(...TASK_SCOPES);
  if (input.isLeadManager) scopes.push(...LEAD_SCOPES);
  return scopes;
}
