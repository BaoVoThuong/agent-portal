import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * TẠM THỜI (giai đoạn UI, 2026-10-27): Accountant Management chưa có quyền riêng,
 * vì thêm quyền phải chạy rollout lên bảng `permissions`. Trong lúc chỉ dựng UI,
 * trang gác bằng Role Manager — hiện chỉ Admin có. Trước khi deploy phải thay
 * bằng `accounting.manage` / `accounting.my_bill` (plan
 * docs/superpowers/plans/2026-10-27-accountant-management-ui.md, mục 4).
 */
export const ACCOUNTING_PAGE_PERMISSION = PERMISSIONS.ROLE_MANAGER;
