import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/config";

declare module "next-auth" {
  interface Session {
    user: {
      role?: UserRole;
      roles?: string[];
      permissions?: string[];
    } & DefaultSession["user"];
  }

  interface User {
    role?: UserRole;
    roles?: string[];
    permissions?: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    roles?: string[];
    permissions?: string[];
  }
}
