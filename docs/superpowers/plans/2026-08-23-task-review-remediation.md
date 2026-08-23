# Task Review Remediation — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa các finding đã xác nhận trong `docs/2026-08-23-task-management-code-review.md`, ưu tiên correctness/security trước, rồi tới hai hotspot chi phí đo được từ production.

**Nguồn:** review 3 chiều (Luna → codex-Sol → Claude-opus5.0) + số liệu Vercel Observability 12h ngày 22/08/2026.

**Tech Stack:** Next.js 16.2.4 App Router · Supabase PostgREST (service-role, scoping ở tầng ứng dụng) · vitest 2.1.9 (`environment: "node"`, chỉ `src/**/*.test.ts` — **không có jsdom, không test được `.tsx`**) · Tailwind v4.

## Global Constraints

- Không đổi hành vi RBAC ngoài phạm vi finding đã chốt.
- Mọi thay đổi logic phải ghi vào `agent-portal/changelog.md`.
- Không tự push. Push theo từng commit, và phải nêu rõ remote.
- Test phải chạy `npm run test:run` + `npm run typecheck` + `npm run lint` trước mỗi commit.
- Baseline trước khi bắt đầu: **108 test files / 760 tests passed**.
- Component `.tsx` không có test runner — thay đổi UI phải verify bằng tay trên `localhost:3000`.

---

## Phân loại: sửa được ngay vs phải đo trước

### Nhóm A — sửa trong plan này (13 finding)

| Finding | Loại | Vì sao làm được ngay |
|---|---|---|
| HIGH-01 | Security | Đổi fail-open → fail-closed, có test |
| HIGH-02 | Security | Đổi một hàm check quyền, có test |
| MEDIUM-01/02/03 | Correctness | Một nguyên nhân gốc, gộp `seeAll` vào resolver |
| MEDIUM-04 | Correctness | Thêm filter `deleted_at` + delegate |
| MEDIUM-05 | Correctness | Lỗi closure tất định |
| MEDIUM-06 | Correctness | Normalize email + backfill |
| LOW-01 | Perf | `Map` thay `find` |
| LOW-02 | Reliability | Thu hẹp điều kiện suppress |
| MEDIUM-12 | Perf | Bỏ ensure bucket ở runtime |
| MEDIUM-11 | Perf | Cap danh sách ID |
| **P-01** | **Cost** | **55% invocations — poll 20s không kiểm tra tab ẩn** |
| **P-02** | **Cost** | **14% invocations — đổi một chữ** |
| HIGH-08 | Perf | Reactions theo comment đang hiển thị |

### Nhóm B — KHÔNG làm trong plan này (9 finding)

| Finding | Vì sao hoãn |
|---|---|
| HIGH-03 (cursor pagination) | Viết lại kiến trúc board. Số đo: 5.1K inv / 3m CPU, error rate 0% — chưa chạm ngưỡng 503. Cần đo số task active thật trước. |
| HIGH-04 (visibility RPC) | Sol đã hạ Medium chờ đo. Cần log độ dài filter thật. |
| HIGH-05 (access RPC) | Số đo: 7% invocations, 5 check chạy song song nên chi phí là max không phải tổng. Sửa gần như không đổi hóa đơn. |
| HIGH-06 (overview aggregate) | Số đo: **không xuất hiện trong top 5 route**. Chỉ chạy khi manager mở đúng tab Overview. |
| HIGH-07 (search RPC) | Số đo: **không xuất hiện trong bảng Functions**. |
| MEDIUM-07 (upload song song) | Optimization, không phải bug. Chạm luồng upload đang chạy ổn định. |
| MEDIUM-08 (ModalShell) | Refactor UI cho cả CS + Enrollment, cần E2E bàn phím mà repo chưa có. |
| MEDIUM-09 (correlated subquery) | Review tự ghi: chỉ đổi SQL **sau** `EXPLAIN ANALYZE`. |
| MEDIUM-10 (refetch amplification) | Cần đo số refetch thực tế; patch-by-ID có rủi ro sai filter khi task đổi category/status. |

**Lý do tách:** 6/9 mục nhóm B là tối ưu kiến trúc mà chính report yêu cầu đo trước khi sửa. Sửa mù sẽ đánh đổi rủi ro lấy phần lợi mà số liệu production cho thấy là rất nhỏ.

