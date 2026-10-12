import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// No cross-module grants (2026-10-09): every page and API uses only its own
// module's permissions. Each folder below may reference only the listed
// PERMISSIONS constants. The most specific (longest) folder wins, so
// tasks/leads is checked as Lead, not Task. Navigation registries that list
// every module (Sidebar, rbac/routes, the authed layout) are not mapped.

const SRC = join(process.cwd(), "src");

const TASK = /^TASK_/;
const LEAD = /^LEAD_/;
const PROVIDER = /^AUTOMATION_PROVIDER_/;
const REGISTRATION = /^CUSTOMER_REGISTRATION_/;
const DASHBOARD = /^(AGENT_DASHBOARD_|COMPANY_DASHBOARD_|COMPANY_VIEW_ALL$)/;
const ACCOUNT_MANAGER = /^(ACCOUNT_MANAGER|NOTIFICATION_ALERTS)$/;
const ROLE_MANAGER = /^ROLE_MANAGER$/;

const MODULES: Array<{ prefix: string; allowed: RegExp; module: string }> = [
  { prefix: "lib/tasks/", allowed: TASK, module: "Task + Enrollment" },
  { prefix: "lib/enrollment/", allowed: TASK, module: "Task + Enrollment" },
  { prefix: "app/api/tasks/", allowed: TASK, module: "Task + Enrollment" },
  { prefix: "app/api/enrollment/", allowed: TASK, module: "Task + Enrollment" },
  { prefix: "app/api/admin/task-", allowed: TASK, module: "Task + Enrollment" },
  { prefix: "app/(authed)/tasks/", allowed: TASK, module: "Task + Enrollment" },
  { prefix: "app/(authed)/enrollment/", allowed: TASK, module: "Task + Enrollment" },
  { prefix: "lib/leads/", allowed: LEAD, module: "Lead" },
  { prefix: "app/api/leads/", allowed: LEAD, module: "Lead" },
  { prefix: "app/(authed)/tasks/leads/", allowed: LEAD, module: "Lead" },
  { prefix: "lib/providers/", allowed: PROVIDER, module: "Provider List" },
  { prefix: "app/api/automation/provider-", allowed: PROVIDER, module: "Provider List" },
  { prefix: "app/(authed)/tasks/providers/", allowed: PROVIDER, module: "Provider List" },
  { prefix: "app/api/entries/", allowed: REGISTRATION, module: "Customer Registration" },
  { prefix: "app/api/pc-entries/", allowed: REGISTRATION, module: "Customer Registration" },
  { prefix: "app/(authed)/customer-registration/", allowed: REGISTRATION, module: "Customer Registration" },
  { prefix: "app/(authed)/page.tsx", allowed: REGISTRATION, module: "Customer Registration" },
  { prefix: "app/(authed)/dashboard/", allowed: DASHBOARD, module: "Dashboard" },
  { prefix: "app/(authed)/sales-dashboard/", allowed: DASHBOARD, module: "Dashboard" },
  { prefix: "app/api/ai/dashboard-chat/", allowed: DASHBOARD, module: "Dashboard" },
  { prefix: "app/api/dashboard-filter-defaults/", allowed: DASHBOARD, module: "Dashboard" },
  { prefix: "app/api/admin/users/", allowed: ACCOUNT_MANAGER, module: "Account Manager" },
  { prefix: "app/api/config/agents/", allowed: ACCOUNT_MANAGER, module: "Account Manager" },
  { prefix: "app/api/config/assistants/", allowed: ACCOUNT_MANAGER, module: "Account Manager" },
  { prefix: "app/(authed)/account-manager/", allowed: ACCOUNT_MANAGER, module: "Account Manager" },
  { prefix: "lib/admin/", allowed: ACCOUNT_MANAGER, module: "Account Manager" },
  { prefix: "app/api/admin/roles/", allowed: ROLE_MANAGER, module: "Role Manager" },
  { prefix: "app/(authed)/role-manager/", allowed: ROLE_MANAGER, module: "Role Manager" },
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

function moduleFor(file: string) {
  return MODULES.filter((entry) => file.startsWith(entry.prefix)).sort(
    (a, b) => b.prefix.length - a.prefix.length
  )[0];
}

describe("module boundaries", () => {
  it("every mapped folder uses only its own module's permissions", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SRC)) {
      const file = relative(SRC, path);
      const owner = moduleFor(file);
      if (!owner) continue;
      const keys = new Set(
        [...readFileSync(path, "utf8").matchAll(/PERMISSIONS\.([A-Z_]+)/g)].map((m) => m[1])
      );
      for (const key of keys) {
        if (!owner.allowed.test(key)) offenders.push(`${file} (${owner.module}) uses PERMISSIONS.${key}`);
      }
    }
    expect(
      offenders,
      "Cross-module permission: a page/API may only use its own module's permissions. See plan 2026-10-09."
    ).toEqual([]);
  });
});
