# Plan: View-model (CS + Enrollment) + Batch fixes — hand-code

Ngày: 2026-08-02 · Branch: `config` · Người code: **bạn (tay)** · Người viết plan: Claude

> Plan **self-contained**: đọc file này là đủ code, không cần mở review doc khác.
> Quyết định gốc: `docs/2026-08-02-uncommitted-review-rbac.md` mục 11 (Q1–Q5 đã chốt).
> Tất cả code trích dưới đây là **code thật hiện tại** (đã đọc kỹ toàn bộ logic liên quan).

---

## 0. Scope & Non-goals

**Làm trong đợt này:**
- **Q1** — Đổi *visibility/quyền XEM*: CS (plain-CS thấy hết, agent/assistant giữ scope) + Enrollment (mọi worker thấy hết) + default filter theo tên.
- **Q2** — 6 fix an toàn: `5.2, 6.3, 6.5, 7.1, 7.2, 7.3`.
- **Q3a** — Import: cho reject/đóng request `failed` + `processing` kẹt.
- **Q4c** — Import: cấm đụng assignee khi *update*.

**KHÔNG đụng (quan trọng — trả lời câu "đợt này có đụng rbac không"):**
- ❌ Hệ RBAC permission/role (`src/lib/rbac/*`) — không thêm/sửa permission hay role.
- ❌ Rule **SỬA/mutate/status/assign/delete** — giữ nguyên `canMutateTask`, `canChangeTaskStatus`, `canAssignToTask`, `canDeleteTask`, `canMutateEnrollmentRecord`.
- ❌ Findings #6 (task authz rải rác) & #7 (task-create non-atomic) — hoãn đợt sau.
- ❌ RPC transaction cho import (M1-b) — hoãn.

Đợt này **chỉ chỉnh tầng lọc dữ liệu theo role sẵn có** (query scoping), không chạm mô hình phân quyền.

---

## 1. Bối cảnh logic hiện tại (để plan tự chứa)

### 1.1 Role model (đã verify)
- `TaskActor` = `{ email, isManager, isWorker }`. `buildTaskActor` (`src/lib/tasks/access.ts:35`):
  - `isManager = task.manage AND isAdmin` (admin role).
  - `isWorker = task.work OR task.manage`.
- Phân loại người dùng board (từ `enrichTaskPeopleRoles` `src/lib/tasks/assignees.ts:179-199`):
  - **Agent** = email ∈ bảng `task_agents` (`fetchSelectedAgentEmails()` `assignees.ts:35`).
  - **Assistant** = có row `agent_members(cs_email=họ, is_assistant=true)` → `fetchAssistantAgentsForCs(email)` (`membership.ts:58`) ≠ rỗng.
  - **CS thường (plain CS)** = worker, KHÔNG agent, KHÔNG assistant.
- ⚠️ `fetchAgentsForCs` và `fetchAssistantAgentsForCs` **giống hệt nhau** (cùng query `agent_members` where `cs_email=email, is_assistant=true`) — đều là "agent mà tôi assist".

### 1.2 CS scope hiện tại (`src/lib/tasks/queries.ts:13-111`)
`fetchTasksForActor(actor)`:
- Manager → không scope (thấy hết).
- **Mọi** non-manager → scope OR: `assignee_email=me OR agent_email=me OR agent_email∈(agent tôi assist) OR id∈assigned OR id∈participant`, rồi lọc lần 2 bằng `canViewTask` (dòng 87-108).
- Có nhánh **legacy fallback** (dòng 55-73) khi thiếu cột `custom_values`, dùng `buildWorkerTaskOrs` (dòng 277-300). **Lưu ý:** `buildWorkerTaskOrs(email, null)` vẫn trả `[assignee=email, agent_email=email]` → vẫn scoped, KHÔNG phải "see all".

