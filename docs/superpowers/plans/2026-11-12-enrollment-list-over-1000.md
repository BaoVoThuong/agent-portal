# ACA Enrollment sập khi danh sách vượt 1.000 hồ sơ: root cause và plan xử lý

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Người thấy toàn bộ danh sách Enrollment (Manager, CS company-wide) mở lại được ACA. Danh sách đọc đủ mọi hồ sơ dù chương trình có hơn 1.000 hồ sơ.

**Architecture:** `fetchEnrollmentRecords` đang đọc cả danh sách bằng một request PostgREST, trong khi Supabase cắt mỗi response ở 1.000 dòng. Plan đổi sang đọc từng trang 1.000 dòng theo keyset `id > lastId`, dùng helper `fetchAllByKeyset` mà Task board đã chạy production. Task 0 (không cần code) gỡ chặn ngay trong lúc chờ deploy.

**Tech Stack:** Next.js App Router (đọc `node_modules/next/dist/docs/` trước khi đụng API Next), TypeScript, Supabase/PostgREST, Vitest.

**Trạng thái 12/11/2026 09:30 VN:** sự cố vẫn đang diễn ra. Chưa sửa gì, chưa đổi cấu hình.

---

## 1. Root cause

### 1.1 Triệu chứng

- Từ 01:39 VN 12/11, mở Enrollment hiện trang lỗi mặc định của Next.js: "This page couldn't load. A server error occurred. Reload to try again." kèm `ERROR <digest>`.
- Người báo trên Slack đều là CS: lúc 01:51, 01:54, 05:32 và 05:47 VN. Họ nói các phần khác của portal vẫn vào được, chỉ ACA Enrollment lỗi.
- Mã lỗi trên ảnh chụp khớp với log Vercel. `ERROR 776423140` là `EnrollmentListTruncatedError (1000 of 1023)` lúc 18:50:02 UTC. `ERROR 715324772` là `(1000 of 1042)` lúc 18:58:29 UTC.

### 1.2 Bằng chứng

Giờ UTC trước, giờ VN (UTC+7) trong ngoặc.

| Nguồn | Thấy gì |
|---|---|
| Vercel runtime log, `level:error`, 48 giờ | Có 265 lỗi `Error [EnrollmentListTruncatedError]: Enrollment list is larger than the server response limit (1000 of N rows loaded)` trên `GET /enrollment`. Lỗi đầu lúc 18:39:55 (01:39 VN) với N = 1005, lỗi cuối lúc 00:44 12/11 với N = 1060. N tăng dần 1005 → 1061. Request đến từ hkg1, sin1, iad1, sfo1, cle1, tức cả người ở VN lẫn người ở Mỹ. Ngoài lỗi này, log chỉ có tiếng ồn DEP0169 `url.parse` và 6 lần đăng nhập sai. |
| Vercel request log, `httpStatus >= 500` | Có 241 lần `/api/enrollment` trả 503 từ 18:36 đến 19:28 (01:36–02:28 VN). Đây là các tab mở từ trước đó, đang poll danh sách mỗi 60 giây. Trang `/enrollment` không hiện là 5xx: từ 18:30 đến 19:30 có 1.594 request trang, tất cả trả 200. Trang stream (`loading.tsx`), nên status 200 đã gửi đi trước khi server component ném lỗi. |
| Supabase API gateway (edge_logs) | Request danh sách ACA đầy đủ, ở mốc 5 phút 18:30, trả `200` với `Content-Range: 0-999/1000`. Ở mốc 18:35 bắt đầu trả **`206 Partial Content`** với `0-999/1001`, sau đó `/1002` … `/1053`. Tức PostgREST chỉ trả 1.000 dòng còn `count=exact` báo tổng thật. |
| Supabase Management API `GET /v1/projects/<ref>/postgrest` | `max_rows: 1000`, là mặc định của Supabase. |
| Supabase postgres_logs, 18:00–20:00 | Không có dòng `ERROR`, `FATAL` hay `PANIC`. |
| Supabase gateway, độ trễ | Request danh sách ACA (≥ 900 dòng) ngày 11/11 có p50 66 ms và p95 112 ms. DB khoẻ, không giống đợt nghẽn 06–09/11. |

### 1.3 Cơ chế (chuỗi nhân quả, trích code thật)

**Bước 1: Danh sách được đọc bằng MỘT request, không phân trang.** Đây là `src/lib/enrollment/queries.ts:196-215`:

```ts
export async function fetchEnrollmentRecords(
  program: EnrollmentProgram,
  scope: EnrollmentScope
): Promise<EnrollmentRecordWithStats[]> {
  const supabase = getSupabaseAdmin();
  const queryClient = supabase as unknown as LooseSupabaseClient;
  const readPrimary = (columns: string) =>
    applyEnrollmentScope(
      queryClient
        .from("enrollment_records")
        .select(columns, { count: "exact" })
        .eq("program", program)
        .is("archived_at", null),
      scope
    ).order("updated_at", { ascending: false });
  let primary = await readPrimary(ENROLLMENT_RECORD_COLUMNS);
```

Query này không có `.range()` hay `.limit()`. Hai nhánh tương thích schema cũ ở `:222-248` cũng đọc theo cùng kiểu.

**Bước 2: PostgREST cắt ở 1.000 dòng.** Supabase đặt `max_rows = 1000` cho mọi response. Khi tổng lớn hơn, PostgREST trả 1.000 dòng đầu và header `Content-Range: 0-999/<tổng>` (HTTP 206). supabase-js đưa tổng đó vào `count`.

