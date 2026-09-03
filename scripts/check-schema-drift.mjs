#!/usr/bin/env node
/**
 * Kiểm xem database có đủ những thứ code đang cần hay không.
 *
 * Vì sao cần: ngày 2026-09-03, code đọc cột `time_off_balance_adjustments.source`
 * được đẩy lên trước khi rollout tạo cột đó được chạy. Hậu quả không phải một
 * tính năng hỏng — `fetchTimeOffDashboard` throw ngay trong server component,
 * nên MỌI người mở `/time-off` đều nhận trang trắng, kể cả người không dùng
 * phần liên quan. Không có gì cảnh báo trước; chỉ có người dùng phát hiện.
 *
 * Chạy: node scripts/check-schema-drift.mjs
 *
 * ⚠ Một điểm dễ hiểu nhầm: PostgREST phục vụ theo schema đã cache. Nếu vừa chạy
 *   rollout xong mà script báo thiếu, hãy chạy `notify pgrst, 'reload schema';`
 *   một lần trong SQL Editor rồi thử lại — thiếu thật và cache cũ trông giống
 *   hệt nhau từ phía client.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

/**
 * Những gì code đang phụ thuộc. Thêm dòng mới ở đây mỗi khi một rollout tạo ra
 * thứ mà code đọc tới — đó là toàn bộ giá trị của file này.
 */
const REQUIRED = {
  tables: {
    time_off_policies: ["code", "label", "annual_allowance", "counts_toward_balance"],
    time_off_requests: ["id", "requester_id", "policy_code", "start_date", "end_date", "total_days", "status", "reviewer_id", "reviewed_at"],
    time_off_balances: ["account_id", "policy_code", "leave_year", "entitlement_days", "adjustment_days"],
    time_off_balance_adjustments: ["id", "account_id", "policy_code", "leave_year", "effective_month", "delta_days", "note", "created_by_id", "source", "batch_id"],
    time_off_balance_adjustment_batches: ["id", "kind", "policy_code", "effective_month", "idempotency_key"],
    time_off_monthly_accrual_rules: ["policy_code", "credit_days", "start_month", "is_active"],
    time_off_holidays: ["id", "holiday_date", "name"],
  },
  rpcs: [
    "approve_time_off_request",
    "adjust_time_off_balance",
    "apply_time_off_monthly_accruals",
    "bulk_adjust_time_off_balances",
    "configure_time_off_monthly_accrual",
  ],
  permissions: ["timeoff.user", "timeoff.admin"],
};

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
  }
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY trong .env.local");
    process.exit(2);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });
  const missing = [];

  // Cột: hỏi đúng danh sách cột. PostgREST trả lỗi nêu tên cột đầu tiên nó
  // không tìm thấy, nên hỏi từng cột mới biết chính xác thiếu cái nào.
  for (const [table, columns] of Object.entries(REQUIRED.tables)) {
    const probe = await db.from(table).select(columns[0]).limit(1);
    if (probe.error) {
      missing.push(`bảng ${table} — ${probe.error.code}: ${probe.error.message}`);
      continue;
    }
    for (const column of columns.slice(1)) {
      const result = await db.from(table).select(column).limit(1);
      if (result.error) missing.push(`cột ${table}.${column} — ${result.error.message}`);
    }
  }

  // RPC: đọc từ OpenAPI spec của PostgREST. Gọi thẳng bằng rpc() không phân
  // biệt được "không có hàm" với "sai tham số", nên spec là nguồn đáng tin hơn.
  const spec = await (await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })).json();
  const rpcs = new Set(
    Object.keys(spec.paths ?? {}).filter((path) => path.startsWith("/rpc/")).map((path) => path.slice(5))
  );
  for (const rpc of REQUIRED.rpcs) {
    if (!rpcs.has(rpc)) missing.push(`hàm ${rpc}()`);
  }

  const permissions = await db.from("permissions").select("key").in("key", REQUIRED.permissions);
  const present = new Set((permissions.data ?? []).map((row) => row.key));
  for (const permission of REQUIRED.permissions) {
    if (!present.has(permission)) missing.push(`quyền ${permission} chưa có trong bảng permissions`);
  }

  if (missing.length === 0) {
    console.log("ok — database có đủ mọi thứ code đang cần");
    return;
  }
  console.error(`LỆCH SCHEMA — thiếu ${missing.length} thứ:`);
  for (const item of missing) console.error(`  - ${item}`);
  console.error("\nChạy rollout còn thiếu trong supabase/rollouts/ TRƯỚC khi đẩy code.");
  console.error("Nếu vừa chạy rollout xong: `notify pgrst, 'reload schema';` rồi thử lại.");
  process.exit(1);
}

main().catch((error) => {
  console.error("check-schema-drift lỗi:", error.message);
  process.exit(2);
});
