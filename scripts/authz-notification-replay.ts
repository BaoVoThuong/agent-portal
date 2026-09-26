// REPLAY NGƯỜI NHẬN THÔNG BÁO (authz Phase F) — READ-ONLY.
//
// Đọc task_notifications + enrollment_notifications trong N ngày gần nhất (mặc
// định 14), chạy lại bộ lọc "người nhận phải xem được bản ghi" (lib/notifications/
// audience.ts) và in ra những dòng mà luật mới SẼ KHÔNG gửi. Không ghi gì.
//
// Giới hạn: quyền và quan hệ lấy theo dữ liệu HIỆN TẠI, không phải lúc gửi —
// người đã được bỏ giao sau đó cũng hiện ra ở đây. Đọc kết quả như danh sách cần
// duyệt, không phải bằng chứng rò rỉ.
//
// Chạy (cần SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY trong môi trường):
//   set -a; source .env.local; set +a
//   npx vite-node -c vitest.config.ts scripts/authz-notification-replay.ts [--days=14] [--json]
import {
  audienceKey,
  enrollmentViewersAmong,
  taskViewersAmong,
} from "@/lib/notifications/audience";
import { getSupabaseAdmin } from "@/lib/supabase";

type Row = { recipient_email: string; entity_id: string; type: string; created_at: string };

const PAGE = 1000;

async function readRows(table: string, idColumn: string, since: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await getSupabaseAdmin()
      .from(table)
      .select(`recipient_email,${idColumn},type,created_at`)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as unknown as Record<string, string>[];
    rows.push(
      ...page.map((row) => ({
        recipient_email: row.recipient_email,
        entity_id: row[idColumn],
        type: row.type,
        created_at: row.created_at,
      }))
    );
    if (page.length < PAGE) return rows;
  }
}

async function dropped(
  rows: Row[],
  among: (pairs: { entityId: string; email: string }[]) => Promise<Set<string>>,
  exempt: ReadonlySet<string> = new Set()
): Promise<Row[]> {
  const checked = rows.filter((row) => !exempt.has(row.type));
  const allowed = new Set<string>();
  // Theo lô 500 cặp để giữ URL truy vấn `.in()` ngắn.
  for (let i = 0; i < checked.length; i += 500) {
    const batch = checked.slice(i, i + 500);
    for (const key of await among(batch.map((row) => ({ entityId: row.entity_id, email: row.recipient_email })))) {
      allowed.add(key);
    }
  }
  return checked.filter((row) => !allowed.has(audienceKey(row.entity_id, row.recipient_email)));
}

async function run() {
  const daysArg = process.argv.find((arg) => arg.startsWith("--days="));
  const days = daysArg ? Number(daysArg.slice("--days=".length)) || 14 : 14;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [taskRows, enrollmentRows] = await Promise.all([
    readRows("task_notifications", "task_id", since),
    readRows("enrollment_notifications", "record_id", since),
  ]);
  const [taskDropped, enrollmentDropped] = await Promise.all([
    dropped(taskRows, taskViewersAmong, new Set(["unassigned"])),
    dropped(enrollmentRows, enrollmentViewersAmong),
  ]);
  return { days, taskRows, enrollmentRows, taskDropped, enrollmentDropped };
}

function summarize(rows: Row[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.type] = (out[row.type] ?? 0) + 1;
  return out;
}

run()
  .then((result) => {
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`${result.days} ngày gần nhất.`);
    console.log(`Task: ${result.taskRows.length} dòng, luật mới bỏ ${result.taskDropped.length}.`);
    console.log("  theo loại:", summarize(result.taskDropped));
    console.log(`Enrollment: ${result.enrollmentRows.length} dòng, luật mới bỏ ${result.enrollmentDropped.length}.`);
    console.log("  theo loại:", summarize(result.enrollmentDropped));
    const byRecipient = new Map<string, number>();
    for (const row of [...result.taskDropped, ...result.enrollmentDropped]) {
      byRecipient.set(row.recipient_email, (byRecipient.get(row.recipient_email) ?? 0) + 1);
    }
    console.log("Người nhận bị bỏ nhiều nhất:");
    for (const [email, count] of [...byRecipient].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${email}: ${count}`);
    }
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