### 1.3 Client CS đã sẵn cho mô hình mới (`TaskBoardClient.tsx`)
- Dòng 137-141: `assigneeFilter` **mặc định `[currentEmail]`** khi `plainCs = !isManager && !ownsAgent && myAssistantAgents.length===0` (định nghĩa **trùng** server).
- Dòng 665-667 comment: *"Plain CS now see ALL … the assignee filter (defaulting to themselves) narrows it instead."* → `scopedTasks = tasks` (không limit thêm ở client).
- Dòng 680-687 `filterAssignees` suy từ `tasks` thấy được → khi server gửi hết, dropdown assignee tự đủ mọi người.
- **Kết luận:** client CS **không cần sửa** để có "thấy hết + default filter self". Chỉ đổi server.

### 1.4 Enrollment scope hiện tại (do batch Codex thêm)
- `fetchEnrollmentRecords(program, actor)` (`queries.ts:64`) fetch tất cả rồi **filter** bằng `canViewEnrollmentRecord`.
- `canViewEnrollmentRecord` / `canViewEnrollmentRecordWithContext` / `fetchEnrollmentParticipantRecordIds` (`access.ts:36-86`) — quyền xem qua stakeholder + "participant qua comment/notification".
- `canMutateEnrollmentRecord` (`access.ts:27-34`) = manager OR stakeholder (`responsible_enroll_email`/`created_by_email`/`caller_email`) — **GIỮ NGUYÊN**.
- 8 route enrollment gọi `canViewEnrollmentRecordWithContext` + `fetchEnrollmentRecordById(id, actor)`.

---

# PART A — CS view model (server) [Q1]

**Mục tiêu:** plain-CS thấy TẤT CẢ task; agent/assistant giữ scope cũ; manager giữ nguyên. Client không đổi.

### A1. Export `fetchSelectedAgentEmails`
File `src/lib/tasks/assignees.ts:35`.

```ts
// BEFORE
const fetchSelectedAgentEmails = cache(async (): Promise<Set<string>> => {

// AFTER
export const fetchSelectedAgentEmails = cache(async (): Promise<Set<string>> => {
```

### A2. Sửa `fetchTasksForActor` — thêm cờ `seeAll` cho plain-CS
File `src/lib/tasks/queries.ts`.

**a) Import** (đầu file, cạnh các import từ `./assignees`): thêm `fetchSelectedAgentEmails`.
```ts
import {
  attachAssigneesToTasks,
  fetchAssignedTaskIdsForEmail,
  fetchSelectedAgentEmails,   // NEW
} from "./assignees";
```
(Kiểm tra import hiện tại — dòng 2 đang là `import { attachAssigneesToTasks, fetchAssignedTaskIdsForEmail } from "./assignees";`.)

**b) Khối scope** — thay dòng 25-50 hiện tại:

```ts
// BEFORE (dòng ~25-50)
  let workerScope:
    | { agents: string[]; assistantAgents: string[]; assignedIds: string[]; participantIds: string[]; }
    | null = null;
  if (!actor.isManager) {
    const [agents, assistantAgents, assignedIds, participantIds] = await Promise.all([
      fetchAgentsForCs(actor.email),
      fetchAssistantAgentsForCs(actor.email),
      fetchAssignedTaskIdsForEmail(actor.email, supabase),
      fetchParticipantTaskIds(actor.email),
    ]);
    workerScope = { agents, assistantAgents, assignedIds, participantIds };
    const ors: string[] = [`assignee_email.eq."${actor.email}"`];
    ors.push(`agent_email.eq."${actor.email}"`);
    if (agents.length > 0) ors.push(`agent_email.in.(${agents.map((a) => `"${a}"`).join(",")})`);
    if (assignedIds.length > 0) ors.push(`id.in.(${assignedIds.join(",")})`);
    if (participantIds.length > 0) ors.push(`id.in.(${participantIds.join(",")})`);
    query = ors.length > 0 ? query.or(ors.join(",")) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }
```

