# Giảm tải danh sách Enrollment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giảm số kết nối PostgREST mà màn Enrollment chiếm cùng lúc, không đổi kết quả hiển thị, và giãn nhịp tải lại hàng loạt giữa các tab.

**Architecture:** Thay các request song song khi nạp danh sách bằng một hàm SQL gộp, có đường dự phòng được log và test. Giãn nhịp tải lại do broadcast, đo theo lần gọi danh sách gần nhất của tab, có độ lệch ngẫu nhiên. Enrollment không poll dày hơn khi Realtime rớt. Phân trang keyset chỉ làm khi số hồ sơ gần chạm giới hạn 1.000.

**Tech Stack:** Next.js App Router (đọc `node_modules/next/dist/docs/` trước khi đụng API Next), TypeScript, Supabase/PostgREST, Vitest.

## Trạng thái thực thi 10/11/2026

- Task 1: code, test và SQL rollout đã chạy production. Preflight trên ACA 614 hồ sơ: `Execution Time` 5,137 ms, hai bảng con dùng index, không spill ra disk. Quyền hàm: chỉ `service_role` được gọi; RPC qua PostgREST đã trả dữ liệu comment hợp lệ. Tổng comment và attachment do RPC trả cho toàn bộ ACA khớp số đếm trực tiếp của hai bảng.
- Task 2a: code ghi `reason=` đã deploy; cần đủ log người dùng thật trong 2 ngày làm việc để tính tỷ lệ broadcast, sau đó xoá log đo tạm.
- Task 2b: chưa kích hoạt vì chưa có tỷ lệ broadcast; chỉ làm nếu đạt ngưỡng 25% như điều kiện bên dưới.
- Task 3: code giảm poll danh sách và single-flight option đã deploy. Khung chi tiết giữ nhịp cũ.
- Task 4: bỏ theo điều kiện của plan; chương trình lớn nhất ACA có 614 hồ sơ, dưới ngưỡng 800.
- Yêu cầu bổ sung sau rollout: thêm phân trang hiển thị 50 hồ sơ/trang cho cả desktop và điện thoại. Vẫn nạp toàn bộ danh sách một lần để giữ tìm kiếm, sort, tổng cột và Export trên toàn bộ kết quả lọc; không dùng keyset của Task 4 vì với 614 hồ sơ nó tăng request DB mà không giúp tải.
- Task 5: 253 file test / 2.021 test, typecheck và lint pass; deployment production `dpl_DhQsLN7twPudyCoJdf3bdJwf33E1` READY tại `https://eps-portal.vercel.app`. Cần so log và latency sau khi có traffic.
- Câu preflight ban đầu dùng `record_id = any((select a from ids))` gây lỗi PostgreSQL `42883` vì parser hiểu là so uuid với uuid[]. Câu đúng bên dưới dùng `cross join ids` và `any(ids.a)`; lỗi chỉ nằm trong câu đo, không nằm trong hàm rollout.

## Global Constraints

- Không commit, không push khi user chưa bảo. Các bước "Dừng" thay cho bước commit.
- File `supabase/rollouts/*` giữ local, không commit. Chỉ chạy rollout hoặc câu SQL đọc trên production sau khi hỏi user từng lần.
- Local dev dùng chung DB production: không chạy thử thao tác ghi.
- Thư mục dùng chung với Codex: kiểm nhánh và `git status` trước khi sửa.
- Mọi thay đổi logic ghi vào `agent-portal/changelog.md`.
- Không đụng RBAC, không đổi phạm vi dữ liệu (`applyEnrollmentScope`), không đổi CS Task.
- Số đo prod lấy từ Vercel metrics hoặc Supabase logs, không chạy vòng lặp query lên DB.

## Bối cảnh (đọc trước)

**Sự cố.** Từ 6/11 portal nhiều lần chậm/treo giờ cao điểm. Mọi module chậm cùng lúc (gấp 37–569 lần), PostgREST báo `PGRST003` (hết thời gian chờ kết nối trong pool). Trong cửa sổ 6/11, các câu Postgres trên 10 giây đều là query chẩn đoán, không có câu nào của app. Điều này không loại trừ được nhiều truy vấn ngắn chạy dày hoặc tranh chấp CPU/RAM/IO, nên **chưa xác định được tác nhân đầu tiên làm cạn pool**. Máy đã nâng Nano → Small ngày 9/11 23:31; Small chỉ tăng dư địa, không chứng minh nguyên nhân gốc đã hết. Đêm 9/11 trên Small: đỉnh 4.188 request/phút, p95 194ms, 0 `PGRST003`. Lúc vắng 10/11: RAM 1,79GB, còn trống 1,17GB, swap 0. Plan này **giảm tải, không phải fix gốc**.

> [codex][P1] `PGRST003` chứng minh request chờ pool, nhưng log SQL chậm không đủ để loại trừ các truy vấn app ngắn chạy với tần suất cao hoặc tranh chấp tài nguyên. Đổi kết luận thành “chưa xác định tác nhân đầu tiên làm cạn pool”; giữ CPU, RAM/swap, số kết nối và thời gian chờ pool làm tiêu chí kiểm chứng sau rollout. Small chỉ tăng headroom, không chứng minh đã hết nguyên nhân gốc.
>
> [claude] Đã sửa đoạn "Sự cố" ở trên thành "chưa xác định tác nhân đầu tiên". CPU, RAM/swap, số kết nối và thời gian chờ pool đã đưa vào tiêu chí đo ở Task 5 Step 5.

**Vì sao nhắm đúng chỗ.** Supabase logs:

| Cửa sổ | `enrollment_comments` + `enrollment_attachments` trên tổng REST | Phần busy time |
|---|---|---|
| 4/11 15:15–15:30, bình thường | 13,7% | |
| 9/11 15:43–15:49, chưa sập | 27,2% | |
| 9/11 15:15–15:30, sập | 30,4% (3.444/11.342 request) | 31,2% |

Fan-out chạy song song bằng `Promise.all`, nên mỗi lần nạp danh sách chiếm cùng lúc `2 × ceil(N/50)` slot pool. Theo log, trung bình khoảng 9 request con mỗi lần đọc `enrollment_records` (ước tính, vì `enrollment_records` còn được đọc ở chỗ khác).

**Đường đi hiện tại.** `page.tsx:68` (SSR), `api/enrollment/route.ts:113` (client tải lại), `api/enrollment/export/route.ts:88` đều gọi `fetchEnrollmentRecords(program, scope)` (`src/lib/enrollment/queries.ts:156`). Phần nạp con ở `queries.ts:94-137`:

```ts
const chunks = chunkEnrollmentRecordIds(recordIds);
const [commentResults, attachmentResults] = await Promise.all([
  Promise.all(chunks.map((chunk) =>
    supabase.from("enrollment_comments").select("record_id,body")
      .in("record_id", chunk).is("deleted_at", null))),
  Promise.all(chunks.map((chunk) =>
    supabase.from("enrollment_attachments").select("record_id")
      .in("record_id", chunk))),
]);
```