**Bước 3: Code cố ý "fail closed".** Dòng `queries.ts:253` gọi `assertEnrollmentRecordsComplete(rows, rowCount)`, định nghĩa ở `:282-290`:

```ts
export function assertEnrollmentRecordsComplete(
  rows: unknown[] | null,
  count: number | null | undefined
): void {
  const loaded = rows?.length ?? 0;
  if (typeof count === "number" && count > loaded) {
    throw new EnrollmentListTruncatedError(count, loaded);
  }
}
```

Hàm cố ý ném lỗi: một danh sách thiếu mà không báo sẽ khiến người dùng tưởng hồ sơ không tồn tại rồi tạo trùng. Hàm chỉ chặn được trường hợp đó. Plan 2026-10-02, mục D2, ghi rằng phải phân trang trước khi chương trình nào chạm khoảng 800 hồ sơ.

**Bước 4: Trang không bắt lỗi, và Enrollment không có `error.tsx`.** `src/app/(authed)/enrollment/page.tsx:56-80` chờ `fetchEnrollmentRecords` trong một `Promise.all` mà không có try/catch:

```ts
  const [records, people, agents, /* … */ scope] = await Promise.all([
    scopePromise.then((resolvedScope) =>
      fetchEnrollmentRecords(program, resolvedScope),
    ),
    fetchEnrollmentPeople(),
    // …
  ]);
```

`src/app/(authed)/enrollment/` chỉ có `page.tsx`, `loading.tsx` và `_components`. Trong cả app, chỉ `config/` có `error.tsx`. Vì vậy Next.js hiện trang lỗi chung, digest băm từ message lỗi. Message chứa số dòng, nên mỗi tổng N cho một digest riêng: 34 digest cho 34 giá trị N.

**Bước 5: Bấm "Enrollment" là vào thẳng ACA.** `src/lib/enrollment/types.ts:28-30`:

```ts
export function toEnrollmentProgram(value: unknown): EnrollmentProgram {
  return isEnrollmentProgram(value) ? value : "aca";
}
```

Menu mở `/enrollment` không kèm `?program=`, nên trang luôn dựng ACA trước. Người dùng thấy như cả mục Enrollment hỏng. Medicare (109 hồ sơ), Medicaid (13) và Other Service (5) vẫn chạy nếu gõ URL có `?program=`.

### 1.4 Vì sao chỉ một số người bị

Phạm vi xem do `buildEnrollmentScope` quyết định (`src/lib/enrollment/scope.ts:138-168`). Hàm trả `{ seeAll: true }` cho Manager, và cho worker không phải Agent được chọn mà cũng không làm Assistant của ai, tức CS company-wide. Khi `seeAll` là true, `applyEnrollmentScope` không lọc gì (`scope.ts:200-204`), nên những người này đọc toàn bộ 1.060 hồ sơ ACA và bị cắt.

Agent và Assistant bị lọc theo `agent_email`, `created_by_email` và các cột người, nên chỉ đọc vài chục đến khoảng 420 hồ sơ, dưới trần. Log gateway khớp điều này: các request có tổng nhỏ (`/4`, `/43`, `/397`, `/420`) vẫn trả 200 suốt thời gian sự cố.

Ngoài trang chính, hai chỗ khác cũng hỏng với nhóm người này:
- **Export ACA** trả 503 (`src/app/api/enrollment/export/route.ts:86-100`).
- **Tab mở từ trước 18:35** poll `/api/enrollment` và nhận 503 (`src/app/api/enrollment/route.ts:125-134`). Client bỏ qua im lặng (`EnrollmentClient.tsx:1442`, `if (!response.ok) continue;`), nên những tab đó hiện danh sách cũ khoảng 50 phút mà không báo gì.

### 1.5 Vì sao xảy ra lúc này

Số hồ sơ ACA đang mở, lấy theo tổng `Content-Range` lớn nhất mỗi giờ trên gateway (UTC). Giờ nào chỉ có Agent/Assistant mở trang thì con số thấp hơn, vì đó là phần của họ chứ không phải tổng. Bảng chỉ lấy các giờ có người xem toàn bộ.

| Thời điểm | Số hồ sơ ACA | Lý do |
|---|---|---|
| 09/11 00:00 | 594 | Lần đầu có người xem toàn bộ mở trang, sau Chủ nhật 08/11 |
| 09/11 → 10/11 22:00 | 594 → 628 | Tạo tay và vài lần Import nhỏ, khoảng 15–20 hồ sơ/ngày |
| **10/11 23:00** (06:00 VN 11/11) | **963** | Import thêm 335 hồ sơ. Có 2 lần `POST /api/enrollment/import` trong giờ đó. |
| 11/11 00:00 → 17:00 | 961 → 969 | |
| **11/11 18:00 → 19:10** | **969 → 1.061** | Khoảng 90 hồ sơ tạo tay. Có 78 lượt `POST /api/enrollment` trong giờ 18 UTC, ngày thường chỉ 1–7 lượt/giờ. |
| 11/11 18:35 | vượt 1.000 | Bắt đầu sập |

Plan `2026-11-09-enrollment-list-load.md` đã có sẵn Task 4 "Phân trang keyset để vượt 1.000 dòng", kèm điều kiện "chỉ làm khi có chương trình từ 800 dòng trở lên". Lúc đo một lần ngày 10/11 (preflight trước khi chạy rollout), ACA có 614 hồ sơ, nên Task 4 bị hoãn. Không có cảnh báo tự động nào, nên một lần Import 335 hồ sơ đã đưa ACA từ 628 lên 963 mà không ai biết. Ngày hôm sau, việc tạo tay đẩy ACA qua mốc 1.000.