```ts
// AFTER
  let workerScope:
    | { agents: string[]; assistantAgents: string[]; assignedIds: string[]; participantIds: string[]; }
    | null = null;
  // seeAll = thấy toàn bộ task (không scope). Manager, HOẶC plain-CS (không phải
  // agent trong task_agents, không phải assistant) — CS là hàng đợi chung công ty.
  let seeAll = actor.isManager;
  if (!actor.isManager) {
    const [selectedAgentEmails, assistantAgents] = await Promise.all([
      fetchSelectedAgentEmails(),
      fetchAssistantAgentsForCs(actor.email),
    ]);
    const isAgent = selectedAgentEmails.has(actor.email);
    const isAssistant = assistantAgents.length > 0;
    seeAll = !isAgent && !isAssistant; // plain CS → thấy hết
    if (!seeAll) {
      const [agents, assignedIds, participantIds] = await Promise.all([
        fetchAgentsForCs(actor.email),
        fetchAssignedTaskIdsForEmail(actor.email, supabase),
        fetchParticipantTaskIds(actor.email),
      ]);
      workerScope = { agents, assistantAgents, assignedIds, participantIds };
      const ors: string[] = [`assignee_email.eq."${actor.email}"`];
      ors.push(`agent_email.eq."${actor.email}"`);
      if (agents.length > 0) ors.push(`agent_email.in.(${agents.map((a) => `"${a}"`).join(",")})`);
      if (assignedIds.length > 0) ors.push(`id.in.(${assignedIds.join(",")})`);
      if (participantIds.length > 0) ors.push(`id.in.(${participantIds.join(",")})`);
      query = ors.length > 0 ? query.or(ors.join(",")) : query.eq("id", "00000000-0000-0000-0000-000000000000");
    }
  }
```

**c) Nhánh legacy fallback** — đổi điều kiện gate (dòng ~63) từ `!actor.isManager` sang `!seeAll`:
```ts
// BEFORE
    if (!actor.isManager) {
      const scopedOrs = buildWorkerTaskOrs(actor.email, workerScope);
// AFTER
    if (!seeAll) {
      const scopedOrs = buildWorkerTaskOrs(actor.email, workerScope);
```

**d) Filter lần 2 (dòng 84):** giữ nguyên `if (!workerScope) return attachTaskListMetadata(tasks, supabase);` — plain-CS có `workerScope=null` nên trả tất cả, đúng.

> **Consistency check bắt buộc:** định nghĩa plain-CS ở server (`!isAgent && !isAssistant`) phải khớp client `TaskBoardClient.tsx:139` (`!ownsAgent && myAssistantAgents.length===0`, với `ownsAgent = agents.some(a=>a.email===currentEmail)` và `agents` = `fetchTaskAgents()` = toàn bộ `task_agents`). → **Khớp.** Nếu sau này đổi 1 bên, phải đổi bên kia.

### A3. Client CS — KHÔNG đổi logic
Không sửa. (Tùy chọn polish, **không bắt buộc**): plain-CS giờ thấy hết nên có thể muốn bỏ ẩn Category filter — hiện `showCategoryFilter = !shouldLimitPlainCsTasks` (`TaskBoardClient.tsx:707`) đang ẩn với plain-CS. Cân nhắc sau, không thuộc đợt này.

### A4. Perf note
Plain-CS giờ load toàn bộ task như manager. Ở 30 agent lượng task lớn → nằm trong phạm vi plan virtualization đang treo (Phase C). Không xử lý ở đây.

### A5. Test (thêm)
File `src/lib/tasks/*.test.ts` (nơi test `fetchTasksForActor` hoặc thêm mới): mock để khẳđịnh
- plain-CS actor → query KHÔNG có `.or(...)` scope (thấy hết).
- agent actor (email ∈ task_agents) → vẫn scope.
- assistant actor → vẫn scope.

---

# PART B — Enrollment view revert (server) [Q1]

**Mục tiêu:** mọi worker thấy TẤT CẢ enrollment record. Bỏ toàn bộ view-scope batch thêm. **GIỮ** `canMutateEnrollmentRecord` (sửa/xoá vẫn chỉ manager + stakeholder).

