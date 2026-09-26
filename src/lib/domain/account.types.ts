// Domain types cho tài khoản người dùng portal.
// UserRole là model role "legacy" (admin/agent) đang tồn tại song song với RBAC.
// Cột `role` chỉ còn được GHI (bản sao theo system_key) — không code nào đọc nó để phân quyền (Phase H).
export type UserRole = "admin" | "agent";

export type AccountUser = {
  id: string;
  email: string;
  name: string | null;
  agent_id: string | null;
  /**
   * Tên agent trong dữ liệu hoa hồng — khoá phạm vi Registration / Dashboard /
   * AI (agent_commission_names). Tách khỏi `name` (tên hiển thị).
   */
  commission_name?: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
};