Client tìm trong comment bằng `comment_search_text` (`src/lib/enrollment/filtering.ts:13`, `EnrollmentClient.tsx:6303`), nên **giữ nguyên** nội dung comment trong response.

Trong `EnrollmentClient.tsx`, danh sách tải lại từ 4 nguồn, đều qua `refetch` (`:1404`, single-flight mỗi tab):
- broadcast, qua `schedule` (`:1530-1538`, debounce 300ms);
- tín hiệu invalidation trong trình duyệt (`:1586`);
- focus hoặc online (`:1606`);
- poll mỗi 60 giây, 15 giây khi degraded (`:1625`, `live-sync.ts:12-13`).

## File Structure

| File | Trách nhiệm |
|---|---|
| Create `supabase/rollouts/2026-11-09-enrollment-list-child-stats.sql` | Hàm SQL gộp (local, không commit) |
| Modify `src/lib/enrollment/queries.ts` | Stats qua RPC; Task 4 (có điều kiện) phân trang keyset |
| Modify `src/lib/enrollment/queries.test.ts` | Test |
| Modify `src/lib/enrollment/live-sync.ts`, `.test.ts` | Nhịp broadcast; degraded poll |
| Modify `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | Dùng nhịp mới |
| Modify `changelog.md` | Ghi thay đổi |

---

### Task 1: Gộp comment/attachment thành một RPC

**Files:**
- Create: `supabase/rollouts/2026-11-09-enrollment-list-child-stats.sql`
- Modify: `src/lib/enrollment/queries.ts` (thêm sau `fetchEnrollmentListChildren`, tức sau dòng 137; thay `:219-229`)
- Test: `src/lib/enrollment/queries.test.ts`

**Interfaces:**
- Produces: `fetchEnrollmentListChildStats(supabase, recordIds): Promise<Map<string, EnrollmentListChildStats>>`, với `EnrollmentListChildStats = { comment_count: number; attachment_count: number; comment_search_text: string }`.

- [ ] **Step 1: Viết rollout.** `record_id` của hai bảng là `not null` (`supabase/schema.sql:6228,6707`), nên full join không sinh key null.

```sql
-- Apply before deploying the matching app code. The enrollment list opened two
-- PostgREST requests per 50 records at once; this returns the same stats in one
-- request and one pool slot. A single jsonb value cannot be cut by max_rows.
create or replace function public.enrollment_list_child_stats(p_record_ids uuid[])
returns jsonb
language sql stable
security invoker
set search_path = public, pg_temp
as $$
  with comment_stats as (
    select record_id,
           count(*)::int as comment_count,
           string_agg(nullif(body, ''), ' ') as comment_search_text
    from enrollment_comments
    where record_id = any(p_record_ids) and deleted_at is null
    group by record_id
  ),
  attachment_stats as (
    select record_id, count(*)::int as attachment_count
    from enrollment_attachments
    where record_id = any(p_record_ids)
    group by record_id
  )
  select coalesce(jsonb_object_agg(
    coalesce(c.record_id, a.record_id),
    jsonb_build_object(
      'comment_count', coalesce(c.comment_count, 0),
      'attachment_count', coalesce(a.attachment_count, 0),
      'comment_search_text', coalesce(c.comment_search_text, '')
    )
  ), '{}'::jsonb)
  from comment_stats c
  full join attachment_stats a on a.record_id = c.record_id;
$$;

revoke all on function public.enrollment_list_child_stats(uuid[])
  from public, anon, authenticated;
grant execute on function public.enrollment_list_child_stats(uuid[])
  to service_role;
