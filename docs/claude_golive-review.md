# Go-Live Review

## Overall Status

**Status:** **NOT READY** — review xong 4/4 module + cross-module, **đã đối chiếu chéo với `codex_review_code.md` và sửa lại**
**Current Module:** hoàn tất (Tasks → Medicare → Config → ACA → Cross-module → Final → **reconcile với Codex**)
**Last Updated:** 2026-08-08 (bản 2 — sau phản biện của Codex)

| Mức | Bản 1 | **Bản 2 (sau đối chiếu)** | Thay đổi |
|---|---|---|---|
| P0 | 1 | **1** | T-01 giữ nguyên, Codex xác nhận |
| P1 | 2 | **7** | +M-34, +A-03, +M-32, +C-15, +M-24 (nâng từ P2) |
| P2 | 14 | **~18** | +M-33, +C-14, C-04/M-30/A-01 nâng từ P3, −M-24 |
| P3 | 21 | **~18** | −T-06 (**rút, tao sai**), −3 cái nâng lên P2 |
| P4 | 6 | **5** | −A-02 (**rút, tao suy luận sai**) |

**Bị rút vì tao sai:** `T-06` (`toggleRangePicker` đã sync sẵn ở `TaskToolbar.tsx:638-648`),
`A-02` (`enrollmentNeedsAttention` áp cho cả hai program, không có bất đối xứng).