**Tóm lại:** danh sách Enrollment được nạp bằng một request PostgREST không phân trang, trong khi Supabase cắt mỗi response ở 1.000 dòng. Code cố ý ném `EnrollmentListTruncatedError` khi thiếu dòng, nhưng trang `/enrollment` không bắt lỗi đó, và `/enrollment` mặc định mở ACA. Vì vậy, khi ACA vượt 1.000 hồ sơ lúc 18:35 UTC 11/11, mọi người xem toàn bộ danh sách (Manager và CS company-wide) không mở được Enrollment. Việc sửa gốc (phân trang keyset) đã được thiết kế từ trước nhưng bị hoãn theo một ngưỡng chỉ đo tay một lần, và Import có thể thêm hàng trăm hồ sơ trong một lượt.

### 1.6 Đã loại trừ

- **DB hay Supabase nghẽn:** không có lỗi Postgres, độ trễ bình thường, gateway trả 200/206 đúng thiết kế. Không giống đợt nghẽn RAM 06–09/11.
- **Bản deploy mới:** deployment `dpl_6KjNsvoms7HfuChiHEN4VEu3T9mE` được tạo lúc 18:45 UTC 10/11 (01:45 VN 11/11), khớp giờ commit 66b8264. Nó chạy khoảng 24 giờ, lúc ACA có 961–969 hồ sơ, mà không có lỗi này. Lỗi bắt đầu đúng lúc tổng vượt 1.000, và message ghi rõ số dòng.
- **Đổi Consent sang dropdown (efed99d, 66b8264):** lỗi là cắt dòng, không phải lỗi render. Chương trình khác cùng code vẫn chạy.

---

## 2. Global Constraints

- Không commit, không push khi user chưa bảo. Mỗi chỗ "Dừng" trong plan thay cho bước commit.
- Đổi cấu hình production (Task 0) phải có user đồng ý rõ ràng.
- Local dev dùng chung DB production: chỉ thao tác đọc, không chạy thử thao tác ghi.
- Thư mục `agent-portal` dùng chung với Codex: chạy `git branch --show-current` và `git status` trước khi sửa.
- Mọi thay đổi logic ghi vào `agent-portal/changelog.md`.
- Không đổi RBAC, không đổi phạm vi dữ liệu (`applyEnrollmentScope`), không đổi thứ tự hiển thị.
- Số đo production lấy từ Vercel logs/metrics hoặc Supabase logs. Không chạy vòng lặp query lên DB.
- Plan này chỉ commit cùng lượt với code hiện thực nó. Repo `origin` là public, nên plan không ghi project ref hay tên người.

## 3. Bối cảnh codebase (đọc trước)

**Helper keyset có sẵn.** `src/lib/pagination/keyset.ts` có `fetchAllByKeyset(fetchPage, { maxRows, isTransient })`. Hàm đọc tuần tự theo `id > lastSeenId`, chỉ dừng khi gặp trang rỗng hoặc đã đủ `count` của trang đầu. Nó không dừng ở trang ngắn, nên vẫn đúng nếu `max_rows` bị hạ thấp hơn kích thước trang. Lỗi tạm thời được thử lại đúng một lần, rồi ném `new Error(page.error.message)`. Lưu ý: **mất `code`**. Kết quả trả về là `{ rows, total, truncated }`. Phần chú thích ở `keyset.ts:28-49` giải thích vì sao không dùng OFFSET: chèn hoặc xoá trước biên trang sẽ làm đọc trùng hoặc bỏ sót dòng.

Hợp đồng của `fetchPage(afterId)`: lọc `id > afterId` khi `afterId` khác null, sắp `id` tăng dần, và **chỉ** xin `count: exact` khi `afterId === null`.

**Task board dùng helper này như sau** (`src/lib/tasks/queries.ts:98-120` và `:145-165`, rút gọn):

```ts
  let query = supabase
    .from("tasks")
    .select(shape.columns, countOption)   // countOption = afterId === null ? { count: "exact" } : {}
    .is("archived_at", null)
    .order("id", { ascending: true })
    .limit(TASK_PAGE_SIZE);               // 1000
  if (afterId !== null) query = query.gt("id", afterId);
// …
    const result = await buildTaskQuery(supabase, { columns, workerScope }, afterId);
    const error = result.error as { code?: string; message?: string } | null;
    return {
      rows: result.data as unknown as { id: string }[] | null,
      error: error ? { ...error, status: result.status } : null,
      count: result.count,
    };
// …
    page = await fetchAllByKeyset(
      (afterId) => readPage(TASK_COLUMNS, afterId),
      { maxRows: TASK_MAX_ROWS, isTransient: isTransientPostgrestError }   // TASK_MAX_ROWS = 5_000
    );
```

**Thứ tự SQL không phải thứ tự hiển thị.** `EnrollmentClient.tsx:963-967` mặc định sắp theo `createdAt` giảm dần. `rankedRecords` (`:1307-1320`) luôn đi qua `sortRecords` (`:6352-6368`), và dòng bằng nhau thì xếp theo `updated_at`. Vì vậy đổi `ORDER BY updated_at` sang `ORDER BY id` không đổi gì trên màn hình.

**Hàm thống kê con chịu được hơn 1.000 id.** `fetchEnrollmentListChildStats` gọi RPC `enrollment_list_child_stats(p_record_ids uuid[])`. Danh sách id đi trong body POST và hàm trả một giá trị `jsonb`, nên `max_rows` không cắt được.