### B1. `src/lib/enrollment/access.ts`
- **XOÁ**: `canViewEnrollmentRecord`, `canViewEnrollmentRecordWithContext`, `fetchEnrollmentParticipantRecordIds`.
- **GIỮ**: `canAccessEnrollment`, `canManageEnrollmentOptions`, `canMutateEnrollmentRecord`, `isDirectEnrollmentStakeholder`, `normalizeEmail`, type `EnrollmentRecordAccessFields`, `loadEnrollmentActor`.
- **Cleanup**: sau khi xoá 3 hàm trên, file không còn dùng `getSupabaseAdmin`/`SupabaseClient` → xoá 2 import đó, và đổi `loadEnrollmentActor` về `import { auth } from "@/auth"` ở đầu file (bỏ `const { auth } = await import("@/auth")`).

### B2. `src/lib/enrollment/queries.ts`
- `fetchEnrollmentRecords(program, actor)` → bỏ tham số `actor` + bỏ khối `participantRecordIds`/`visibleRecords`. Dùng `records` trực tiếp cho `ids` và return.
```ts
// AFTER (bản rút gọn)
export async function fetchEnrollmentRecords(
  program: EnrollmentProgram
): Promise<EnrollmentRecordWithStats[]> {
  ...
  const records = (rows ?? []).map(coerceEnrollmentRecord);
  const ids = records.map((record) => record.id);
  if (ids.length === 0) return [];
  ... // comments/attachments counts như cũ
  return records.map((record) => ({ ...record, comment_count: ..., ... }));
}
```
- `fetchEnrollmentRecordById(id, actor?)` → bỏ tham số `actor` + bỏ khối check `canViewEnrollmentRecord`. Giữ phần load comments/attachments.
- Bỏ import `canViewEnrollmentRecord`, `fetchEnrollmentParticipantRecordIds`, `EnrollmentActor` khỏi file này.

### B3. `src/lib/enrollment/overview-data.ts`
- Bỏ tham số `actor` khỏi `fetchEnrollmentOverview(program, actor, now)` → `(program, now)`.
- Bỏ khối `participantRecordIds`/`visibleRecords`; truyền `records` (tất cả) vào `aggregateEnrollmentOverview`.
- Bỏ import `canViewEnrollmentRecord`, `fetchEnrollmentParticipantRecordIds`, `EnrollmentActor`.
- `OVERVIEW_RECORD_COLUMNS`: có thể giữ nguyên (thừa `caller_email`/`created_by_email` vô hại) hoặc revert về bản cũ — tùy, không bắt buộc.

### B4. Các API route enrollment — bỏ check view, revert chữ ký
Bảng thao tác (mỗi route: **bỏ** `canViewEnrollmentRecordWithContext(...)`, và đổi `fetchEnrollmentRecordById(id, actor)` → `fetchEnrollmentRecordById(id)`; **revert** `.select("id,caller_email,...")` về `.select("id")` ở các chỗ chỉ dùng cho view):

| File | Sửa |
|---|---|
| `api/enrollment/[id]/route.ts` | GET: `fetchEnrollmentRecordById(id)`. **PATCH/DELETE: GIỮ** `canMutateEnrollmentRecord` + `.select` có stakeholder fields (cần cho mutate). PATCH cuối: `fetchEnrollmentRecordById(id)`. |
| `api/enrollment/[id]/detail/route.ts` | bỏ canView; `.select("id")` |
| `api/enrollment/[id]/activity/route.ts` | bỏ canView; `.select("id")` |
| `api/enrollment/[id]/comments/route.ts` | `loadContext`: bỏ canView; POST cuối `fetchEnrollmentRecordById(id)` |
| `api/enrollment/[id]/comments/[cid]/route.ts` | `loadAuthorContext`: bỏ canView; `.select("id")` (GIỮ check `author_email===actor.email` để sửa/xoá comment của chính mình) |
| `api/enrollment/[id]/comments/[cid]/edits/route.ts` | bỏ canView + bỏ luôn khối fetch record chỉ để check |
| `api/enrollment/[id]/attachments/route.ts` | `loadRecordContext`: bỏ canView. POST: **GIỮ** `canMutateEnrollmentRecord` cho standalone attach + comment-attach validate. Cuối: `fetchEnrollmentRecordById(id)` |
| `api/enrollment/[id]/attachments/[aid]/route.ts` | bỏ canView; `.select("id")`. **GIỮ** check `uploaded_by`/manager để xoá |
| `api/enrollment/export/route.ts` | `fetchEnrollmentRecords(program)` |
| `api/enrollment/overview/route.ts` | `fetchEnrollmentOverview(program)` |
| `api/enrollment/route.ts` | GET: `fetchEnrollmentRecords(program)`. POST: giữ `sanitizeEnrollmentPatchForProgram`. |