**👉 Đọc thẳng [PLAN FINAL — hợp nhất Claude + Codex](#-plan-final--hợp-nhất-claude--codex) ở cuối file.**
Phần đó thay thế mọi "Recommended Actions" cũ và là bản duy nhất nên dùng làm release gate.
Nó gồm: 7 hạng mục chặn go-live, 2 release control vận hành, thứ tự bắt buộc, và danh sách
tao đã sai ở đâu.

> **Chế độ làm việc (theo yêu cầu của owner):** REVIEW ONLY — **không sửa code**.
> Mọi finding đều kèm patch đề xuất ở mục `Fix`, nhưng **chưa apply**. Cột `Status`
> của finding = `OPEN (fix proposed, not applied)` cho tới khi owner duyệt.

> **[CODEX COMMENT — OVERALL REVIEW]** Review chéo trên cùng `HEAD` (`df561ef`) xác nhận kết luận **NOT READY** và xác nhận T-01 là một P0 thật. Tuy nhiên bảng tổng hợp `1 P0 / 2 P1` của Claude **không đầy đủ**: nhiều P1 về partial commit, optimistic rollback, permission affordance, import integrity, stage/config invariants và program parsing chưa được report này ghi nhận. Audit độc lập của Codex đang theo dõi **16 nhóm P1 duy nhất** (shared ACA/Medicare chỉ đếm một lần), ngoài P0 T-01 vừa được Claude phát hiện. Các comment bên dưới dùng tag `CONFIRMED`, `PARTIALLY CONFIRMED`, `INCORRECT`, hoặc `OMISSION`; chúng không thay đổi nội dung gốc của Claude.

### Baseline verification (chạy trên code hiện tại, chưa đụng gì)

| Lệnh | Kết quả |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | ✅ exit 0 |
| `npm run lint` (`eslint`) | ✅ "No issues found" |
| `npm run test:run` (`vitest run`) | ✅ 50 test files / 431 tests passed (2.33s) |

⚠️ Baseline xanh **không** loại trừ các lỗi trong report này: toàn bộ 431 test là
unit test cho `src/lib/**` (xem `vitest.config.ts` → `include: ["src/**/*.test.ts"]`).
**Không có một test nào chạm tới component React, effect, hay data-fetching.**
ESLint xanh vì `react-hooks/exhaustive-deps` chỉ kiểm tra dependency có **đủ**
hay không — nó không thấy được dependency **không ổn định** (identity đổi mỗi
render), đúng là root cause của finding P0 bên dưới.

### Kiến trúc (khảo sát)

| Hạng mục | Thực tế |
|---|---|
| Framework | Next.js **16.2.4** App Router, React **19.2.4**, RSC + `"use client"` islands |
| Auth | NextAuth v5 beta; route guard qua `src/proxy.ts` (Next 16 đổi tên `middleware.ts` → `proxy.ts`), phân quyền per-page bằng `requireAnyPermission()` |
| Data | Supabase JS (service-role, server-side); realtime = **broadcast channel**, không phải postgres_changes |
| State | **Không** có react-query/SWR/Zustand/Redux. Tất cả là `useState` + `useEffect` + `fetch` thủ công trong client component |
| Form | **Không** có react-hook-form/formik. Form = local `useState` + `onBlur` patch |
| UI | Tailwind v4 + lucide-react, **không** có design-system component library. Class Tailwind viết thẳng, màu hardcode hex (`#0c66e4`, `#172b4d`…) |
| Test | Vitest, node environment, chỉ unit test `src/lib` |
| Cron | `vercel.json` (sync-data, check-enrollment-due) + `.github/workflows/task-reminders.yml` (check-overdue, 15 phút/lần) |

Vì **không** có data-fetching library, mọi cơ chế chống race (latest-request-wins,
dirty-refetch, optimistic + rollback, `expected_updated_at`) đều **tự viết tay** và
lặp lại 3 lần: `TaskBoardClient`, `EnrollmentClient`, `ConfigClient`. Đây là nguồn
gốc phần lớn finding trong report này.

---

# 1. Tasks

## Status

Reviewed. **NOT READY** — 1× P0, 1× P1, 3× P2 chưa fix.

Phạm vi đã đọc: `src/app/(authed)/tasks/page.tsx`, `_components/TaskBoardClient.tsx`
(1902 dòng), `TaskListView.tsx`, `TaskRowItem.tsx`, `TaskDetailDrawer.tsx`,
`CommentThread.tsx`, `TaskToolbar.tsx`, `TaskSearchBox.tsx`, `task-list-columns.ts`,
`use-anchored-menu.ts`; `src/lib/tasks/**`, `src/lib/table-config/layout.ts`;
API `/api/tasks`, `/api/tasks/[id]`, `/api/config/layout`, `/api/cron/check-overdue`.

> **[CODEX COMMENT — TASKS OMISSIONS]** Ngoài các finding Claude ghi, code còn các production risk quan trọng: (1) nhiều task mutation ghi canonical task trước rồi mới ghi assignee/history/activity/notification và có thể trả 500 sau partial commit; (2) reopen, overdue-unlock, assignee add/remove và archive không có `expected_updated_at`; (3) failed archive restore nguyên mảng task; (4) board/search scope của plain CS không khớp, candidate bị limit trước permission filter và file-result bị UI bỏ qua; (5) comment/attachment metadata có thể stale vì whole-row cooldown và thiếu board broadcast. Ba mục đầu là P1/P2 trực tiếp và làm số P1 cuối report bị thiếu.

## Functional Bugs

### T-02 — Sửa 2 field liên tiếp trên cùng 1 task → lần 2 bị revert kèm toast "Task was updated by someone else"

- **Issue:** Hai PATCH liên tiếp lên cùng một task trong khoảng thời gian nhỏ hơn một round-trip sẽ khiến lần thứ 2 gửi `expected_updated_at` cũ → server trả **409** → client revert optimistic + hiện toast lỗi. Thao tác của user bị **mất**.
- **Severity:** **P1**
- **Location:**
  - `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:975-1015` (`patchTask`)
  - `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:1693-1747` (`buildOptimisticTaskPatch`)
  - `src/app/api/tasks/[id]/route.ts:195-200`, `:359-372` (optimistic-concurrency check)
- **Affected Module:** Tasks (và cùng class ở Enrollment — xem X-02)
- **Trigger:**
  1. Kéo card từ **To do → In Progress**, rồi kéo tiếp sang **Waiting** trước khi request 1 trả về; hoặc
  2. Trong List view: đổi **Priority** rồi đổi ngay **Category**; hoặc
  3. Trong Detail drawer: sửa Title rồi Tab sang Description (2 lần `onBlur` liên tiếp).
- **Expected:** Cả hai thay đổi được ghi nhận.
- **Actual:** Thay đổi thứ 2 bị revert về giá trị cũ + toast đỏ "Task was updated by someone else. Refresh and try again."
- **Root Cause:** hai tầng:
  1. `patchTask` đọc `before = tasks.find(...)` từ state **hiện tại**, gửi `before.updated_at`. Khi request 1 chưa trả về, `updated_at` trong state vẫn là giá trị **trước** request 1 → server đã đổi → mismatch.
  2. **Nặng hơn với status change:** `buildOptimisticTaskPatch` ghi một `updated_at` **do client tự sinh** vào state:
     ```ts
     // TaskBoardClient.tsx:1710-1712
     if (typeof optimistic.status === "string" && before && optimistic.status !== before.status) {
       const nowIso = new Date().toISOString();
       optimistic.updated_at = nowIso;   // ← timestamp của CLIENT, không bao giờ khớp DB
     ```
     → PATCH thứ 2 gửi `expected_updated_at` = timestamp client → **chắc chắn** 409, kể cả khi request 1 đã xong nhưng response chưa kịp `replaceTask`.
- **Impact:** Mất thao tác người dùng + toast lỗi sai sự thật (đổ lỗi cho "người khác" trong khi chỉ có 1 user). Dễ tái hiện nhất trên mạng chậm — đúng kịch bản §24 của brief. Trên board thật (~50 agent) đây là lỗi hằng ngày.
- **Fix (đề xuất, chưa apply):**
  1. **Không** ghi `updated_at` giả vào state optimistic — xoá dòng `optimistic.updated_at = nowIso;` (`TaskBoardClient.tsx:1712`). `updated_at` chỉ được ghi bởi response server (`replaceTask`). Không mất gì: `updated_at` chỉ dùng làm token concurrency + cột "Updated", không tham gia tính SLA.
  2. Serialize PATCH theo task id: giữ `Map<taskId, Promise>`, request sau `await` request trước rồi mới đọc `before` → luôn dùng `updated_at` server mới nhất.
     ```ts
     const patchChainRef = useRef(new Map<string, Promise<void>>());
     function queuePatch(id: string, run: () => Promise<void>) {
       const prev = patchChainRef.current.get(id) ?? Promise.resolve();
       const next = prev.catch(() => {}).then(run);
       patchChainRef.current.set(id, next);
       void next.finally(() => {
         if (patchChainRef.current.get(id) === next) patchChainRef.current.delete(id);
       });
       return next;
     }
     ```
- **Regression Risk:** **Trung bình.** `patchTask` là đường ghi chung của List view, Kanban drag, Detail drawer, QC review. Phải verify lại: drag đổi status, đổi priority/category inline, sửa title/description/FUB trong drawer, toggle QC, và trường hợp **thật sự** có 2 user cùng sửa (409 vẫn phải xuất hiện đúng).
- **Verification (chưa chạy — cần approve mới làm):**
  1. DevTools → Network throttling "Slow 3G". Kéo 1 card qua 2 cột liên tiếp → cả 2 phải vào DB, không toast.
  2. Mở 2 tab, tab A và tab B cùng sửa 1 task → 409 vẫn phải hiện (không được làm mất optimistic concurrency).
  3. Thêm regression test cho `buildOptimisticTaskPatch`: assert kết quả **không** chứa key `updated_at`.
- **Status:** OPEN (fix proposed, not applied)

> **[CODEX COMMENT — T-02 CONFIRMED, BUT INCOMPLETE]** Trigger và P1 là đúng. Ngoài timestamp optimistic tự sinh, rollback hiện restore **toàn bộ `before` row** (`patchTask():983-1009`). Nếu request A thành công và request B stale/409, B có thể restore V0 rồi `recentTaskWritesRef` bảo vệ V0 khỏi canonical refetch trong 3 giây mà không có expiry-triggered retry. Vì vậy bỏ `optimistic.updated_at` là cần thiết nhưng chưa đủ; serialize/rebase per-task và reconcile canonical row trên 409 mới đóng hết lỗi.

## Performance / Lag

### T-01 — Vòng lặp vô hạn `GET /api/config/layout` + re-render toàn board trên `/tasks`

- **Issue:** `useEffect` hydrate layout tự kích hoạt lại chính nó vĩnh viễn. Mỗi vòng = 1 request `/api/config/layout` + 1 lần set 2 state → re-render toàn bộ cây board. Tốc độ lặp = tốc độ round-trip mạng (~10–50 req/s/tab).
- **Severity:** **P0 — BLOCKER** (production-breaking performance issue, request flood)
- **Location:**
  - `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:208-275` — effect, dep array ở dòng **275**
  - `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:189-206` — 3 `useMemo` sinh dep
  - `src/app/(authed)/tasks/_components/task-list-columns.ts:113-163` — `taskListColumnsFromConfig` luôn trả **array mới**
  - `src/app/api/config/layout/route.ts:33-39` — GET trả `layout: [...]` khi user đã có bản ghi
- **Affected Module:** Tasks (Config là nguồn dữ liệu → xem thêm X-01)
- **Trigger:** Bất kỳ user nào **đã từng bật/tắt một cột** trong menu cột của List view. Thao tác đó gọi `toggleTaskListColumn` → `saveTaskTableLayout` (`TaskBoardClient.tsx:1236-1272`) → `PUT /api/config/layout` → từ đó trở đi user có bản ghi `user_table_layout(scope='cs')`. Lần load `/tasks` kế tiếp là bắt đầu lặp.
  User **chưa từng** đụng menu cột thì không dính (nhánh fallback `setTaskLayoutColumns(tableColumns)` giữ nguyên identity của prop nên React bail-out).
- **Expected:** Load `/tasks` → **đúng 1** request `/api/config/layout`.
- **Actual:** Request lặp không dừng suốt thời gian tab mở.
- **Root Cause:** dependency **exhaustive nhưng không ổn định**, tạo chu trình khép kín:

  | # | Bước | Code |
  |---|---|---|
  | 1 | Effect chạy, fetch layout | `:214` |
  | 2 | Thành công → `setTaskLayoutColumns(resolved.map(...))` — **array mới** | `:228-232` |
  | 3 | `taskListColumnConfig = useMemo(..., [taskLayoutColumns])` recompute; `taskListColumnsFromConfig` trả array mới (`task-list-columns.ts:125` `const next = []` … `:159` `return [...]`) | `:189-192` |
  | 4 | `taskListColumnKeySet = useMemo(() => new Set(...), [taskListColumnConfig])` → **Set mới** | `:193-196` |
  | 5 | `taskListDefaultHiddenKeys = useMemo(() => new Set(...), [taskLayoutColumns])` → **Set mới** | `:197-206` |
  | 6 | Dep array `[tableColumns, taskListColumnKeySet, taskListDefaultHiddenKeys]` đổi identity → effect chạy lại → **về bước 1** | `:275` |

  Đóng chu trình: `setHiddenTaskListColumnKeys(new Set(...))` ở `:233-244` cũng luôn tạo Set mới nên không có chỗ nào React bail-out được.
- **Impact:**
  - Server: mỗi tab CS mở `/tasks` bắn hàng chục req/s vào `/api/config/layout` → mỗi request là 1 lần `auth()` + 1 query Supabase. Với ~50 agent = vài trăm–vài nghìn req/s vô ích. Trên Vercel là hoá đơn + rate-limit; trên Supabase là connection pressure.
  - Client: mỗi vòng re-render `TaskBoardClient` (1902 dòng) + `TaskListView` + **toàn bộ** `TaskRowItem` (không memo, xem T-05) → CPU pin, laptop nóng, mọi tương tác (mở menu, gõ search) giật.
  - Đây gần như chắc chắn là nguồn "lag" mà brief §12/§18 mô tả.
- **Fix (đề xuất, chưa apply) — smallest safe change:** giữ dep array **chỉ gồm giá trị ổn định**, đưa 2 Set phái sinh vào ref để nhánh fallback vẫn đọc được giá trị mới nhất.
  ```ts
  // thêm cạnh các memo hiện có (:189-206)
  const taskListColumnKeySetRef = useRef(taskListColumnKeySet);
  const taskListDefaultHiddenKeysRef = useRef(taskListDefaultHiddenKeys);
  useEffect(() => {
    taskListColumnKeySetRef.current = taskListColumnKeySet;
    taskListDefaultHiddenKeysRef.current = taskListDefaultHiddenKeys;
  }, [taskListColumnKeySet, taskListDefaultHiddenKeys]);

  // trong effect :249-254 và :261-267 đổi sang đọc ref:
  readHiddenTaskListColumns(
    browserStorage(),
    taskListColumnKeySetRef.current,
    TASK_LIST_LOCKED_COLUMN_KEYS,
    taskListDefaultHiddenKeysRef.current
  ) as Set<TaskListColumnKey>

  // và dep array :275 rút còn:
  }, [tableColumns]);
  ```
  Không đổi kiến trúc, không đổi API, không đổi schema. `tableColumns` là prop từ server component → ổn định trong suốt vòng đời client component, nên effect chạy đúng 1 lần.

  *(Phương án thay thế nếu muốn "đúng React" hơn: dùng `useRef` một cờ `hydratedRef` như `EnrollmentClient.tsx:482,543,576` đã làm — nhưng cách trên nhỏ hơn và không đổi luồng.)*
- **Regression Risk:** **Thấp–trung bình.** Effect này là nơi duy nhất hydrate `taskLayoutColumns` + `hiddenTaskListColumnKeys`. Rủi ro thật sự chỉ có một: nếu `tableColumns` (prop) **có thể** đổi giữa chừng thì effect sẽ không chạy lại. Kiểm tra: `tasks/page.tsx:102` truyền `tableConfig.columns` từ RSC, page là `force-dynamic` → prop chỉ đổi khi navigate/reload, khi đó client component remount. → An toàn.
  Phải verify lại: (a) user **có** layout đã lưu thấy đúng thứ tự/ẩn-hiện cột, (b) user **không** có layout rơi vào nhánh localStorage đúng như cũ, (c) toggle cột vẫn PUT và vẫn giữ sau F5, (d) cột `hidden_default` (archived) vẫn bị ẩn với mọi user.
- **Verification (chưa chạy):**
  1. DevTools → Network, filter `layout`. Load `/tasks` bằng tài khoản đã lưu layout → phải thấy **đúng 1** request (hiện tại: đếm không xuể).
  2. React DevTools Profiler → "Record why each component rendered": `TaskBoardClient` phải đứng yên khi không thao tác.
  3. Regression test (unit, chạy được với vitest hiện tại) — chứng minh nguồn bất ổn định:
     ```ts
     // src/app/(authed)/tasks/_components/task-list-columns.test.ts
     it("trả về reference mới mỗi lần gọi với cùng input (nên không được dùng làm effect dep)", () => {
       const cols = [{ key: "summary", is_system: true, position: 10, label: "Task" }] as never[];
       expect(taskListColumnsFromConfig(cols)).not.toBe(taskListColumnsFromConfig(cols));
     });
     ```
- **Status:** OPEN (fix proposed, not applied)

> **[CODEX COMMENT — T-01 CONFIRMED]** Static dependency trace của Claude là chính xác. Khi GET trả saved layout, effect luôn tạo `taskLayoutColumns` array mới; hai `useMemo` tạo Set mới; dependency đổi; cleanup + effect mới lại fetch. Đây là request/re-render loop vô hạn theo tốc độ round-trip và đủ điều kiện P0. Lưu ý test “helper trả reference mới” chỉ chứng minh một mắt xích, không phải regression test cho effect; verification đúng cần component/browser test đếm GET sau hydrate.

### T-04 — `/api/tasks` trả **toàn bộ** bảng task không phân trang, và được gọi lại nguyên vẹn mỗi lần có realtime ping

- **Issue:** `fetchTasksForActor` không có `.limit()` / `.range()` / lọc theo thời gian. Manager kéo về toàn bộ task chưa archive của **cả công ty**, mỗi lần refetch.
- **Severity:** **P2** (sẽ thành P1 khi dữ liệu tăng)
- **Location:** `src/lib/tasks/queries.ts:17-124` (query chính), `:139-172` (`attachTaskListMetadata` RPC theo **mọi** id), `TaskBoardClient.tsx:368-407` (`refetchTasks`), `:508-533` (realtime → refetch)
- **Affected Module:** Tasks
- **Trigger:** Bất kỳ ai PATCH một task bất kỳ → `broadcastTasksChanged()` (`api/tasks/[id]/route.ts:524`) → **mọi** tab đang mở board refetch **toàn bộ** danh sách (debounce 300ms).
- **Expected:** Payload có giới hạn.
- **Actual:** Payload = O(số task toàn hệ thống) × (35 cột + assignees + metadata). Board đang mặc định lọc theo `thisMonth` **ở client** (`TaskBoardClient.tsx:804-836` `filterTasks`), nghĩa là dữ liệu ngoài phạm vi vẫn được tải rồi vứt đi.
- **Root Cause:** Không có tầng phân trang; filter hoàn toàn client-side.
- **Impact:** 50 user × mỗi lần ai đó đổi status = 50 query full-table + 50 RPC metadata. Thêm nữa PostgREST có `db-max-rows` mặc định — nếu vượt, danh sách bị **cắt âm thầm** và counter "x / y" sai mà không có lỗi nào.
- **Fix (đề xuất, chưa apply):** Đây là thay đổi có ảnh hưởng sản phẩm → **cần owner quyết**, không tự làm:
  - **Tối thiểu cho Go-Live (an toàn, không đổi UX):** thêm `.limit(N)` tường minh + trả `truncated: boolean` và hiện cảnh báo trên toolbar. Hết mù dữ liệu.
  - **Đúng bài (sau Go-Live):** đẩy `dateRange` + `status` xuống server (board đã có sẵn 2 filter này ở client).
- **Regression Risk:** Cao nếu đẩy filter xuống server (đổi hành vi filter + counter). Thấp nếu chỉ thêm `.limit()` + cảnh báo.
- **Verification (chưa chạy):** seed ~5.000 task → đo payload `/api/tasks` và thời gian render đầu tiên.
- **Status:** OPEN (needs product decision)

### T-05 — List view render mọi dòng, không memo, không virtualization; sort/rank chạy lại mỗi render

- **Issue:** `TaskListView` tính lại toàn bộ dẫn xuất trên **mỗi** render và render **mọi** dòng vào DOM.
- **Severity:** **P2**
- **Location:**
  - `src/app/(authed)/tasks/_components/TaskListView.tsx:94-108` — `categoryById`, `labelByEmail`, `rows = rankTasksForManager(...)` đều **không** `useMemo`
  - `:120-123` — `new Set(...)`, `buildPinnedOffsetByKey(...)` tạo mới mỗi render, truyền xuống **mọi** row
  - `:169-207` — render toàn bộ `rows`, không windowing; khung cố định `maxHeight: 1008px` (`:124-126`) nên phần lớn DOM nằm ngoài màn hình
  - `src/app/(authed)/tasks/_components/TaskRowItem.tsx:178` — `TaskRowItem` **không** bọc `React.memo` (component ~700 dòng render)
- **Affected Module:** Tasks
- **Trigger:** (a) đồng hồ SLA tick mỗi 30s (`TaskBoardClient.tsx:565-573` `setNow`) → re-render **tất cả** row; (b) mọi thay đổi state của board; (c) hiện tại: mỗi vòng của T-01.
- **Expected:** Tick 30s chỉ cập nhật nhãn đếm ngược.
- **Actual:** Tick 30s → re-render + re-sort + rebuild Map/Set + re-render N row.
- **Root Cause:** Không có ranh giới memo giữa board state và row.
- **Impact:** Với ~500 task đã thấy khựng khi tick; với vài nghìn thì scroll/gõ phím giật.
- **Fix (đề xuất, chưa apply):** làm theo thứ tự, dừng khi đủ:
  1. `useMemo` cho `rows`, `categoryById`, `labelByEmail`, `visibleColumnKeys`, `pinnedOffsetByKey` (thuần cục bộ, rủi ro ~0).
  2. Bọc `TaskRowItem` bằng `React.memo` — **chỉ sau khi** (1) xong, vì hiện giờ prop nào cũng là object mới nên memo vô tác dụng.
  3. Virtualization: **KHÔNG** làm trước Go-Live (thêm thư viện + đụng sticky column = rủi ro thừa). Ghi nhận là nợ kỹ thuật.
- **Regression Risk:** Thấp cho (1). Trung bình cho (2) — `React.memo` có thể giữ lại UI cũ nếu còn prop nào bị mutate tại chỗ; cần rà `visibleColumns`, `rules`, `now`.
- **Verification (chưa chạy):** Profiler, đo thời gian commit của một tick 30s trước/sau.
- **Status:** OPEN (fix proposed, not applied)

## Race Conditions / Async Issues

### T-03 — Kênh Supabase realtime bị huỷ và subscribe lại mỗi lần đổi view / đổi date range, mỗi lần kéo thêm một `GET /api/tasks` thừa

- **Issue:** Effect subscribe realtime có dep không ổn định → cứ đổi filter ngày hoặc chuyển List/Board/Overview là `removeChannel` + `subscribe` lại; callback `SUBSCRIBED` lại gọi `refetchTasks()`.
- **Severity:** **P2**
- **Location:** `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:508-533`, dep array `:533` = `[isManager, loadOverview, refetchTasks, view]`; `loadOverview` là `useCallback` với dep `[dateRange.from, dateRange.to, isManager]` (`:423-453`)
- **Affected Module:** Tasks
- **Trigger:** Đổi date-range filter, bấm "Clear all", hay chuyển tab List ↔ Board ↔ Overview.
- **Expected:** Subscribe 1 lần, giữ suốt vòng đời trang.
- **Actual:** Mỗi lần đổi → unsubscribe → subscribe → `refetchTasks()` (full payload, xem T-04). Giữa 2 lần có **khoảng trống không subscribe** → ping của người khác rơi mất trong cửa sổ đó (self-heal có, nhưng chỉ ở lần reconnect kế tiếp).
- **Root Cause:** `view` và `loadOverview` bị đưa vào dep của effect subscribe, dù kênh không phụ thuộc chúng — chúng chỉ được **đọc** trong handler.
- **Impact:** Request thừa + churn kết nối realtime. Người dùng nghịch bộ lọc ngày vài lần là bắn vài lần full-list fetch.
- **Fix (đề xuất, chưa apply):** giữ `view`/`loadOverview` trong ref, dep chỉ còn `[isManager, refetchTasks]` (hoặc `[]` + ref cho tất cả).
  ```ts
  const viewRef = useRef(view);
  const loadOverviewRef = useRef(loadOverview);
  useEffect(() => { viewRef.current = view; loadOverviewRef.current = loadOverview; });
  // trong schedule()/subscribe callback đọc viewRef.current / loadOverviewRef.current
  ```
- **Regression Risk:** Thấp. Cần verify: mở 2 tab, tab A đổi status → tab B tự cập nhật; và Overview vẫn auto-refresh khi đang ở view overview.
- **Verification (chưa chạy):** DevTools → WS frames, đếm số lần `phx_join` khi bấm đổi date range 5 lần (hiện tại: 5; kỳ vọng: 0).
- **Status:** OPEN (fix proposed, not applied)

### Đã kiểm tra và KHÔNG có vấn đề (race)

| Vùng | Kết luận |
|---|---|
| `refetchTasks` (`TaskBoardClient.tsx:368-407`) | Latest-request-wins (`tasksRefetchRequestRef`) + write-version + `pendingTaskMutationsRef` + dirty-replay. Xử lý **đúng**, kể cả trường hợp "drop rồi không ai chạy lại" (`:392-396`). |
| `mergeRefetchedTasks` (`:1675-1691`) | Cooldown 3s per-task chống refetch cũ đè optimistic. Có prune, không rò map. Đúng. |
| `TaskSearchBox` (`TaskSearchBox.tsx:47-85`) | Debounce 200ms + `AbortController` + cleanup + guard `signal.aborted`. **Chuẩn**, không cần sửa. |
| `CommentThread` realtime (`CommentThread.tsx:249-265`) | Dep `[roomTopic, taskId, onReload]`, `onReload` là `useCallback([task.id])` → ổn định. Đúng. |
| Optimistic comment (`CommentThread.tsx:284-384`) | Có `realId` shadowing chống render trùng, revoke blob URL, đánh dấu `failed`. Đúng. |
| `use-anchored-menu.ts` | Cleanup listener đầy đủ; chặn scroll bên trong menu tự đóng. Đúng. |

> **[CODEX COMMENT — CORRECTION TO “KHÔNG CÓ VẤN ĐỀ”]** `mergeRefetchedTasks` không thể được kết luận hoàn toàn đúng. Nó giữ **nguyên whole local row** trong 3 giây, kể cả các field local không cập nhật như `comment_count`, `attachment_count`, `last_activity_*`; map được prune chỉ khi một refetch khác xảy ra, không có timer tự repair khi cooldown hết. Cùng cơ chế này còn giữ stale rollback của T-02. Latest-request sequencing tốt, nhưng reconciliation theo entity/cooldown vẫn có bug thật.

## State Management Issues

### ~~T-06 — `DateRangeFilter` giữ draft state riêng, không bao giờ đồng bộ lại với prop~~ → **RÚT LẠI (tao sai)**

> **[Claude — FINDING SAI, ĐÃ RÚT. Codex bắt đúng.]**
> Codex chỉ ra `toggleRangePicker()` tại **`TaskToolbar.tsx:638-648`** đã làm sẵn đúng cái tao đề xuất:
> ```ts
> function toggleRangePicker() {
>   if (!isOpen) {
>     setDraftRange({ from, to });
>     setDraftPreset(getDatePresetForRange(from, to));
>     const nextMonths = getVisibleDateMonths(from, to);
>     setVisibleStartMonth(nextMonths.startMonth);
>     setVisibleEndMonth(nextMonths.endMonth);
>   }
>   setIsOpen((current) => !current);
> }
> ```
> Tao đã đọc `TaskToolbar.tsx` từ dòng 530 tới 609 rồi kết luận "không có effect nào sync" — **dừng sớm đúng 30 dòng**. Hàm sync nằm ở 638. Luồng "Clear all → mở picker" nhận prop mới bình thường, không kéo range cũ về.
>
> **Bài học phương pháp:** tao suy ra sự vắng mặt của một cơ chế từ một lát cắt file, không grep hết. Với claim dạng "không có X ở đâu cả" thì phải grep toàn file, không được đọc một đoạn rồi kết luận. Đây là cùng loại lỗi tao đã mắc ở M-01 của Codex (thấy `canEdit` truyền cho 1 component rồi cho là mọi component đều có).
>
> **T-06 bị gỡ khỏi mọi bảng tổng kết P3.** Nội dung gốc giữ lại bên dưới để đối chiếu, **không còn hiệu lực**.

- ~~**Issue:** `draftRange` / `draftPreset` / `visibleStartMonth` / `visibleEndMonth` khởi tạo từ prop **một lần** rồi sống độc lập.~~
- **Severity:** ~~P3~~ → **KHÔNG PHẢI BUG**
- **Location:** `src/app/(authed)/tasks/_components/TaskToolbar.tsx:534-545` — *(kết luận sai: hàm sync ở `:638-648`)*
- **Affected Module:** Tasks (+ Enrollment: `EnrollmentClient.tsx:81` import lại đúng component này → xem X-04)
- **Trigger:** Chọn range tuỳ ý (vd 01/07–15/07) → bấm **Clear all** (`TaskBoardClient.tsx:1225-1234` reset về `defaultDateRange`) → mở lại date picker.
- **Expected:** Picker hiện range mặc định vừa được reset.
- **Actual:** Picker vẫn hiện 01/07–15/07; bấm Apply thì **áp lại range cũ**, mâu thuẫn với nhãn đang hiển thị trên nút.
- **Root Cause:** Hai nguồn sự thật cho cùng một giá trị (parent `dateRange` và draft cục bộ), không có đường đồng bộ ngược.
- **Impact:** User tưởng đã xoá filter nhưng thao tác kế tiếp lại kéo filter cũ về.
- **Fix (đề xuất, chưa apply):** đồng bộ draft khi popup **mở** (không sync liên tục để không phá thao tác đang chọn dở):
  ```ts
  useEffect(() => {
    if (!isOpen) return;
    setDraftRange({ from, to });
    setDraftPreset(getDatePresetForRange(from, to));
    const months = getVisibleDateMonths(from, to);
    setVisibleStartMonth(months.startMonth);
    setVisibleEndMonth(months.endMonth);
  }, [isOpen]);   // cố ý chỉ theo isOpen
  ```
- **Regression Risk:** Thấp–trung bình. Component **dùng chung** với Enrollment (`EnrollmentClient.tsx:81`) → phải test cả 2 nơi. Rủi ro chính: mở popup mà đè mất lựa chọn đang dở → đã chặn bằng việc chỉ chạy khi `isOpen` chuyển sang true.
- **Verification (chưa chạy):** Tasks: set range → Clear all → mở picker (phải là mặc định). Enrollment: set Created-from/to → mở lại picker.
- **Status:** OPEN (fix proposed, not applied)

> **[CODEX COMMENT — T-06 INCORRECT / CLOSE]** Finding này không còn đúng trên code hiện tại. `DateRangeFilter.toggleRangePicker()` tại `TaskToolbar.tsx:638-645` đã chạy `setDraftRange({ from, to })`, recompute preset và hai visible month **mỗi lần popup chuyển từ đóng sang mở** — đúng chính giải pháp Claude đề xuất. Flow “Clear all → mở picker” vì vậy nhận prop mới, không kéo range cũ về. Không nên tính T-06 vào P3/final totals.

### T-08 — Field text trong Detail drawer không đồng bộ lại khi task đổi từ bên ngoài

- **Issue:** `title` / `description` / `fubLink` là state cục bộ khởi tạo từ prop, không có đường cập nhật khi `task` prop đổi.
- **Severity:** **P3**
- **Location:** `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx:113-115`
- **Affected Module:** Tasks
- **Trigger:** Mở drawer task X → user khác sửa title task X → realtime ping → board cập nhật `tasks` → prop `task` đổi, nhưng drawer vẫn hiện text cũ.
- **Expected:** Hoặc thấy giá trị mới, hoặc được báo là dữ liệu đã đổi.
- **Actual:** Hiện text cũ. Blur ra sẽ gửi text cũ → server trả 409 (nhờ `expected_updated_at`) → toast lỗi.
- **Root Cause:** Không phân biệt "đang gõ dở" (phải giữ) và "chưa đụng vào" (nên đồng bộ).
- **Impact:** Chỉ gây khó hiểu, **không mất dữ liệu** — optimistic concurrency ở server chặn ghi đè. Vì vậy P3 chứ không phải P1.
- **Fix (đề xuất, chưa apply):** đồng bộ lại field khi nó **không** đang focus và giá trị cục bộ vẫn bằng giá trị prop trước đó (`useRef` lưu prop trước). Cân nhắc **hoãn sau Go-Live** — không có thiệt hại dữ liệu, mà sửa thì đụng vùng nhạy cảm.
- **Regression Risk:** Trung bình — làm ẩu sẽ xoá chữ user đang gõ (đúng loại bug §16 brief cấm).
- **Status:** OPEN (đề xuất **hoãn** — xem "Remaining Risks")

## UI/UX Issues

- Toast lỗi trộn 2 ngôn ngữ trong cùng một luồng: `"Mất kết nối — không lưu được thay đổi."` (`TaskBoardClient.tsx:1002`, `:1009`, `:1121`, `:1129`, `:1189`, `:1195`, `:1213`, `:1219`, `:1270`) vs `"Connection lost — could not unlock the overdue task."` (`:1034`, `:1040`, `:1063`, `:1069`) và toàn bộ Overview tiếng Anh (`:441`, `:477`, `:1162`). **P4**, cosmetic — nhưng cùng một màn hình.
- `window.alert()` cho lỗi export (`TaskBoardClient.tsx:861`, `:866`) trong khi mọi lỗi khác dùng `<Toast>`. Không đồng nhất. **P4**.

## UI Consistency

- Export dùng `window.alert`, phần còn lại dùng `<Toast>` → xem trên. Enrollment export thì dùng `setError` + `<Toast>` (`EnrollmentClient.tsx:684`) → **Tasks lệch chuẩn so với Enrollment**. Chi tiết ở X-05.
- Deep-link không nhất quán ngay trong module: mở task từ board gọi `writeTaskDeepLink(null)` (`:886`) — tức là **xoá** `?task=` khỏi URL; mở task từ search lại `writeTaskDeepLink(taskId, "push", commentId)` (`:303`). Hệ quả: task mở từ board không share được link, nút Back không đóng drawer. Enrollment thì luôn push (`EnrollmentClient.tsx:902-905`). **P3** — chi tiết ở X-05.

## Duplicate / Overlapping Logic

- `isAgentOwnerOrAssistantOf` + `isAgentTeamMemberOf` + `capabilitiesFor` được **copy nguyên văn** ở 2 nơi: `TaskBoardClient.tsx:946-969` và `TaskListView.tsx:69-90`. Hiện giống hệt nhau; rủi ro là sửa một chỗ quên chỗ kia → quyền hiển thị lệch giữa row và drawer. **P3** — chưa gây lỗi, gom lại được nhưng là refactor → theo §3 brief thì **không** làm trước Go-Live, chỉ ghi nhận.
- Trạng thái ẩn/hiện cột có **hai** nơi lưu: `localStorage` (`list-column-visibility.ts`) và server `user_table_layout` (`/api/config/layout`). Xem X-01.

## Security / Permission

- ✅ `/api/tasks` GET + POST đều `auth()` → `buildTaskActor` → `canAccessBoard`. PATCH/DELETE có `resolveTaskAccess` + `patchCapabilityError` theo từng nhóm field (`api/tasks/[id]/route.ts:75-92`). Kiểm tra quyền nằm ở **server**, client chỉ ẩn UI. Đúng.
- ✅ Soft-delete thay vì hard delete, có comment giải thích (`api/tasks/[id]/route.ts:542-550`).
- ⚠️ **T-10 (P3, hardening):** filter PostgREST `or()` được ghép bằng nội suy chuỗi:
  ```ts
  // src/lib/tasks/queries.ts:53-57
  const ors: string[] = [`assignee_email.eq."${actor.email}"`];
  if (agents.length > 0) ors.push(`agent_email.in.(${agents.map((a) => `"${a}"`).join(",")})`);
  ```
  Giá trị đến từ session/DB nên **chưa** khai thác được, nhưng một email chứa `"` hoặc `,` sẽ làm hỏng hoặc **nới rộng** phạm vi lọc → user thấy task ngoài quyền. Fix: validate/escape email trước khi nội suy, hoặc dùng `.in()` với mảng.
- ⚠️ **T-13 (P3):** cron chấp nhận secret qua query string `?secret=` (`api/cron/check-overdue/route.ts:31`, và tương tự ở 2 cron còn lại). Secret trong URL bị ghi vào access log / Vercel log. Header `Authorization` đã hỗ trợ sẵn và workflow đang dùng header → bỏ nhánh query param được ngay.

## Regression Risks

| Thay đổi | Có thể vỡ ở đâu | Cách chặn |
|---|---|---|
| T-01 (dep array effect layout) | Thứ tự/ẩn-hiện cột List view; cột archived; nhánh fallback localStorage | Test 4 tổ hợp: có/không saved layout × có/không localStorage |
| T-02 (bỏ `updated_at` optimistic + serialize patch) | Kanban drag, inline edit, drawer edit, QC toggle, `/overdue-unlock`, `/reopen` | Phải giữ 409 **thật** khi 2 user đụng nhau |
| T-03 (dep realtime) | Đồng bộ đa tab; auto-refresh Overview | Test 2 tab + đứng ở Overview 60s |
| T-05 (memo) | UI đứng hình nếu còn prop bị mutate tại chỗ | Chỉ làm bước (1) trước, đo lại rồi mới tính bước (2) |
| T-06 (sync draft date) | **Dùng chung với Enrollment** | Test cả `/tasks` và `/enrollment` |

## Fixes Applied

**Không có.** Owner yêu cầu review-only ở lượt này. Toàn bộ fix ở trạng thái đề xuất.

## Verification

Đã chạy (baseline, chưa sửa gì):

```
npm run typecheck   → exit 0
npm run lint        → "ESLint: No issues found"
npm run test:run    → 50 files / 431 tests passed
```

**Chưa chạy:** verification cho từng finding (cần apply fix trước). Cách verify đã ghi trong từng finding.

**Lỗ hổng kiểm thử cần biết:** `vitest.config.ts` chỉ include `src/**/*.test.ts` với `environment: "node"` → **không có** test nào cho component/effect. Toàn bộ nhóm bug P0/P1 ở trên nằm ngoài tầm phủ của bộ test hiện tại và sẽ **không** bị bắt bởi CI.

## Remaining Risks

| Issue | Impact | Likelihood | Workaround | Risk | Lý do chưa fix | Khuyến nghị Go-Live |
|---|---|---|---|---|---|---|
| T-04 (không phân trang) | Payload + query tăng tuyến tính theo số task | Cao theo thời gian | Dọn/archive task cũ | Trung bình lúc go-live | Cần quyết định sản phẩm về filter server-side | Thêm `.limit()` + cảnh báo truncate **trước** go-live; phân trang sau |
| T-05 bước 3 (virtualization) | Giật khi >2000 dòng | Trung bình | Dùng filter thu hẹp | Thấp lúc go-live | Thêm thư viện + sticky column = rủi ro thừa | **Hoãn** sau go-live |
| T-08 (drawer không sync) | Gây khó hiểu, không mất dữ liệu | Thấp | F5 | Thấp | Sửa ẩu sẽ xoá chữ đang gõ | **Hoãn** sau go-live |
| T-12 (cron chạy trên GitHub Actions) | Toàn bộ engine SLA/overdue/reminder ngưng âm thầm | Trung bình | Chạy tay `workflow_dispatch` | **Trung bình–cao** | Cần quyết định hạ tầng | Chuyển `check-overdue` sang `vercel.json` cùng 2 cron kia — xem dưới |

### T-12 — Engine overdue/reminder phụ thuộc GitHub Actions schedule, không phải Vercel Cron

- **Issue:** `vercel.json` chỉ khai báo `sync-data` + `check-enrollment-due`. `/api/cron/check-overdue` — nơi stamp `overdue_flagged_at`, cộng `overdue_count` (KPI), và bắn mọi reminder — chỉ được gọi bởi `.github/workflows/task-reminders.yml` (`*/15 * * * *`).
- **Severity:** **P3** (hạ tầng, nhưng ảnh hưởng nghiệp vụ lõi)
- **Location:** `vercel.json:3-14`, `.github/workflows/task-reminders.yml:3-5`; comment ở `src/app/api/cron/check-overdue/route.ts:22-26` viết *"runs on a schedule (see vercel.json)"* → **sai thực tế**.
- **Impact:** GitHub Actions `schedule` là best-effort (thường trễ 5–20 phút khi runner bận) và **tự động bị tắt sau 60 ngày repo không có commit**. Nếu tắt: task không bao giờ bị đánh overdue, `overdue_count` không tăng, reminder ngừng — **âm thầm**, không lỗi, không alert.
- **Fix (đề xuất, chưa apply):** thêm entry vào `vercel.json` (Vercel Cron tự gửi `Authorization: Bearer $CRON_SECRET`, đúng cái `checkAuthorization` đang chờ):
  ```json
  { "path": "/api/cron/check-overdue", "schedule": "*/15 * * * *" }
  ```
  rồi tắt workflow GitHub (hoặc giữ làm backup thủ công). Sửa luôn comment sai ở `route.ts:22-26`.
  ⚠️ Cần kiểm tra gói Vercel: plan Hobby giới hạn cron **1 lần/ngày**; `*/15` cần Pro trở lên.
- **Regression Risk:** Thấp. Rủi ro duy nhất là chạy **hai** scheduler song song → cron chạy 2 lần/15 phút. Code có idempotency (`overdue_flagged_at`, `*_reminded_at` được kiểm tra trước khi gửi lại), nhưng vẫn nên tắt hẳn một bên.
- **Verification (chưa chạy):** sau khi đổi, xem Vercel → Cron Jobs → log 2 lần chạy liên tiếp; kiểm tra `overdue_flagged_at` được stamp đúng 1 lần.
- **Status:** OPEN (fix proposed, not applied)

---

# 2. Medicare Enrollment

## Status

Reviewed. **NOT READY** — 1× P1, 5× P2 chưa fix.

Phạm vi: `enrollment/page.tsx`, `_components/EnrollmentClient.tsx` (4101 dòng — dùng
chung cho **cả** Medicare và ACA), `EnrollmentOverview.tsx`; `src/lib/enrollment/**`;
API `/api/enrollment`, `/api/enrollment/[id]`, `/api/enrollment/overview`.

> **Lưu ý kiến trúc:** Medicare và ACA **không** phải hai màn hình riêng — cùng một
> component, phân nhánh bằng `program`. Nên hầu hết finding dưới đây áp dụng cho cả
> hai. Phần **khác biệt** Medicare ↔ ACA nằm ở mục 4.

> **[CODEX COMMENT — ENROLLMENT CRITICAL OMISSIONS]** Report này bỏ sót ba P1 trên chính shared Enrollment path: (1) client tính `canEditRecord` nhưng Stage/Due/Agent/Assignee/Carrier/QC/reopen và nhiều control vẫn interactive với non-stakeholder, tạo guaranteed A → B → A khi server 403; (2) `pendingRef` là `Set<id>` chứ không phải counter, cho phép hai edit cùng record rollback whole stale row và mở guard quá sớm; (3) create/update commit record trước activity/stage-history/notification, có nhánh trả failure sau canonical commit và nhiều Supabase insert result không kiểm `error`. Ngoài ra archive network rejection không rollback, comment có thể trả `parent_updated_at` chưa persist, attachment storage/DB/count không nhất quán. Vì dùng chung code, tất cả áp dụng cả Medicare lẫn ACA.

## Functional Bugs

### M-01 — Thao tác "không thay đổi gì" làm số comment/attachment trên dòng tụt về 0

- **Issue:** Khi patch không tạo ra thay đổi thực (`sanitizedPatch` rỗng), API trả về record với `comment_count: 0, attachment_count: 0` **hardcode**. Client ghi đè record trong list bằng payload đó → badge comment/file trên dòng đó về 0.
- **Severity:** **P2**
- **Location:**
  - `src/app/api/enrollment/[id]/route.ts:271-273`
    ```ts
    if (Object.keys(sanitizedPatch).length === 0) {
      return NextResponse.json({ record: { ...current, comment_count: 0, attachment_count: 0 } });
    }
    ```
  - Nhánh fallback tương tự ở `:472`
  - Client ghi đè: `EnrollmentClient.tsx:838-840`
- **Affected Module:** Medicare + ACA
- **Trigger:** Mở dropdown Stage/Carrier/Payment trong drawer rồi chọn **lại đúng giá trị đang có**; hoặc focus rồi blur một field mà không sửa (đường `EditableInput.onBlur` chỉ gửi khi khác, nhưng các menu option thì gửi vô điều kiện — `EnrollmentClient.tsx:2722`, `:2753`, `:2768`).
- **Expected:** Không đổi gì → UI không đổi gì.
- **Actual:** Cột Comments của dòng đó nhảy về 0 và ở nguyên đó tới lần refetch kế tiếp. Sort theo cột "comments" cũng sai theo.
- **Root Cause:** Hai đường trả record: đường "có thay đổi" đọc lại qua `fetchEnrollmentRecordById` (có stats thật), đường "không thay đổi" tự bịa `0`.
- **Impact:** Dữ liệu hiển thị sai. Không hỏng DB (chỉ là payload response), nhưng user nhìn thấy số sai.
- **Fix (đề xuất, chưa apply):** trả về stats thật thay vì `0`:
  ```ts
  if (Object.keys(sanitizedPatch).length === 0) {
    const unchanged = await fetchEnrollmentRecordById(id);
    return NextResponse.json({ record: unchanged ?? current });
  }
  ```
  (đắt hơn 1 query nhưng chỉ chạy ở nhánh no-op; hoặc rẻ hơn: để client bỏ qua response khi `patch` rỗng.)
- **Regression Risk:** Thấp. Chỉ đụng nhánh no-op.
- **Verification (chưa chạy):** Mở record có ≥1 comment → chọn lại đúng Stage đang có → cột Comments phải giữ nguyên.
- **Status:** OPEN (fix proposed, not applied)

> **[CODEX COMMENT — M-01 CONFIRMED]** Finding ngay phía trên là đúng: nhánh no-op tại API hardcode cả hai count về 0, còn option menu có thể gửi lại cùng id. Đây là P2 display/state bug thật và là một bổ sung tốt so với audit Codex ban đầu. Nhánh fallback cuối route cũng có thể trả stats 0 nếu refetch-by-id thất bại, nên fix nên thống nhất response contract thay vì chỉ vá một call site.

### M-11 — Gõ tay Due date trong drawer bắn nhiều PATCH rác, có patch `due_date: null`

- **Issue:** `<input type="date">` gọi `onPatch` ngay trong `onChange`, không debounce, không so sánh với giá trị cũ.
- **Severity:** **P2**
- **Location:** `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:2732-2739`
  ```tsx
  <input type="date" value={formatDateInput(record.due_date)}
    onChange={(event) => void onPatch({ due_date: event.target.value || null })} />
  ```
- **Affected Module:** Medicare + ACA
- **Trigger:** Gõ tay ngày (không dùng picker). Trình duyệt phát `input` cho từng segment; khi ngày chưa đủ, `input.value === ""` → gửi `due_date: null`, rồi mới gửi ngày thật.
- **Expected:** 1 PATCH khi ngày hoàn chỉnh.
- **Actual:** ≥2 PATCH, trong đó có patch `null`. Mỗi patch `due_date` còn **reset 3 cột thông báo** ở server:
  ```ts
  // api/enrollment/[id]/route.ts:149-151
  patch.due_soon_notified_at = null;
  patch.overdue_notified_at = null;
  patch.overdue_reminded_at = null;
  ```
  → lịch sử nhắc hạn bị xoá oan. Nếu Config đặt `due` = Required thì patch `null` còn ăn 400 "Due date required." → toast lỗi giữa lúc user đang gõ. Và 2 patch liên tiếp lại rơi vào X-02 (409).
- **Root Cause:** Ghi thẳng trên `onChange` của một input có trạng thái trung gian không hợp lệ.
- **Impact:** Request rác, toast lỗi sai, mất mốc `*_notified_at`.
- **Fix (đề xuất, chưa apply):** chỉ ghi khi giá trị hợp lệ và thực sự khác:
  ```tsx
  onChange={(event) => {
    const next = event.target.value || null;
    if (next === (record.due_date ?? null)) return;
    if (next !== null && !/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    void onPatch({ due_date: next });
  }}
  ```
  (hoặc chuyển sang `onBlur` cho đồng nhất với mọi field khác trong drawer — xem M-27.)
- **Regression Risk:** Thấp. Chỉ ảnh hưởng ô Due date của drawer.
- **Verification (chưa chạy):** DevTools Network, gõ tay `2026-09-15` vào ô Due date → phải thấy đúng 1 PATCH, body không có `null`.
- **Status:** OPEN (fix proposed, not applied)

> **[CODEX COMMENT — M-11 PARTIALLY CONFIRMED]** Code đúng là PATCH ngay trên `onChange`, không equality guard/serialization, nên rapid date changes có race thật. Nhưng claim “gõ từng segment chắc chắn phát `value === ""` rồi ≥2 PATCH” phụ thuộc browser/date-input implementation và chưa có browser reproduction trong report. Giữ finding, nhưng phần trigger cụ thể và việc xoá mốc notification cần được xác minh trên browser mục tiêu trước khi coi là deterministic P2.

### M-26 — Bấm "Create" khi thiếu field bắt buộc: chỉ tô viền đỏ, **không có thông báo nào**

- **Issue:** `submit()` chặn khi thiếu field Required nhưng **không set message** — chỉ `setInvalidKeys`. Nếu field đó đang nằm ngoài vùng nhìn (panel Properties bên phải cuộn riêng, tới ~12 field), user thấy nút Create "bấm không ăn".
- **Severity:** **P3**
- **Location:** `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:3097-3105`
  ```ts
  const missing = [...requiredColumnKeys].filter(...);
  if (missing.length > 0) { setInvalidKeys(new Set(missing)); return; }   // ← không setError
  ```
- **Affected Module:** Medicare + ACA
- **Trigger:** Config đặt một cột (vd Carrier) = Required → mở New enrollment → điền Client Name → bấm Create mà chưa cuộn xuống chọn Carrier.
- **Expected:** Thông báo "Carrier required."
- **Actual:** Không có gì. Dialog đứng im. Viền đỏ có nhưng ở ngoài vùng nhìn.
- **Root Cause:** Nhánh validation fail không đi qua `setError`, trong khi nhánh server-side fail thì có (`:3126-3127`).
- **Fix (đề xuất, chưa apply):**
  ```ts
  if (missing.length > 0) {
    setInvalidKeys(new Set(missing));
    setError(`${missing.map((k) => columnByKey.get(k)?.label ?? k).join(", ")} required.`);
    return;
  }
  ```
- **Regression Risk:** Rất thấp — chỉ thêm message.
- **Status:** OPEN (fix proposed, not applied)

> **Đính chính (tao đã kiểm lại và tự bác bỏ giả thuyết ban đầu):** tao ban đầu nghi Config có thể đặt Required lên một cột Medicare không áp dụng (Caller/Payment/AC/Consent/Platform/PCP 2026) và làm **chết hẳn** luồng Create của Medicare. **Không đúng** — hệ thống đã chặn ở 2 lớp:
> 1. `DEFAULT_TABLE_COLUMNS.medicare` (`src/lib/table-config/queries.ts:48-63`) **không chứa** các cột đó, nên Config (scope Medicare) không hiển thị chúng để bật Required.
> 2. `REQUIRED_CAPABLE_SYSTEM_KEYS.medicare` (`src/lib/table-config/columns.ts:76-78`) cũng không chứa chúng → `canEditColumnField(column, "required")` trả `false` → PATCH bị từ chối 400.
>
> Ngoài ra `applyColumnPatchInvariants` (`columns.ts:41-54`) ép `hidden_default = false` khi Required, nên một cột Required **luôn** nằm trong `adminVisibleColumnKeys` và luôn được render. Đây là phần đã làm **đúng** — ghi lại để không ai "sửa" nhầm sau này. (Kẽ hở còn lại của bất biến này nằm ở đường POST — xem **C-05**.)

### M-18 — Due date sai định dạng: Create nuốt im lặng, Update trả lỗi 400

- **Issue:** Cùng một field, hai đường ghi validate khác nhau.
- **Severity:** **P3**
- **Location:** `src/app/api/enrollment/route.ts:264-268` (`cleanDate` → trả `null`, không lỗi) vs `src/app/api/enrollment/[id]/route.ts:567-575` (`parseDate` → trả `{error: "Invalid due date."}` → 400)
- **Affected Module:** Medicare + ACA
- **Trigger:** POST `/api/enrollment` với `due_date: "15/09/2026"` → record được tạo với `due_date = null`, không báo gì. PATCH cùng giá trị đó → 400.
- **Impact:** Import/tự động hoá gửi sai định dạng sẽ **âm thầm mất** due date ở đường create.
- **Fix (đề xuất, chưa apply):** dùng chung `parseDate` cho cả hai route (đưa vào `src/lib/enrollment/helpers.ts`), create cũng trả 400.
- **Regression Risk:** Thấp–trung bình: nếu có luồng import đang dựa vào việc create "tha" ngày sai, luồng đó sẽ bắt đầu fail (đúng, nhưng là thay đổi hành vi). Kiểm `HealthTableImportDialog` trước khi đổi.
- **Status:** OPEN (fix proposed, not applied)

## Performance / Lag

### M-22 — Danh sách enrollment trả về **toàn bộ nội dung comment** của **mọi** record, mỗi lần refetch

- **Issue:** `fetchEnrollmentRecords` nối toàn bộ body comment vào `comment_search_text` và gửi kèm mọi record — chỉ để phục vụ ô search phía client.
- **Severity:** **P2**
- **Location:** `src/lib/enrollment/queries.ts:106-128` (`textByRecord`), tiêu thụ ở `EnrollmentClient.tsx:3840-3847` (`filterRecords` → `haystack`)
- **Affected Module:** Medicare + ACA
- **Trigger:** Mỗi lần load trang **và** mỗi lần bất kỳ ai sửa bất kỳ record nào (`broadcastEnrollmentChanged` → refetch, `EnrollmentClient.tsx:782-803`).
- **Expected:** Payload tỉ lệ với số record hiển thị.
- **Actual:** Payload tỉ lệ với **tổng số ký tự comment** trong toàn bộ chương trình. Không phân trang (`queries.ts:64-74` — không `.limit()`/`.range()`).
- **Impact:** 1.000 record × 5 comment × 200 ký tự ≈ 1 MB **mỗi lần refetch**, cho **mỗi** tab đang mở. Thời gian parse JSON + GC trên máy user tăng theo.
- **Fix (đề xuất, chưa apply):** Cần quyết định sản phẩm (giống T-04). Hai hướng:
  - **Tối thiểu:** cắt `comment_search_text` (vd 500 ký tự đầu/record) + `.limit()` tường minh.
  - **Đúng bài:** search server-side như CS đã làm (`/api/tasks/search` + `src/lib/tasks/search.ts` — **đã có sẵn mẫu**), bỏ hẳn `comment_search_text` khỏi payload list.
- **Regression Risk:** Trung bình — đổi hành vi ô search.
- **Status:** OPEN (needs product decision)

### M-23 — Kênh realtime dùng chung cho cả 2 chương trình: sửa ACA làm mọi tab Medicare refetch (và ngược lại)

- **Issue:** `ENROLLMENT_TOPIC` là hằng số toàn cục, không tách theo program.
- **Severity:** **P2**
- **Location:** `src/lib/enrollment/realtime-topics.ts:1` (`export const ENROLLMENT_TOPIC = "enrollment-stream"`); phát ở `api/enrollment/[id]/route.ts:468`, `api/enrollment/route.ts:254`; nhận ở `EnrollmentClient.tsx:793-798`
- **Affected Module:** Medicare ↔ ACA
- **Trigger:** Bất kỳ ai sửa 1 record ACA.
- **Expected:** Chỉ tab đang xem ACA refetch.
- **Actual:** Tab Medicare cũng chạy `refetch()` (`GET /api/enrollment?program=medicare`) + `reloadOptions()` — kéo về payload nặng (xem M-22) rồi phát hiện chẳng có gì đổi.
- **Root Cause:** Topic không mang program.
- **Impact:** Nhân đôi lưu lượng refetch của toàn hệ thống, không mang lại giá trị nào.
- **Fix (đề xuất, chưa apply):** tách topic theo program — đúng mẫu `enrollmentRoomTopic(recordId)` ngay bên dưới nó:
  ```ts
  export const ENROLLMENT_TOPIC = "enrollment-stream";                       // giữ để tương thích
  export function enrollmentProgramTopic(p: EnrollmentProgram) { return `enrollment-${p}`; }
  ```
  rồi `broadcastEnrollmentChanged(program)` và client subscribe `enrollmentProgramTopic(program)`.
- **Regression Risk:** Trung bình. **Phải deploy đồng bộ**: nếu server phát topic mới mà client cũ còn nghe topic cũ (hoặc ngược lại) thì mất realtime. Cân nhắc phát **cả hai** topic trong 1 kỳ deploy rồi mới bỏ topic cũ.
- **Verification (chưa chạy):** mở tab Medicare + tab ACA, sửa 1 record ACA → tab Medicare không được có request `/api/enrollment?program=medicare`.
- **Status:** OPEN (fix proposed, not applied)

### M-28 — Mỗi lần mở trang Enrollment đều ghi lại layout xuống DB, kể cả khi user không đổi gì

- **Issue:** Effect auto-save layout chạy ngay sau khi hydrate xong, nên lần load nào cũng phát 1 `PUT /api/config/layout`.
- **Severity:** **P3**
- **Location:** `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:590-615`; cờ mở khoá ở `:576`/`:581` (`enrollmentLayoutHydratedRef.current = true`)
- **Trigger:** Mọi lần vào `/enrollment` (cả 2 program).
- **Actual:** hydrate → `setLayoutTableColumns` + `setHiddenColumnKeys` → effect chạy lại, `hydratedRef` giờ là `true` → PUT sau 250ms. Kể cả nhánh "không có layout đã lưu" (`:573-575`) cũng PUT → **mọi user tự động có bản ghi `user_table_layout`** dù chưa từng tuỳ chỉnh gì.
- **Impact:** 1 write DB/lần xem trang/user. Không sai dữ liệu, nhưng là ghi vô ích và làm nhiễu ý nghĩa của bảng ("đã tuỳ chỉnh" vs "chưa").
- **Fix (đề xuất, chưa apply):** chỉ PUT khi layout **thực sự** khác lần hydrate — lưu snapshot đã serialize vào ref sau hydrate và so sánh trước khi gửi.
- **Regression Risk:** Thấp.
- **Status:** OPEN (fix proposed, not applied)

### M-29 — Bảng enrollment: không memo dòng, không virtualization (giống T-05)

- **Severity:** **P2** — cùng bản chất T-05, ghi riêng vì đây là component khác.
- **Location:** `EnrollmentClient.tsx:1545-1563` (render mọi record), `:1570` (`EnrollmentRowItem` không `React.memo`), `:2481-2493` (drawer dựng lại `optionLabelById`/`optionsByColumnId`/`customPeople` mỗi render, không memo)
- **Điểm tốt:** khác Tasks, `visibleRecords` **đã** được `useMemo` đúng (`:641-650`) — filter/sort không chạy lại vô cớ. Vấn đề chỉ còn ở tầng render dòng.
- **Fix:** như T-05 bước (1)+(2). Virtualization: hoãn.
- **Status:** OPEN (fix proposed, not applied)

## Race Conditions / Async Issues

### Đã kiểm tra và KHÔNG có vấn đề

| Vùng | Kết luận |
|---|---|
| `refetch()` (`EnrollmentClient.tsx:693-728`) | `refetchSeqRef` + `hadPendingAtIssue` (chụp **trước** khi gửi request — chặt hơn bản Tasks) + dirty-replay. **Đây là bản đúng nhất trong repo.** |
| ~~`patchRecord` / `createRecord` / `archiveRecord` (`:805-900`)~~ | ❌ **KẾT LUẬN SAI — xem M-32/M-33 ngay bên dưới.** |
| Effect hydrate layout (`:541-588`) | Dep `[program, setHiddenColumnKeys, tableColumns]` — **tất cả đều ổn định** (`setHiddenColumnKeys` là `useCallback([program])`). **Không** dính vòng lặp T-01. Đây là mẫu đúng. |
| Effect realtime (`:782-803`) | Dep `[refetch, reloadOptions]`, cả hai `useCallback([program])` → ổn định, **không** resubscribe vô cớ. Đúng — ngược lại với T-03. |
| `EnrollmentOverview` initial load (`EnrollmentOverview.tsx:57-82`) | Có cờ `cancelled`, `eslint-disable` kèm lý do rõ ràng. Đúng. |

> **[CODEX COMMENT — CORRECTION TO “KHÔNG CÓ VẤN ĐỀ”]** Dòng đánh giá `patchRecord/createRecord/archiveRecord` là “đúng” không chính xác. `pendingRef` dùng Set nên hai PATCH cùng id: request đầu settle sẽ `delete(id)` dù request thứ hai còn bay. Cả hai rollback whole row. `archiveRecord` không có `catch`; nếu `fetch` reject, row đã remove không được restore và không có error Toast; nếu HTTP fail thì restore **nguyên mảng** `before`. Đây là P1 same-record race + P2 archive failure, không phải vùng sạch.

### M-34 — Control của record chỉ-đọc vẫn bấm được → A → B → A **bảo đảm xảy ra** *(Codex phát hiện, tao verify đúng)*

- **Issue:** Client **có** tính `canEditRecord` nhưng chỉ truyền xuống một phần control. Stage, Due date, Payment, Carrier, QC, reopen vẫn tương tác được với người không có quyền sửa. Server trả 403, client rollback → user thấy giá trị nhảy **A → B → A**.
- **Severity:** **P1**
- **Location:**
  - Tính đúng: `EnrollmentClient.tsx:2494-2503` (drawer), `:1613-1617` (row)
  - **Có** truyền `canEdit`: `:1678`, `:1834`, `:1855`, `:1876`, `:1980`, `:2704` (AttachmentPanel), `:2930`
  - **KHÔNG** truyền: `EnrollmentStagePill` `:2718-2723`, `<input type="date">` Due `:2732-2739`, `EnrollmentOptionMenu` Payment `:2748-2754`, Carrier `:2763-2769`, QC, reopen
  - Server chặn đúng: `src/lib/enrollment/access.ts:26-33` (`canMutateEnrollmentRecord`) → 403 ở `api/enrollment/[id]/route.ts:117-119`
- **Affected Module:** Medicare **và** ACA (ACA lộ rộng hơn: thêm Payment/AC/Consent/Platform/Caller/PCP 2026)
- **Trigger:** Một CS thường mở record mà họ **không** phải caller / responsible / người tạo — theo quyết định sản phẩm 2026-08-02 thì họ **xem được hết**, nên đây là đường đi bình thường hằng ngày, không phải edge case.
- **Expected:** Control read-only, không mời user thao tác.
- **Actual:** Bấm được → optimistic hiện B → server 403 → `catch` khôi phục A + Toast. **Chuỗi A → B → A là tất định**, đúng class §12 brief đặt lên hàng đầu.
- **Fix (đề xuất, chưa apply):** truyền một hợp đồng `canEdit`/`disabled` thống nhất xuống **mọi** control trong drawer + row. ⚠️ **Chừa `NewEnrollmentDialog`**: nó dùng chung `EnrollmentStagePill` (`:3226-3230`) và `EnrollmentOptionMenu` (`:3255-3260`) nhưng lúc tạo mới **chưa có record** để tính `canEditRecord` — không được mặc định `disabled` theo cùng biến đó.
- **Regression Risk:** Trung bình–cao. Dùng chung 2 program + dialog Create + row + drawer. Phải test ma trận: manager / creator / caller / responsible / người ngoài × {row, drawer, create}.
- **Status:** OPEN (fix proposed, not applied)

> **[Claude]** Đây là finding tao sót và Codex bắt đúng nhất. Nguyên nhân tao sót: đọc thấy `canEdit={canEditRecord}` truyền cho `AttachmentPanel` rồi **mặc định** các control khác cũng vậy, không đi kiểm từng cái. Cùng loại lỗi phương pháp với T-06 (tao đọc một lát cắt file rồi kết luận cho cả file). Ghi lại để lần sau đừng lặp.

### M-32 — `pendingRef` là `Set`, không phải counter → guard mở sớm khi 2 write cùng record chồng nhau *(Codex phát hiện, tao verify đúng)*

- **Issue:** Enrollment dùng `useRef(new Set<string>())` để đánh dấu "đang có write". Hai PATCH trên **cùng một record**: request đầu settle chạy `delete(id)` trong `finally` **dù request thứ hai còn đang bay** → guard mở, một refetch trung gian được phép apply và đè lên write chưa xong.
- **Severity:** **P1**
- **Location:** `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:469` (`const pendingRef = useRef(new Set<string>())`), `:808`/`:847` (add/delete trong `patchRecord`), `:885`/`:897` (archive)
- **Đối chiếu:** Tasks làm **đúng** — `pendingTaskMutationsRef` là `Map<string, number>` có đếm (`TaskBoardClient.tsx:894-906`), `beginTaskMutation` tăng, closure trả về giảm, chỉ `delete` khi về 0. **Enrollment là bản yếu hơn của cùng cơ chế.**
- **Fix:** đổi `Set<string>` → `Map<string, number>` và bê nguyên `beginTaskMutation` từ `TaskBoardClient.tsx:894-906`. Mẫu đúng đã có sẵn trong repo.
- **Regression Risk:** Thấp. Cùng shape API (`.size > 0` vẫn dùng được), chỉ đổi add/delete thành tăng/giảm.
- **Status:** OPEN (fix proposed, not applied)

> **[Claude]** Tao đã xếp vùng này vào bảng "KHÔNG có vấn đề" và **sai**. Tao đọc thấy cả 3 hàm đều `add` + `finally delete` rồi kết luận là đối xứng, không hỏi tiếp "hai request cùng id thì sao". Codex hỏi câu đó. Verify: `rtk proxy grep -n "pendingRef"` → dòng 469 là `new Set<string>()`, không phải Map.

### M-33 — `archiveRecord` không có `catch`: mất mạng → record biến mất khỏi UI, không báo lỗi *(Codex phát hiện, tao verify đúng)*

- **Issue:** `archiveRecord` chỉ xử lý `!response.ok`. Nếu `fetch` **reject** (mất mạng, DNS, CORS), luồng nhảy thẳng vào `finally` — record đã bị xoá optimistic **không được khôi phục**, không có Toast, và promise reject không ai bắt.
- **Severity:** **P2**
- **Location:** `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:881-899` — có `try` + `finally`, **không có `catch`**
- **Thêm:** nhánh `!response.ok` chạy `setRecords(before)` — khôi phục **nguyên mảng**, xoá luôn thay đổi của các record khác xảy ra trong lúc request bay. Cùng lỗi với **T-05** của Codex bên Tasks.
- **Đối chiếu:** `patchRecord` (`:826-849`) **có** `catch` đầy đủ. Chỉ `archiveRecord` bị sót.
- **Fix:** thêm `catch` khôi phục **chỉ** record đó (đúng vị trí cũ trong mảng) + `setError(...)`.
- **Regression Risk:** Thấp.
- **Status:** OPEN (fix proposed, not applied)

### M-30 — `EnrollmentOverview.load()` không có latest-wins; và Overview không bao giờ tự làm mới

- **Severity:** **P3**
- **Location:** `src/app/(authed)/enrollment/_components/EnrollmentOverview.tsx:40-52` (`load` không có seq/abort), gọi ở `:111` (nút Refresh) và `:244` (sau khi assign)
- **Trigger:** Bấm Refresh 2 lần liên tiếp trên mạng chậm → response về sai thứ tự → hiện snapshot cũ.
- **Thêm:** Overview **không** subscribe realtime và **không** poll. Tab CS Overview thì poll 30s (`TaskBoardClient.tsx:502-506`). → dữ liệu Enrollment Overview đứng yên cho tới khi bấm Refresh. Không sai, nhưng lệch hẳn với module kia (xem X-07).
- **Fix (đề xuất, chưa apply):** thêm `seqRef` như `refetch()` đã làm; quyết định riêng việc có auto-refresh hay không (nên **thống nhất** với CS Overview).
- **Status:** OPEN (fix proposed, not applied)

> **[CODEX COMMENT — M-30 CONFIRMED, SEVERITY UNDERRATED]** Out-of-order manual/assignment loads có thể overwrite ownership workload ngay sau thao tác user nên Codex đánh P2, không phải P3. Cùng class còn tồn tại ở drawer `reload()` và `reloadOptions()`; đặc biệt option request A cũ có thể set lại Config cũ sau response B mới. Initial-load cancellation không bảo vệ các đường manual/realtime này.

## State Management Issues

- `EnrollmentDrawer` đọc thẳng từ prop `record`, không giữ bản sao cục bộ cho field text — **đúng hơn** `TaskDetailDrawer` (xem T-08). `EditableInput`/`EditableTextarea` (`:3429-3506`) dùng uncontrolled + `key={value}` để nhận giá trị mới. Chấp nhận được; hệ quả nhỏ: nếu người khác đổi đúng field đang gõ dở, `key` đổi → remount → mất chữ đang gõ. Xác suất thấp, **P4**, không đề xuất sửa trước Go-Live.
- Ẩn/hiện cột vẫn có 2 nguồn (localStorage `:324-343` và server layout `:566-572`) — xem X-01.

## UI/UX Issues

### M-08 — Lý do reopen dùng `window.prompt()`, trong khi Tasks có modal riêng cho đúng nghiệp vụ đó

- **Severity:** **P2** (UI consistency, đúng §21 của brief)
- **Location:** `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:2557-2562`
  ```ts
  const reason = window.prompt(`Reason to reopen to ${reopenTarget.label}`);
  ```
  vs Tasks: `<ReasonModal>` với title/description/placeholder/submitLabel/accentColor — `TaskBoardClient.tsx:1552-1561`, component `_components/ReasonModal.tsx`.
- **Vì sao là bug chứ không chỉ xấu:** `window.prompt` không style được, không validate được (chỉ `!reason?.trim()` rồi im lặng bỏ qua), **bị chặn** trong iframe có `sandbox` và trong một số webview; Safari/Chrome hiển thị checkbox "Prevent this page from creating additional dialogs" — tick vào là **toàn bộ luồng reopen chết** cho tới khi reload.
- **Fix (đề xuất, chưa apply):** dùng lại `ReasonModal` — đã export sẵn, không cần viết mới:
  ```tsx
  import { ReasonModal } from "../../tasks/_components/ReasonModal";
  // ...
  <ReasonModal
    open={reopenOpen}
    title="Reopen enrollment"
    description={`This record is in a terminal stage. Enter a reason to move it back to ${reopenTarget?.label}.`}
    placeholder="Reason for reopening..."
    submitLabel="Reopen"
    accentColor="#0c66e4"
    onClose={() => setReopenOpen(false)}
    onSubmit={async (reason) => { await onPatch({ stage_id: reopenTarget!.id, reopen_reason: reason }); return true; }}
  />
  ```
  Enrollment **đã** import 6 component khác từ `tasks/_components` (`:77-83`) nên không tạo coupling mới.
- **Regression Risk:** Thấp. Server đã bắt buộc `reopen_reason` (`api/enrollment/[id]/route.ts:181-187`) nên không thể lọt reason rỗng.
- **Verification (chưa chạy):** đưa record về stage terminal → Reopen → modal hiện, bỏ trống thì không submit được, có lý do thì stage đổi + activity `reopened` được ghi.
- **Status:** OPEN (fix proposed, not applied)

> **[CODEX COMMENT — M-08 CONFIRMED, SEVERITY DISAGREEMENT]** UI inconsistency và accessibility concern là thật, nhưng P2 “luồng có thể chết” chưa được chứng minh cho runtime production bình thường; iframe sandbox/webview cũng chưa được xác nhận là môi trường deploy. Không có bằng chứng đó, đây phù hợp P3. Dùng `ReasonModal` vẫn là hướng chuẩn hoá hợp lý sau các P0/P1.

### M-27 — Trong cùng một drawer, có field lưu khi blur, có field lưu ngay khi đổi

- **Severity:** **P4**
- **Location:** blur-to-save: `EditableInput`/`EditableTextarea` (`:2601-2610`, `:2651-2656`); change-to-save: Stage (`:2722`), Due date (`:2735`), Payment (`:2753`), Carrier (`:2768`)…
- Không sai chức năng (menu chọn xong là xong), nhưng là hai mô hình tương tác cạnh nhau trong một panel. Ghi nhận, **không** đề xuất sửa trước Go-Live.

## UI Consistency

- **M-08** (prompt vs modal) — trên.
- **M-25:** Dialog Create của Enrollment **không có** ô nhập cho custom column, trong khi Create của Tasks có. So sánh props: `NewEnrollmentDialog` (`:3014-3035`) nhận `visibleColumnKeys / requiredColumnKeys / columnByKey`; `NewTaskDialog` (`TaskBoardClient.tsx:1456-1476`) còn nhận thêm `detailColumns`, `tableColumnOptions`, `configuredColumnKeys`. Chi tiết ở mục Config ↔ Enrollment.
- Overview: CS có auto-refresh 30s + realtime, Enrollment không có (M-30). Xem X-07.
- Deep-link: Enrollment **luôn** push `?record=` khi mở (`:902-905`); Tasks thì xoá (T-09). Hai hành vi ngược nhau cho cùng một thao tác "mở chi tiết".

## Duplicate / Overlapping Logic

### M-31 — Quy tắc "field nào không áp dụng cho Medicare" bị chép ở **5** nơi

- **Severity:** **P3** (hiện đang khớp nhau — rủi ro là ở lần sửa sau)
- **Location:**
  1. `EnrollmentClient.tsx:219-226` — `MEDICARE_HIDDEN_COLUMNS` (khoá cột danh sách)
  2. `EnrollmentClient.tsx:2514-2524` — `showPayment/showAca/showConsent/showPlatform/showCaller/showPcp2026 = !isMedicare && ...` (drawer)
  3. `EnrollmentClient.tsx:3114-3124` — strip payload trong `submit()` của Create dialog
  4. `src/lib/enrollment/program-fields.ts:3-10` — `MEDICARE_INAPPLICABLE_FIELDS` (server)
  5. `EnrollmentClient.tsx:3946-3948` — `enrollmentNeedsAttention`: `record.program !== "medicare" && !record.caller_email`
- **Đã kiểm chứng:** cả 5 danh sách hiện **khớp nhau** (caller, payment, aca, consent, platform, pcp2026). Không có bug đang tồn tại.
- **Impact:** Thêm/bớt một field Medicare-inapplicable phải sửa đúng 5 chỗ; sót 1 chỗ là dữ liệu Medicare lệch mà không có test nào bắt được (`program-fields.test.ts` chỉ có 3 test và chỉ phủ điểm 4).
- **Fix:** **KHÔNG làm trước Go-Live** (§3 brief: đây là refactor, không phải rủi ro production đang xảy ra). Đề xuất tối thiểu: thêm test khoá 5 danh sách lại với nhau — rẻ, không đụng code chạy:
  ```ts
  it("mọi danh sách Medicare-inapplicable phải khớp nhau", () => {
    expect([...MEDICARE_HIDDEN_COLUMNS].sort()).toEqual(
      ["aca","caller","consent","payment","pcp2026","platform"]
    );
    expect([...MEDICARE_INAPPLICABLE_FIELDS].sort()).toEqual(
      ["aca_status_id","caller_email","consent_id","payment_status_id","pcp_2026","platform_id"]
    );
  });
  ```
- **Status:** OPEN (chỉ đề xuất thêm test)

## Security / Permission

- ✅ Mọi route enrollment đều qua `loadEnrollmentActor()` → `canAccessEnrollment`. PATCH kiểm `canMutateEnrollmentRecord`, DELETE kiểm `canArchiveEnrollmentRecord` (hẹp hơn: chỉ manager hoặc người tạo) — server-side, có test (`access.test.ts`, 4 test). Đúng.
- ✅ Option id được validate thuộc đúng set + chưa archived (`api/enrollment/[id]/route.ts:534-541`, `assertEnrollmentOptionSet` ở create).
- ℹ️ **Xem toàn công ty là chủ ý:** `fetchEnrollmentRecords` không lọc theo user — mọi người có `TASK_WORK` đọc được mọi record của program. Khớp với quyết định sản phẩm 2026-08-02 (CS company-wide / Enrollment shared+revert), **không tính là lỗi**. Nhưng nên biết: điều đó cũng có nghĩa **toàn bộ nội dung comment** của mọi record được gửi tới mọi client (M-22) — nếu sau này có record nhạy cảm, đây là chỗ phải sửa đầu tiên.

## Regression Risks

| Thay đổi | Có thể vỡ ở đâu | Cách chặn |
|---|---|---|
| M-01 (trả stats thật ở nhánh no-op) | Chỉ nhánh no-op | So sánh badge trước/sau |
| M-11 (chặn patch date rác) | Ô Due date drawer, cả 2 program | Test gõ tay + dùng picker + xoá trống |
| M-26 (đổi thứ tự sanitize/validate) | **Ảnh hưởng cả ACA** — required của ACA phải vẫn chặn | Ma trận: {aca, medicare} × {required, không required} |
| M-23 (tách topic realtime) | Mất realtime nếu deploy lệch | Deploy 2 pha: phát cả 2 topic → rồi bỏ topic cũ |
| M-08 (ReasonModal) | Luồng reopen | Server đã bắt buộc reason → an toàn |
| M-18 (dùng chung parseDate) | Luồng import có thể bắt đầu fail | Rà `HealthTableImportDialog` trước |

## Fixes Applied

**Không có** — review-only.

## Verification

Baseline chung đã chạy (xem Overall Status). Chưa verify từng finding vì chưa apply fix.

Riêng module này, test hiện có: `src/lib/enrollment/*.test.ts` — `access.test.ts` (4), `overview.test.ts`, `column-visibility.test.ts`, `program-fields.test.ts` (3). **Không có** test cho `api/enrollment/*` route, cho `EnrollmentClient`, hay cho luồng Create/Patch.

## Remaining Risks

| Issue | Impact | Likelihood | Workaround | Risk | Lý do chưa fix | Khuyến nghị |
|---|---|---|---|---|---|---|
| M-22 (payload comment) | Chậm dần theo lượng comment | Cao theo thời gian | — | Trung bình | Cần quyết định sản phẩm về search | Cắt độ dài `comment_search_text` trước go-live |
| M-24 (fallback schema âm thầm) | Mất dữ liệu **không báo lỗi** nếu DB thiếu cột | Thấp nếu đã chạy `schema.sql` | Kiểm DB thủ công | **Cao nếu chưa kiểm** | Là thiết kế có chủ ý | **Bắt buộc kiểm trước go-live** — xem dưới |
| M-31 (5 danh sách trùng) | Lệch dữ liệu khi sửa sau này | Thấp trong tuần go-live | — | Thấp | Là refactor, §3 cấm | Chỉ thêm test |

### M-24 — Hệ thống "tự chữa" khi DB thiếu cột, và **im lặng nuốt dữ liệu**

- **Issue:** Có ≥4 chỗ bắt lỗi "cột/bảng không tồn tại" rồi chạy tiếp bằng đường fallback, trả **HTTP 200** như bình thường.
- **Severity:** **P2** (có thể thành **P0** nếu DB production chưa được cập nhật)
- **Location:**
  - `src/lib/enrollment/queries.ts:42-62` + `:77-99` — thiếu `enrollment_records.description` **hoặc** `custom_values` → chuyển sang bộ cột legacy
  - `src/app/api/enrollment/route.ts:173-184` — insert thất bại vì thiếu `description` → **insert lại, bỏ description**, trả 200
  - `src/app/api/enrollment/[id]/route.ts:286-306` — update tương tự, `descriptionSkipped = true` nhưng **không** báo cho client
  - `src/lib/tasks/queries.ts:315-333` — thiếu `tasks.custom_values` → bộ cột legacy; `:326-333` thiếu RPC `task_list_metadata` → đường chậm
  - `src/app/api/config/layout/route.ts:141-149` — thiếu bảng `user_table_layout` → trả `layout: null`
- **Trigger:** Deploy code lên một database chưa chạy `supabase/schema.sql` mới nhất.
- **Actual:** User gõ Description → bấm lưu → không có lỗi → chữ biến mất sau khi drawer reload. Không có log, không có alert.
- **Root Cause:** Repo **không có** cơ chế migration (chỉ một file `supabase/schema.sql` 93 KB, không có `supabase/migrations/`, không có bước migrate trong CI/`vercel.json`). Các fallback này là cách chống chịu việc đó.
- **Fix (đề xuất, chưa apply):** không gỡ fallback (chúng đang che rủi ro thật), mà **làm cho im lặng trở thành ồn ào**:
  1. `console.error` + trả `{ warning: "..." }` trong response ở mọi nhánh fallback.
  2. Thêm bước kiểm trước go-live: chạy `supabase/schema.sql` lên DB production và xác nhận 5 đối tượng: `enrollment_records.description`, `enrollment_records.custom_values`, `tasks.custom_values`, `user_table_layout`, function `task_list_metadata`.
- **Verification (chạy được ngay, không cần sửa code):**
  ```sql
  select column_name from information_schema.columns
   where (table_name='enrollment_records' and column_name in ('description','custom_values'))
      or (table_name='tasks' and column_name='custom_values');
  select to_regclass('public.user_table_layout');
  select proname from pg_proc where proname='task_list_metadata';
  ```
- **Status:** OPEN — **đây là hạng mục kiểm tra bắt buộc trước Go-Live**, không phải sửa code.

---

# 3. Config

## Status

Reviewed. **NOT READY** — 1× P1, 3× P2 chưa fix.

Phạm vi: `config/page.tsx`, `_components/ConfigClient.tsx` (1799 dòng);
`src/lib/table-config/**` (columns, queries, layout, required, import, export,
access, realtime); API `/api/config/columns`, `/api/config/columns/[id]`,
`/api/config/columns/[id]/options`, `/api/config/columns/reorder`,
`/api/config/layout`, `/api/config/imports`, `/api/config/imports/[id]`,
`/api/config/agents`, `/api/config/assistants`.

Config là **dependency cao nhất** của cả 3 màn còn lại: nó quyết định cột nào tồn
tại, nhãn gì, ghim/ẩn, **Required**, thứ tự, và dropdown values. Vì vậy mọi finding
ở đây đều có đuôi lan sang Tasks/Medicare/ACA.

> **[CODEX COMMENT — CONFIG CRITICAL OMISSIONS]** Số `1× P1` của module này bị thiếu đáng kể. Ngoài C-01, audit Codex xác nhận: (1) multi-step column/reorder/agent operations có thể partial commit; (2) stage option có thể archive stage cuối hoặc đổi terminal flag mà không reconcile record đang dùng; (3) custom Enrollment column bật Required nhưng create route không enforce; (4) import approval có partial commit, stale overwrite và bypass business invariants; (5) rapid `patchColumn` không có OCC/serialization nên response cũ có thể thắng. Các mục (1)–(4) là P1 trước Go-Live, mục (5) là P2.

## Functional Bugs

### C-01 — Đổi Config **không** tới được các tab đang mở; broadcast bắn ra nhưng không ai nghe đúng thứ

- **Issue:** `broadcastTableConfigChanged()` không có kênh riêng — nó gọi lại đúng 2 kênh **dữ liệu** của Tasks và Enrollment. Hai client đó khi nhận ping chỉ refetch **rows**, chưa bao giờ refetch **column config**.
- **Severity:** **P1**
- **Location:**
  - `src/lib/table-config/realtime.ts:4-6` — toàn bộ nội dung:
    ```ts
    export async function broadcastTableConfigChanged(): Promise<void> {
      await Promise.all([broadcastEnrollmentChanged(), broadcastTasksChanged()]);
    }
    ```
  - Bên nhận, Tasks: `TaskBoardClient.tsx:512-518` → `refetchTasks()` (`GET /api/tasks`, chỉ rows) + `reloadCategories()`
  - Bên nhận, Enrollment: `EnrollmentClient.tsx:786-792` → `refetch()` (`GET /api/enrollment`, chỉ rows) + `reloadOptions()`
  - Nguồn config ở client: prop `tableColumns` từ RSC — `tasks/page.tsx:102-103`, `enrollment/page.tsx:87-89`. **Không có đường nào cập nhật lại prop này mà không reload trang.**
- **Affected Module:** Config → Tasks, Medicare, ACA (cả 3)
- **Trigger:** Admin ở `/config` đổi bất cứ thứ gì: thêm cột, đổi nhãn, bật Required, ghim, ẩn, archive, đổi thứ tự, thêm/xoá dropdown value.
- **Expected:** Tab của user cập nhật (hoặc ít nhất báo "cấu hình đã đổi, tải lại").
- **Actual:** Tab user **giữ nguyên cấu hình cũ vô thời hạn**. Đồng thời vẫn bị ép chạy 1 lần refetch full-list (Tasks) + 1 lần refetch full-list (Enrollment) hoàn toàn vô ích — nhân với số tab đang mở, nhân với mỗi cú click trong Config.
- **Root Cause:** Không có kênh config riêng và không có endpoint để client kéo lại column config. `/api/config/columns?scope=` **đã tồn tại** (`api/config/columns/route.ts:15-36`, chỉ cần `loadConfigActor`, không đòi admin) — tức là mảnh ghép còn thiếu chỉ là phía client.
- **Impact (3 hệ quả thật, không phải giả định):**
  1. **Bật Required trong khi user đang mở tab:** client validation của user không biết field mới → cho bấm Create → server đọc config **live** (`findMissingRequiredFields` query thẳng DB) → trả 400 "X required." Với Tasks, `NewTaskDialog` không render field mới nếu nó vốn `hidden_default`… mà Required đã ép `hidden_default=false` ở DB — nhưng client **không biết**, vẫn dùng bản cũ → **user không có ô để điền, và không tạo được task cho tới khi F5**.
  2. **Đổi nhãn cột:** user vẫn thấy nhãn cũ; export ra Excel dùng nhãn cũ (`exportColumnKeys` lấy từ state cũ) → hai người export cùng lúc ra hai file khác header.
  3. **Kết hợp với C-02:** admin archive/ẩn một cột → server xoá sạch layout của mọi user → tab đang mở ghi layout **cũ** đè lại.
- **Fix (đề xuất, chưa apply) — nhỏ nhất mà đúng:** thêm kênh riêng cho config và cho client kéo lại column config khi nhận ping.
  ```ts
  // src/lib/table-config/realtime-topics.ts  (mới)
  export const TABLE_CONFIG_TOPIC = "table-config-stream";

  // src/lib/table-config/realtime.ts
  export async function broadcastTableConfigChanged(): Promise<void> {
    await Promise.all([
      broadcastToTopic(TABLE_CONFIG_TOPIC, "changed"),   // dùng lại helper của tasks/realtime.ts
      broadcastEnrollmentChanged(),
      broadcastTasksChanged(),
    ]);
  }
  ```
  Phía client (Tasks và Enrollment), subscribe `TABLE_CONFIG_TOPIC` và gọi
  `GET /api/config/columns?scope=<scope>` → `setTaskLayoutColumns` / `setLayoutTableColumns`.
  **Lưu ý bắt buộc:** ở Tasks, việc này chỉ an toàn **sau khi** đã sửa T-01 — nếu không,
  mỗi lần set `taskLayoutColumns` lại châm thêm một vòng lặp vô hạn.
- **Regression Risk:** **Trung bình–cao.** Đụng vào nguồn `tableColumns` của cả 3 màn. Rủi ro cụ thể:
  - refresh config giữa lúc user đang mở dialog Create → field có thể xuất hiện/biến mất giữa chừng (cần chốt: chỉ áp dụng khi không có dialog/drawer nào mở, hoặc hiện banner "Cấu hình đã đổi — Tải lại").
  - phải làm **sau** T-01.
- **Verification (chưa chạy):** mở `/tasks` ở tab A, `/config` ở tab B → đổi nhãn 1 cột ở B → tab A phải đổi nhãn trong ≤1s mà **không** reload; DevTools Network của tab A phải **không** có thêm `GET /api/tasks` nào cho thao tác đó.
- **Status:** OPEN (fix proposed, not applied) — **ứng viên hàng đầu để hoãn nếu thiếu thời gian**; xem phương án tạm ở Remaining Risks.

> **[CODEX COMMENT — C-01 CONFIRMED]** Finding và P1 là đúng, nhưng gọi đây là “ứng viên hàng đầu để hoãn” chỉ an toàn nếu Go-Live áp dụng **config freeze**, cấm chỉnh trong giờ vận hành, bắt buộc reload sau mọi thay đổi và có owner chịu trách nhiệm. Banner/F5 chỉ là mitigation, không đóng lỗi; nếu Config vẫn được phép đổi live thì P1 này vẫn chặn Go-Live.

### C-02 — Reset layout của admin bị tab đang mở ghi đè ngược lại

- **Issue:** Khi admin đổi `hidden_default`/`pinned`, server xoá sạch `user_table_layout` của scope đó để thay đổi có hiệu lực với mọi người. Nhưng các tab đang mở vẫn giữ layout cũ trong memory và ghi lại xuống DB.
- **Severity:** **P2**
- **Location:**
  - Xoá: `src/lib/table-config/queries.ts:305-314` (`resetTableLayoutsForScope`), gọi ở `api/config/columns/[id]/route.ts:112-117`
  - Ghi đè ngược, Tasks: `TaskBoardClient.tsx:1249-1272` (`saveTaskTableLayout` serialize từ `taskLayoutColumns` **cũ trong memory**)
  - Ghi đè ngược, Enrollment: `EnrollmentClient.tsx:590-615` (effect tự động PUT khi `hiddenColumnKeys`/`layoutTableColumns` đổi, debounce 250ms)
- **Affected Module:** Config → Tasks, Medicare, ACA
- **Trigger:** Admin bật "Hidden" cho một cột. User A đang mở `/tasks` → bật/tắt bất kỳ cột nào trong menu cột → `PUT /api/config/layout` với layout cũ (chưa có thay đổi của admin).
- **Expected:** Thay đổi của admin thắng.
- **Actual:** Layout của user A quay về trạng thái trước reset. Admin nhìn máy mình thì thấy đúng (Config tự refresh), user A thì không.
- **Root Cause:** Hệ quả trực tiếp của C-01 (client không biết config đã đổi) cộng với việc PUT layout gửi **toàn bộ** layout thay vì delta.
- **Fix (đề xuất, chưa apply):** sửa C-01 là bịt được phần lớn. Bịt thêm ở tầng dữ liệu: cho `PUT /api/config/layout` bỏ qua entry của cột đã archived và **không** ghi `hidden` cho cột mà admin vừa đổi `hidden_default` — hoặc đơn giản hơn, gắn `config_version` (max `table_column.updated_at` của scope) vào layout và từ chối PUT mang version cũ hơn.
- **Regression Risk:** Trung bình. Đụng đường ghi layout dùng chung 3 scope.
- **Status:** OPEN (fix proposed, not applied)

### C-03 — Duyệt import lớn sẽ timeout giữa chừng, để lại dữ liệu ghi **một nửa**

- **Issue:** Route approve áp dụng từng dòng **tuần tự**, không transaction, không `maxDuration`, trong khi giới hạn import là 5.000 dòng.
- **Severity:** **P2** (thành **P1** nếu go-live có kế hoạch import dữ liệu thật)
- **Location:**
  - `src/app/api/config/imports/[id]/route.ts:91-94`
    ```ts
    for (const row of data.rows) {
      await applyImportRow(data.request.scope, row);   // 2–3 round-trip DB mỗi dòng
    }
    ```
  - Giới hạn: `src/app/api/config/imports/route.ts:22` → `IMPORT_MAX_ROWS = 5_000`
  - **Không có** `export const maxDuration` trong route này. Cả repo chỉ có **một** chỗ đặt: `src/app/api/cron/sync-data/route.ts:5` → `maxDuration = 300` (tức là team đã biết cơ chế này, chỉ là chưa đặt cho import).
- **Affected Module:** Config → Tasks / Medicare / ACA (ghi thẳng vào `tasks` và `enrollment_records`)
- **Trigger:** Duyệt một import ~1.000 dòng trở lên.
- **Expected:** Toàn bộ áp dụng, hoặc không dòng nào áp dụng.
- **Actual:** 5.000 dòng × ~2–3 round-trip ≈ 10.000–15.000 request tuần tự. Ở 20 ms/request đã là **200–300 giây** — vượt `maxDuration` mặc định của Vercel. Function bị kill giữa chừng:
  - `catch` **không** chạy → `import_request.status` kẹt ở `processing`;
  - N dòng đầu **đã ghi vào DB**, phần còn lại thì không;
  - không có cột nào ghi lại "đã áp dụng tới dòng nào" (`import_request_row` chỉ có `action/target_record_id/values/error_text`).
  → Duyệt lại lần nữa sẽ **nhân đôi** các dòng `add` đã ghi.
- **Điểm đã làm đúng:** claim `status='pending' → 'processing'` bằng conditional update (`:72-89`) nên **không** double-apply do double-click. `processing` cũng nằm trong `REJECTABLE_IMPORT_STATUSES` (`:36`) nên request kẹt vẫn reject được thủ công. Vấn đề còn lại thuần tuý là dữ liệu ghi dở.
- **Fix (đề xuất, chưa apply), theo thứ tự rẻ → đắt:**
  1. `export const maxDuration = 300;` trong `api/config/imports/[id]/route.ts` — 1 dòng, mua thêm thời gian ngay. *(Kiểm gói Vercel: 300s cần Pro.)*
  2. Ghi `applied_at` lên từng `import_request_row` sau khi áp dụng xong → duyệt lại chỉ chạy phần chưa `applied_at` (idempotent, không nhân đôi).
  3. Batch insert/update theo lô 100–500 dòng thay vì từng dòng.
  4. Hạ `IMPORT_MAX_ROWS` xuống mức chạy lọt trong thời gian cho phép (vd 500) cho tới khi (2)+(3) xong.
  → **Cho tuần go-live: làm (1) + (4).** (2)(3) để sau.
- **Regression Risk:** (1)(4) gần như bằng 0. (2)(3) là thay đổi lớn, không làm trước go-live.
- **Verification (chưa chạy):** import 600 dòng thử trên staging, đo thời gian phản hồi của `PATCH /api/config/imports/{id}`.
- **Status:** OPEN (fix proposed, not applied)

> **[CODEX COMMENT — C-03 SEVERITY UNDERRATED]** Rủi ro không chỉ xảy ra với file lớn bị timeout. **Bất kỳ** row nào lỗi sau khi các row trước đã ghi cũng tạo partial dataset. Với update, staged values không có version/OCC nên còn có thể đè thay đổi mới hơn; đường lấy custom values biến DB error thành `{}` có thể ghi trắng custom data. Vì thế đây là P1 integrity bug nếu import được bật ở production; `maxDuration` + hạ row limit chỉ giảm xác suất timeout, không tạo atomicity/idempotency và không đóng finding.

### C-04 — Đường import bỏ qua toàn bộ validation nghiệp vụ mà API thường bắt buộc

- **Issue:** `applyTaskImportRow` / `applyEnrollmentImportRow` insert thẳng vào bảng, không đi qua `findMissingRequiredFields`, không validate option id, không ghi activity/history/notification.
- **Severity:** **P3**
- **Location:** `src/app/api/config/imports/[id]/route.ts:205-244` (`applyTaskImportRow`) và hàm enrollment tương ứng bên dưới
- **Trigger:** Import file có dòng thiếu cột Required.
- **Actual:** Dòng đó vẫn được tạo. Cột Required của Config **không có hiệu lực** trên đường import. Task tạo bằng import còn có `reporter_email: "import"` (`:225`) — không phải email thật, sẽ hiện là "Import" ở cột "Opened by" và không bao giờ nhận được notification.
- **Severity:** ~~P3~~ → **P2** *(nâng theo phản biện của Codex — xem dưới)*
- **Status:** OPEN (needs product decision)

> **[Claude — Codex phản biện ĐÚNG, tao nâng severity và rút chữ "chủ ý".]**
> Tao viết *"có thể là chủ ý → documentation only"*. Sai ở chỗ: tao lấy sự tồn tại của một comment giải thích chủ ý **ở chỗ khác** (`required.ts:28-31`, nói về Create dialog của Enrollment) rồi gán luôn cho đường import. **Không có dòng nào trong repo nói việc import bỏ qua Required là có chủ ý.** Suy luận không có căn cứ.
>
> Codex đúng: đây là **đường ghi production thứ hai**, khác API chuẩn, có thể tạo dữ liệu sai âm thầm — và nó vẫn ghi vào đúng bảng `tasks` / `enrollment_records` mà mọi thứ khác đọc.
>
> Codex còn bổ sung một điểm sắc hơn phần tao viết: import đổi stage của enrollment **không** set/clear `closed_at`, không chạm QC field, không ghi `enrollment_stage_history`. Hệ quả cụ thể: import một record vào stage **terminal** để lại `closed_at = null` → `enrollmentNeedsAttention`, filter, Overview và cron due-date đều đọc sai trạng thái record đó. Đây là **mâu thuẫn dữ liệu thật**, không chỉ là "thiếu audit log".
>
> **Nhưng tao vẫn giữ P2, không lên P1** như Codex đề nghị: đường này chỉ chạy khi **admin chủ động duyệt một import**. Nó không tự xảy ra trong thao tác thường ngày của user. Với tuần go-live, biện pháp đúng là **tắt/khoá import** (đã có trong plan cuối) chứ không phải viết lại tầng import — và một khi đã tắt thì nó không còn là release gate.

> **[CODEX COMMENT — C-04 DISAGREE]** Chưa có business requirement/sign-off thì không thể suy ra đây là “chủ ý” và hạ xuống documentation-only. Import hiện bypass Required, option validity, task transition invariants, audit/history và notification; màn approval lại chỉ cho count, không cho reviewer xem row/diff. Đây là đường ghi production khác API chuẩn và có thể tạo dữ liệu sai âm thầm — Codex xếp P1 cho tới khi owner xác nhận contract import lịch sử và thêm validation/preview tương ứng.

### C-05 — Bất biến của cột chỉ được áp ở PATCH, không áp ở POST

- **Issue:** `applyColumnPatchInvariants` (Required/Pinned ⇒ không thể Hidden; Required trên custom column ⇒ bật `show_in_detail`) được gọi ở PATCH nhưng **không** ở POST.
- **Severity:** **P3**
- **Location:** có ở `api/config/columns/[id]/route.ts:91`; **thiếu** ở `api/config/columns/route.ts:66-84` (insert set thẳng `pinned`/`hidden_default`/`required`/`show_in_detail` từ body)
- **Trigger:** Gọi thẳng `POST /api/config/columns` với `{ required: true, hidden_default: true }` (form trong UI chỉ gửi `{scope,label,type}` nên không tự trúng).
- **Actual:** Tạo ra cột vừa Required vừa Hidden → không nằm trong `adminVisibleColumnKeys` → **không render ô nhập ở đâu cả**, nhưng server vẫn đòi. Đúng cái tình huống "Required không thể thoả mãn" mà `applyColumnPatchInvariants` sinh ra để chặn.
- **Fix (đề xuất, chưa apply):** bọc payload insert qua cùng một hàm:
  ```ts
  const invariants = applyColumnPatchInvariants(
    { pinned: Boolean(body?.pinned), required: Boolean(body?.required), is_system: false },
    { pinned: Boolean(body?.pinned), required: Boolean(body?.required),
      hidden_default: Boolean(body?.hidden_default), show_in_detail: Boolean(body?.show_in_detail) }
  );
  ```
- **Regression Risk:** Rất thấp — UI hiện không gửi mấy cờ này.
- **Status:** OPEN (fix proposed, not applied)

### C-15 — Lỗi đọc tạm thời khi duyệt import → **xoá trắng toàn bộ `custom_values`** của record *(Codex phát hiện, tao verify đúng)*

- **Issue:** `fetchCurrentCustomValues` biến **mọi** lỗi đọc DB thành `{}`, rồi giá trị đó được dùng làm nền cho một phép ghi **thay thế toàn bộ** cột `custom_values`.
- **Severity:** **P1** — mất dữ liệu, không có cảnh báo, không hoàn tác được.
- **Location:** `src/app/api/config/imports/[id]/route.ts:326-340`
  ```ts
  async function fetchCurrentCustomValues(table, id): Promise<Record<string, unknown>> {
    const { data, error } = await getSupabaseAdmin().from(table).select("custom_values")...;
    if (error) return {};          // ← nuốt lỗi, trả object rỗng
    ...
  }
  ```
  Nơi tiêu thụ (ghi đè toàn bộ, **không** merge ở tầng DB):
  - `:243` (tasks) → `custom_values: { ...currentCustomValues, ...customPatch }`
  - `:316` (enrollment_records) → tương tự
- **Affected Module:** Config → Tasks + Medicare + ACA
- **Trigger:** Duyệt một import có dòng `update`, đúng lúc câu `select custom_values` gặp lỗi tạm thời (timeout, connection reset, PostgREST 5xx, schema-cache miss).
- **Expected:** Không đọc được giá trị hiện tại thì **dừng dòng đó**, không ghi gì.
- **Actual:** `currentCustomValues = {}` → ghi `{ ...{}, ...customPatch }` → **mọi custom field không có trong file Excel bị xoá sạch**. Nếu `customPatch` cũng rỗng thì cột thành `{}` — mất trắng.
- **Root Cause:** Mẫu "error-as-empty" đặt vào đúng một thao tác read-before-replace. Với read-modify-write, `{}` không phải giá trị mặc định an toàn — nó là giá trị **phá huỷ**.
- **Fix (đề xuất, chưa apply):** **1 dòng.**
  ```ts
  if (error) throw new Error(`Could not read current custom_values for ${table}/${id}: ${error.message}`);
  ```
  Vòng lặp duyệt đã có `try/catch` bọc ngoài (`:91-109`) sẽ bắt, đánh dấu request `failed` kèm lý do, và **không** ghi tiếp.
- **Regression Risk:** **Rất thấp.** Chỉ đổi hành vi ở nhánh lỗi — nhánh mà hiện tại đang phá dữ liệu.
- **Verification (chưa chạy):** tạm đổi tên bảng trong `fetchCurrentCustomValues` để ép lỗi → duyệt 1 import update → dòng đó phải **fail**, và `custom_values` trong DB phải **giữ nguyên**.
- **Status:** OPEN (fix proposed, not applied)

> **[Claude]** Tao đọc `applyTaskImportRow` và **thấy** dòng `custom_values: { ...currentCustomValues, ...customPatch }` nhưng không mở `fetchCurrentCustomValues` ra xem nó xử lý lỗi thế nào — cho rằng một hàm tên "fetch current values" thì hoặc trả giá trị hoặc ném lỗi. Codex mở ra xem. Đây là finding **rẻ nhất để fix và đắt nhất nếu bỏ qua** trong toàn bộ hai bài review.

## Performance / Lag

### C-06 — Mở `/config` quét toàn bộ bảng `enrollment_records` chỉ để đếm usage của dropdown

- **Severity:** **P2**
- **Location:** `src/app/(authed)/config/page.tsx:59-63`
  ```ts
  supabase.from("enrollment_records")
    .select("program,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id")
    .is("archived_at", null),          // ← KHÔNG có .limit()
  ```
  Xử lý ở `:76-100` (`buildUsageCounts`, loop toàn bộ rows × 2 lần cho aca + medicare)
- **Trigger:** Mỗi lần mở `/config` (kể cả khi admin chỉ vào tab "Assistant Membership", không liên quan gì tới dropdown).
- **Actual:** Với 20.000 record là 20.000 dòng × 7 cột kéo về server rồi loop 2 lần — nằm trên đường render của trang, chặn TTFB. Comment `// Đếm usage TỐI GIẢN — KHÔNG load nguyên enrollment records.` cho thấy đã tối ưu 1 lần, nhưng vẫn là full scan.
- **Thêm:** kết quả này **không bao giờ được làm mới** — `refreshOptionData` chỉ cập nhật `optionData`, `enrollmentUsageCounts` giữ nguyên bản SSR (`ConfigClient.tsx:238-242`). Xoá một option rồi xem lại số usage vẫn là số cũ.
- **Fix (đề xuất, chưa apply):** dùng aggregate thay vì kéo rows — 1 RPC `count(*) group by` cho mỗi cột option, hoặc 6 query `select option_id, count(*)`. Hoặc rẻ nhất: **lười** — chỉ đếm khi admin mở tab "Dropdown Values", qua một endpoint riêng.
- **Regression Risk:** Thấp (chỉ ảnh hưởng con số cảnh báo trước khi xoá option).
- **Status:** OPEN (fix proposed, not applied)

### C-07 — Mỗi cú click trong Config làm **mọi** tab Tasks + **mọi** tab Enrollment refetch full-list

- **Severity:** **P2**
- **Location:** `src/lib/table-config/realtime.ts:4-6` (đã dẫn ở C-01) — 11 route Config gọi hàm này (columns, options, reorder, agents, assistants, imports).
- **Trigger:** Admin kéo thả sắp xếp cột → mỗi lần thả là 1 broadcast.
- **Actual:** Mỗi broadcast = mọi tab `/tasks` chạy `GET /api/tasks` (không phân trang — T-04) **và** mọi tab `/enrollment` chạy `GET /api/enrollment` (kèm toàn bộ text comment — M-22). Không tab nào thu được gì từ đó (C-01). Với 50 người đang mở app, một buổi admin chỉnh Config 20 lần = **2.000 request full-list vô ích**.
- **Fix:** chính là fix của C-01 (kênh riêng cho config) — khi đó ping config không còn kéo theo refetch dữ liệu.
- **Status:** OPEN (gộp với C-01)

## Race Conditions / Async Issues

### Đã kiểm tra và KHÔNG có vấn đề

| Vùng | Kết luận |
|---|---|
| `patchColumn` (`ConfigClient.tsx:481-520`) | ⚠️ **ĐÁNH GIÁ CỦA TAO QUÁ CAO — Codex sửa đúng.** Rollback theo **từng cột** (không snapshot cả mảng) và đặt refresh **ngoài** `try` thì đúng và tốt. Nhưng `pendingColumnPatchesRef` chỉ quyết định **khi nào refresh**, nó **không** serialize request và **không** gửi expected version → hai lần bấm nhanh cùng một field: A và B cùng bay, DB kết thúc ở cái **về sau**, không phải cái **bấm sau**. Thêm nữa nếu request settle cuối cùng là failure, nó `throw` **trước** đoạn refresh sau `try`, trong khi request thành công trước đó đã skip refresh → UI kẹt state cũ. → xem **C-14**. |
| Optimistic khớp server | `applyColumnPatchInvariants` được **dùng chung** client (`:491`) và server (`api/config/columns/[id]/route.ts:91`) → không có hiện tượng "toggle tự sửa lại sau 1s". Đúng mẫu chống flicker mà §12 brief yêu cầu. |
| Claim import request | Conditional update `.eq("status","pending")` (`imports/[id]/route.ts:72-89`) → double-click Approve không double-apply. Đúng. |
| Sắp xếp cột không "sink" hidden xuống đáy | Comment `ConfigClient.tsx:439-447` ghi rõ vì sao (hàng teleport khỏi con trỏ + làm hỏng `position` thật). Quyết định đúng. |

> **[CODEX COMMENT — `patchColumn` NOT RACE-SAFE]** Kết luận hàng đầu trong bảng là sai. Counter chỉ quyết định lúc nào refresh; nó không serialize request, không gửi expected version và không bảo đảm **last user intent wins**. Hai PATCH A→B có thể về B rồi A, khiến DB kết thúc ở A. Nếu request settle cuối là failure, nó throw trước post-try refresh trong khi request success trước đó đã skip refresh, nên UI còn có thể giữ state stale. Rollback theo một cột là tốt hơn snapshot cả mảng, nhưng không biến đường này thành concurrency-safe.

### C-14 — `patchColumn` không serialize và không có OCC: bấm nhanh 2 lần thì DB giữ lần bấm **trước** *(Codex phát hiện, tao verify đúng)*

- **Issue:** `pendingColumnPatchesRef` là bộ đếm để biết **khi nào refresh**, không phải cơ chế xếp hàng. Không request nào gửi expected version, `PATCH /api/config/columns/[id]` cũng không kiểm.
- **Severity:** **P2**
- **Location:** `src/app/(authed)/config/_components/ConfigClient.tsx:481-520`; server `src/app/api/config/columns/[id]/route.ts:93-100` (update theo `id` trần, không có predicate version)
- **Trigger:** Bật rồi tắt nhanh cùng một toggle (Required/Hidden/Pinned) trên mạng chậm.
- **Actual:** hai kịch bản hỏng:
  1. **Sai thứ tự ghi:** A(bật) và B(tắt) cùng bay, B về trước, A về sau → DB kết thúc ở **bật**, ngược ý định cuối của admin. UI thì hiện "tắt" vì optimistic local đã đổi → **UI và DB nói ngược nhau cho tới lần refresh sau**.
  2. **Kẹt state cũ:** B thành công nhưng skip refresh (vì A còn pending), rồi A thất bại → A rollback cột, giảm counter về 0, **`throw` trước** đoạn `if (pendingColumnPatchesRef.current === 0) await refreshScope(scope)` (`:517-519`) → không ai reconcile.
- **Fix:** xếp hàng theo `column.id` (cùng mẫu `queuePatch` đề xuất ở **T-02**), và đưa reconcile vào `finally` thay vì sau `try`. Thêm expected version cho route thì tốt nhưng không bắt buộc trước go-live.
- **Regression Risk:** Trung bình — đụng invariant cột + side-effect reset layout của mỗi PATCH.
- **Status:** OPEN (fix proposed, not applied)

### C-08 — `refreshScope` / `refreshOptionData` không có latest-wins

- **Severity:** **P3**
- **Location:** `ConfigClient.tsx:147-164`
- **Trigger:** Đổi scope nhanh cs → aca → medicare trên mạng chậm; response về sai thứ tự.
- **Actual:** Vì cả hai đều ghi theo key (`{...current, [nextScope]: payload.columns}`) nên **không** ghi nhầm scope — thiệt hại tối đa là dữ liệu cũ của đúng scope đó. Nhẹ.
- **Fix:** thêm `seqRef` như `EnrollmentClient.refetch`. Ưu tiên thấp.
- **Status:** OPEN (fix proposed, not applied)

## State Management Issues

- `localColumns` (state cục bộ, `ConfigClient.tsx:449`) song song với `columns[scope]` (state cha) — hai nguồn cho cùng một danh sách, đồng bộ 1 chiều qua effect `:455-458`. Đã được kiểm soát bằng `pendingColumnPatchesRef`, **không phát hiện lỗi**. Ghi nhận là điểm cần cẩn thận khi sửa về sau.
- `enrollmentUsageCounts` là snapshot SSR, không đồng bộ với `optionData` đã refresh — xem C-06.

## UI/UX Issues

### C-09 — Lỗi và thành công dùng **chung một toast, chung một màu**

- **Severity:** **P3**
- **Location:** `ConfigClient.tsx:166-177` (`run` đổ cả 2 vào cùng `notice`) và `:269`
  ```tsx
  <Toast message={notice} onDismiss={() => setNotice(null)} />   // ← không truyền tone
  ```
  `Toast` mặc định `tone = "info"` → nền `#172b4d` (xanh đen) — `_shared/Toast.tsx:8-12,26`.
- **Actual:** "Column updated." và "System column label cannot be edited." hiện **giống hệt nhau**. Admin đọc lướt sẽ tưởng thao tác thành công trong khi server đã từ chối.
- **So sánh:** Tasks truyền `tone="error"` (`TaskBoardClient.tsx:1563`), Enrollment cũng vậy (`EnrollmentClient.tsx:1004`). **Chỉ Config là không.**
- **Fix (đề xuất, chưa apply):** tách 2 state, hoặc mang theo tone:
  ```ts
  const [notice, setNotice] = useState<{ text: string; tone: ToastTone } | null>(null);
  // run(): thành công → { text: success, tone: "success" }; lỗi → { text: message, tone: "error" }
  <Toast message={notice?.text ?? null} tone={notice?.tone ?? "info"} onDismiss={() => setNotice(null)} />
  ```
- **Regression Risk:** Rất thấp, khu trú trong ConfigClient.
- **Status:** OPEN (fix proposed, not applied)

## UI Consistency

- `DropdownSelect` (`ConfigClient.tsx:298-417`) là **cái select thứ tư** trong hệ thống, cạnh `TaskSelect` (`tasks/_components/TaskSelect.tsx`), `EnrollmentOptionMenu` (`EnrollmentClient.tsx:2076`), `EnrollmentPersonMenu` (`:2168`). Bốn triển khai, ba hành vi đóng khác nhau: `DropdownSelect` dùng `onBlur` + `relatedTarget`; `useAnchoredMenu` dùng `pointerdown` + `keydown` + `scroll` capture; `TaskSearchBox` dùng `pointerdown` riêng. Hệ quả cụ thể: **chỉ `useAnchoredMenu` mới render qua portal**, nên `DropdownSelect` trong Config bị cắt bởi `overflow` của khung bảng khi nó nằm gần đáy — nó chống bằng cách tự lật lên (`:321-331`), tức là đã phải giải lại đúng bài toán mà `useAnchoredMenu` giải sẵn.
  → **P3, KHÔNG hợp nhất trước Go-Live** (§3 brief). Ghi nhận là nợ kỹ thuật ưu tiên cao sau go-live.
- Config là màn duy nhất **không** dùng layout shell chung (`min-h-screen bg-[#f7f8fa] px-8 py-10` — `:183`), trong khi Tasks/Enrollment dùng `flex h-full min-h-0 … bg-[#f7f9fc]`. Nền lệch màu (`#f7f8fa` vs `#f7f9fc`) và không có header/toolbar chung. **P4**, cosmetic.

## Duplicate / Overlapping Logic

- ✅ **Không** có logic trùng nguy hiểm ở tầng bất biến cột: `applyColumnPatchInvariants` và `REQUIRED_CAPABLE_SYSTEM_KEYS` đều là nguồn duy nhất, được cả client lẫn server dùng chung, có comment giải thích rõ vì sao. Đây là phần làm **tốt nhất** của module.
- ⚠️ Bất biến đó **không** được áp ở đường POST — xem C-05.
- ⚠️ Đường import ghi DB bằng code riêng, không đi qua API nghiệp vụ — xem C-04.

## Security / Permission

- ✅ `loadConfigAdmin()` cho mọi thao tác ghi; `loadConfigActor()` (nhẹ hơn) cho GET columns và GET/PUT layout — đúng, vì user thường **cần** đọc config và lưu layout của chính mình.
- ✅ `PUT /api/config/layout` lọc theo `validKeys` từ `fetchTableColumns(scope)` (`api/config/layout/route.ts:62-76`) → không nhét được key rác vào layout.
- ✅ Cột hệ thống không archive được (`api/config/columns/[id]/route.ts:133-135`); cột Required không archive được (`:136-141`) — chặn đúng chỗ.
- ⚠️ **C-10 (P3):** `GET /api/config/columns` **không có** tham số scope thì trả về config của **cả 3 scope** (`route.ts:24-28`) cho bất kỳ user nào qua được `loadConfigActor`. Không lộ dữ liệu khách hàng, nhưng lộ toàn bộ cấu trúc bảng của các module user đó không có quyền vào. Fix: bắt buộc `scope`, hoặc lọc theo quyền.

## Regression Risks

| Thay đổi | Có thể vỡ ở đâu | Cách chặn |
|---|---|---|
| C-01 (kênh config riêng + refetch config ở client) | **Cả 3 màn.** Config đổi giữa lúc user mở dialog Create/drawer → field nhảy | Làm **sau** T-01; áp dụng config mới chỉ khi không có dialog/drawer mở, hoặc chỉ hiện banner "Tải lại" |
| C-02 (chặn PUT layout cũ) | Lưu ẩn/hiện cột ở cả Tasks + 2 program Enrollment | Test 3 scope × {có layout, không layout} |
| C-03 (1) `maxDuration` | Không | Kiểm gói Vercel có cho 300s |
| C-03 (4) hạ `IMPORT_MAX_ROWS` | User import file lớn sẽ bị chặn | Thông báo cho vận hành trước |
| C-05 (invariants ở POST) | Tạo cột mới từ UI | UI chỉ gửi 3 field → an toàn |
| C-09 (tone toast) | Chỉ ConfigClient | — |

## Fixes Applied

**Không có** — review-only.

## Verification

Baseline chung đã chạy. Test hiện có cho module này khá tốt so với phần còn lại:
`columns.test.ts`, `queries.test.ts` (6), `layout.test.ts`, `required.test.ts`,
`import.test.ts`, `export.test.ts`, `export-access.test.ts`, `values.test.ts`,
`excel-filter.test.ts`. **Không có** test cho `ConfigClient` hay cho route
`/api/config/imports/[id]` (đường ghi dữ liệu hàng loạt).

## Remaining Risks

| Issue | Impact | Likelihood | Workaround | Risk | Lý do chưa fix | Khuyến nghị Go-Live |
|---|---|---|---|---|---|---|
| **C-01** | Đổi Config không tới user; Required mới có thể chặn Create tới khi F5 | **Cao** (mỗi lần admin chỉnh Config lúc có người online) | **Chỉ chỉnh Config ngoài giờ + báo mọi người F5** | **Cao** | Fix đúng phải làm sau T-01, đụng cả 3 màn | Nếu không kịp: (a) fix T-01, (b) áp quy trình chỉnh Config ngoài giờ, (c) thêm banner "Cấu hình đã thay đổi — Tải lại trang" (rẻ hơn nhiều so với hot-reload config) |
| C-03 | Import lớn ghi nửa chừng, không biết dòng nào đã vào | Trung bình | Chia file < 500 dòng | Trung bình | Idempotency cần đổi schema | Làm (1)+(4) trước go-live |
| C-06 | `/config` chậm dần theo số record | Thấp (chỉ admin) | — | Thấp | Cần RPC aggregate | Hoãn |
| C-04 | Required bị bỏ qua khi import | Thấp | — | Thấp | Có thể là chủ ý | Chỉ ghi tài liệu cho vận hành |

---

# 4. ACA Enrollment

## Status

Reviewed. **NOT READY** — kế thừa toàn bộ finding của mục 2 (chung code), cộng 1× P3 riêng.

ACA và Medicare dùng **cùng một** `EnrollmentClient.tsx`, cùng route API, cùng
`page.tsx`. Mọi finding M-01…M-31 áp dụng cho ACA **y nguyên**. Mục này chỉ ghi
phần **riêng của ACA** và phần **so sánh hai chương trình**.

> **[CODEX COMMENT — ACA CRITICAL OMISSIONS]** Có ít nhất hai P1 riêng ACA bị bỏ sót: (1) non-manager mặc định lọc `responsible = current user`, nhưng create mặc định `caller = current user` và `responsible = null`, nên record vừa tạo biến mất khỏi list ngay khi drawer đóng; (2) parser `toEnrollmentProgram` silently default mọi giá trị thiếu/sai sang ACA, kể cả POST, nên URL/API typo có thể đọc hoặc ghi nhầm program thay vì 400. Các P2 còn thiếu: UI quảng bá search FUB nhưng candidate không gồm `fub_link`; option bị archive khi form đang mở để lại hidden stale id và submit fail; server nhận owner/agent email tùy ý mà không validate membership.

## Functional Bugs

### A-01 — Đặt **Consent = Required** cho ACA: client chặn, server thả — và vẫn xoá trắng được bằng Update

- **Issue:** `consent` khai báo type `checkbox` trong config nhưng dữ liệu thật là **option id**. Hàm validate của server coi mọi checkbox là "luôn có giá trị", trong khi validate client so sánh chuỗi rỗng. Hai bên ra hai kết quả trái ngược.
- **Severity:** **P3**
- **Location:**
  - Khai báo type: `src/lib/table-config/queries.ts:36` → `col("aca", "consent", "Consent", "checkbox", 90)`
  - Cho phép Required: `src/lib/table-config/columns.ts:72-75` → `REQUIRED_CAPABLE_SYSTEM_KEYS.aca` **có** `"consent"`
  - Server bỏ qua: `src/lib/table-config/required.ts:6-13`
    ```ts
    function isValueFilled(type: ColumnType, value: unknown): boolean {
      if (type === "checkbox") return true;   // ← Consent luôn được coi là đã điền
    ```
  - Client lại chặn: `EnrollmentClient.tsx:3084-3087` (`isFilled` chỉ kiểm chuỗi rỗng) + `:3098-3101`
  - Dữ liệu thật là option: `api/enrollment/route.ts:44-51` (`consent_id: "consent"` trong `OPTION_FIELDS`), UI `EnrollmentClient.tsx:2015-2071` (`EnrollmentConsentToggle` map sang id của option "Yes"/khác)
- **Affected Module:** ACA (Medicare không có Consent)
- **Trigger:** Config → scope ACA → bật Required cho **Consent**.
- **Expected:** Consent trở thành bắt buộc ở cả create lẫn update.
- **Actual:** ba hành vi mâu thuẫn:
  1. **Create qua UI:** bị chặn (viền đỏ, và theo M-26 là **không có message**) — dù server sẵn sàng nhận.
  2. **Create qua API trực tiếp / import:** đi lọt, `consent_id = null`.
  3. **Update:** đặt lại về rỗng **luôn** được chấp nhận — `partial: true` có thấy key nhưng `isValueFilled("checkbox", null)` vẫn trả `true`.
- **Root Cause:** `type` trong config ("checkbox" — mô tả cách **hiển thị**) bị dùng làm căn cứ cho luật **validate**. Với Consent, hiển thị là checkbox nhưng lưu trữ là option id nullable.
- **Impact:** Cờ Required trên Consent thực chất là **vô hiệu** ở server. Admin bật rồi tin là dữ liệu đã được bảo đảm — không phải. Không hỏng gì đang chạy (mặc định Consent không Required), nhưng là cái bẫy đã cài sẵn.
- **Fix (đề xuất, chưa apply) — chọn 1 trong 2, không làm cả hai:**
  - **(a) An toàn nhất cho go-live:** bỏ `"consent"` khỏi `REQUIRED_CAPABLE_SYSTEM_KEYS.aca` → Config không cho bật Required nữa, hết mâu thuẫn. 1 dòng.
  - **(b) Đúng bản chất hơn:** đổi type của `consent` thành `dropdown` trong `DEFAULT_TABLE_COLUMNS.aca` (nó **đúng** là dropdown 2 giá trị). Nhưng đây là đổi dữ liệu đã tồn tại trong `table_column` → cần migration + kiểm lại `EnrollmentConsentToggle` (nó tự fallback về `EnrollmentOptionMenu` khi không tìm thấy option "yes", `:2029-2039` — nên vẫn render được). **Rủi ro cao hơn, để sau go-live.**
  → Khuyến nghị: **(a)** trước go-live.
- **Regression Risk:** (a) rất thấp — chỉ khoá một cờ vốn đang không hoạt động đúng. Cần kiểm: nếu **hiện tại** có ai đã bật Required cho Consent trong DB thì sau khi đổi, PATCH cờ đó sẽ bị từ chối; nên chạy kèm 1 câu SQL tắt cờ:
  ```sql
  update table_column set required = false where scope='aca' and key='consent' and required;
  ```
- **Verification (chưa chạy):** trước fix — bật Required cho Consent rồi `POST /api/enrollment` không kèm `consent_id` → hiện tại trả **201** (chứng minh cờ vô hiệu). Sau fix (a) — Config không cho bật.
- **Status:** OPEN (fix proposed, not applied)

> **[CODEX COMMENT — A-01 CONFIRMED, SEVERITY UNDERRATED]** Source trace là đúng. Đây không chỉ là “bẫy mặc định tắt”: admin được UI cho bật một invariant Required nhưng server âm thầm không enforce. Nếu feature được expose ở production, sai contract client/server và dữ liệu thiếu bắt buộc là P2; workaround “đừng bật” cần config audit/freeze rõ ràng, không nên tính P3 chung chung.

## Performance / Lag

Giống hệt Medicare (M-22, M-23, M-28, M-29). Riêng ACA nặng hơn về render vì bộ cột
mặc định là **20** so với **14** của Medicare (`src/lib/table-config/queries.ts:26-47`
vs `:48-63`) → mỗi dòng nhiều cell hơn ~43%, trên cùng một bảng không virtualization.

## Race Conditions / Async Issues

Không có đường async nào riêng cho ACA. Kết luận của mục 2 áp dụng nguyên vẹn.

## State Management Issues

Giống mục 2.

## UI/UX Issues

- Giống mục 2 (M-08 `window.prompt`, M-27 blur-vs-change).
- ~~**A-02 (P4):** …mọi record Medicare mới tạo đều lập tức bị gắn cờ "cần chú ý"…~~ → **RÚT LẠI (tao suy luận sai)**

> **[Claude — SUY LUẬN SAI, ĐÃ RÚT. Codex bắt đúng.]**
> Tao viết "ACA record luôn có chủ ngay khi tạo, Medicare thì không". Đọc lại `enrollmentNeedsAttention` (`EnrollmentClient.tsx:3944-3954`):
> ```ts
> const missingCaller = record.program !== "medicare" && !record.caller_email;
> return Boolean(stage?.triggers_qc && !record.qc_checked_at)
>     || missingCaller
>     || !record.responsible_enroll_email      // ← áp dụng cho CẢ HAI program
>     || !record.due_date;                     // ← áp dụng cho CẢ HAI program
> ```
> Create dialog để `responsible_enroll_email: ""` cho **cả ACA lẫn Medicare** (`:3054`). Nên record mới của **cả hai** đều bị gắn cờ "cần chú ý" vì thiếu Responsible — không có sự bất đối xứng nào như tao mô tả. Việc ACA tự gán Caller không cứu được, vì `missingCaller` chỉ là **một trong bốn** vế OR.
>
> **Vấn đề thật nằm ở chỗ khác, và Codex tìm ra:** filter mặc định của non-manager là `responsible: [currentEmail]`, nên record vừa tạo (Responsible rỗng) **biến mất khỏi danh sách** ngay khi đóng drawer → xem **A-03** ngay bên dưới. Đó mới là bug, và nó nghiêm trọng hơn nhiều cái tao viết.

### A-03 — Record vừa tạo biến mất khỏi danh sách của chính người tạo *(Codex phát hiện, tao verify đúng)*

- **Issue:** Filter mặc định của non-manager là `responsible = [chính mình]`, nhưng Create chỉ tự gán `caller_email`, để `responsible_enroll_email` rỗng. Record tạo xong không lọt qua filter của chính người vừa tạo nó.
- **Severity:** **P1**
- **Location:**
  - Filter mặc định: `EnrollmentClient.tsx:455-458` → `{ ...DEFAULT_FILTERS, responsible: [currentEmail] }`
  - Create dialog: `:3053-3054` → `caller_email: isMedicare ? "" : currentEmail`, `responsible_enroll_email: ""`
  - Filter loại bỏ: `:3822-3827` → `if (filters.responsible.length > 0 && !filters.responsible.includes(record.responsible_enroll_email ?? "")) return false;`
- **Affected Module:** ACA (rõ nhất) **và** Medicare — cả hai đều để Responsible rỗng khi tạo.
- **Trigger:** Một CS thường (không phải manager) vào `/enrollment`, bấm New enrollment, điền, Create, rồi **đóng drawer**.
- **Expected:** Record vừa tạo nằm trong danh sách làm việc của người tạo.
- **Actual:** POST **thành công**, `setRecords([record, ...current])` **có** thêm vào state (`:872`), drawer mở lên bình thường vì `openRecord` đọc từ mảng **chưa lọc** (`:666`). Nhưng `visibleRecords` (`:641-650`) loại nó ngay. Đóng drawer → **không còn dòng nào**. Người dùng tưởng tạo hỏng, tạo lại → **trùng record**.
- **Root Cause:** "Ai sở hữu record" và "record nào hiện trong view mặc định" dùng hai vị ngữ khác nhau. Quyền sửa thì tính cả `caller_email` / `created_by_email` (`lib/enrollment/access.ts:49-59`), nhưng view mặc định chỉ tính `responsible_enroll_email`.
- **Fix (đề xuất, chưa apply) — cần owner chốt 1 trong 2:**
  - **(a)** Định nghĩa lại "My records" = `responsible OR caller OR created_by` (khớp với vị ngữ quyền sửa đã có ở server). Đổi ở `filterRecords`, không đụng dữ liệu.
  - **(b)** Create tự gán `responsible_enroll_email = currentEmail` khi để trống.
  → **(a) an toàn hơn**: (b) đổi ngữ nghĩa sở hữu và có thể sai với quy trình thật (người tạo ≠ người phụ trách).
- **Regression Risk:** Trung bình. (a) làm view mặc định rộng ra → phải kiểm view của manager không đổi, và bộ lọc Responsible chọn tay vẫn lọc đúng.
- **Verification (chưa chạy):** đăng nhập bằng tài khoản CS thường → tạo 1 record không set Responsible → đóng drawer → record **phải** còn trong danh sách.
- **Status:** OPEN (needs product decision)

> **[CODEX COMMENT — A-02 INFERENCE INCORRECT]** Cả form ACA lẫn Medicare đều khởi tạo `responsible_agent_email = null` và `due_date = null`; `enrollmentNeedsAttention` kiểm thiếu responsible/due cho **cả hai**. ACA chỉ tự gán Caller, mà Caller bị loại khỏi rule này. Vì vậy Medicare không bị “cần chú ý” theo một cơ chế riêng như finding mô tả; record mới của cả hai có thể bị đánh dấu vì cùng thiếu Responsible/Due. A-02 nên đóng hoặc viết lại thành vấn đề default-filter của ACA nêu ở comment đầu mục.

## UI Consistency

## Medicare vs ACA — bảng đối chiếu

| Hạng mục | Medicare | ACA | Đánh giá |
|---|---|---|---|
| Component | `EnrollmentClient.tsx` | **cùng file** | ✅ Nhất quán tuyệt đối |
| Route API | `/api/enrollment*` + `?program=` | **cùng** | ✅ |
| Cột mặc định | 14 (`queries.ts:48-63`) | 20 (`:26-47`) | ✅ Khác biệt nghiệp vụ hợp lệ, có comment giải thích (`EnrollmentClient.tsx:215-218`) |
| Field không áp dụng | 6 field bị loại ở **5** nơi | — | ⚠️ **M-31** — hiện khớp nhau, nhưng là 5 danh sách chép tay |
| Validation | **cùng** `findMissingRequiredFields` + cùng route | **cùng** | ✅ (trừ **A-01** cho riêng Consent) |
| Loading / Empty / Error | **cùng** component, cùng chuỗi | **cùng** | ✅ |
| Optimistic + rollback | **cùng** `patchRecord` | **cùng** | ✅ |
| Realtime | `ENROLLMENT_TOPIC` dùng chung | **cùng** | ❌ **M-23** — nên tách theo program |
| Overview | `EnrollmentOverview` key theo program | **cùng** | ✅ |
| Default owner khi tạo | không tự gán | tự gán Caller = người tạo | ⚠️ **A-02** — cần owner xác nhận |
| Quy tắc "cần chú ý" | bỏ qua Caller | tính cả Caller | ✅ Đúng, có comment (`:3946-3948`) |

**Kết luận:** Medicare ↔ ACA là **cặp nhất quán nhất** trong toàn hệ thống — đúng như
§10 brief yêu cầu (khác biệt nghiệp vụ thì tách, phần dùng chung thì dùng chung).
Hai điểm cần xử lý là **M-23** (kênh realtime) và **A-01** (Consent). **Không** cần và
**không nên** động vào cấu trúc chia sẻ này trước Go-Live.

## Duplicate / Overlapping Logic

Xem **M-31** (5 danh sách Medicare-inapplicable). Không có logic riêng của ACA bị nhân bản.

## Security / Permission

Giống mục 2 — cùng `loadEnrollmentActor` / `canMutateEnrollmentRecord` /
`canArchiveEnrollmentRecord`, không phân nhánh theo program. Không phát hiện lỗ hổng
riêng cho ACA.

## Regression Risks

Vì ACA và Medicare **dùng chung code**, mọi fix ở mục 2 đều phải được verify **hai lần**
— một lần cho mỗi program. Đây là rủi ro regression lớn nhất của cả hai mục: rất dễ
test Medicare rồi quên ACA (hoặc ngược lại).

| Fix của mục 2 | Bắt buộc test lại trên ACA vì |
|---|---|
| M-01 (stats no-op) | ACA có nhiều field option hơn → nhiều đường phát sinh patch rỗng hơn |
| M-11 (Due date) | Cùng ô, cùng component |
| M-26 (message required) | ACA có nhiều field Required khả dĩ hơn (15 vs 9 key) |
| M-23 (tách topic) | Sai topic ở một bên là mất realtime ở bên đó |
| M-08 (ReasonModal) | Stage terminal tồn tại ở cả hai |

## Fixes Applied

**Không có** — review-only.

## Verification

Baseline chung. **Chưa có** test tự động nào phân biệt ACA/Medicare ngoài
`program-fields.test.ts` (3 test, chỉ phủ `sanitizeEnrollmentPatchForProgram`).

## Remaining Risks

| Issue | Impact | Likelihood | Workaround | Risk | Lý do chưa fix | Khuyến nghị |
|---|---|---|---|---|---|---|
| A-01 | Cờ Required trên Consent vô hiệu ở server | Thấp (mặc định tắt) | Đừng bật Required cho Consent | Thấp | Fix (b) cần migration | Làm fix (a) — 1 dòng |
| A-02 | Record Medicare mới luôn bị gắn cờ "cần chú ý" | Cao **nếu** là ngoài ý muốn | — | Thấp | Cần owner xác nhận đây có phải chủ ý | Hỏi owner, không tự đổi |

---

# Cross-Module Findings

## Shared Components

Có một tầng dùng chung **thật sự**, nhưng nó nằm sai chỗ và không được đặt tên như một tầng dùng chung.

| Component | Định nghĩa tại | Ai dùng | Ghi chú |
|---|---|---|---|
| `Toast` | `(authed)/_shared/Toast.tsx` | Tasks, Enrollment, Config | ✅ Đúng chỗ. Nhưng Config không truyền `tone` (**C-09**) |
| `EditableCustomCell` | `(authed)/_shared/EditableCustomCell.tsx` | Tasks, Enrollment | ✅ Đúng chỗ |
| `HealthTableImportDialog` | `(authed)/_components/` | Tasks, Enrollment | ✅ |
| `CommentThread` | **`tasks/_components/`** | Tasks **+ Enrollment** | ⚠️ **X-06** |
| `ActivityFeed` | **`tasks/_components/`** | Tasks **+ Enrollment** | ⚠️ X-06 |
| `AttachmentPanel` | **`tasks/_components/`** | Tasks **+ Enrollment** | ⚠️ X-06 |
| `TaskSelect` | **`tasks/_components/`** | Tasks **+ Enrollment** | ⚠️ X-06 |
| `DateRangeFilter` | **`tasks/_components/TaskToolbar.tsx`** | Tasks **+ Enrollment** | ⚠️ X-06 + **T-06** |
| `Initials` | **`tasks/_components/board-ui.tsx`** | Tasks **+ Enrollment** | ⚠️ X-06 |
| `useAnchoredMenu` | **`tasks/_components/`** | Tasks **+ Enrollment** | ⚠️ X-06 |
| `ReasonModal` | `tasks/_components/` | **chỉ Tasks** | ❌ Enrollment cần mà không dùng (**M-08**) |

### X-06 — 7 component dùng chung nằm trong thư mục riêng của Tasks

- **Severity:** **P3** (rủi ro quy trình, không phải bug đang chạy)
- **Location:** `EnrollmentClient.tsx:77-83`
  ```ts
  import { CommentThread }   from "../../tasks/_components/CommentThread";
  import { ActivityFeed }    from "../../tasks/_components/ActivityFeed";
  import { AttachmentPanel } from "../../tasks/_components/AttachmentPanel";
  import { TaskSelect }      from "../../tasks/_components/TaskSelect";
  import { DateRangeFilter } from "../../tasks/_components/TaskToolbar";
  import { useAnchoredMenu } from "../../tasks/_components/use-anchored-menu";
  import { Initials }        from "../../tasks/_components/board-ui";
  ```
- **Impact:** Một dev được giao "sửa comment thread của CS" sẽ mở `tasks/_components/CommentThread.tsx`, không có tín hiệu nào cho biết mình đang sửa cả Medicare và ACA. Đây chính xác là loại regression §25 brief cảnh báo. `CommentThread` **đã** được tham số hoá đúng (`apiBase`, `roomTopic`, `onParentUpdatedAt`) nên về mã nguồn là tốt — chỉ sai vị trí.
- **Fix:** chuyển sang `(authed)/_shared/`. **KHÔNG làm trước Go-Live** — đây là rename thuần tuý, §3 brief cấm, và rủi ro merge conflict cao trong tuần release. Biện pháp rẻ thay thế: thêm một dòng comment ở đầu mỗi file đó ghi rõ "Dùng bởi cả Tasks và Enrollment — xem `EnrollmentClient.tsx:77-83` trước khi sửa."
- **Status:** OPEN (đề xuất **hoãn**, chỉ thêm comment cảnh báo)

## Shared Logic

| Logic | Nguồn duy nhất? | Ghi chú |
|---|---|---|
| Quyền cột / bất biến Required | ✅ `table-config/columns.ts`, client+server dùng chung | Mẫu tốt nhất repo. Kẽ hở duy nhất: **C-05** (POST) |
| Required validation | ✅ `table-config/required.ts` | Kẽ hở: **A-01** (checkbox), **C-04** (import bỏ qua) |
| Resolve layout | ✅ `table-config/layout.ts` | Dùng bởi cả 3 scope |
| Actor / RBAC | ✅ `tasks/access.ts` → `enrollment/access.ts` tái sử dụng `buildTaskActor` | Đúng |
| Medicare-inapplicable fields | ❌ **5 bản chép tay** | **M-31** |
| Chống race refetch | ❌ **3 bản viết tay** | **X-02** dưới |
| Capabilities của task | ❌ 2 bản chép | T-xx (mục 1, Duplicate Logic) |

### X-02 — Ba bản tự viết của cùng một cơ chế "chống refetch cũ đè dữ liệu mới", chất lượng khác nhau

- **Severity:** **P2** (bản yếu nhất chính là **T-01/T-03**)
- **Location:**
  | Bản | Vị trí | Chất lượng |
  |---|---|---|
  | Enrollment | `EnrollmentClient.tsx:693-741` | **Tốt nhất** — chụp `hadPendingAtIssue` **trước** khi gửi request |
  | Tasks | `TaskBoardClient.tsx:368-421` | Tốt, nhưng chỉ kiểm pending **lúc response về** → phải bù bằng `recentTaskWritesRef` cooldown 3s (`:1665-1691`) |
  | Config | `ConfigClient.tsx:481-520` | Khác mô hình (đếm patch đang bay), đúng cho bài toán của nó |
- **Root Cause:** Không có data-fetching library. Mỗi màn tự phát minh lại latest-request-wins.
- **Impact:** Ba bộ luật, ba bộ bug tiềm ẩn, không bộ nào có test. Sửa bug race ở một màn **không** tự động sửa ở hai màn kia.
- **Fix:** **KHÔNG** thay bằng react-query/SWR trước Go-Live (§3 brief: đổi kiến trúc = rủi ro thừa). Đề xuất: sau go-live, trích bản Enrollment thành một hook `useGuardedRefetch()` dùng chung.
- **Status:** OPEN (đề xuất hoãn)

> **[CODEX COMMENT — X-02 ASSESSMENT INCOMPLETE]** `refetchTasks` có sequence guard nhưng whole-row cooldown vẫn giữ stale comment/attachment/activity metadata, stale rollback của T-02, và chỉ prune khi có refetch kế tiếp. Enrollment cũng không “sạch”: `pendingRef` là Set thay vì counter nên guard mở sớm khi hai mutation cùng id overlap. Config counter không giải quyết out-of-order PATCH DB writes. Do đó cả ba bản đều có bug cụ thể, không chỉ “nợ kiến trúc”; không cần đổi library nhưng phải fix các invariant cục bộ trước.

### X-03 — Cùng một effect hydrate layout, hai cách viết, một cách sinh vòng lặp vô hạn

- **Severity:** đã tính ở **T-01 (P0)**; ghi ở đây để chỉ ra **bản đúng đã có sẵn trong repo**.
- **So sánh trực tiếp:**
  | | Tasks (`TaskBoardClient.tsx:208-275`) | Enrollment (`EnrollmentClient.tsx:541-588`) |
  |---|---|---|
  | Dep array | `[tableColumns, taskListColumnKeySet, taskListDefaultHiddenKeys]` — 2 dep là `new Set(...)` phái sinh từ **state mà chính effect này set** | `[program, setHiddenColumnKeys, tableColumns]` — cả 3 ổn định |
  | Cờ hydrate | ❌ không có | ✅ `enrollmentLayoutHydratedRef` |
  | Kết quả | **Vòng lặp vô hạn** | Chạy đúng 1 lần |
- **Kết luận cho người fix T-01:** không cần thiết kế gì mới — bê mô hình của `EnrollmentClient` sang.

## Duplicate Implementations

- **4 component select** (`TaskSelect`, `EnrollmentOptionMenu`, `EnrollmentPersonMenu`, `DropdownSelect`) với **3 cơ chế đóng menu** khác nhau — chi tiết ở mục 3 (UI Consistency). Chỉ `useAnchoredMenu` render qua portal; `DropdownSelect` phải tự viết lại logic lật hướng vì không dùng portal.
- **2 bản `isAgentOwnerOrAssistantOf` / `isAgentTeamMemberOf` / `capabilitiesFor`** (`TaskBoardClient.tsx:946-969` ≡ `TaskListView.tsx:69-90`) — giống hệt nhau hiện tại.
- **2 bản `canEdit...RecordClient`** (client `EnrollmentClient.tsx:393-427`) song song với server (`lib/enrollment/access.ts:26-47`) — cố ý (client ẩn UI, server chặn thật), có comment giải thích. ✅ Không phải bug.

**Không đề xuất gộp cái nào trước Go-Live.**

## Medicare vs ACA

Xem bảng đối chiếu đầy đủ ở **mục 4**. Tóm tắt: đây là cặp nhất quán nhất; chỉ cần
xử lý **M-23** (kênh realtime dùng chung) và **A-01** (Consent).

## Tasks ↔ Config

| Đường phụ thuộc | Trạng thái |
|---|---|
| `fetchTableColumnsWithOptions("cs")` → prop `tableColumns` (`tasks/page.tsx:65,102`) | Chỉ lấy lúc SSR, **không bao giờ làm mới** → **C-01** |
| Layout người dùng ↔ `hidden_default` của admin | **C-02** — tab đang mở ghi đè ngược reset của admin |
| `required` → `NewTaskDialog` + PATCH server | Client dùng bản cũ, server dùng bản live → **C-01 hệ quả 1** |
| Broadcast Config → Tasks | Có ping nhưng ping sai loại → refetch rows vô ích (**C-07**) |
| Import → `tasks` | Bỏ qua Required (**C-04**) |
| **T-01 loop** | Bắt nguồn từ dữ liệu Config (saved layout) — Config càng được dùng nhiều thì càng nhiều user dính |

## Enrollment ↔ Config

Giống Tasks ↔ Config, **cộng thêm**:
- Enrollment **tự tạo** bản ghi `user_table_layout` cho mọi user ngay lần load đầu (**M-28**) → tập user chịu ảnh hưởng của **C-02** ở Enrollment là **100%**, trong khi ở Tasks chỉ là những ai từng bấm menu cột.
- Create dialog của Enrollment **không có** ô nhập custom column, và server truyền `checkCustom: false` (`api/enrollment/route.ts:138`) → cột custom Required do Config đặt là **không bao giờ được thực thi** cho Enrollment; với Tasks thì **có** (`api/tasks/route.ts:189-199`).
  → **X-07 (P3):** cùng một công tắc trong Config có ý nghĩa khác nhau giữa hai module. Hành vi này **có chủ ý** và được ghi rõ trong docstring `required.ts:28-31`, nhưng **không** được nói cho admin biết trong UI Config. Fix rẻ: hiện chú thích ở màn Config khi bật Required cho một custom column thuộc scope aca/medicare.

## Cross-Module Performance

Xếp theo mức lãng phí thực tế:

1. **T-01 (P0)** — vòng lặp vô hạn request. Áp đảo mọi thứ khác.
2. **C-07 + T-04 + M-22** — mỗi click trong Config làm **mọi** tab refetch full-list task **và** full-list enrollment (kèm toàn bộ text comment). Ba lỗi này nhân với nhau.
3. **M-23** — sửa ACA làm tab Medicare refetch, và ngược lại.
4. **T-05 / M-29** — không memo, không virtualization, ở cả 3 bảng.
5. **C-06** — full scan `enrollment_records` mỗi lần mở `/config`.

**Điểm chung:** không màn nào phân trang. Cả 3 đều theo mô hình "kéo hết về rồi lọc ở
client". Hoạt động tốt ở quy mô hiện tại, xấu đi tuyến tính, và **không có chỗ nào cảnh
báo khi vượt ngưỡng** (PostgREST cắt ở `db-max-rows` một cách im lặng).

## Cross-Module UI Consistency

### Đã nhất quán ✅

- Shell/spacing: Tasks và Enrollment dùng **chung** chuỗi class (`flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7f9fc] text-[#172b4d]` — `TaskBoardClient.tsx:1288-1290` ≡ `EnrollmentClient.tsx:913-915`), chung `max-w-[1760px]`, chung `text-3xl font-bold` cho H1.
- Drawer: **cùng** kích thước và cấu trúc (`h-[calc(100vh-2rem)] max-h-[760px] max-w-4xl`, grid `[minmax(0,1fr)_280px]` — `TaskDetailDrawer.tsx:247`, `:268` ≡ `EnrollmentClient.tsx:2572`, `:2593`).
- Bảng: cùng `maxHeight: 1008px`, cùng sticky header, cùng kiểu cột ghim.
- Nút primary: cùng `bg-[#0c66e4] … hover:bg-[#0055cc]`.
- Empty state: cùng khuôn `rounded border border-dashed border-[#c1c7d0] bg-[#f4f5f7] px-6 py-12 …` (`TaskListView.tsx:130-133` ≡ `EnrollmentClient.tsx:1504-1509`).

Nói cách khác: **ngôn ngữ thiết kế là nhất quán**. Vấn đề nằm ở hành vi, không ở diện mạo.

### Chưa nhất quán ❌

| # | Hạng mục | Tasks | Enrollment | Config |
|---|---|---|---|---|
| 1 | Hỏi lý do (reopen) | `<ReasonModal>` | **`window.prompt`** (M-08) | — |
| 2 | Tone của toast lỗi | `tone="error"` (đỏ) | `tone="error"` (đỏ) | **không tone** → lỗi hiện y hệt thành công (C-09) |
| 3 | Lỗi export | **`window.alert`** | `<Toast>` | — |
| 4 | Deep-link khi mở chi tiết | **xoá** `?task=` (T-09) | **push** `?record=` | — |
| 5 | Ngôn ngữ thông báo | **trộn Việt–Anh** | trộn Việt–Anh | Anh |
| 6 | Overview tự làm mới | poll 30s + realtime | **không có** (M-30) | — |
| 7 | Custom field ở dialog Create | **có** | **không có** (X-07) | — |
| 8 | Shell trang | `bg-[#f7f9fc]` flex-fill | `bg-[#f7f9fc]` flex-fill | **`bg-[#f7f8fa]` min-h-screen** |

### X-08 — Skeleton loading dùng chung là hình dạng **dashboard**, trong khi 3 màn này đều là **bảng**

- **Severity:** **P3**
- **Location:** `src/app/(authed)/loading.tsx` — render 2 "card" với khối biểu đồ `h-[430px]` và `h-[380px]`. Next.js App Router áp `loading.tsx` này cho **mọi** route con của `(authed)` không có `loading.tsx` riêng → gồm `/tasks`, `/enrollment`, `/config`. (Chỉ `dashboard/health` có bản riêng.)
- **Actual:** Vào `/tasks` thấy khung skeleton hình dashboard 2 card, rồi nhảy sang bảng danh sách. Layout giật rõ, và skeleton **thông tin sai** về thứ sắp hiện ra.
- **Fix (đề xuất, chưa apply):** thêm `loading.tsx` dạng bảng cho 3 route (header + toolbar + ~10 hàng skeleton). Rẻ, khu trú, không đụng logic.
- **Status:** OPEN (fix proposed, not applied)

### X-09 — Dark mode của hệ điều hành làm chữ trong ô "New column label" của Config gần như vô hình

- **Severity:** **P3**
- **Location:**
  - `src/app/globals.css:16-27` — có `@media (prefers-color-scheme: dark)` đổi `--foreground` thành `#ededed` và áp lên `body`
  - Nhưng toàn bộ 3 module là **light-only**: 421 mã màu hex hardcode chỉ trong 3 file chính (TaskBoardClient 29 / EnrollmentClient 238 / ConfigClient 154), **không** có token, **không** có biến thể dark
  - Chỗ trúng cụ thể: `ConfigClient.tsx:585-590` — input này **không có** class `text-*` **cũng không có** `bg-*`:
    ```tsx
    className="h-10 min-w-[280px] max-w-[520px] flex-1 rounded border border-[#dfe1e6] px-3 text-sm font-semibold outline-none focus:border-[#0c66e4]"
    ```
    → kế thừa `color: #ededed` từ `body` trong khi nền input vẫn trắng (UA default).
- **Trigger:** macOS/Windows đang ở Dark Mode → mở `/config` → gõ vào ô "New column label".
- **Actual:** Chữ trắng trên nền trắng.
- **Fix (đề xuất, chưa apply) — chọn 1:**
  - **(a) Rẻ nhất, an toàn nhất:** app này chỉ có giao diện sáng → **bỏ hẳn** khối `@media (prefers-color-scheme: dark)` trong `globals.css:16-21`. 6 dòng. Loại bỏ luôn cả lớp bug này chứ không chỉ một chỗ.
  - **(b)** thêm `bg-white text-[#172b4d]` cho input đó (chỉ vá 1 chỗ, các chỗ khác vẫn còn rủi ro).
  → Khuyến nghị **(a)**.
- **Regression Risk:** Thấp. Cần rà nhanh xem có màn nào **thật sự** dùng dark mode không — theo kết quả grep thì không có màn nào có biến thể `dark:`.
- **Verification (chưa chạy):** bật Dark Mode ở OS → chụp `/config`, `/tasks`, `/enrollment` trước/sau.
- **Status:** OPEN (fix proposed, not applied)

## Regression Risks (ma trận toàn hệ thống)

Cột = fix. Hàng = vùng phải test lại. ● = bắt buộc test, ○ = nên test.

| Vùng ảnh hưởng | T-01 | T-02 | T-03 | T-06 | M-08 | M-11 | M-23 | M-26 | C-01 | C-02 | C-03 | A-01 | X-09 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tasks — List/Board | ● | ● | ● | ● | | | | | ● | ● | ○ | | ○ |
| Tasks — Detail drawer | ○ | ● | | | | | | | ● | | | | ○ |
| Tasks — Create dialog | ● | | | | | | | | ● | | ○ | | ○ |
| Tasks — cột & layout | ● | | | | | | | | ● | ● | | | |
| Medicare — List | | | | ○ | | | ● | | ● | ● | ○ | | ○ |
| Medicare — Drawer | | ○ | | | ● | ● | | | ● | | | | ○ |
| Medicare — Create | | | | | | | | ● | ● | | ○ | | ○ |
| ACA — List | | | | ○ | | | ● | | ● | ● | ○ | ● | ○ |
| ACA — Drawer | | ○ | | | ● | ● | | | ● | | | ● | ○ |
| ACA — Create | | | | | | | | ● | ● | | ○ | ● | ○ |
| Config — Table Columns | | | | | | | | | ● | ● | | ● | ● |
| Config — Import Review | | | | | | | | | ○ | | ● | | ● |
| Realtime đa tab | ○ | ○ | ● | | | | ● | | ● | | | | |

**Quy tắc rút ra:** bất kỳ fix nào chạm `table-config/**` hoặc `EnrollmentClient.tsx`
đều phải test **cả Medicare lẫn ACA**; bất kỳ fix nào chạm `/api/config/layout` đều
phải test **cả 3 scope**.

---

# Final Go-Live Status

**Status: NOT READY**

Lý do: còn **1 P0** và **2 P1** chưa fix. Theo §28 của brief, không được đánh READY
khi còn P0/P1 chưa xử lý.

Cần nói rõ: **đây không phải một codebase tệ.** Phần lớn các cơ chế khó (optimistic
update + rollback theo từng bản ghi, optimistic concurrency bằng `expected_updated_at`,
latest-request-wins, bất biến cột dùng chung client–server, soft-delete để giữ lịch sử
KPI) đều đã được làm, làm đúng, và có comment giải thích **vì sao**. 431 unit test cho
`src/lib` xanh. Ngôn ngữ thiết kế giữa các màn thống nhất. Vấn đề tập trung vào đúng
một chỗ: **tầng client-side data/effect được viết tay 3 lần**, và một trong ba bản có
lỗi dependency gây vòng lặp vô hạn.

> **[CODEX COMMENT — FINAL COUNTS CORRECTION]** `NOT READY` là đúng, nhưng lý do “còn 1 P0 và 2 P1” không đầy đủ. Cross-check độc lập xác nhận **1 P0** (T-01) và đang theo dõi **16 nhóm P1 duy nhất**, gồm task partial commits/OCC gaps; Enrollment permission affordance, same-record concurrency và partial commits; Config multi-write/import/stage/custom-required invariants; ACA default-filter disappearance và strict program parsing. Ngược lại, T-06 phải bỏ khỏi P3 vì code đã resync draft khi mở picker. Vì report chưa kiểm đếm các nhóm này, mọi tổng P1–P4 và câu “vấn đề tập trung vào đúng một chỗ” không nên dùng làm release gate.

## P0

| ID | Vấn đề | Vị trí | Ảnh hưởng |
|---|---|---|---|
| **T-01** | Vòng lặp vô hạn `GET /api/config/layout` + re-render toàn board | `TaskBoardClient.tsx:208-275` | Ngập request server, CPU client pin, mọi thao tác trên `/tasks` giật. Trúng mọi user đã từng bật/tắt cột. |

## P1

| ID | Vấn đề | Vị trí | Ảnh hưởng |
|---|---|---|---|
| **T-02** | 2 thao tác liên tiếp trên cùng 1 task → cái thứ 2 bị revert + toast 409 sai | `TaskBoardClient.tsx:975-1015`, `:1710-1712` | Mất thao tác người dùng. Hằng ngày trên mạng chậm. |
| **C-01** | Đổi Config không tới được tab đang mở; Required mới có thể chặn Create tới khi F5 | `table-config/realtime.ts:4-6` | Admin chỉnh Config trong giờ làm việc có thể làm user không tạo được task/record. |

> **[CODEX COMMENT — P1 TABLE INCOMPLETE]** Bảng này không thể được xem là danh sách P1 cuối cùng. Ít nhất phải bổ sung các family đã nêu trong comment Tasks/Enrollment/Config/ACA phía trên và liên kết sang từng finding đầy đủ trong `docs/codex_review_code.md`; nếu shared Enrollment bug áp dụng hai program thì chỉ đếm một lần, nhưng vẫn phải nằm trong release gate.

## P2

| ID | Vấn đề | Chặn Go-Live? |
|---|---|---|
| **T-03** | Realtime resubscribe + refetch thừa mỗi lần đổi view/date range | **Không** — lãng phí, không sai dữ liệu. Fix rẻ, nên làm cùng T-01. |
| **T-04** | `/api/tasks` không phân trang | **Không** ở quy mô hiện tại — nhưng **phải** thêm `.limit()` + cảnh báo truncate, nếu không sẽ mất dữ liệu âm thầm khi vượt `db-max-rows`. |
| **T-05 / M-29** | Bảng không memo, không virtualization | **Không**. Làm bước memo (rẻ, an toàn); hoãn virtualization. |
| **M-01** | Patch no-op làm số comment về 0 | **Không** — sai hiển thị, không sai DB. Fix rẻ, nên làm. |
| **M-11** | Gõ tay Due date bắn patch `null` + xoá mốc nhắc hạn | **Nên fix** — có mất dữ liệu (`*_notified_at`). Fix rẻ, khu trú. |
| **M-22** | Payload list mang toàn bộ text comment | **Không** — nhưng nên cắt độ dài trước go-live. |
| **M-23** | Kênh realtime chung cho ACA + Medicare | **Không**. Cần deploy 2 pha, cân nhắc để sau. |
| **M-24** | Fallback schema im lặng nuốt dữ liệu | **CÓ, nếu chưa kiểm DB.** → hạng mục bắt buộc trong checklist dưới. |
| **C-02** | Reset layout của admin bị tab đang mở ghi đè | **Không** — nhưng sẽ hết khi fix C-01. |
| **C-03** | Duyệt import lớn timeout, ghi dữ liệu một nửa | **CÓ, nếu go-live có kế hoạch import.** Làm `maxDuration` + hạ `IMPORT_MAX_ROWS`. |
| **C-06** | `/config` full scan `enrollment_records` | **Không** — chỉ admin, và hiện chưa đủ lớn. |
| **C-07** | Mỗi click Config → mọi tab refetch full-list | **Không** — hết khi fix C-01. |
| **X-02** | 3 bản tự viết của cùng cơ chế chống race | **Không** — nợ kiến trúc, không đổi trước go-live. |

## P3

T-06 (draft date range không sync), T-08 (drawer không sync), T-09 (deep-link lệch),
T-10 (nội suy chuỗi vào filter PostgREST), T-12 (cron chạy trên GitHub Actions),
T-13 (cron secret qua query string), M-18 (validate due date create ≠ update),
M-26 (Create fail không có message), M-28 (PUT layout mỗi lần load trang),
M-30 (Overview không latest-wins, không tự refresh), M-31 (5 danh sách Medicare trùng),
C-04 (import bỏ qua Required), C-05 (bất biến thiếu ở POST), C-08 (refresh scope không
latest-wins), C-09 (toast lỗi không có màu lỗi), C-10 (GET columns không scope trả cả 3),
A-01 (Required trên Consent vô hiệu ở server), X-06 (7 component chung nằm trong
`tasks/_components`), X-07 (Required custom column không thực thi cho Enrollment),
X-08 (skeleton hình dashboard cho màn bảng), X-09 (dark mode làm chữ input Config vô hình).

## P4

T-07 (`reloadCategories` thiếu trong dep — vô hại), toast trộn Việt–Anh trong cùng màn,
`window.alert` cho lỗi export, M-27 (blur-save vs change-save lẫn lộn trong 1 drawer),
A-02 (ACA tự gán Caller, Medicare không), Config lệch nền + không dùng shell chung.

## Critical Bugs

1. **T-01** — vòng lặp vô hạn (P0).
2. **T-02** — mất thao tác người dùng do `expected_updated_at` client tự sinh (P1).
3. **C-01** — Config không tới được client (P1).

## Critical Fixes

**Chưa fix gì.** Owner yêu cầu review-only. Mọi patch đề xuất nằm trong từng finding,
ở dạng có thể dán thẳng.

## Performance Risks

Xếp theo mức lãng phí thật: **T-01** ≫ (**C-07** × **T-04** × **M-22**) > **M-23** >
**T-05/M-29** > **C-06**. Điểm chung: không màn nào phân trang, tất cả theo mô hình
"kéo hết về rồi lọc client", và **không chỗ nào cảnh báo khi vượt ngưỡng**.

## Race Conditions

- **Đã xử lý đúng:** refetch sequencing (cả 3 màn), optimistic + rollback theo từng bản
  ghi, claim import bằng conditional update, debounce + `AbortController` cho search,
  cooldown chống refetch cũ đè optimistic.
- **Còn hở:** **T-02** (PATCH liên tiếp), **T-03** (resubscribe), **M-30** (Overview),
  **C-08** (refresh scope), **C-02** (layout ghi đè ngược).
- **Không tìm thấy:** race kiểu A→B→A→B do effect chain trong luồng form của Enrollment
  — `EnrollmentDrawer` đọc thẳng từ prop nên không có nguồn thứ hai. Đây là điểm brief
  §12/§16 lo nhất, và ở module Enrollment thì **sạch**.

## UI/UX Risks

Ngôn ngữ thiết kế **nhất quán** (shell, drawer, bảng, empty state, nút primary đều dùng
chung chuỗi class). Lệch nằm ở **hành vi**: 8 điểm trong bảng "Chưa nhất quán" ở phần
Cross-Module. Nặng nhất: **M-08** (`window.prompt` cho reopen — có thể bị trình duyệt
chặn hẳn) và **C-09** (lỗi hiện giống hệt thành công trong Config).

## Duplicate Logic

5 danh sách Medicare-inapplicable (**M-31**), 3 bản chống race (**X-02**), 4 component
select (**mục 3**), 2 bản capabilities của task. **Không đề xuất gộp cái nào trước
Go-Live** — theo §3 brief, không cái nào đang gây lỗi.

## Regression Risks

Xem ma trận đầy đủ ở cuối phần Cross-Module. Hai quy tắc bắt buộc:
1. Fix chạm `table-config/**` hoặc `EnrollmentClient.tsx` → test **cả Medicare lẫn ACA**.
2. Fix chạm `/api/config/layout` → test **cả 3 scope** (cs, aca, medicare).

Rủi ro lớn nhất của đợt này: **C-01 phải được fix SAU T-01**. Làm ngược lại (cho client
kéo lại config trong khi vòng lặp còn đó) sẽ nhân thêm một nguồn re-render vào đúng cái
vòng lặp vô hạn.

## Remaining Risks

Ba việc **không** phải sửa code nhưng **bắt buộc** làm trước Go-Live:

1. **Kiểm schema DB production** (**M-24**) — chạy 3 câu SQL ở cuối mục 2. Nếu thiếu bất
   kỳ đối tượng nào, app sẽ chạy "bình thường" và **âm thầm nuốt dữ liệu**. Repo không có
   cơ chế migration, chỉ có một file `supabase/schema.sql`.
2. **Xác nhận scheduler cho `check-overdue`** (**T-12**) — hiện chạy trên GitHub Actions,
   sẽ **tự tắt sau 60 ngày repo không có commit**. Nên chuyển sang `vercel.json`.
3. **Chốt quy trình chỉnh Config** (**C-01**) — nếu không kịp fix: chỉ chỉnh Config ngoài
   giờ làm việc và thông báo mọi người F5.

---

# ✅ PLAN FINAL — hợp nhất Claude + Codex

> Phần này **thay thế** mọi "Recommended Actions" / "Final Recommendation" trước đó của tao.
> Nó là kết quả sau khi đối chiếu hai bài review độc lập (`claude_golive-review.md` +
> `codex_review_code.md`), verify lại từng điểm tranh chấp bằng code, và **nhận sai ở
> những chỗ tao sai**. Đây là bản duy nhất nên dùng làm release gate.

## 0. Tao đã sai ở đâu (ghi trước, để phần sau đọc mới có trọng lượng)

| Tao viết | Sự thật | Codex đúng ở đâu |
|---|---|---|
| **T-06** — `DateRangeFilter` không sync draft | `toggleRangePicker()` **đã** sync ở `TaskToolbar.tsx:638-648` | ✅ Tao đọc file tới dòng 609 rồi kết luận "không có" — thiếu đúng 30 dòng. **Finding bị gỡ.** |
| **A-02** — chỉ record Medicare mới bị cờ "cần chú ý" | `!responsible_enroll_email` áp cho **cả hai** program; create để rỗng ở cả hai | ✅ Không có bất đối xứng nào. **Finding bị gỡ**, thay bằng **A-03**. |
| `patchRecord/createRecord/archiveRecord` "Đúng" | `pendingRef` là `Set` (mở guard sớm) + `archiveRecord` **không có `catch`** | ✅ → **M-32**, **M-33** |
| `patchColumn` "xử lý concurrency tốt nhất repo" | Counter chỉ quyết định *khi nào refresh*, không serialize, không OCC | ✅ → **C-14** |
| **C-04** import bỏ qua Required "có thể là chủ ý" | Không có dòng nào trong repo nói vậy; tao mượn comment của `checkCustom` ở chỗ khác | ✅ Nâng P3 → **P2** |
| Tao **sót hoàn toàn** | Control read-only vẫn bấm được → A→B→A tất định | ✅ → **M-34 (P1)** |
| Tao **sót hoàn toàn** | Record vừa tạo biến mất khỏi list của người tạo | ✅ → **A-03 (P1)** |
| Tao **sót hoàn toàn** | `fetchCurrentCustomValues` lỗi đọc → `{}` → **xoá trắng** custom_values | ✅ → mục 2, hạng mục #5 |
| Tao **sót hoàn toàn** | reopen / overdue-unlock / assignee / archive không có `expected_updated_at` | ✅ → mục 3 |

**Bài học phương pháp (cả hai lần sai đều cùng một kiểu):** tao suy ra sự **vắng mặt**
của một cơ chế từ một **lát cắt** file. Claim dạng "không có X ở đâu cả" bắt buộc phải
grep toàn file, không được đọc một đoạn rồi kết luận.

## 1. Chỗ tao vẫn giữ nguyên quan điểm (không nhận sai cho đủ lễ)

| Điểm Codex nêu | Quan điểm của tao | Lý do |
|---|---|---|
| "16 nhóm P1" | **Không chấp nhận nguyên khối** | 16 P1 / 0 P0 là bản đồ dẫn sai đường. Tao chấp nhận **7** P1 (bảng mục 2) và hạ phần còn lại xuống P2 kèm lý do từng cái. |
| Codex **C-08** (custom Required không enforce ở Enrollment) = P1 | **P3** | Đây là đánh đổi **có ghi lý do** ngay trong docstring `required.ts:28-31`. Verification của chính Codex trích comment đó rồi vẫn gắn CRITICAL. |
| Codex **C-04** (duyệt import không xem được row) = P1 | **P2** | Là **thiếu tính năng UI review**, không có defect. Không hỏng, không mất dữ liệu, không race. |
| Codex **C-05** (config multi-write partial commit) = P1 | **P2** | Admin-only, tần suất thấp, bấm lại là xong — config không cộng dồn như import. |
| Codex **A-02 / T-02** (`toEnrollmentProgram`, special routes thiếu OCC) = P1 | **P2** | Đúng về sự thật (tao verify rồi). Nhưng cần client tự viết (chưa tồn tại), hoặc cửa sổ race tính bằng **giây** vì phải qua `ReasonModal`. |
| "test helper không chứng minh vòng effect đã hết" | **Đồng ý một nửa** | Đúng là chưa phải regression test. Nhưng nó **không phải** "chỉ một mắt xích": nó dựng lại đủ chuỗi `state → memo → memo → dep compare` bằng hàm thật và chạy ra `[true×5]`. Nó chứng minh **bug tồn tại**; nó không chứng minh **fix đã xong** — hai việc khác nhau. |
| Codex sót | `maxDuration` (biến C-03 từ "có thể" thành "gần chắc chắn"), `ENROLLMENT_TOPIC` dùng chung 2 program, fallback schema im lặng + **không có cơ chế migration**, `check-overdue` chạy trên GH Actions (tự tắt sau 60 ngày) | Bốn cái này không có trong bài Codex. Ba cái đầu là rủi ro production thật, cái cuối làm ngưng engine SLA âm thầm. |

## 2. Release gate — P0/P1 phải đóng trước Go-Live

**7 hạng mục.** Ước tính **2–3 ngày công**, không phải 1 ngày như tao viết ban đầu
(Codex phản biện đúng — bản cũ bỏ sót M-34 và A-03).

| # | ID | Vấn đề | Nguồn | Quy mô | Rủi ro | Chặn |
|---|---|---|---|---|---|---|
| 1 | **T-01** | Vòng lặp `useEffect` vô hạn `GET /api/config/layout` trên `/tasks` | Claude | ~10 dòng | Thấp–TB | **P0** |
| 2 | **T-02** | `optimistic.updated_at` client tự sinh → PATCH kế tiếp 409 tất định + rollback whole-row | Claude *(+ Codex bổ sung phần rollback)* | ~25 dòng | TB | P1 |
| 3 | **M-34** | Control read-only vẫn bấm được → A→B→A bảo đảm | **Codex** | ~30 dòng | TB–Cao | P1 |
| 4 | **A-03** | Record vừa tạo biến mất khỏi list của người tạo | **Codex** | ~5 dòng + 1 quyết định sản phẩm | TB | P1 |
| 5 | **C-15** | `fetchCurrentCustomValues` lỗi đọc → `{}` → ghi đè **xoá trắng** custom_values | **Codex** | **1 dòng** (`return {}` → `throw`) | Rất thấp | P1 |
| 6 | **M-32** | `pendingRef` là `Set` → guard mở sớm khi 2 write cùng record | **Codex** | ~10 dòng | Thấp | P1 |
| 7 | **M-24** | Kiểm schema DB production (không có cơ chế migration, ≥5 nhánh fallback trả 200 im lặng) | Claude | **0 dòng** — chỉ chạy SQL | Không | P1 |

**Thứ tự bắt buộc:**
- **#1 trước #2.** Sửa T-02 khi vòng lặp còn sống thì không đo được gì.
- **#5 làm ngay** — 1 dòng, chặn mất dữ liệu, không có lý do gì để hoãn.
- **#7 làm ngay** — không đụng code, nhưng nếu DB production thiếu cột thì mọi thứ khác vô nghĩa.
- **#3 và #4 độc lập**, làm song song được.

## 3. Hạ rủi ro bằng quyết định vận hành, không bằng code

Ba hạng mục dưới đây **fix đúng thì tốn nhiều ngày và rủi ro trung bình–cao**. Trong tuần
release, chặn bằng release control rẻ hơn nhiều — nhưng phải là **control chính thức, có
người chịu trách nhiệm**, không phải khuyến nghị miệng (Codex phản biện đúng ở điểm này).

| ID | Rủi ro | Release control thay thế | Ai chịu trách nhiệm |
|---|---|---|---|
| **C-01 / Codex C-06** — đổi Config không tới tab đang mở | User có thể **không tạo được task** cho tới khi F5 | **CONFIG FREEZE:** khoá `/config` trong giờ vận hành. Mọi thay đổi chỉ ngoài giờ + thông báo "F5 trước khi làm tiếp". | Owner + admin Config |
| **C-03 / Codex C-01→C-04** — import ghi nửa chừng, đè bản mới hơn, bypass invariant | Dữ liệu production sai **âm thầm** | **TẮT IMPORT** trong tuần go-live (ẩn tab "Data Import Review" hoặc chặn ở `loadConfigAdmin`). Đã tắt thì toàn bộ nhóm C-01→C-04 **rời khỏi release gate**. | Owner |
| **T-12** — `check-overdue` chạy trên GitHub Actions, tự tắt sau 60 ngày repo im | Engine SLA/overdue/reminder ngưng, **không có alert** | Chuyển sang `vercel.json` (**3 dòng**, kiểm gói Vercel cần Pro cho `*/15`) hoặc đặt lịch nhắc kiểm workflow hằng tháng | DevOps |

> ⚠️ **Điều kiện của Codex mà tao chấp nhận:** nếu **không** áp được config freeze thì
> **C-01 quay lại release gate** và phải fix bằng code trước go-live. Banner + F5 tự nó
> không đóng được lỗi.

## 4. Làm nếu còn thời gian — rẻ, khu trú, rủi ro thấp

`M-33` (thêm `catch` cho archiveRecord) · `C-15`-liền-kề: `C-14` (serialize `patchColumn`) ·
`T-03` (dep realtime) · `M-01` (stats no-op trả 0) · `M-11` (patch date rác) ·
`M-08` (ReasonModal thay `window.prompt`) · `C-09` (tone toast — lỗi đang hiện giống thành công) ·
`M-26` (thêm message khi validate fail) · `A-01` fix (a) (khoá Required cho Consent) ·
`X-09` fix (a) (bỏ block dark-mode) · `T-13` (bỏ cron secret qua query string) ·
`T-05` bước 1 (`useMemo` cho `rows`/maps trong TaskListView).

## 5. Hoãn sau Go-Live — có lý do, không phải bỏ quên

| Hạng mục | Vì sao hoãn |
|---|---|
| RPC atomic cho toàn bộ mutation (Codex T-01/M-03/C-05) | Regression Risk **High**, đụng history/SLA/notification/rotation. Nhiều ngày công. Chưa có sự cố thật. |
| Phân trang + search server-side (T-04, M-22) | Đổi hợp đồng filter/export/deep-link. Cần quyết định sản phẩm trước. |
| Virtualization (T-05 bước 3) | Thêm thư viện + đụng sticky column = rủi ro thừa trong tuần release. |
| Hydrate config live (C-01 fix bằng code) | TB–Cao, **và bắt buộc sau T-01**. Đã có control vận hành thay thế. |
| Import idempotent + batch (C-03 (2)(3)) | Cần đổi schema (`applied_at` per row). Đã tắt import thì không gấp. |
| M-23 tách `ENROLLMENT_TOPIC` theo program | Cần deploy 2 pha (phát cả 2 topic → rồi bỏ topic cũ), không vội trong tuần release. |
| Gom trùng lặp (M-31, X-02, X-06, 4 component select) | Refactor thuần, §3 brief cấm trước go-live. |

## 6. Verification bắt buộc trước khi tuyên bố xong

Codex phản biện **đúng** ở điểm này và tao nhận: bản cũ của tao coi "fix xong 1–5 là
READY WITH RISKS" mà không có bằng chứng. Điều kiện thoát đúng phải là:

1. **T-01:** DevTools → Network, lọc `layout`, load `/tasks` bằng tài khoản **đã lưu layout** → đúng **1** request. *(Test helper hiện có chứng minh bug tồn tại, **không** chứng minh fix đã xong.)*
2. **T-02:** Network throttle "Slow 3G" → kéo 1 card qua 2 cột liên tiếp → cả 2 vào DB, không toast. Và mở 2 tab cùng sửa 1 task → 409 **vẫn phải** xuất hiện (không được làm mất OCC).
3. **M-34:** đăng nhập bằng CS **không** phải caller/responsible/creator → mọi control trong drawer phải disabled, **không** có request 403 nào phát ra.
4. **A-03:** CS thường tạo record không set Responsible → đóng drawer → record **vẫn còn** trong list.
5. **M-24:** chạy 3 câu SQL kiểm schema (`enrollment_records.description`, `.custom_values`, `tasks.custom_values`, `user_table_layout`, function `task_list_metadata`).
6. **Regression 4 module:** Tasks + Medicare + Config + ACA. Mọi fix chạm `table-config/**` hoặc `EnrollmentClient.tsx` phải test **cả Medicare lẫn ACA** — xem ma trận ở cuối phần Cross-Module.
7. **Baseline lại:** `typecheck` + `lint` + `test:run` + `build` (hiện tại cả 4 đều xanh — đã verify độc lập cả hai bên).

**Nợ kiểm thử phải ghi nhận:** `vitest.config.ts` chỉ include `src/**/*.test.ts` với
`environment: "node"` → **không có test component/effect nào**. Toàn bộ P0/P1 ở trên nằm
ngoài tầm phủ CI. Sau go-live: thêm `jsdom` + test cho `TaskBoardClient`/`EnrollmentClient`.
Ngay bây giờ có 2 test thuần rẻ chạy được với cấu hình hiện tại: `taskListColumnsFromConfig`
trả reference mới (T-01) và `buildOptimisticTaskPatch` không sinh `updated_at` (T-02).

## 7. Final Recommendation

**Trạng thái hiện tại: NOT READY.** Cả hai bài review độc lập kết luận giống nhau.

**Đường ra:** đóng **7 hạng mục ở mục 2** (2–3 ngày công) **+** áp **2 release control ở
mục 3** (config freeze, tắt import) → đánh giá lại. **Không** tuyên bố READY WITH RISKS
trước khi chạy đủ 7 bước verification ở mục 6 — đây là chỗ bản trước của tao vội, và
Codex phản biện đúng.

**Thứ tự tuyệt đối không đảo:**
```
#7 kiểm SQL  ─┐
#5 fix 1 dòng ─┼─→  #1 T-01  ─→  #2 T-02  ─→  #3 M-34 ∥ #4 A-03 ∥ #6 M-32
              ─┘      (P0)        (cần #1)         (song song được)
                                        ↓
                          verification mục 6 (đủ 7 bước)
                                        ↓
                    READY WITH RISKS + 2 release control mục 3
```

**Điều duy nhất còn tranh chấp giữa hai bài review** là số lượng P1: Codex theo dõi 16,
tao chấp nhận 7 và hạ phần còn lại xuống P2 kèm lý do từng cái (mục 1). Với owner, khác
biệt này **không đổi quyết định go-live** (cả hai đều NOT READY) — nó chỉ đổi **thứ tự
làm**. Nếu owner muốn tuyệt đối an toàn thì lấy danh sách 16 của Codex; nếu muốn ra được
trong tuần thì lấy 7 của tao **kèm đủ 2 release control**. Tao khuyến nghị phương án thứ hai
và nhận trách nhiệm về phần đã hạ severity.

---

*Đối chiếu hoàn tất 2026-08-08. Hai bài review: `docs/claude_golive-review.md` (bài này) và
`docs/codex_review_code.md`. Không dòng source nào bị sửa trong cả hai lượt review.*
