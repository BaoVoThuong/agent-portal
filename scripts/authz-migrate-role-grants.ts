// CHUYỂN ROLE SANG GRANT (authz Phase H).
//
// Code Phase H chỉ đọc grant từ định nghĩa role: role chưa chuyển = không có
// quyền. Script này ghi grant tương thích (đúng quyết định cũ) cho mọi role
// chưa chuyển, TRƯỚC khi deploy code Phase H.
//
//   Mặc định DRY-RUN — chỉ đọc, in:
//     - role sẽ chuyển và số grant;
//     - account nào sẽ ĐỔI quyết định sau khi chuyển (kỳ vọng 0). Nguyên nhân
//       thường gặp: cột portal_account.role = 'admin' nhưng account không giữ
//       role super_admin (hoặc ngược lại) — sửa role của account đó trong
//       Account Manager rồi chạy lại.
//   --apply            ghi qua RPC convert_role_to_grants_atomic (audit từng role).
//                      Từ chối nếu dry-run còn account đổi quyết định.
//   --accept-changes   cho --apply chạy dù còn account đổi quyết định (đã duyệt).
//
// Chạy (cần SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY trong môi trường; chạy
// rollout 2026-10-01-authz-phase-h.sql trước):
//   set -a; source .env.local; set +a
//   npx vite-node -c vitest.config.ts scripts/authz-migrate-role-grants.ts [--apply] [--accept-changes]
import { compatGrantsForRole } from "@/lib/authz/compat";
import { diffDecisions, type DecisionMismatch } from "@/lib/authz/decision-diff";
import { decodeGrant } from "@/lib/authz/grants";
import {
  fetchRoleRows,
  grantsForRoles,
  roleDefinitionFromRow,
} from "@/lib/authz/principal";
import { getSupabaseAdmin } from "@/lib/supabase";

type AccountRow = {
  id: string;
  email: string;
  role: string | null;
  user_roles: { role_id: string }[] | null;
};

async function run() {
  const apply = process.argv.includes("--apply");
  const acceptChanges = process.argv.includes("--accept-changes");

  const roles = (await fetchRoleRows()).map(roleDefinitionFromRow);
  const toConvert = roles.filter((role) => role.systemKey !== "super_admin" && role.grants === null);
  const converted = new Map(
    roles.map((role) => [
      role.id,
      toConvert.includes(role) ? { ...role, grants: compatGrantsForRole(role) } : role,
    ])
  );

  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("id,email,role,user_roles(role_id)")
    .eq("is_active", true)
    .order("email");
  if (error) throw new Error(`portal_account: ${error.message}`);

  const changes: { email: string; mismatches: DecisionMismatch[] }[] = [];
  const withoutRole: string[] = [];
  for (const account of (data ?? []) as unknown as AccountRow[]) {
    const accountRoles = (account.user_roles ?? [])
      .map((row) => roles.find((role) => role.id === row.role_id))
      .filter((role) => role !== undefined);
    const activeRoles = accountRoles.filter((role) => role.isActive);
    if (activeRoles.length === 0) withoutRole.push(account.email);
    // Quyết định CŨ: permission + tên role + cột legacy, như trước Phase H.
    const legacy = {
      permissions: [...new Set(activeRoles.flatMap((role) => role.permissions))],
      roles: activeRoles.map((role) => role.name),
      legacyRole: account.role,
    };
    // Quyết định SAU khi chuyển + deploy Phase H.
    const after = grantsForRoles(
      (account.user_roles ?? [])
        .map((row) => converted.get(row.role_id))
        .filter((role) => role !== undefined)
    );
    const mismatches = diffDecisions(legacy, after);
    if (mismatches.length > 0) changes.push({ email: account.email, mismatches });
  }

  console.log(`Role: ${roles.length}. Sẽ chuyển: ${toConvert.length}.`);
  for (const role of toConvert) {
    console.log(`  ${role.name}${role.isActive ? "" : " (đang tắt)"}: ${compatGrantsForRole(role).length} grant`);
  }
  if (withoutRole.length > 0) {
    console.log(`\nAccount active KHÔNG có role đang hoạt động (sẽ không có quyền nào): ${withoutRole.length}`);
    for (const email of withoutRole) console.log(`  ${email}`);
  }
  console.log(`\nAccount đổi quyết định sau khi chuyển: ${changes.length}`);
  for (const change of changes) {
    console.log(`  ${change.email}`);
    for (const row of change.mismatches.slice(0, 12)) {
      console.log(`    ${row.decision}: cũ=${row.legacy} mới=${row.next}`);
    }
    if (change.mismatches.length > 12) console.log(`    … và ${change.mismatches.length - 12} dòng khác`);
  }

  if (!apply) {
    console.log("\nDRY-RUN: chưa ghi gì. Thêm --apply để chuyển.");
    return changes.length === 0 ? 0 : 1;
  }
  if (changes.length > 0 && !acceptChanges) {
    console.log("\nTừ chối --apply: còn account đổi quyết định. Sửa hoặc thêm --accept-changes.");
    return 1;
  }

  let done = 0;
  for (const role of toConvert) {
    const grants = compatGrantsForRole(role)
      .map((grant) => decodeGrant(grant))
      .filter((grant) => grant !== null);
    const { data: changed, error: rpcError } = await getSupabaseAdmin().rpc(
      "convert_role_to_grants_atomic",
      { p_role_id: role.id, p_grants: grants, p_actor_email: "migration:authz-phase-h" }
    );
    if (rpcError) {
      console.error(`  LỖI ${role.name}: ${rpcError.message}`);
      return 1;
    }
    if (changed) done += 1;
  }
  console.log(`\nĐã chuyển ${done}/${toConvert.length} role.`);
  return 0;
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