### B5. `src/app/(authed)/enrollment/page.tsx`
- `fetchEnrollmentRecords(program, actor)` → `fetchEnrollmentRecords(program)`.
- `linkedRecord = records.find(...) ?? (await fetchEnrollmentRecordById(recordId, actor))` → `fetchEnrollmentRecordById(recordId)`.
- `actor` vẫn cần cho `canActorExportImport(actor)` → giữ biến `actor`.

---

# PART C — Enrollment default filter (client) [Q1]

File `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`.

- `DEFAULT_FILTERS` (dòng 129) giữ nguyên (`responsible: []`).
- State init (dòng 401): mặc định lọc theo mình **chỉ khi không phải manager** (`canManageOptions` = `actor.isManager`, xem `canManageEnrollmentOptions`).
```ts
// BEFORE
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
// AFTER
  const [filters, setFilters] = useState<Filters>(() =>
    canManageOptions
      ? DEFAULT_FILTERS
      : { ...DEFAULT_FILTERS, responsible: [currentEmail] }
  );
```
- Nút "Clear" (dòng ~1200 `setFilters(DEFAULT_FILTERS)`) giữ nguyên → clear = xem tất cả. Đúng ý.

---

# PART D — Q2: 6 fix an toàn

### D1 (5.2) — Enrollment `canEdit` theo quyền thật
Hiện `EditableCustomCell` trong enrollment nhận `canEdit` **hardcode `true`** (inline row ~dòng 1785 & drawer ~dòng 2558) → worker chỉ-xem sửa bị 403 im lặng.

**a) Helper client mirror server** — thêm cạnh `isPlainRecord` (`EnrollmentClient.tsx:368`):
```ts
function canEditEnrollmentRecordClient(
  record: { responsible_enroll_email?: string | null; created_by_email?: string | null; caller_email?: string | null },
  currentEmail: string,
  isManager: boolean
): boolean {
  if (isManager) return true;
  const me = currentEmail.trim().toLowerCase();
  return [record.responsible_enroll_email, record.created_by_email, record.caller_email]
    .some((e) => (e ?? "").trim().toLowerCase() === me);
}
```

**b) Thread `currentEmail` + `isManager` xuống bảng.** `EnrollmentTable` (dòng 1324) và `EnrollmentRowItem` (dòng 1419) hiện **KHÔNG** có 2 prop này → thêm vào cả 2 (type + truyền). Ở nơi render `<EnrollmentTable ...>` trong `EnrollmentClient` truyền `currentEmail={currentEmail}` `isManager={canManageOptions}`; `EnrollmentTable` truyền tiếp xuống `<EnrollmentRowItem .../>`.

**c) Row inline cell** (~dòng 1785, chỗ `<EditableCustomCell ... canEdit ...>`):
```ts
canEdit={canEditEnrollmentRecordClient(record, currentEmail, isManager)}
```

**d) Drawer** (`EnrollmentDrawer`, custom fields ~dòng 2558): `EnrollmentDrawer` đã có `currentEmail`. Cần thêm `isManager`/`canManageOptions` prop (kiểm tra — nếu chưa có thì thêm). Đổi `canEdit` hardcode → `canEdit={canEditEnrollmentRecordClient(record, currentEmail, isManager)}`.

> Lưu ý: server `canMutateEnrollmentRecord` là nguồn chân lý (đã chặn 403). Đây chỉ đồng bộ UI để không hiện ô editable rồi fail.