---

## Phase 1 — Security & correctness

### Task 1: `seeAll` vào resolver dùng chung (MEDIUM-01/02/03)

**Files:**
- Modify: `src/lib/tasks/access.ts` (`canViewTask`, comment dòng 1)
- Modify: `src/app/api/tasks/[id]/route.ts` (`resolveTaskAccess`)
- Modify: `src/lib/tasks/search.ts` (`isHitVisible`, `VisibilityScope`)
- Test: `src/lib/tasks/access.test.ts`, `src/lib/tasks/search.test.ts`

**Nguyên nhân gốc:** `canViewTask` không biết luật "plain-CS thấy toàn bộ company queue". Luật đó sống riêng ở `actorSeesAllTasks()` và được viết lại lần hai trong `fetchTasksForActor()`. 2/4 route đọc task quên OR nó vào.

- [ ] **Step 1: Test đỏ cho `canViewTask`**

```ts
it("grants view to a plain-CS company-queue viewer with no task-specific flag", () => {
  const actor = { email: "cs@x.com", isManager: false, isWorker: true };
  expect(canViewTask(actor, { assignee_email: "other@x.com" }, {})).toBe(false);
  expect(
    canViewTask(actor, { assignee_email: "other@x.com" }, { seesAllTasks: true })
  ).toBe(true);
});

it("still denies a non-worker even with seesAllTasks", () => {
  const actor = { email: "x@x.com", isManager: false, isWorker: false };
  expect(canViewTask(actor, { assignee_email: null }, { seesAllTasks: true })).toBe(false);
});
```

- [ ] **Step 2: Chạy test — phải FAIL** (`seesAllTasks` chưa tồn tại → TS error)

- [ ] **Step 3: Thêm flag vào `canViewTask`**

```ts
//   isReporter    – worker created/reported the task
//   seesAllTasks  – plain-CS company-wide queue (actorSeesAllTasks). Lives here
//                   so list/detail/comments/direct-GET/search cannot drift.
export function canViewTask(
  actor: TaskActor,
  task: Pick<TaskRow, "assignee_email">,
  flags: {
    isAssignee?: boolean;
    isAgentMember?: boolean;
    isAgentOwner?: boolean;
    isParticipant?: boolean;
    isReporter?: boolean;
    seesAllTasks?: boolean;
  } = {}
): boolean {
  void task;
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  return (
    Boolean(flags.seesAllTasks) ||
    Boolean(flags.isAssignee) ||
    ...
  );
}
```

- [ ] **Step 4: Direct GET truyền `seeAll`** — thêm `actorSeesAllTasks(actor)` vào `Promise.all` của `resolveTaskAccess`, truyền vào `resolveTaskCapabilities`.

- [ ] **Step 5: Search truyền `seeAll`** — thêm `seesAllTasks: boolean` vào `VisibilityScope`, `isHitVisible` truyền xuống `canViewTask`. Sửa luôn comment sai phía trên nó.

- [ ] **Step 6: Test xanh + commit**

### Task 2: Membership fail-closed (HIGH-01)

**Files:** `src/lib/tasks/membership.ts`, test `src/lib/tasks/membership.test.ts`

`fetchAssistantAgentsForCs` trả `[]` khi lỗi, trong khi caller dùng mảng rỗng làm **bằng chứng** user là plain CS.

- [ ] **Step 1: Test đỏ** — mock query lỗi, assert `fetchAssistantAgentsForCs` **throw**, và `actorSeesAllTasks` throw theo.
- [ ] **Step 2: Đổi `if (error) return [];` → `if (error) throw new Error(error.message);`** (khớp với `fetchSelectedAgentEmails` đã throw sẵn).
- [ ] **Step 3:** Kiểm `fetchAgentsForCs` — hàm này dùng cho `isAgentMember`, trả `[]` là **fail-closed** (từ chối quyền), giữ nguyên nhưng thêm comment giải thích vì sao hai hàm giống nhau lại xử lý lỗi khác nhau.
- [ ] **Step 4: Test xanh + commit**

### Task 3: Assign permission (HIGH-02)

