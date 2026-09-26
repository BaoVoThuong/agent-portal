// DECISION DIFF (authz Phase D, D12) — READ-ONLY.
//
// Với mỗi account ĐANG HOẠT ĐỘNG: so quyết định cũ (permission phẳng + tên role)
// với quyết định mới (grant hiệu lực, đúng cách phiên đăng nhập suy ra). Không
// ghi gì vào database.
//
//   Kỳ vọng trước khi deploy Phase D: 0 dòng cho mọi account có role CHƯA sửa ở
//   Role Manager mới. Role đã sửa (grants_managed) được in ra để người duyệt
//   xác nhận từng thay đổi là cố ý.
//
// Chạy (cần SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY trong môi trường):
//   set -a; source .env.local; set +a
//   npx vite-node -c vitest.config.ts scripts/authz-decision-diff.ts [--json]
import { diffDecisions, type DecisionMismatch } from "@/lib/authz/decision-diff";
import { fetchRoleRows, grantsForRoles, roleDefinitionFromRow } from "@/lib/authz/principal";
import { getSupabaseAdmin } from "@/lib/supabase";

type AccountRow = {
  id: string;
  email: string;
  role: string | null;
  user_roles: { role_id: string }[] | null;
};

type Report = {
  email: string;
  roles: string[];
  converted: boolean;
  mismatches: DecisionMismatch[];
};

async function run(): Promise<Report[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("id,email,role,user_roles(role_id)")
    .eq("is_active", true)
    .order("email");
  if (error) throw new Error(`portal_account: ${error.message}`);

  const roles = new Map((await fetchRoleRows()).map((row) => {
    const role = roleDefinitionFromRow(row);
    return [role.id, role] as const;
  }));

  const reports: Report[] = [];
  for (const account of (data ?? []) as unknown as AccountRow[]) {
    const accountRoles = (account.user_roles ?? [])
      .map((row) => roles.get(row.role_id))
      .filter((role) => role !== undefined);
    const activeRoles = accountRoles.filter((role) => role.isActive);
    // Quyết định CŨ đọc đúng những gì getUserAccess đưa vào phiên: permission
    // và tên của role đang hoạt động, cộng cột portal_account.role.
    const legacy = {
      permissions: [...new Set(activeRoles.flatMap((role) => role.permissions))],
      roles: activeRoles.map((role) => role.name),
      legacyRole: account.role,
    };
    const grants = grantsForRoles(accountRoles, account.role);
    reports.push({
      email: account.email,
      roles: activeRoles.map((role) => role.name),
      converted: activeRoles.some((role) => role.grants !== null),
      mismatches: diffDecisions(legacy, grants),
    });
  }
  return reports;
}

run()
  .then((reports) => {
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(reports, null, 2));
      return;
    }
    const withDiff = reports.filter((report) => report.mismatches.length > 0);
    console.log(`Accounts: ${reports.length}. Có lệch: ${withDiff.length}.`);
    for (const report of withDiff) {
      const tag = report.converted ? "role ĐÃ chuyển grant — duyệt từng dòng" : "role CHƯA chuyển — LỖI, không deploy";
      console.log(`\n${report.email} [${report.roles.join(", ") || "không role"}] (${tag})`);
      for (const row of report.mismatches) {
        console.log(`  ${row.decision}: cũ=${row.legacy} mới=${row.next}`);
      }
    }
    const unexpected = withDiff.filter((report) => !report.converted);
    process.exitCode = unexpected.length > 0 ? 1 : 0;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
