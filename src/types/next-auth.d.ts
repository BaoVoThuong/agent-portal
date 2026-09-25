import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/domain/account.types";

declare module "next-auth" {
  interface Session {
    user: {
      accountId?: string | null;
      role?: UserRole;
      roles?: string[];
      roleIds?: string[];
      permissions?: string[];
      agentId?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role?: UserRole;
    roles?: string[];
    roleIds?: string[];
    permissions?: string[];
    agentId?: string | null;
    rbacRefreshedAt?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** portal_account.id — chủ thể phân quyền (không phải email, audit S20). */
    accountId?: string | null;
    role?: UserRole;
    roles?: string[];
    /** Role đang hoạt động — grant suy mỗi request từ định nghĩa role. */
    roleIds?: string[];
    permissions?: string[];
    agentId?: string | null;
    /** portal_account.access_version lúc làm mới quyền gần nhất. */
    accessVersion?: number;
  }
}