**Files:** `src/app/api/tasks/[id]/assign/route.ts`

- [ ] **Step 1:** Trước khi sửa, query DB xem có role nào `admin`-ish mà **không** có `task.manage` không. Ghi kết quả vào changelog.
- [ ] **Step 2:** Đổi sang `buildTaskActor(session.user.permissions, email, { isAdmin: isTaskViewAdmin(session.user) })` rồi check `canAssign(actor)`.
- [ ] **Step 3:** Test route với role có/không `task.manage`.

### Task 4: Comments GET (MEDIUM-04)

**Files:** `src/app/api/tasks/[id]/comments/route.ts`

- [ ] Thêm `.is("deleted_at", null)` + limit, hoặc delegate sang `loadComments()`.
- [ ] Giữ nguyên `canViewResolved` — đây là một trong hai nơi làm ĐÚNG luật `seeAll`.

### Task 5: Optimistic retry closure (MEDIUM-05)

**Files:** `src/app/(authed)/tasks/_components/CommentThread.tsx:1182-1200`

Lỗi tất định: `optimisticComments` đọc từ closure cũ nên file cuối cùng không bao giờ release.

- [ ] Quyết định release **bên trong** functional update, hoặc dùng ref đồng bộ với state.
- [ ] Verify tay: upload 1 file fail → retry thành công → comment tạm phải biến mất.

### Task 6: Email normalization (MEDIUM-06)

**Files:** `src/lib/tasks/mentions.ts`, rollout SQL mới, `src/lib/tasks/participants.ts`

- [ ] `mentions.ts:10` thêm `.toLowerCase()`.
- [ ] RPC comment: `btrim(lower(mention_email))` khi insert.
- [ ] **Backfill dữ liệu cũ TRƯỚC** khi thêm bất kỳ constraint nào.
- [ ] Xoá `addParticipants()` — code chết, không caller nào.

---

## Phase 2 — Hai hotspot chi phí (P-01, P-02)

### Task 7: Notification poll (P-01 — 55% invocations)

**Files:** `src/app/(authed)/_components/NotificationBell.tsx:291-297`

- [ ] Gate `setInterval` bằng `document.visibilityState === "visible"`; load lại một lần khi tab quay lại.
- [ ] `POLL_REALTIME_MS` 20s → 120s (realtime đã push `event: "new"`); giữ `POLL_FALLBACK_MS` 10s cho trường hợp không có realtime.
- [ ] Verify tay: mở DevTools Network, chuyển tab, xác nhận request dừng.

### Task 8: Reconcile scope (P-02 — 14% invocations)

**Files:** `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:767-773`

- [ ] Đổi `reconcileTaskData()` → `reconcileTaskData("tasks-only")` trong nhịp poll định kỳ.
- [ ] Giữ nguyên `"full"` cho các đường khác (broadcast không có sourceId, invalidation không có taskId).

---

## Phase 3 — Quick wins

- [ ] **LOW-01:** `Map<storage_path, result>` thay `results.find()` trong `signAttachmentsSafely`.
- [ ] **LOW-02:** `isMissingEnrollmentTableError` chỉ suppress khi message chứa đúng tên relation.
- [ ] **MEDIUM-11:** cap danh sách `unreadAssignedTaskIds`.
- [ ] **MEDIUM-12:** rollout bucket qua SQL/deploy, bỏ `configureTaskBucket` khỏi đường upload.
- [ ] **HIGH-08:** RPC nhận danh sách comment id đang hiển thị.

---

## Thứ tự commit

1. `fix(tasks): share the company-queue rule across every read path` (Task 1)
2. `fix(tasks): fail closed when membership lookup errors` (Task 2)
3. `fix(tasks): require task.manage to assign` (Task 3)
4. `fix(tasks): stop the legacy comments route returning deleted bodies` (Task 4)
5. `fix(comments): release the optimistic row after a retried upload` (Task 5)
6. `fix(tasks): normalize mention emails` (Task 6)
7. `perf(notifications): stop polling hidden tabs` (Task 7)
8. `perf(tasks): keep the heartbeat off the categories endpoint` (Task 8)
9. `perf(tasks): quick wins from the 23/08 review` (Phase 3)