**Các nhánh tương thích schema** (`queries.ts:211-252`). Khi thiếu `carrier_ids`, đọc lại không có cột đó. Khi thiếu `description` hoặc `custom_values`, đọc lại với bộ cột cũ. Khi thiếu cột tracking, ném `EnrollmentSchemaOutOfDateError`. Phần nhận diện dựa vào `error.code` (`42703`, `PGRST204`) cộng với message, nên lỗi phải giữ nguyên `code` thì các nhánh này mới chạy. Production đã có đủ cột, nên các nhánh này không chạy, nhưng plan giữ nguyên. Codex review plan 09/11 (P2) yêu cầu mọi nhánh đọc phải đi cùng cơ chế phân trang.

**Test hiện có.** `src/lib/enrollment/queries.test.ts` dùng Vitest. Mẫu giả lập Supabase theo trang (builder có `then`, `vi.doMock("@/lib/supabase")` rồi import động) nằm ở `src/lib/tasks/queries.test.ts:380-512`.

## 4. File Structure

| File | Việc |
|---|---|
| Modify `src/lib/enrollment/queries.ts` | Kiểu builder (`gt`, `limit`, `status`); hằng số trang và trần; viết lại phần đọc của `fetchEnrollmentRecords` |
| Modify `src/lib/enrollment/queries.test.ts` | 6 test phân trang |
| Modify `changelog.md` | Ghi thay đổi |
| (Task 3, chờ duyệt) `src/app/(authed)/enrollment/error.tsx`, `EnrollmentClient.tsx`, `aca-overview-data.ts`, `stage-metrics.ts`, `overview-data.ts` | Hardening |

---

## Task 0: Gỡ chặn ngay, không cần code (user quyết)

**Context:** Task 1 cần code, review và deploy. Trong lúc chờ, nâng trần `max_rows` để request hiện tại trả đủ 1.060 dòng. Khi đó `count` bằng số dòng nhận được, `assertEnrollmentRecordsComplete` không ném lỗi, và trang chạy lại ngay mà không cần deploy.

- [ ] **Step 1:** Supabase Dashboard → project EPS Portal → Project Settings → Data API → **Max rows**: đổi `1000` thành `2000`, rồi Save. Cách khác là gọi Management API bằng Personal Access Token: `PATCH https://api.supabase.com/v1/projects/<ref>/postgrest` với body `{"max_rows": 2000}`. `<ref>` là subdomain trong `NEXT_PUBLIC_SUPABASE_URL`.
- [ ] **Step 2:** Đọc lại cấu hình bằng `GET https://api.supabase.com/v1/projects/<ref>/postgrest`. Kỳ vọng `max_rows: 2000`.
- [ ] **Step 3:** Nhờ một tài khoản CS mở lại `/enrollment`. Kiểm log Vercel không còn `EnrollmentListTruncatedError` mới:
  `vercel logs --environment production --since 15m -q 'level:error' -n 500 --json | grep -c EnrollmentListTruncatedError`. Kỳ vọng là 0.

**Rủi ro:** `max_rows` áp cho mọi request PostgREST không tự đặt `limit`. Những request đó giờ trả tối đa 2.000 dòng thay vì 1.000, tức response lớn hơn nhưng bớt cắt cụt im lặng. Cách lùi là đặt lại `1000`.
**Thời hạn:** ACA tăng tới hàng trăm hồ sơ mỗi lần Import, nên 2.000 chỉ là đệm tạm. Task 1 phải theo ngay sau.

## Task 1: Phân trang keyset cho `fetchEnrollmentRecords` (sửa gốc)

**Context:** Đây là Task 4 của plan 09/11, đã sửa theo review và đổi sang dùng helper chung. Danh sách được đọc từng trang 1.000 dòng theo `id > lastId`, tuần tự, `count: exact` chỉ ở trang đầu, scope áp lại cho mọi trang, và cả ba nhánh schema cũng đọc theo trang. Sau khi đọc xong:
- Nếu thiếu dòng so với `count` của trang đầu, tức một hồ sơ bị archive hoặc rời scope giữa hai trang, thì chỉ log cảnh báo, **không** chặn trang. Lần poll sau (≤ 60 giây) tự đúng.
- Vượt trần 5.000 dòng (bằng Task board) thì vẫn ném `EnrollmentListTruncatedError` như cũ.
- Từ 4.000 dòng (80% trần) thì log cảnh báo.

Tải thêm là nhỏ: ACA 1.060 hồ sơ cần 2 request nối nhau thay vì 1. Trang thứ hai khoảng 60 dòng, trong khi trang 1.000 dòng có p95 112 ms.

**Files:**
- Modify: `src/lib/enrollment/queries.ts`
- Test: `src/lib/enrollment/queries.test.ts`

- [ ] **Step 0: Kiểm nhánh.** Chạy `git branch --show-current && git log -1 --oneline && git status --short`. Phải đang ở `main` (hoặc nhánh user chỉ định) và không có thay đổi lạ trong hai file trên.

- [ ] **Step 1: Viết test thất bại.** Thêm cuối `src/lib/enrollment/queries.test.ts`. Dòng import `vitest` ở đầu file đã có `afterEach, describe, expect, it, vi`.

