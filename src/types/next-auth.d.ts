import type { DefaultSession } from "next-auth";

// The session carries permissions only. Role names and the legacy admin/agent
// role were dropped 2026-10-09: nothing may decide access from them.
declare module "next-auth" {
  interface Session {
    user: {
      permissions?: string[];
      agentId?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    permissions?: string[];
    agentId?: string | null;
    rbacRefreshedAt?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    permissions?: string[];
    agentId?: string | null;
  }
}