### D2 (6.3) — `cache()` cho `fetchTaskAssignees`
File `src/lib/tasks/assignees.ts:56` (đã có `import { cache } from "react"` dòng 2).
```ts
// BEFORE
export async function fetchTaskAssignees(): Promise<TaskAssignee[]> {
  const supabase = getSupabaseAdmin();
  ...
}
// AFTER
export const fetchTaskAssignees = cache(async (): Promise<TaskAssignee[]> => {
  const supabase = getSupabaseAdmin();
  ...
});
```
> Phần "short-circuit participant trong `fetchEnrollmentRecordById`" của 6.3 **tự tiêu** vì Part B đã bỏ actor param — không còn participant fetch.

### D3 (6.5) — Enrollment DELETE: log activity error thay vì 500
File `src/app/api/enrollment/[id]/route.ts` (DELETE, ~dòng 441-447). Record đã archive thành công trước đó → không nên trả 500 vì lỗi ghi activity.
```ts
// BEFORE
  if (activityError) {
    return NextResponse.json({ error: activityError.message }, { status: 500 });
  }
// AFTER
  if (activityError) {
    console.error("enrollment archive activity insert failed", { id, error: activityError.message });
  }
```

### D4 (7.1) — Xoá dead code `permissions.ts`
- **Trước khi xoá**, verify không còn runtime import:
  ```
  grep -rn "table-config/permissions" src   # chỉ nên thấy permissions.test.ts
  ```
- Xoá `src/lib/table-config/permissions.ts` + `src/lib/table-config/permissions.test.ts`.
- (Runtime dùng `export-access.ts::canActorExportImport` = `actor.isManager`, không liên quan.)

### D5 (7.2) — `EditableCustomCell` person compare lowercase
File `src/app/(authed)/_shared/EditableCustomCell.tsx`. Hiện `commit` gọi `normalizedValueEquals(value, next)` (dòng 50) so sánh `===` → person khác hoa/thường bị coi là khác → PATCH thừa.
```ts
// commit (dòng 48-52) — truyền type vào
  function commit(next: unknown) {
    setEditing(false);
    if (normalizedValueEquals(column.type, value, next)) return;   // NEW: thêm type
    void onSave(next);
  }

// normalizedValueEquals (dòng 197-200)
function normalizedValueEquals(type: TableColumn["type"], current: unknown, next: unknown): boolean {
  if ((current === "" || current === undefined) && next === null) return true;
  if (type === "person" && typeof current === "string" && typeof next === "string") {
    return current.trim().toLowerCase() === next.trim().toLowerCase();
  }
  return current === next;
}
```

### D6 (7.3) — Feedback khi save custom value fail
File `src/app/(authed)/_shared/EditableCustomCell.tsx`. Hiện save fail → revert im lặng (parent rollback optimistic). Thêm trạng thái lỗi nhẹ.
```ts
// thêm state (cạnh const [editing, setEditing] = useState(false); dòng 35)
  const [saveError, setSaveError] = useState(false);

// commit → await onSave, bắt lỗi
  async function commit(next: unknown) {
    setEditing(false);
    if (normalizedValueEquals(column.type, value, next)) return;
    setSaveError(false);
    try {
      await onSave(next);
    } catch {
      setSaveError(true);
    }
  }
```
- Thêm viền đỏ khi `saveError` (thêm vào className của button hiển thị, vd `${saveError ? "ring-1 ring-[#de350b]" : ""}`), và `title` báo "Lưu thất bại, thử lại".
- `onSave` prop hiện `(next) => void | Promise<void>` — parent (`TaskRowItem`/`EnrollmentClient`) cần **throw** khi PATCH fail để cell bắt được (kiểm tra: `onPatch` có reject không; nếu nuốt lỗi thì cell không biết — có thể cần cho `onPatch` re-throw, hoặc trả `{ok:false}`). Nếu parent không đổi được dễ, giữ 7.3 ở mức tối thiểu: chỉ set error khi `onSave` reject.

---

# PART E — Q3a: Import recovery (reject `failed`/`processing`)