```ts
describe("fetchEnrollmentRecords paging", () => {
  type ListPage = {
    data: unknown[] | null;
    error: { code?: string; message?: string } | null;
    count?: number | null;
    status?: number;
  };

  afterEach(() => {
    vi.doUnmock("@/lib/supabase");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const rowsFrom = (start: number, length: number) =>
    Array.from({ length }, (_, index) => ({
      id: `rec-${String(start + index).padStart(5, "0")}`,
      program: "aca",
      created_at: "2026-11-11T00:00:00.000Z",
      updated_at: "2026-11-11T00:00:00.000Z",
    }));

  // Mỗi lần await builder trả trang kế tiếp trong `pages`.
  async function load(pages: ListPage[]) {
    vi.resetModules();
    const calls = {
      select: [] as unknown[][],
      gt: [] as unknown[][],
      order: [] as unknown[][],
      limit: [] as unknown[][],
      or: [] as string[],
    };
    let served = 0;
    const builder = {
      select: vi.fn((...args: unknown[]) => {
        calls.select.push(args);
        return builder;
      }),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      or: vi.fn((value: string) => {
        calls.or.push(value);
        return builder;
      }),
      gt: vi.fn((...args: unknown[]) => {
        calls.gt.push(args);
        return builder;
      }),
      order: vi.fn((...args: unknown[]) => {
        calls.order.push(args);
        return builder;
      }),
      limit: vi.fn((...args: unknown[]) => {
        calls.limit.push(args);
        return builder;
      }),
      then: (
        resolve: (value: ListPage) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => {
        const page = pages[Math.min(served, pages.length - 1)];
        served += 1;
        return Promise.resolve(page).then(resolve, reject);
      },
    };
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    vi.doMock("@/lib/supabase", () => ({
      getSupabaseAdmin: () => ({ from: vi.fn(() => builder), rpc }),
    }));
    const queries = await import("@/lib/enrollment/queries");
    return { queries, calls, rpc };
  }

  it("reads past PostgREST's 1,000-row cap with an id keyset", async () => {
    const { queries, calls, rpc } = await load([
      { data: rowsFrom(0, 1000), error: null, count: 1060, status: 206 },
      { data: rowsFrom(1000, 60), error: null, count: null, status: 200 },
    ]);
    const records = await queries.fetchEnrollmentRecords("aca", { seeAll: true });
    expect(records).toHaveLength(1060);
    expect(new Set(records.map((record) => record.id)).size).toBe(1060);
    expect(calls.select.map(([, options]) => options)).toEqual([
      { count: "exact" },
      undefined,
    ]);
    expect(calls.gt).toEqual([["id", "rec-00999"]]);
    expect(calls.order).toEqual([
      ["id", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(calls.limit).toEqual([[1000], [1000]]);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("does not fail the page when a record is archived between pages", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { queries } = await load([
      { data: rowsFrom(0, 1000), error: null, count: 1001, status: 206 },
      { data: [], error: null, count: null, status: 200 },
    ]);
    const records = await queries.fetchEnrollmentRecords("aca", { seeAll: true });
    expect(records).toHaveLength(1000);
    expect(warn).toHaveBeenCalledWith("[enrollment-list] short read", {
      program: "aca",
      total: 1001,
      loaded: 1000,
    });
  });

  it("still fails closed above the 5,000-row cap", async () => {
    const pages = Array.from({ length: 5 }, (_, page) => ({
      data: rowsFrom(page * 1000, 1000),
      error: null,
      count: page === 0 ? 5001 : null,
      status: 206,
    }));
    const { queries } = await load(pages);
    await expect(
      queries.fetchEnrollmentRecords("aca", { seeAll: true }),
    ).rejects.toBeInstanceOf(queries.EnrollmentListTruncatedError);
  });

  it("keeps the schema fallback when carrier_ids is missing", async () => {
    const { queries, calls } = await load([
      {
        data: null,
        error: {
          code: "42703",
          message: "column enrollment_records.carrier_ids does not exist",
        },
        count: null,
        status: 400,
      },
      { data: rowsFrom(0, 2), error: null, count: 2, status: 200 },
    ]);
    const records = await queries.fetchEnrollmentRecords("aca", { seeAll: true });
    expect(records).toHaveLength(2);
    expect(String(calls.select[0][0])).toContain("carrier_ids");
    expect(String(calls.select[1][0])).not.toContain("carrier_ids");
  });

  it("applies the viewer's scope to every page", async () => {
    const { queries, calls } = await load([
      { data: rowsFrom(0, 1000), error: null, count: 1001, status: 206 },
      { data: rowsFrom(1000, 1), error: null, count: null, status: 200 },
    ]);
    await queries.fetchEnrollmentRecords("aca", {
      seeAll: false,
      agentEmails: ["agent@example.com"],
      viewerEmail: "cs@example.com",
      personColumns: [],
    } as never);
    expect(calls.or).toHaveLength(2);
    expect(calls.or[1]).toBe(calls.or[0]);
  });

  it("returns an error instead of a partial list when a later page fails", async () => {
    const timeout = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    const { queries } = await load([
      { data: rowsFrom(0, 1000), error: null, count: 1500, status: 206 },
      { data: null, error: timeout, count: null, status: 500 },
      { data: null, error: timeout, count: null, status: 500 },
    ]);
    await expect(
      queries.fetchEnrollmentRecords("aca", { seeAll: true }),
    ).rejects.toThrow("canceling statement due to statement timeout");
  });
});
```

Ghi chú cho người viết test: lớp `EnrollmentListTruncatedError` lấy từ module import động (`queries.EnrollmentListTruncatedError`), không lấy từ import tĩnh ở đầu file. Sau `vi.resetModules()` hai bản là hai class khác nhau. Builder tự tham chiếu chính nó giống mẫu ở `src/lib/tasks/queries.test.ts:399-423`. Nếu `npm run typecheck` báo TS7022 thì khai báo kiểu cho `builder` là `Record<string, unknown>`.