notify pgrst, 'reload schema';
```

Tương đương code cũ: `nullif(body,'')` khớp `!row.body` (`queries.ts:374`), `count(*)` khớp `countByRecord`. Thứ tự nối chuỗi không xác định ở cả hai bên và chỉ dùng cho tìm kiếm.

> [codex][P1] Trước rollout, cần kiểm tra kế hoạch thực thi bằng `EXPLAIN (không ANALYZE)` hoặc trên dữ liệu staging với số hồ sơ và comment giờ cao điểm. RPC giảm fan-out nhưng vẫn phải quét/gộp comment và attachment; nếu một lần RPC giữ kết nối lâu hơn, nghẽn pool có thể chỉ chuyển dạng. So p95 của RPC và `/api/enrollment`, không chỉ đếm số request.
>
> [claude] Đã thêm Step 1b ngay dưới. Không có staging (local dùng DB production), nên chạy `EXPLAIN (ANALYZE, BUFFERS)` một lần lúc vắng, sau khi user duyệt. Câu này chỉ là SELECT, công việc bằng đúng một lần nạp danh sách vốn đang chạy hàng nghìn lần mỗi ngày, mà lại cho thời gian thật, điều `EXPLAIN` không ANALYZE không cho được. Có ngưỡng dừng và ngưỡng rollback; p95 của RPC và `/api/enrollment` đã nằm trong Task 5 Step 5.

- [ ] **Step 1b: Đo trước rollout (hỏi user, chạy lúc vắng, 8:00–18:00 VN).** Trước tiên chạy câu đếm, cũng là câu dùng cho điều kiện của Task 4:

```sql
select program, count(*) from enrollment_records where archived_at is null group by program order by 2 desc;
```

Sau đó, với chương trình lớn nhất (thay `'aca'` nếu khác), chạy thân hàm trên toàn bộ hồ sơ của chương trình. Đây là trường hợp xấu nhất, ứng với user thấy hết:

```sql
explain (analyze, buffers)
with ids as (
  select array_agg(id) as a from enrollment_records
  where program = 'aca' and archived_at is null
),
comment_stats as (
  select record_id, count(*)::int as comment_count,
         string_agg(nullif(body, ''), ' ') as comment_search_text
  from enrollment_comments cross join ids
  where record_id = any(ids.a) and deleted_at is null
  group by record_id
),
attachment_stats as (
  select record_id, count(*)::int as attachment_count
  from enrollment_attachments cross join ids
  where record_id = any(ids.a)
  group by record_id
)
select coalesce(jsonb_object_agg(
  coalesce(c.record_id, a.record_id),
  jsonb_build_object(
    'comment_count', coalesce(c.comment_count, 0),
    'attachment_count', coalesce(a.attachment_count, 0),
    'comment_search_text', coalesce(c.comment_search_text, '')
  )
), '{}'::jsonb)
from comment_stats c
full join attachment_stats a on a.record_id = c.record_id;
```

Đi tiếp khi `Execution Time` ≤ 300ms, cả hai bảng dùng index `*_record_idx` hoặc quét tuần tự trên bảng nhỏ, và không có dòng `external merge` / `Disk`. Mốc so sánh: mỗi request lô cũ có p95 khoảng 190–200ms lúc bình thường (Supabase logs 4/11), và một lần nạp danh sách giữ khoảng 9 slot cùng lúc. Vượt ngưỡng thì dừng và báo user, không rollout.

- [ ] **Step 2: Viết test thất bại.** Trong `queries.test.ts`, đổi import vitest thành `import { afterEach, describe, expect, it, vi } from "vitest";`, thêm `fetchEnrollmentListChildStats` vào import từ `@/lib/enrollment/queries`, rồi thêm:

```ts
describe("fetchEnrollmentListChildStats", () => {
  afterEach(() => vi.restoreAllMocks());

  const thenable = (rows: unknown[]) => {
    const result = Promise.resolve({ data: rows, error: null });
    const builder = {
      select: () => builder,
      in: () => builder,
      is: () => result,
      then: result.then.bind(result),
    };
    return builder;
  };

  it("loads every record's stats in one request", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { a: { comment_count: 2, attachment_count: 1, comment_search_text: "x y" } },
      error: null,
    });
    const from = vi.fn();
    const stats = await fetchEnrollmentListChildStats({ rpc, from } as never, ["a", "b"]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("enrollment_list_child_stats", {
      p_record_ids: ["a", "b"],
    });
    expect(from).not.toHaveBeenCalled();
    expect(stats.get("a")).toEqual({
      comment_count: 2,
      attachment_count: 1,
      comment_search_text: "x y",
    });
    expect(stats.get("b")).toBeUndefined();
  });

  it("makes no request for an empty list", async () => {
    const rpc = vi.fn();
    await fetchEnrollmentListChildStats({ rpc, from: vi.fn() } as never, []);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("falls back to the old reads, and says so, while the function is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    const from = vi.fn((table: string) =>
      table === "enrollment_comments"
        ? thenable([
            { record_id: "a", body: "hi" },
            { record_id: "a", body: "" },
          ])
        : thenable([{ record_id: "a" }]),
    );
    const stats = await fetchEnrollmentListChildStats({ rpc, from } as never, ["a", "b"]);
    expect(stats.get("a")).toEqual({
      comment_count: 2,
      attachment_count: 1,
      comment_search_text: "hi",
    });
    expect(stats.get("b")).toEqual({
      comment_count: 0,
      attachment_count: 0,
      comment_search_text: "",
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("throws on database errors other than a missing function", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });
    await expect(
      fetchEnrollmentListChildStats({ rpc, from: vi.fn() } as never, ["a"]),
    ).rejects.toThrow("statement timeout");
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run: `npx vitest run src/lib/enrollment/queries.test.ts`
Expected: FAIL, `fetchEnrollmentListChildStats` không tồn tại.

- [ ] **Step 4: Viết code** trong `queries.ts`, ngay sau `fetchEnrollmentListChildren`. Đường dự phòng giống mẫu `get_notification_summary` (`src/app/api/tasks/notifications/route.ts:105`), nhưng có log để biết prod đang chạy đường nào:

```ts
export type EnrollmentListChildStats = {
  comment_count: number;
  attachment_count: number;
  comment_search_text: string;
};

export async function fetchEnrollmentListChildStats(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  recordIds: readonly string[],
): Promise<Map<string, EnrollmentListChildStats>> {
  if (recordIds.length === 0) return new Map();
  const { data, error } = await supabase.rpc("enrollment_list_child_stats", {
    p_record_ids: [...recordIds],
  });
  if (!error) {
    return new Map(
      Object.entries((data ?? {}) as Record<string, EnrollmentListChildStats>),
    );
  }
  if (error.code !== "PGRST202") throw new Error(error.message);

  // Keep the old path only while the SQL rollout has not reached this DB.
  console.warn("Enrollment list stats RPC missing; using per-chunk reads", {
    records: recordIds.length,
  });
  const { comments, attachments } = await fetchEnrollmentListChildren(supabase, recordIds);
  const commentCounts = countByRecord(comments);
  const commentText = textByRecord(comments);
  const attachmentCounts = countByRecord(attachments);
  return new Map(
    recordIds.map((id) => [
      id,
      {
        comment_count: commentCounts.get(id) ?? 0,
        attachment_count: attachmentCounts.get(id) ?? 0,
        comment_search_text: commentText.get(id) ?? "",
      },
    ]),
  );
}
```

Trong `fetchEnrollmentRecords`, thay `queries.ts:219-229`:

```ts
  const stats = await fetchEnrollmentListChildStats(supabase, ids);
  return records.map((record) => ({
    ...record,
    comment_count: stats.get(record.id)?.comment_count ?? 0,
    comment_search_text: stats.get(record.id)?.comment_search_text ?? "",
    attachment_count: stats.get(record.id)?.attachment_count ?? 0,
  }));
```

- [ ] **Step 5: Chạy test và typecheck**

Run: `npx vitest run src/lib/enrollment/queries.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Dừng, hỏi user cho chạy rollout.** Sau khi chạy, kiểm bằng một câu đọc (hỏi trước):

```sql
select p.proname, r.rolname,
       has_function_privilege(r.rolname, 'public.enrollment_list_child_stats(uuid[])', 'execute') as can_execute
from pg_proc p
cross join (values ('service_role'), ('authenticated'), ('anon')) as r(rolname)
where p.proname = 'enrollment_list_child_stats';
```

Expected: `service_role` true, hai role còn lại false. Thiếu quyền (42501) sẽ làm hỏng cả danh sách, nên chưa thấy kết quả đúng thì không deploy.

> [codex][P1] Task 2 làm người khác thấy thay đổi chậm thêm tối đa khoảng 12 giây nhưng chưa có tỷ lệ request do broadcast. Nên triển khai sau khi đo nguồn refresh bằng telemetry tổng hợp (broadcast/poll/focus/invalidation, không ghi dữ liệu khách hàng), hoặc tách thành rollout riêng với ngưỡng rollback. Bổ sung test hành vi cho hai cam kết quan trọng: burst liên tục không reset timer và scope `full` không bị ghi đè; test hàm tính delay hiện tại chưa bao phủ chúng.
>
> [claude] Đã tách: Task 2a đo nguồn tải lại (chỉ gửi lý do, không dữ liệu khách). Task 2b (giãn nhịp) chỉ làm khi broadcast chiếm từ 25% số lần gọi `/api/enrollment`, và có công tắc rollback là một hằng số. Bộ hẹn giờ đã tách thành `createEnrollmentBroadcastScheduler` để test bằng fake timers hai cam kết: burst liên tục không reset timer, scope `full` không bị ghi đè.

### Task 2a: Đo lần tải lại danh sách đến từ đâu

**Files:**
- Modify: `src/lib/enrollment/live-sync.ts`, `src/lib/enrollment/live-sync.test.ts`
- Modify: `src/app/api/enrollment/route.ts:89-115` (GET)
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`: ref cạnh `:1008-1009`, `refetch` `:1404-1460`, các nơi gọi `:1469,1535,1586,1606,1625,2023,2084,2228`

**Interfaces:**
- Produces: `type EnrollmentRefetchReason`, `parseEnrollmentRefetchReason(value: string | null): EnrollmentRefetchReason`; `refetch(reason?: EnrollmentRefetchReason)`.

- [ ] **Step 1: Viết test thất bại.** Thêm `parseEnrollmentRefetchReason` vào import của `live-sync.test.ts`:

```ts
  it("accepts only known refetch reasons", () => {
    expect(parseEnrollmentRefetchReason("broadcast")).toBe("broadcast");
    expect(parseEnrollmentRefetchReason("poll")).toBe("poll");
    expect(parseEnrollmentRefetchReason("x@example.com")).toBe("other");
    expect(parseEnrollmentRefetchReason(null)).toBe("other");
  });
```

Run: `npx vitest run src/lib/enrollment/live-sync.test.ts`
Expected: FAIL.

- [ ] **Step 2: Viết hàm** trong `live-sync.ts`:

```ts
export const ENROLLMENT_REFETCH_REASONS = [
  "broadcast",
  "invalidation",
  "focus",
  "poll",
  "reconnect",
  "import",
  "parent",
  "retry",
  "other",
] as const;
export type EnrollmentRefetchReason = (typeof ENROLLMENT_REFETCH_REASONS)[number];

export function parseEnrollmentRefetchReason(value: string | null): EnrollmentRefetchReason {
  return (ENROLLMENT_REFETCH_REASONS as readonly string[]).includes(value ?? "")
    ? (value as EnrollmentRefetchReason)
    : "other";
}
```

- [ ] **Step 3: Server ghi một dòng log cho mỗi lần gọi**, chỉ chứa lý do và chương trình. Trong GET của `src/app/api/enrollment/route.ts`, ngay sau đoạn kiểm `program` hợp lệ:

```ts
  console.info(
    `[enrollment-list] reason=${parseEnrollmentRefetchReason(
      new URL(request.url).searchParams.get("reason"),
    )} program=${program}`,
  );
```

Thêm `import { parseEnrollmentRefetchReason } from "@/lib/enrollment/live-sync";`.

- [ ] **Step 4: Client gửi lý do.** Thêm cạnh `recordsRefetchQueuedRef` (`:1009`):

```ts
  const recordsRefetchQueuedReasonRef = useRef<EnrollmentRefetchReason | null>(null);
```

Trong `refetch` (`:1404`), đổi chữ ký thành `(reason: EnrollmentRefetchReason = "other"): Promise<void>`. Trong nhánh đang có request (`if (current)`), thêm `recordsRefetchQueuedReasonRef.current ??= reason;` trước `return current;`. Thay phần `do { ... } while (recordsRefetchQueuedRef.current);` như sau. Chỉ đổi dòng đầu vòng, URL fetch và điều kiện cuối; phần còn lại giữ nguyên:

```ts
    let runReason: EnrollmentRefetchReason = reason;
    const takeQueued = () => {
      if (!recordsRefetchQueuedRef.current) return false;
      runReason = recordsRefetchQueuedReasonRef.current ?? "retry";
      return true;
    };
    const operation = (async () => {
      do {
        recordsRefetchQueuedRef.current = false;
        recordsRefetchQueuedReasonRef.current = null;
        // ... giữ nguyên các dòng cũ cho tới fetch ...
          const response = await fetch(
            `/api/enrollment?program=${program}&reason=${runReason}`,
            { cache: "no-store" },
          );
        // ... giữ nguyên phần còn lại của thân vòng ...
      } while (takeQueued());
    })()
```

Đổi các nơi gọi: `:1469` → `refetch("retry")`, `:1535` → `refetch("broadcast")`, `:1586` → `refetch("invalidation")`, `:1606` → `refetch("focus")`, `:1625` → `refetch("poll")`, `:2023` (nút kết nối lại trên banner degraded) → `refetch("reconnect")`, `:2084` → `refetch("import")`, `:2228` → `refetch("parent")`. Thêm `type EnrollmentRefetchReason` vào import `@/lib/enrollment/live-sync`.

- [ ] **Step 5: Chạy test, typecheck, lint**

Run: `npx vitest run src/lib/enrollment/live-sync.test.ts && npm run typecheck && npx eslint src/app/api/enrollment/route.ts "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"`
Expected: PASS.

- [ ] **Step 6: Dừng.** Deploy cùng Task 1 nếu user duyệt. Sau 2 ngày làm việc, đếm:

```bash
vercel logs --environment production --since 24h -q 'enrollment-list' -n 10000 --json | jq -r '.message' | grep -o 'reason=[a-z]*' | sort | uniq -c
```

Nếu CLI trả ít dòng hơn tổng số lần gọi `/api/enrollment` trong cùng khoảng (xem bằng `vercel metrics`), chia thành từng khung 6 giờ. Sau khi có số liệu thì xoá dòng log ở Step 3 (ghi changelog).

### Task 2b (có điều kiện): Giãn nhịp tải lại do broadcast

**Khi nào làm:** khi `reason=broadcast` chiếm từ 25% số lần gọi `/api/enrollment` trong số liệu của Task 2a. Dưới 25% thì bỏ, vì nó làm UX chậm đi mà lợi ích nhỏ. **Rollback:** đặt `ENROLLMENT_BROADCAST_MIN_REFETCH_GAP_MS = 0` và `ENROLLMENT_BROADCAST_JITTER_MS = 0`, lúc đó hành vi quay về debounce 300ms như cũ.

**Files:**
- Modify: `src/lib/enrollment/live-sync.ts` (sau dòng 13)
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`: import `:62-69`, ref cạnh `:1001`, trong `refetch` `:1404-1460`, effect broadcast `:1522-1577`
- Test: `src/lib/enrollment/live-sync.test.ts`

**Quyết định cần user duyệt:** thay đổi của người khác sẽ hiện chậm hơn. Độ trễ trước khi gửi request tối đa khoảng 12 giây, chưa tính thời gian API trả về và hàng đợi single-flight. Khung chi tiết hồ sơ dùng room topic riêng (`:4314,4362`) nên không đổi. Thao tác của chính mình vẫn hiện ngay.

**Interfaces:**
- Consumes: `refetch(reason)` từ Task 2a.
- Produces: `enrollmentBroadcastRefetchDelay(nowMs: number, lastStartedAtMs: number | null, randomFraction: number): number`; `createEnrollmentBroadcastScheduler(options): { schedule(scope: EnrollmentReconcileScope): void; cancel(): void }`.

- [ ] **Step 1: Viết test thất bại.** Trong `live-sync.test.ts`, đổi import vitest thành `import { afterEach, describe, expect, it, vi } from "vitest";`, thêm `createEnrollmentBroadcastScheduler`, `enrollmentBroadcastRefetchDelay` vào import từ `./live-sync`. Thêm trong `describe("enrollment live sync", ...)`:

```ts
  it("spaces broadcast refetches and spreads tabs apart", () => {
    expect(enrollmentBroadcastRefetchDelay(50_000, null, 0)).toBe(300);
    expect(enrollmentBroadcastRefetchDelay(50_000, 49_000, 0)).toBe(9_000);
    expect(enrollmentBroadcastRefetchDelay(50_000, 10_000, 0)).toBe(300);
    expect(enrollmentBroadcastRefetchDelay(50_000, null, 0.5)).toBe(1_300);
  });
```

Thêm một `describe` mới ở cuối file:

```ts
describe("createEnrollmentBroadcastScheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps refetching during a continuous burst instead of resetting the timer", () => {
    vi.useFakeTimers();
    const runs: number[] = [];
    let last: number | null = null;
    const scheduler = createEnrollmentBroadcastScheduler({
      run: () => {
        last = Date.now();
        runs.push(last);
      },
      lastStartedAt: () => last,
      now: () => Date.now(),
      random: () => 0,
    });
    const start = Date.now();
    for (let i = 0; i < 25; i += 1) {
      scheduler.schedule("enrollments-only");
      vi.advanceTimersByTime(1_000);
    }
    // One event per second for 25 s: runs at +300 ms, +10.3 s, +20.3 s.
    expect(runs.map((t) => t - start)).toEqual([300, 10_300, 20_300]);
  });

  it("does not let a narrower event replace a pending full reload", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const scheduler = createEnrollmentBroadcastScheduler({
      run,
      lastStartedAt: () => null,
      now: () => Date.now(),
      random: () => 0,
    });
    scheduler.schedule("full");
    scheduler.schedule("enrollments-only");
    vi.advanceTimersByTime(300);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("full");
  });

  it("drops a pending run on cancel", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const scheduler = createEnrollmentBroadcastScheduler({
      run,
      lastStartedAt: () => null,
      now: () => Date.now(),
      random: () => 0,
    });
    scheduler.schedule("full");
    scheduler.cancel();
    vi.advanceTimersByTime(5_000);
    expect(run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npx vitest run src/lib/enrollment/live-sync.test.ts`
Expected: FAIL, hàm không tồn tại.

- [ ] **Step 3: Viết hàm** trong `live-sync.ts`, sau `ENROLLMENT_DEGRADED_RECONCILE_MS`:

```ts
export const ENROLLMENT_BROADCAST_MIN_REFETCH_GAP_MS = 10_000;
export const ENROLLMENT_BROADCAST_JITTER_MS = 2_000;

export function enrollmentBroadcastRefetchDelay(
  nowMs: number,
  lastStartedAtMs: number | null,
  randomFraction: number,
): number {
  const elapsed =
    lastStartedAtMs === null ? Number.POSITIVE_INFINITY : nowMs - lastStartedAtMs;
  const gap = Math.max(0, ENROLLMENT_BROADCAST_MIN_REFETCH_GAP_MS - elapsed);
  return (
    Math.max(ENROLLMENT_LIVE_EVENT_DEBOUNCE_MS, gap) +
    Math.floor(randomFraction * ENROLLMENT_BROADCAST_JITTER_MS)
  );
}

/**
 * Coalesces broadcast-triggered list reloads. A pending timer is never reset,
 * so a continuous stream of events still reloads every ~10 s, and a pending
 * "full" scope is never narrowed by a later "enrollments-only" event.
 */
export function createEnrollmentBroadcastScheduler(options: {
  run: (scope: EnrollmentReconcileScope) => void;
  lastStartedAt: () => number | null;
  now?: () => number;
  random?: () => number;
}): { schedule(scope: EnrollmentReconcileScope): void; cancel(): void } {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingScope: EnrollmentReconcileScope | null = null;
  return {
    schedule(scope) {
      pendingScope = pendingScope
        ? mergeEnrollmentReconcileScope(pendingScope, scope)
        : scope;
      if (timer) return;
      timer = setTimeout(
        () => {
          timer = null;
          const runScope = pendingScope;
          pendingScope = null;
          if (runScope) options.run(runScope);
        },
        enrollmentBroadcastRefetchDelay(now(), options.lastStartedAt(), random()),
      );
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pendingScope = null;
    },
  };
}
```

- [ ] **Step 4: Ghi thời điểm ở chính `refetch`**, để khoảng cách tính theo mọi lần gọi danh sách (poll, focus, invalidation, broadcast). Thêm cạnh `refetchSeqRef` (`:1001`):

```ts
  const lastListRefetchStartedAtRef = useRef<number | null>(null);
```

Trong vòng `do` của `refetch`, ngay trước `const response = await fetch(` (dòng fetch đã có `&reason=` từ Task 2a):

```ts
          lastListRefetchStartedAtRef.current = Date.now();
```

- [ ] **Step 5: Đổi `schedule`.** Ở import `@/lib/enrollment/live-sync`, **giữ** `ENROLLMENT_LIVE_EVENT_DEBOUNCE_MS` (vẫn dùng ở `:4314,4362`), thêm `createEnrollmentBroadcastScheduler`, `type EnrollmentReconcileScope`. Thay `:1528-1538` (khai báo `timer`, `active`, `schedule`). Code hiện tại gọi `clearTimeout` rồi đặt lại timer ở mỗi sự kiện, và ghi đè scope bằng sự kiện cuối; scheduler đã test ở Step 1 sửa cả hai:

```ts
    let active = true;
    const scheduler = createEnrollmentBroadcastScheduler({
      run: (scope) => {
        if (!active) return;
        void refetch("broadcast");
        if (scope === "full") void reloadOptions();
      },
      lastStartedAt: () => lastListRefetchStartedAtRef.current,
    });
    const schedule = (scope: EnrollmentReconcileScope) => {
      if (active) scheduler.schedule(scope);
    };
```

Trong cleanup của effect (`:1572-1576`), thay `if (timer) clearTimeout(timer);` bằng `scheduler.cancel();`.

- [ ] **Step 6: Chạy test, typecheck, lint**

Run: `npx vitest run src/lib/enrollment/live-sync.test.ts && npm run typecheck && npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" src/lib/enrollment/live-sync.ts`
Expected: PASS, không có lỗi mới.

- [ ] **Step 7: Dừng.**

### Task 3: Enrollment không poll dày hơn khi Realtime rớt

**Phạm vi:** chỉ Enrollment. `TASK_DEGRADED_RECONCILE_MS` giữ 15 giây, vì nó điều khiển cả `TaskBoardClient.tsx:919` và `TaskDetailDrawer.tsx:400`, còn tải của Tasks đang giảm (41.247 → 27.992).

**Files:**
- Modify: `src/lib/enrollment/live-sync.ts` (sau dòng 13)
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`: ref cạnh `:1016`, `reloadOptions` `:1472-1482`, poll danh sách `:1622-1630`
- Test: `src/lib/enrollment/live-sync.test.ts`

**Không đổi:** `ENROLLMENT_DEGRADED_RECONCILE_MS` (15 giây) và `enrollmentLivePollInterval`, vì chúng còn điều khiển poll của khung chi tiết (`EnrollmentClient.tsx:4404`). Chi tiết chỉ đọc một hồ sơ nên giữ nhịp nhanh khi Realtime rớt.

**Quyết định cần user duyệt:**
- Khi Realtime rớt, **danh sách** cập nhật mỗi 60 giây thay vì 15 giây. Khung chi tiết vẫn 15 giây.
- Danh mục option tải lại theo chu kỳ 5 phút thay vì 1 phút. Khi Realtime chạy bình thường, đổi option vẫn hiện ngay qua broadcast. **Khi Realtime rớt**, tab đang mở có thể thấy danh mục cũ **tối đa 5 phút**, trừ khi người dùng quay lại tab (`:1607`) hoặc bấm nút kết nối lại trên banner (`:2024`). Hệ quả: option vừa thêm chưa hiện trong ô chọn, option vừa xoá vẫn còn. User cần xác nhận luồng chỉnh option chịu được điều này.

> [codex][P1] Khi Realtime thực sự rớt, broadcast không tới tab; vì vậy không thể dùng broadcast để chứng minh option-sets luôn cập nhật ngay. Cần ghi rõ mức stale tối đa 5 phút và kiểm tra luồng chỉnh option có chấp nhận được. Hằng số `ENROLLMENT_DEGRADED_RECONCILE_MS` còn điều khiển cả poll của khung chi tiết (`EnrollmentClient.tsx:4400`), nên chi tiết cũng đổi từ 15 lên 60 giây. Đồng thời thêm single-flight cho `reloadOptions`: hiện hàm này chỉ dùng sequence để bỏ kết quả cũ, vẫn có thể mở nhiều request song song khi API chậm.
>
> [claude] Đúng cả ba điểm. Đã ghi rõ mức cũ tối đa 5 phút khi Realtime rớt và đưa vào phần quyết định của user. Đã tách nhịp poll danh sách thành hằng số riêng `ENROLLMENT_LIST_RECONCILE_MS`, nên chi tiết giữ 15 giây. Đã thêm single-flight cho `reloadOptions` (Step 4). Component remount theo chương trình (`page.tsx:111`, `key={program}`), nên request đang chạy không thể là của chương trình khác.

**Interfaces:**
- Consumes: `refetch(reason)` từ Task 2a.
- Produces: `ENROLLMENT_LIST_RECONCILE_MS = 60_000`, `ENROLLMENT_OPTIONS_POLL_EVERY_TICKS = 5`.

- [ ] **Step 1: Viết test thất bại.** Thêm `ENROLLMENT_LIST_RECONCILE_MS`, `ENROLLMENT_LIVE_RECONCILE_MS` vào import của `live-sync.test.ts`, thêm trong `describe("enrollment live sync", ...)`. Test cũ ở `:52-54` giữ nguyên, vì chi tiết vẫn poll nhanh hơn khi degraded:

```ts
  it("polls the list at the live rate even while realtime is down", () => {
    expect(ENROLLMENT_LIST_RECONCILE_MS).toBe(ENROLLMENT_LIVE_RECONCILE_MS);
  });
```

Run: `npx vitest run src/lib/enrollment/live-sync.test.ts`
Expected: FAIL, hằng số chưa có.

- [ ] **Step 2: Thêm hằng số** trong `src/lib/enrollment/live-sync.ts`, sau `ENROLLMENT_DEGRADED_RECONCILE_MS`:

```ts
/** The list is the expensive read: never poll it faster when realtime is down. */
export const ENROLLMENT_LIST_RECONCILE_MS = ENROLLMENT_LIVE_RECONCILE_MS;
export const ENROLLMENT_OPTIONS_POLL_EVERY_TICKS = 5;
```

- [ ] **Step 3: Poll danh sách và option.** Thêm `ENROLLMENT_LIST_RECONCILE_MS`, `ENROLLMENT_OPTIONS_POLL_EVERY_TICKS` vào import, thay `EnrollmentClient.tsx:1622-1630`. Biến đếm không bị reset khi Realtime chập chờn vì effect không còn phụ thuộc `liveStatus`:

```ts
  useEffect(() => {
    let ticks = 0;
    const timer = window.setInterval(() => {
      if (canRefreshEnrollmentData(document.visibilityState, navigator.onLine)) {
        void refetch("poll");
        ticks += 1;
        if (ticks % ENROLLMENT_OPTIONS_POLL_EVERY_TICKS === 0) void reloadOptions();
      }
    }, ENROLLMENT_LIST_RECONCILE_MS);
    return () => window.clearInterval(timer);
  }, [refetch, reloadOptions]);
```

`enrollmentLivePollInterval` vẫn được dùng ở `:4404` nên giữ import.

- [ ] **Step 4: Single-flight cho `reloadOptions`.** Thêm cạnh `optionsRequestSequenceRef` (`:1016`):

```ts
  const optionsInFlightRef = useRef<Promise<void> | null>(null);
  const optionsQueuedRef = useRef(false);
```

Thay `:1472-1482`. Mọi nơi gọi đều là `void reloadOptions()` (`:1536,1587,1607,1626,2024`), nên việc bắt lỗi mạng bên trong không làm đổi hành vi của nơi gọi:

```ts
  const reloadOptions = useCallback((): Promise<void> => {
    if (optionsInFlightRef.current) {
      // Coalesce triggers that arrive while a request is open into one trailing request.
      optionsQueuedRef.current = true;
      return optionsInFlightRef.current;
    }
    const operation = (async () => {
      do {
        optionsQueuedRef.current = false;
        const sequence = ++optionsRequestSequenceRef.current;
        try {
          const response = await fetch(
            `/api/enrollment/option-sets?program=${program}`,
            { cache: "no-store" },
          );
          if (!response.ok) continue;
          const data = (await response.json()) as { options: EnrollmentOption[] };
          if (sequence !== optionsRequestSequenceRef.current) continue;
          setOptions(data.options);
        } catch {
          // The next trigger retries.
        }
      } while (optionsQueuedRef.current);
    })().finally(() => {
      if (optionsInFlightRef.current === operation) optionsInFlightRef.current = null;
    });
    optionsInFlightRef.current = operation;
    return operation;
  }, [program]);
```

- [ ] **Step 5: Chạy test, typecheck, lint**

Run: `npx vitest run src/lib/enrollment/live-sync.test.ts && npm run typecheck && npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"`
Expected: PASS.

- [ ] **Step 6: Dừng.**

### Task 4 (có điều kiện): Phân trang keyset để vượt 1.000 dòng

**Khi nào làm:** log Vercel đã lưu (5–9/11) không có lần nào `/api/enrollment` trả 503 vì `ENROLLMENT_LIST_TRUNCATED`. Dùng kết quả câu đếm ở Task 1 Step 1b. Chỉ làm khi có chương trình từ 800 dòng (80% giới hạn) trở lên. Task này **tăng** số request khi danh sách lớn, nên không làm sớm.

**Vì sao keyset, không phải offset:** offset theo `updated_at` sẽ bỏ sót dòng khi có người sửa hồ sơ giữa hai trang. Lúc đó `assertEnrollmentRecordsComplete` (`queries.ts:213`) trả 503, mà broadcast sau mỗi lần ghi lại kích hoạt đúng lúc đọc. Keyset theo `id` (không đổi) không bị lệch vì sửa hồ sơ. Nó **không** phải snapshot nhất quán: hồ sơ mới thêm có id nằm sau cursor sẽ chỉ hiện ở lần tải sau, còn hồ sơ bị archive giữa hai trang có thể gây 503 một lần.

**Files:**
- Modify: `src/lib/enrollment/queries.ts:30-53` (kiểu), `:156-171` (`readPrimary`), sau `:212` (sắp xếp)
- Test: `src/lib/enrollment/queries.test.ts`

**Interfaces:**
- Produces: `readAllEnrollmentPages(readPage, pageSize?)`, với `readPage: (afterId: string | null, limit: number, withCount: boolean) => PromiseLike<LooseSupabaseRowsResult>`.

- [ ] **Step 1: Viết test thất bại.** Thêm `readAllEnrollmentPages` vào import:

```ts
describe("readAllEnrollmentPages", () => {
  it("walks pages by id and counts only once", async () => {
    const readPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "a" }, { id: "b" }], error: null, count: 3 })
      .mockResolvedValueOnce({ data: [{ id: "c" }], error: null, count: null });
    const result = await readAllEnrollmentPages(readPage, 2);
    expect(readPage).toHaveBeenNthCalledWith(1, null, 2, true);
    expect(readPage).toHaveBeenNthCalledWith(2, "b", 2, false);
    expect(result.data).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(result.count).toBe(3);
  });

  it("returns a first-page error unchanged so schema fallbacks still run", async () => {
    const error = { code: "42703", message: "missing column" };
    const readPage = vi.fn().mockResolvedValueOnce({ data: null, error, count: null });
    const result = await readAllEnrollmentPages(readPage, 2);
    expect(result.error).toBe(error);
    expect(readPage).toHaveBeenCalledTimes(1);
  });

  it("stops at a short page", async () => {
    const readPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "a" }], error: null, count: 1 });
    await readAllEnrollmentPages(readPage, 2);
    expect(readPage).toHaveBeenCalledTimes(1);
  });

  it("returns a later-page error instead of a partial list", async () => {
    const error = { code: "57014", message: "statement timeout" };
    const readPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "a" }, { id: "b" }], error: null, count: 3 })
      .mockResolvedValueOnce({ data: null, error, count: null });
    const result = await readAllEnrollmentPages(readPage, 2);
    expect(result.error).toBe(error);
    expect(result.data).toBeNull();
  });

  it("keeps the first page's count when a record lands behind the cursor", async () => {
    // A record inserted after page 1 with an id below the cursor is returned by
    // no page. It was not in page 1's count either, so the list is not short:
    // it appears on the next reload. This is not a consistent snapshot.
    const readPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "b" }, { id: "d" }], error: null, count: 3 })
      .mockResolvedValueOnce({ data: [{ id: "e" }], error: null, count: null });
    const result = await readAllEnrollmentPages(readPage, 2);
    expect(result.data).toEqual([{ id: "b" }, { id: "d" }, { id: "e" }]);
    expect(result.count).toBe(3);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận FAIL**

Run: `npx vitest run src/lib/enrollment/queries.test.ts`
Expected: FAIL.

- [ ] **Step 3: Sửa kiểu** ở `queries.ts:30-53`: đổi `type LooseSupabaseRowsResult` thành `export type LooseSupabaseRowsResult`. Trong `LooseSupabaseQueryBuilder`, thay `order` và thêm `gt`, `limit`. Các chỗ đang `await ...order(...)` vẫn chạy vì kết quả await được.

```ts
  order: (
    column: string,
    options: { ascending: boolean }
  ) => LooseSupabaseQueryBuilder & PromiseLike<LooseSupabaseRowsResult>;
  gt: (column: string, value: unknown) => LooseSupabaseQueryBuilder;
  limit: (count: number) => PromiseLike<LooseSupabaseRowsResult>;
```

- [ ] **Step 4: Viết hàm** trước `fetchEnrollmentRecords`:

```ts
const ENROLLMENT_LIST_PAGE_SIZE = 1000;

export async function readAllEnrollmentPages(
  readPage: (
    afterId: string | null,
    limit: number,
    withCount: boolean,
  ) => PromiseLike<LooseSupabaseRowsResult>,
  pageSize = ENROLLMENT_LIST_PAGE_SIZE,
): Promise<LooseSupabaseRowsResult> {
  const first = await readPage(null, pageSize, true);
  if (first.error || !first.data) return first;
  const rows = [...first.data];
  let page = first.data;
  while (page.length === pageSize) {
    const lastId = (page[page.length - 1] as { id?: unknown }).id;
    if (typeof lastId !== "string") break;
    const next = await readPage(lastId, pageSize, false);
    if (next.error) return next;
    page = next.data ?? [];
    rows.push(...page);
  }
  return { data: rows, error: null, count: first.count };
}
```

- [ ] **Step 5: Dùng cho mọi nhánh đọc.** Đổi tên `readPrimary` (`queries.ts:163-171`) thành `readList` và sửa cả hai lần gọi ở `:172-175`. Sau đó thay hai khối tương thích cũ (`:182-193` thiếu `description`, `:194-207` thiếu `custom_values`), để mọi nhánh đều đọc theo trang:

```ts
  if (isMissingEnrollmentDescriptionColumn(error)) {
    const fallback = await readList(ENROLLMENT_RECORD_COLUMNS_WITHOUT_DESCRIPTION);
    rows = fallback.data;
    queryError = fallback.error;
    rowCount = fallback.count;
  }
  if (isMissingEnrollmentCustomValuesColumn(queryError)) {
    const legacyColumns = isMissingEnrollmentDescriptionColumn(queryError)
      ? ENROLLMENT_RECORD_COLUMNS_LEGACY_WITHOUT_DESCRIPTION
      : ENROLLMENT_RECORD_COLUMNS_LEGACY;
    const fallback = await readList(legacyColumns);
    rows = fallback.data;
    queryError = fallback.error;
    rowCount = fallback.count;
  }
```

Định nghĩa `readList`:

```ts
  const readList = (columns: string) =>
    readAllEnrollmentPages((afterId, limit, withCount) => {
      let query = queryClient
        .from("enrollment_records")
        .select(columns, withCount ? { count: "exact" } : undefined)
        .eq("program", program)
        .is("archived_at", null);
      if (afterId) query = query.gt("id", afterId);
      return applyEnrollmentScope(query, scope)
        .order("id", { ascending: true })
        .limit(limit);
    });
```

Danh sách giờ ra theo `id`, nên ngay sau `const records = (rows ?? []).map(coerceEnrollmentRecord);` thêm dòng sắp xếp lại như cũ:

```ts
  records.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
```

`assertEnrollmentRecordsComplete` giữ nguyên để bắt trường hợp `max_rows` bị hạ dưới `pageSize`. Hồ sơ bị archive giữa hai trang vẫn có thể gây 503 một lần, và lần tải sau sẽ hết.

> [codex][P2] Task 4 chỉ phân trang `readPrimary`; các nhánh fallback thiếu cột `description`/`custom_values` vẫn đọc một trang theo `updated_at`, nên khi fallback được dùng và dữ liệu vượt giới hạn, endpoint vẫn trả 503. Nếu kích hoạt Task 4, áp dụng cùng cơ chế cho mọi nhánh đọc hoặc bỏ fallback có kiểm chứng. Bổ sung test cho bản ghi mới xuất hiện giữa hai trang (UUID nhỏ hơn cursor) và cho trang trả lỗi giữa chừng; keyset theo `id` chỉ tránh lệch do sửa `updated_at`, không tạo snapshot nhất quán.
>
> [claude] Đúng. Step 5 giờ cho cả ba nhánh (`readList`) đọc theo trang. Step 1 có thêm hai test: trang sau trả lỗi thì trả lỗi chứ không trả danh sách thiếu; bản ghi mới nằm sau cursor không được trang nào trả, nhưng cũng không nằm trong `count` của trang đầu, nên không gây 503 mà chỉ hiện ở lần tải sau. Phần "Vì sao keyset" đã ghi rõ đây không phải snapshot nhất quán.

- [ ] **Step 6: Chạy test và typecheck**

Run: `npx vitest run src/lib/enrollment/queries.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Dừng.**

### Task 5: Xác minh, changelog, đo

- [ ] **Step 1: Toàn bộ test**

Run: `npx vitest run && npm run typecheck && npx eslint src/lib/enrollment "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"`
Expected: PASS.

- [ ] **Step 2: So dữ liệu, chỉ sau khi rollout Task 1 đã chạy.** Dùng skill `run`, mở `/enrollment?program=aca` ở local (chỉ đọc). Log server **không** được có dòng `Enrollment list stats RPC missing`; nếu có tức là đang so đường cũ với chính nó. Đối chiếu số comment, số attachment ở vài hồ sơ với khung chi tiết, và tìm thử một từ chỉ có trong comment.

- [ ] **Step 3: Ghi `changelog.md`.**

- [ ] **Step 4: Dừng và báo user.** Thứ tự triển khai: chạy rollout, kiểm quyền (Task 1 Step 6), rồi mới deploy.

- [ ] **Step 5: Đo 3 ngày làm việc sau deploy**, so với 2–6/11 và 9/11. Đọc Supabase logs cần token, nên hỏi user trước.
  - **Sự cố:** số `PGRST003`/ngày, p95 REST ở gateway giờ cao điểm (14:00–24:00 UTC), số phút p95 trên 3 giây.
  - **Tải:** REST/phút đỉnh.
  - **Máy:** RAM còn trống, swap đang dùng, tốc độ đọc từ swap, iowait. Đo một lần trong giờ cao điểm (21:00–23:00 VN) qua `/customer/v1/privileged/metrics` (hai mẫu cách 60 giây), hoặc ảnh chụp Dashboard. Số kết nối và thời gian chờ pool lấy từ Dashboard → Reports → Database. Mốc so sánh lúc vắng 10/11: còn trống 1,17GB, swap 0.
  - **Task 1, độ trễ:** p95 `origin_time` của `/rest/v1/rpc/enrollment_list_child_stats` ở gateway, và p95 thời gian chạy `/api/enrollment` (`vercel metrics vercel.function_invocation.function_duration_ms -f 'route:"/api/enrollment"' -a p95`), so với 3 ngày trước deploy. **Rollback** khi p95 `/api/enrollment` tệ hơn 30%, hoặc p95 của RPC trên 1 giây giờ cao điểm: revert code (hàm SQL để lại cũng không ảnh hưởng gì).
  - **Task 1:** request con trên mỗi lần đọc danh sách. Đạt khi số request vào `enrollment_comments` + `enrollment_attachments` gần 0 và `rpc/enrollment_list_child_stats` thay vào chỗ đó.
  - **Task 2a/2b:** tỷ lệ `reason=` theo log Task 2a, và `/api/enrollment` trên mỗi lần mở trang `/enrollment`, trước và sau Task 2b.

```bash
vercel metrics vercel.external_api_request.count -f 'requestHostname:cxdgupxfhvtsitmcmpiw.supabase.co' --prod --since 3d --group-by requestPath --json
vercel metrics vercel.function_invocation.count --prod --since 3d --granularity 1d --group-by route --json
```

## Không làm trong plan này (đã cân nhắc)

- **Cache tra quyền `portal_account`:** 1.419–1.795 request mỗi cửa sổ 6–15 phút (khoảng 13% REST), 629 log timeout tra quyền ngày 9/11. Đây là thay đổi RBAC: route chuông cố ý đọc quyền mới nhất (`notifications/route.ts:57-58`). Cần user quyết.
- **`attachment_upload_intents`:** 467 request trong cửa sổ sập 9/11, do `recoverSavedAttachments` chạy ở mọi lần mở chi tiết (`api/enrollment/[id]/detail/route.ts:5`). Ứng viên cho plan sau.
- **Bảng cấu hình:** `table_column`, `enrollment_options`, `table_column_option`, `enrollment_option_sets` chiếm 1.004 request (khoảng 9%) trong cửa sổ sập. Task 3 chỉ đụng một phần.
- **Embed PostgREST thay cho RPC:** không cần rollout, nhưng phải đổi mọi bộ cột `ENROLLMENT_RECORD_COLUMNS*` (gồm các nhánh tương thích), có thể dính PGRST201 vì `enrollment_attachments` có hai khoá ngoại tới cụm comment/record, và chưa thử. RPC đi theo mẫu đã chạy (`get_notification_summary`).
- **Tìm comment trên server, vá từng hồ sơ thay vì tải lại danh sách:** đổi hành vi, cần thiết kế riêng.