### E1. Server — `src/app/api/config/imports/[id]/route.ts` (DELETE, dòng 124-160)
Hiện chặn `status !== "pending"`. Cho phép reject/đóng cả `failed` + `processing` (gỡ kẹt), 2-người rule chỉ áp cho `pending`.
```ts
// BEFORE (dòng 136-145)
  if (data.request.status !== "pending") {
    return NextResponse.json({ error: "Import request is not pending." }, { status: 400 });
  }
  if (
    data.request.submitted_by_email.trim().toLowerCase() !==
    admin.actor.email.trim().toLowerCase()
  ) {
    const approval = canApproveImport(data.request, admin.actor.email);
    if (!approval.ok) return NextResponse.json({ error: approval.error }, { status: 400 });
  }
```
```ts
// AFTER
  const REJECTABLE = new Set(["pending", "processing", "failed"]);
  if (!REJECTABLE.has(data.request.status)) {
    return NextResponse.json(
      { error: "Import request cannot be rejected in its current state." },
      { status: 400 }
    );
  }
  // 2-người: chỉ áp khi reject một request PENDING (giữ tính toàn vẹn duyệt).
  // failed/processing kẹt → bất kỳ config admin nào cũng được đóng để phục hồi.
  if (
    data.request.status === "pending" &&
    data.request.submitted_by_email.trim().toLowerCase() !== admin.actor.email.trim().toLowerCase()
  ) {
    const approval = canApproveImport(data.request, admin.actor.email);
    if (!approval.ok) return NextResponse.json({ error: approval.error }, { status: 400 });
  }
```
(Phần update `status:"rejected"` bên dưới giữ nguyên.)

### E2. Client — `src/app/(authed)/config/_components/ConfigClient.tsx` (ImportReviewSection, ~dòng 1099-1132)
Hiện nút Approve/Reject chỉ hiện khi `pending` (`const pending = request.status === "pending"`, dòng 1049). Cho hiện nút **"Close / Reject"** khi `failed` hoặc `processing` (không hiện Approve).
```ts
const pending = request.status === "pending";
const recoverable = request.status === "failed" || request.status === "processing"; // NEW
```
- Trong JSX: `{pending ? (<Approve/><Reject/>) : recoverable ? (<Reject label="Close"/>) : null}` — nút Reject gọi cùng endpoint DELETE (đã cho phép). Label có thể "Close" cho rõ nghĩa gỡ kẹt.

---

# PART F — Q4c: Import cấm đụng assignee khi *update*

File `src/app/api/config/imports/[id]/route.ts`, `applyTaskImportRow` (dòng 198-242).

- **Nhánh add (dòng 201-226): GIỮ NGUYÊN** (import tạo task mới được set 1 assignee).
- **Nhánh update (dòng 228-242):** (1) **bỏ** `assignee_email` khỏi patch update, (2) **bỏ** khối `syncImportedTaskAssignee`.
```ts
// BEFORE (dòng 228-242)
  if (!row.target_record_id) throw new Error("Update row is missing target_record_id.");
  const currentCustomValues = await fetchCurrentCustomValues("tasks", row.target_record_id);
  const { error } = await supabase
    .from("tasks")
    .update({
      ...systemPatch,
      custom_values: { ...currentCustomValues, ...customPatch },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.target_record_id);
  if (error) throw new Error(error.message);
  if ("assignee_email" in systemPatch) {
    await syncImportedTaskAssignee(supabase, row.target_record_id, systemPatch.assignee_email);
  }
}
```
```ts
// AFTER
  if (!row.target_record_id) throw new Error("Update row is missing target_record_id.");
  const currentCustomValues = await fetchCurrentCustomValues("tasks", row.target_record_id);
  // Team dùng đa-assignee (nhất là CS) → import KHÔNG được đổi assignee khi update
  // (tránh xoá nhầm người). Assignee đổi qua UI. Chỉ set assignee lúc *create*.
  const { assignee_email: _ignoredAssignee, ...updatePatch } = systemPatch;
  void _ignoredAssignee;
  const { error } = await supabase
    .from("tasks")
    .update({
      ...updatePatch,
      custom_values: { ...currentCustomValues, ...customPatch },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.target_record_id);
  if (error) throw new Error(error.message);
}
```
> `syncImportedTaskAssignee` vẫn dùng ở nhánh add → **không xoá** hàm đó.
> Tùy chọn: cân nhắc bỏ `assignee` khỏi `splitTaskValues` map cũng được, nhưng giữ để nhánh add dùng; strip ở update là đủ.

