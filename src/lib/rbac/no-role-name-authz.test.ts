import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Guard for the 2026-10-09 cleanup: access is decided by permission ticks only.
// Role names (and the legacy portal_account.role column) must never come back
// as an access rule. The one fixed role the code knows — "Admin" — lives in
// lib/rbac/admin-role.ts and is used only for its lock, its label and the
// "at least one Admin" rule, by the files listed below.

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /["'](Super Admin|Admin Health Task|Task Admin)["']/, why: "hard-coded role name" },
  { pattern: /\brole\s*[!=]==?\s*["']admin["']/, why: "legacy portal_account.role check" },
  { pattern: /\brole\w*\??\.name\s*[!=]==?\s*["']/i, why: "comparing a role name to a literal" },
  { pattern: /\broleNames?\.(includes|some)\(\s*["']/, why: "matching role names" },
];

const ADMIN_ROLE_USERS = new Set([
  "lib/rbac/admin-role.ts",
  "lib/rbac/role-management.ts",
  "lib/tasks/assignees.ts",
  "lib/tasks/overview-data.ts",
  "app/api/admin/roles/route.ts",
  "app/api/admin/roles/[id]/route.ts",
  "app/api/admin/users/[id]/route.ts",
  "app/(authed)/account-manager/page.tsx",
  "app/(authed)/account-manager/AccountManagerClient.tsx",
  "app/(authed)/role-manager/RoleManagerClient.tsx",
]);

describe("no access rule reads role names", () => {
  const files = sourceFiles(SRC);

  it("has no hard-coded role-name or legacy-role check", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(text)) offenders.push(`${relative(SRC, file)}: ${why}`);
      }
    }
    expect(
      offenders,
      "Access follows permission ticks (can()), never role names or portal_account.role. See plan 2026-10-09."
    ).toEqual([]);
  });

  it("only the allow-listed files use the Admin role name", () => {
    const offenders = files
      .map((file) => relative(SRC, file))
      .filter((file) => !ADMIN_ROLE_USERS.has(file))
      .filter((file) =>
        /rbac\/admin-role"|\bADMIN_ROLE_NAME\b|\bisAdminRoleName\b/.test(
          readFileSync(join(SRC, file), "utf8")
        )
      );
    expect(
      offenders,
      "The Admin role name is for its lock, label and last-Admin rule only — not for access."
    ).toEqual([]);
  });
});