- [ ] **Step 2: Chạy, xác nhận FAIL.**
Run: `npx vitest run src/lib/enrollment/queries.test.ts`
Expected: FAIL. Test 1 nhận 1.000 thay vì 1.060, hoặc ném `EnrollmentListTruncatedError`, vì code cũ chỉ đọc một trang.

- [ ] **Step 3: Sửa kiểu builder** ở `queries.ts:31-53`. Thêm `status` vào kết quả, thêm `gt` và `limit`, và cho `order` trả lại builder:

```ts
type LooseSupabaseRowsResult = {
  data: unknown[] | null;
  error: SupabaseLikeError;
  count?: number | null;
  /** HTTP status supabase-js trả kèm; fetchAllByKeyset dùng để nhận ra 429/5xx là lỗi tạm thời. */
  status?: number;
};
type LooseSupabaseRowResult = {
  data: unknown | null;
  error: SupabaseLikeError;
};
type LooseSupabaseQueryBuilder = {
  select: (
    columns: string,
    options?: { count?: "exact" }
  ) => LooseSupabaseQueryBuilder;
  eq: (column: string, value: unknown) => LooseSupabaseQueryBuilder;
  in: (column: string, values: readonly string[]) => LooseSupabaseQueryBuilder;
  is: (column: string, value: unknown) => LooseSupabaseQueryBuilder;
  gt: (column: string, value: unknown) => LooseSupabaseQueryBuilder;
  order: (
    column: string,
    options: { ascending: boolean }
  ) => LooseSupabaseQueryBuilder;
  limit: (count: number) => PromiseLike<LooseSupabaseRowsResult>;
  maybeSingle: () => Promise<LooseSupabaseRowResult>;
};
```

Sau Step 5, chỗ duy nhất gọi `.order(` trên `queryClient` là `readListPage`. Kiểm bằng `grep -n "order(" src/lib/enrollment/queries.ts`. `fetchEnrollmentRecordById` dùng `.maybeSingle()` nên không bị ảnh hưởng.

- [ ] **Step 4: Thêm import và hằng số.** Thêm import ở đầu file, cạnh các import hiện có:

```ts
import {
  fetchAllByKeyset,
  isTransientPostgrestError,
} from "@/lib/pagination/keyset";
```

Thêm ngay sau `const ENROLLMENT_CHILD_RECORD_ID_CHUNK_SIZE = 50;` (`:78`):

```ts
/**
 * Supabase cắt mỗi response PostgREST ở `max_rows` dòng (project EPS Portal:
 * 1.000). Xin đúng bằng trần. Nếu ai đó hạ `max_rows` thấp hơn,
 * fetchAllByKeyset vẫn đọc đủ vì nó chỉ dừng ở trang RỖNG.
 * Sự cố 12/11/2026: đọc một phát không phân trang, ACA vượt 1.000 hồ sơ thì
 * trang Enrollment sập cho mọi người xem toàn bộ danh sách.
 */
export const ENROLLMENT_LIST_PAGE_SIZE = 1000;

/**
 * Trần DÒNG một lượt nạp danh sách, bằng TASK_MAX_ROWS của Task board.
 * Vượt trần thì vẫn ném EnrollmentListTruncatedError: không trả danh sách
 * thiếu mà không nói. Từ 80% trần thì log cảnh báo.
 */
export const ENROLLMENT_LIST_MAX_ROWS = 5_000;
const ENROLLMENT_LIST_WARN_ROWS = Math.floor(ENROLLMENT_LIST_MAX_ROWS * 0.8);
const COUNT_EXACT = { count: "exact" } as const;

type EnrollmentListRead = {
  rows: unknown[] | null;
  /** Lỗi Supabase NGUYÊN BẢN (còn `code`) để chuỗi fallback schema nhận ra. */
  error: SupabaseLikeError;
  /** `count: exact` của trang đầu; null khi server không trả. */
  count: number | null;
};
```

- [ ] **Step 5: Viết lại phần đọc của `fetchEnrollmentRecords`** (`queries.ts:200-255`). Thay từ `const supabase = getSupabaseAdmin();` đến hết dòng `const records = (rows ?? []).map(coerceEnrollmentRecord);` bằng đoạn dưới. Phần stats phía sau (`const ids = …` đến hết hàm) giữ nguyên.

