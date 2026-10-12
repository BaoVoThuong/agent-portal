// Domain types cho tài khoản người dùng portal.
// Quyền đến DUY NHẤT từ role (user_roles → roles → role_permissions). Cột cũ
// `portal_account.role` ('admin' | 'agent') đã ngừng đọc và ngừng ghi từ
// 2026-10-09; nó chỉ còn trong DB chờ xoá.
export type AccountUser = {
  id: string;
  email: string;
  name: string | null;
  agent_id: string | null;
  is_active: boolean;
  created_at: string;
};