---

## 2. Verification (chạy sau khi code xong)

```bash
npx tsc --noEmit          # phải exit 0
npx vitest run            # phải xanh (thêm test A5, cập nhật test enrollment nếu chữ ký đổi)
npm run lint
```
- Test cần **cập nhật** vì đổi chữ ký: `access.test.ts` (enrollment — nếu import `canViewEnrollmentRecord` đã xoá thì sửa/bỏ các test đó), bất kỳ test nào gọi `fetchEnrollmentRecords(program, actor)`/`fetchEnrollmentRecordById(id, actor)`/`fetchEnrollmentOverview(program, actor)`.
- **Xoá** `permissions.test.ts` (D4).

## 3. Ghi changelog (bắt buộc — thêm vào đầu `Unreleased` của `changelog.md`)

```
## 2026-08-02 — CS company-wide view + Enrollment shared view + import fixes
- **Loại**: feat, security, refactor-logic
- **Cái gì**:
  - CS: plain-CS (không agent/không assistant) thấy TẤT CẢ task; agent/assistant giữ scope; manager không đổi. Default filter assignee=self (client đã có sẵn).
  - Enrollment: mọi worker thấy TẤT CẢ record (revert view-scope của batch); SỬA vẫn manager+stakeholder. Default filter responsible=self cho non-manager.
  - Import: reject/đóng được request `failed`/`processing` kẹt; cấm đổi assignee khi update (đa-assignee).
  - Fix: enrollment inline canEdit theo quyền; cache fetchTaskAssignees; DELETE log activity thay vì 500; xoá dead permissions.ts; person compare lowercase; save feedback cho custom cell.
- **Vì sao**: CS là hàng đợi chung công ty; enrollment dùng chung + filter tên để tập trung; gỡ kẹt import; tránh mất đa-assignee.
- **File**: lib/tasks/queries.ts, lib/tasks/assignees.ts, lib/enrollment/{access,queries,overview-data}.ts + 11 route enrollment, TaskBoardClient (không đổi), EnrollmentClient.tsx, config/imports/[id]/route.ts, ConfigClient.tsx, _shared/EditableCustomCell.tsx
- **Ảnh hưởng**: plain-CS + mọi enrollment worker giờ thấy dữ liệu rộng hơn (chủ ý). Mutate không đổi. KHÔNG đụng RBAC permission/role.
- **Ref**: docs/superpowers/plans/2026-08-02-view-model-and-batch-fixes.md · quyết định Q1–Q5 trong docs/2026-08-02-uncommitted-review-rbac.md
```

## 4. Thứ tự code đề xuất
1. **Part A** (CS server) → typecheck → test nhanh.
2. **Part B + C** (enrollment revert + default filter) → typecheck (sửa test chữ ký).
3. **Part D** (6 fix) → test.
4. **Part E + F** (import) → test.
5. Verify toàn bộ + ghi changelog.

## 5. Rủi ro cần để ý
- **Consistency plain-CS server↔client** (A2) — sai lệch = plain-CS thấy hết nhưng default filter không bật (hoặc ngược lại).
- **Enrollment revert bỏ sót 1 route** → route đó vẫn 403 với non-stakeholder (khó chịu). Rà đủ 11 route ở B4/B5.
- **7.3 (D6)** phụ thuộc `onPatch` có reject khi fail — nếu parent nuốt lỗi, cần chỉnh parent hoặc hạ mức 7.3.
- **KHÔNG** revert nhầm `canMutateEnrollmentRecord` và các select stakeholder ở PATCH/DELETE/attachments POST.