```ts
  const supabase = getSupabaseAdmin();
  const queryClient = supabase as unknown as LooseSupabaseClient;

  // MỘT trang: keyset theo `id` (PK, bất biến), `count: exact` chỉ ở trang
  // đầu. Thứ tự SQL không phải thứ tự hiển thị: EnrollmentClient luôn xếp lại
  // bằng sortRecords (mặc định createdAt giảm dần).
  const readListPage = (columns: string, afterId: string | null) => {
    let query = queryClient
      .from("enrollment_records")
      .select(columns, afterId === null ? COUNT_EXACT : undefined)
      .eq("program", program)
      .is("archived_at", null);
    if (afterId !== null) query = query.gt("id", afterId);
    return applyEnrollmentScope(query, scope)
      .order("id", { ascending: true })
      .limit(ENROLLMENT_LIST_PAGE_SIZE);
  };

  // Cả danh sách với một bộ cột. fetchAllByKeyset ném `new Error(message)` và
  // làm mất `code`, nên giữ lại lỗi gốc để chuỗi fallback schema bên dưới (dựa
  // vào code 42703/PGRST204) chạy y như trước.
  const readList = async (columns: string): Promise<EnrollmentListRead> => {
    const seen: { error: SupabaseLikeError; count: number | null } = {
      error: null,
      count: null,
    };
    try {
      const result = await fetchAllByKeyset<{ id: string }>(
        async (afterId) => {
          const page = await readListPage(columns, afterId);
          seen.error = page.error ?? null;
          if (afterId === null) {
            seen.count = typeof page.count === "number" ? page.count : null;
          }
          return {
            rows: page.data as { id: string }[] | null,
            error: page.error ? { ...page.error, status: page.status } : null,
            count: page.count,
          };
        },
        {
          maxRows: ENROLLMENT_LIST_MAX_ROWS,
          isTransient: isTransientPostgrestError,
        }
      );
      return { rows: result.rows, error: null, count: seen.count };
    } catch (error) {
      if (seen.error) return { rows: null, error: seen.error, count: null };
      throw error;
    }
  };

  let read = await readList(ENROLLMENT_RECORD_COLUMNS);
  if (isMissingCarrierIdsColumn(read.error)) {
    read = await readList(ENROLLMENT_RECORD_COLUMNS_WITHOUT_CARRIER_IDS);
  }
  if (isMissingEnrollmentTrackingColumn(read.error)) {
    throw new EnrollmentSchemaOutOfDateError();
  }
  if (isMissingEnrollmentDescriptionColumn(read.error)) {
    read = await readList(ENROLLMENT_RECORD_COLUMNS_WITHOUT_DESCRIPTION);
  }
  if (isMissingEnrollmentCustomValuesColumn(read.error)) {
    const legacyColumns = isMissingEnrollmentDescriptionColumn(read.error)
      ? ENROLLMENT_RECORD_COLUMNS_LEGACY_WITHOUT_DESCRIPTION
      : ENROLLMENT_RECORD_COLUMNS_LEGACY;
    read = await readList(legacyColumns);
  }
  if (isMissingEnrollmentTrackingColumn(read.error)) {
    throw new EnrollmentSchemaOutOfDateError();
  }
  if (read.error) throw new Error(read.error.message ?? "Could not fetch records.");

  const rows = read.rows ?? [];
  if (
    rows.length >= ENROLLMENT_LIST_MAX_ROWS &&
    (read.count === null || read.count > rows.length)
  ) {
    throw new EnrollmentListTruncatedError(read.count ?? rows.length, rows.length);
  }
  if (read.count !== null && read.count > rows.length) {
    // Hồ sơ bị archive hoặc rời scope giữa hai trang: thiếu vài dòng trong một
    // lần tải, lần poll sau (≤ 60 giây) tự đúng. Không chặn trang.
    console.warn("[enrollment-list] short read", {
      program,
      total: read.count,
      loaded: rows.length,
    });
  }
  if (rows.length >= ENROLLMENT_LIST_WARN_ROWS) {
    console.warn("[enrollment-list] near row cap", {
      program,
      loaded: rows.length,
      cap: ENROLLMENT_LIST_MAX_ROWS,
    });
  }

  const records = rows.map(coerceEnrollmentRecord);
```

So với code cũ: thứ tự kiểm lỗi schema giữ nguyên, chỉ khác là cả ba nhánh giờ đọc theo trang. `assertEnrollmentRecordsComplete` và `EnrollmentListTruncatedError` vẫn giữ: `stage-metrics.ts:54` còn dùng hàm, và API/Export còn bắt class (→ 503) khi vượt trần.

- [ ] **Step 6: Chạy test.**
Run: `npx vitest run src/lib/enrollment/queries.test.ts src/lib/pagination/keyset.test.ts`
Expected: PASS, gồm 6 test mới và các test cũ của `assertEnrollmentRecordsComplete`.

- [ ] **Step 7: Toàn bộ test, typecheck, lint.**
Run: `npx vitest run && npm run typecheck && npx eslint src/lib/enrollment/queries.ts src/lib/enrollment/queries.test.ts`
Expected: PASS.

- [ ] **Step 8: Ghi `changelog.md`** (mới nhất ở trên cùng):

```md
## 2026-11-12 — Enrollment: danh sách đọc theo trang, hết sập khi chương trình vượt 1.000 hồ sơ

- Trước: `fetchEnrollmentRecords` đọc cả chương trình bằng một request; Supabase cắt ở 1.000 dòng (`max_rows`) nên khi ACA vượt 1.000 hồ sơ (18:35 UTC 11/11) code ném `EnrollmentListTruncatedError` và trang `/enrollment` sập cho Manager/CS company-wide (Agent/Assistant đọc phần của mình nên không bị).
- Giờ đọc tuần tự từng trang 1.000 dòng theo keyset `id` (`fetchAllByKeyset`, giống Task board), `count: exact` chỉ ở trang đầu, scope áp cho mọi trang, cả các nhánh tương thích schema. Thiếu dòng vì hồ sơ bị archive giữa hai trang chỉ log `[enrollment-list] short read`, không chặn. Trần 5.000 dòng vẫn fail closed như cũ; từ 4.000 log `[enrollment-list] near row cap`.
```

- [ ] **Step 9: Kiểm local, chỉ đọc.** Dùng skill `run` để mở `/enrollment` bằng tài khoản Manager hoặc CS company-wide. Kỳ vọng: trang dựng được và tổng dòng bằng số hồ sơ ACA hiện tại (~1.060). Log server không có `EnrollmentListTruncatedError`.
  Lưu ý: nếu Task 0 đã nâng `max_rows` lên 2.000 thì trang 1 trả đủ và nhánh trang 2 chưa chạy thật. Phân trang thật được kiểm ở Task 2 Step 3, sau khi trả `max_rows` về 1.000.

- [ ] **Step 10: Dừng và báo user.** Chưa commit. Khi user bảo commit, gói code, test, changelog và plan này vào cùng một commit:
  `fix(enrollment): page the list by id so programs over 1,000 records load`

