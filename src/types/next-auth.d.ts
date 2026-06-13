import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/config";

declare module "next-auth" {
  interface Session {
    user: {
      role?: UserRole;
      roles?: string[];
      permissions?: string[];
      agentId?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role?: UserRole;
    roles?: string[];
    permissions?: string[];
    agentId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    roles?: string[];
    permissions?: string[];
    agentId?: string | null;
  }
}
