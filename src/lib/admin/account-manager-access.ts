import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * Gate for everything on the Account Manager page, including Agent membership
 * (task_agents / agent_members). Uses the page's own permission,
 * `management.account_manager`.
 *
 * Until 2026-10-09 the Agent membership API was gated by the task-manager rule
 * instead — a cross-module grant that let people who cannot open this page
 * still add and remove Agents and Assistants by calling the API directly.
 */
export async function loadAccountManager(): Promise<
  | { ok: true; email: string; permissions: string[] }
  | { ok: false; error: "Unauthorized" | "Forbidden"; status: 401 | 403 }
> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Unauthorized", status: 401 };
  if (!can(session.user.permissions, PERMISSIONS.ACCOUNT_MANAGER)) {
    return { ok: false, error: "Forbidden", status: 403 };
  }
  return { ok: true, email, permissions: session.user.permissions ?? [] };
}
