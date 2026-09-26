import { PORTAL_ACCOUNT_TABLE } from "@/lib/config";
import type { UserRole } from "@/lib/domain/account.types";
import { getSupabaseAdmin } from "@/lib/supabase";

export type AccessRow = {
  id: string;
  email?: string | null;
  is_active: boolean | null;
  agent_id: string | null;
  user_roles:
    | {
        roles: {
          id: string;
          name: string;
          is_active: boolean;
          system_key?: string | null;
          role_permissions: { permission_key: string }[];
        } | null;
      }[]
    | null;
};

export type UserAccess = {
  userId: string | null;
  legacyRole: UserRole;
  roles: string[];
  /** Id của các role ĐANG hoạt động — nguồn để suy grant (authz/principal.ts). */
  roleIds: string[];
  permissions: string[];
  isActive: boolean;
  agentId: string | null;
  /** true khi truy vấn quyền LỖI — khác với "không có account". */
  lookupFailed: boolean;
};

const ACCESS_SELECT =
  "id,email,is_active,agent_id,user_roles(roles(id,name,is_active,system_key,role_permissions(permission_key)))";

function missingAccess(lookupFailed: boolean): UserAccess {
  return {
    userId: null,
    legacyRole: "agent",
    roles: [],
    roleIds: [],
    permissions: [],
    isActive: false,
    agentId: null,
    lookupFailed,
  };
}

export function flattenAccess(row: AccessRow): UserAccess {
  if (row.is_active === false) {
    return { userId: row.id, legacyRole: "agent", roles: [], roleIds: [], permissions: [], isActive: false, agentId: row.agent_id ?? null, lookupFailed: false };
  }
  const activeRoles = (row.user_roles ?? [])
    .map((ur) => ur.roles)
    .filter((r): r is NonNullable<typeof r> => Boolean(r) && r!.is_active);
  const permissions = [
    ...new Set(activeRoles.flatMap((r) => r.role_permissions.map((p) => p.permission_key))),
  ];
  return {
    userId: row.id,
    // Chỉ còn là nhãn trong JWT/UI, suy từ `system_key` — không đọc cột
    // `portal_account.role`, không so tên role (Phase H). Quyết định quyền đọc
    // grant (authz/principal.ts).
    legacyRole: activeRoles.some((r) => r.system_key === "super_admin") ? "admin" : "agent",
    roles: activeRoles.map((r) => r.name),
    roleIds: activeRoles.map((r) => r.id),
    permissions,
    isActive: true,
    agentId: row.agent_id ?? null,
    lookupFailed: false,
  };
}

/**
 * Quyền hiện tại của một account.
 *
 * Có `accountId` thì tra theo id (bất biến) và đòi email trong phiên phải khớp
 * email hiện tại của account; lệch nghĩa là email đã đổi/tái dùng, và phiên cũ
 * không được nhận quyền của account đang giữ email đó (audit S20). Không có id
 * (phiên cũ, lần đầu đăng nhập Google) thì tra theo email.
 */
export async function getUserAccess(identity: {
  accountId?: string | null;
  email: string;
}): Promise<UserAccess> {
  const base = getSupabaseAdmin().from(PORTAL_ACCOUNT_TABLE).select(ACCESS_SELECT);
  const { data, error } = await (identity.accountId
    ? base.eq("id", identity.accountId)
    : base.eq("email", identity.email)
  ).maybeSingle();

  if (error) return missingAccess(true);
  if (!data) return missingAccess(false);

  const row = data as unknown as AccessRow;
  if (
    identity.accountId &&
    (row.email ?? "").trim().toLowerCase() !== identity.email.trim().toLowerCase()
  ) {
    return missingAccess(false);
  }
  return flattenAccess(row);
}

export async function getUserAccessByEmail(email: string): Promise<UserAccess> {
  return getUserAccess({ email });
}

/**
 * Quyền của nhiều account trong MỘT truy vấn — dùng khi lọc người nhận thông
 * báo. Khoá của Map là email chữ thường. Ném lỗi khi truy vấn lỗi để nơi gọi
 * fail-closed (không gửi) thay vì gửi mò.
 */
export async function getUserAccessByEmails(
  emails: readonly string[]
): Promise<Map<string, UserAccess>> {
  const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const result = new Map<string, UserAccess>();
  if (unique.length === 0) return result;

  const { data, error } = await getSupabaseAdmin()
    .from(PORTAL_ACCOUNT_TABLE)
    .select(ACCESS_SELECT)
    .in("email", unique);
  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as unknown as (AccessRow & { email: string })[]) {
    result.set(row.email.trim().toLowerCase(), flattenAccess(row));
  }
  return result;
}

/**
 * Gán role mặc định cho account vừa tự tạo (đăng nhập Google lần đầu). Tìm role
 * theo `system_key` và KHÔNG nuốt lỗi
 * nữa: trước đây lỗi ở đây để lại account không có role mà không ai biết (S19).
 */
export async function assignDefaultRoleToUser(
  userId: string,
  legacyRole: UserRole
) {
  const supabase = getSupabaseAdmin();
  const systemKey = legacyRole === "admin" ? "super_admin" : "default_new_account";
  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select("id,is_active")
    .eq("system_key", systemKey)
    .maybeSingle();
  if (roleError) throw new Error(roleError.message);
  const roleId = (role as { id: string; is_active: boolean } | null)?.id ?? null;
  if (!roleId) throw new Error(`Default role "${systemKey}" not found.`);
  // Role mặc định bị tắt thì account mới không có quyền nào — báo lỗi để đăng
  // nhập thất bại rõ ràng thay vì tạo account rỗng (review C P2-01).
  if (!(role as { is_active: boolean }).is_active) {
    throw new Error(`Default role "${systemKey}" is disabled.`);
  }

  const { error: deleteError } = await supabase.from("user_roles").delete().eq("user_id", userId);
  if (deleteError) throw new Error(deleteError.message);
  const { error: insertError } = await supabase.from("user_roles").insert({
    user_id: userId,
    role_id: roleId,
  });
  if (insertError) throw new Error(insertError.message);
}
