// Domain types cho tài khoản người dùng portal.
// UserRole là model role "legacy" (admin/agent) đang tồn tại song song với RBAC.
// Xem ghi chú migration shim trong @/lib/rbac/system-roles.
export type UserRole = "admin" | "agent";

export type AccountUser = {
  id: string;
  email: string;
  name: string | null;
  agent_id: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  /**
   * Quản lý trực tiếp, trỏ tới portal_account.id. null = đứng đầu sơ đồ.
   * Quan hệ này KHÁC `agent_members` — bảng đó nói ai làm task của agent nào,
   * còn cột này nói ai báo cáo cho ai.
   */
  manager_id?: string | null;
};