## Task 2: Deploy và xác minh trên production (theo lệnh user)

- [ ] **Step 1:** Trước khi push, chạy `git fetch` và `git log origin/main vercel/main -3 --oneline`, vì Codex cũng có thể đã push. Push `origin` và `vercel` chỉ khi user bảo. Chờ deployment Ready.
- [ ] **Step 2: Xác minh lỗi đã hết.** Nhờ CS mở `/enrollment`, rồi kiểm:
  `vercel logs --environment production --since 30m -q 'level:error' -n 1000 --json | grep -c EnrollmentListTruncatedError`. Kỳ vọng là 0 kể từ giờ deploy.
- [ ] **Step 3: Nếu đã làm Task 0, trả `max_rows` về 1000** (Dashboard, hoặc PATCH `{"max_rows": 1000}`). Mục đích là để phân trang thật sự chạy và giữ trần chung như trước cho mọi query khác. Sau đó mở lại `/enrollment?program=aca` và kiểm trên Supabase gateway: request ACA trang 1 trả `206`, `Content-Range: 0-999/<tổng>`. Đây là bình thường khi có `limit`. Trang 2 có `id=gt.` trong `request.search` và trả `200`. Câu ClickHouse cho API logs (tối đa 24 giờ mỗi lần, cách nhau ≥ 7 giây):

```sql
select log_attributes['response.status_code'] as st,
       log_attributes['response.headers.content_range'] as cr,
       position(log_attributes['request.search'], 'id=gt.') > 0 as page2,
       count() as n
from logs
where source = 'edge_logs'
  and log_attributes['request.path'] = '/rest/v1/enrollment_records'
  and log_attributes['request.method'] = 'GET'
  and log_attributes['request.search'] like '%program=eq.aca%'
group by st, cr, page2
order by n desc
limit 50
```

- [ ] **Step 4: Báo trên Slack** cho người đã báo lỗi rằng đã sửa xong.
- [ ] **Rollback:** revert commit Task 1. Code cũ sẽ sập lại ngay vì ACA hơn 1.000 hồ sơ, nên trước khi revert phải nâng `max_rows` lên lớn hơn số hồ sơ ACA (Task 0).

## Task 3: Hardening (mỗi mục chờ user duyệt riêng, không chặn việc sửa gốc)

- **3a. `src/app/(authed)/enrollment/error.tsx`:** khi server component lỗi, hiện thông báo trong app có nút Retry và link sang chương trình khác (`?program=medicare`, `medicaid`, `other_service`). Như vậy một chương trình hỏng không khoá cả mục Enrollment. Mẫu có sẵn là `src/app/(authed)/config/error.tsx` (client component, nhận `{ error, reset }`, nút `onClick={reset}`).
- **3b. Báo khi tải lại hỏng liên tục:** `EnrollmentClient.tsx:1442` bỏ qua im lặng mọi response không OK, nên các tab mở từ trước 18:35 hiện dữ liệu cũ khoảng 50 phút mà không báo gì. Đề xuất: sau 3 lần liên tiếp không OK thì hiện một dòng nhỏ "Danh sách chưa cập nhật được". Cần user chốt UI.
- **3c. ACA Overview đọc theo OFFSET:** `src/lib/enrollment/aca-overview-data.ts:55-65` đọc `.order("created_at", desc).range(offset, …)` với trang 1.000. Giờ ACA hơn 1.000 hồ sơ nên trang 2 có thật. Một hồ sơ tạo giữa hai trang được xếp lên đầu (desc), làm mọi dòng lùi một bậc và dòng cuối trang 1 bị đọc lại ở trang 2, tức số liệu Overview có thể đếm trùng một hồ sơ. Sửa: đổi sang `fetchAllByKeyset` (order `id`), rồi sắp lại theo `created_at` giảm dần trong JS.
- **3d. Chỗ còn đọc một phát:** `src/lib/enrollment/stage-metrics.ts:47-54` đọc id không phân trang rồi `assertEnrollmentRecordsComplete`, nên sẽ ném lỗi cho ACA. `src/lib/enrollment/overview-data.ts:38-42` không có `count` nên cắt im lặng ở 1.000. Cả hai chỉ chạy qua `GET /api/enrollment/overview`, mà grep `src/` không thấy UI nào gọi route này. User chọn: phân trang cả hai bằng `fetchAllByKeyset`, hoặc xoá route nếu đã chết.
- **3e. Trần 5.000 và tăng trưởng:** Import có thể thêm hàng trăm hồ sơ một lượt (+335 trong một giờ ngày 10/11). Khi chạm 5.000, trang vẫn sập như hôm nay, chỉ là có 5 lần dư địa và log cảnh báo từ 4.000. Hai hướng cần user chọn:
  1. Giống Task board: trả 5.000 dòng kèm cờ `truncated` và hiện banner, không sập.
  2. Dài hạn: phân trang hoặc lọc ở server, hoặc chỉ tải lại các hồ sơ đổi từ lần poll trước. Hiện mỗi tab company-wide tải lại toàn bộ danh sách mỗi 60 giây.

## Không làm trong plan này

- Không xoá các nhánh tương thích schema (thiếu `carrier_ids`, `description`, `custom_values`) dù production đã đủ cột. Đó là việc dọn dẹp riêng; plan này chỉ cho chúng đọc theo trang.
- Không đổi phạm vi xem, RBAC, thứ tự hiển thị, nhịp poll hay broadcast.
- Không đổi Task board, vì nó đã dùng keyset từ trước.
