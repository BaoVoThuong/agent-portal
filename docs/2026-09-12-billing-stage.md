# Thêm stage Billing, bỏ cột Cancel khỏi board

**Ngày:** 2026-09-12 · **Bản 2** (đã gộp 7 review comment của codex, mỗi điểm đều được xác minh lại bằng code)

**Yêu cầu:** thêm stage **Billing** nằm bên trái Done trên board; **bỏ cột Cancel** khỏi board.

**Đã chốt:**

1. **Billing là tuỳ chọn** — vẫn đi thẳng In Progress → Done được.
2. **Billing là "đang chạy", chưa xong** — vẫn đếm giờ, vẫn bị nhắc quá Due Date, không tính vào số liệu hoàn thành.
3. **Cancel vẫn là stage hợp lệ**, chỉ không có cột trên board.

4. **Billing tạm dừng SLA**, y hệt Waiting (§7).

---

## 1. Vì sao việc này lớn hơn vẻ ngoài

`status` không phải một cột dữ liệu bình thường mà là một enum được **liệt kê cứng ở chín nơi độc lập**, trong đó ba nơi TypeScript không kiểm được:

| Nơi | Kiểm bởi | Sai thì biểu hiện |
|---|---|---|
| `TASK_STATUSES` / `KANBAN_STATUSES` | TypeScript | Báo lỗi biên dịch ✅ |
| Ràng buộc `tasks_status_check` (×2 trong `schema.sql`) | Database | Ghi thất bại, có lỗi rõ ✅ |
| `task_stage_cycles.stage` check | Database | Ghi thất bại ✅ |
| **`patch_task_atomic`** (`schema.sql:3180`) | **Không ai** | ⚠️ **Bỏ qua im lặng** |
| **`create_task_atomic`** | **Không ai** | ⚠️ Bỏ qua im lặng |
| **`TASK_COLUMNS`** chuỗi select (`queries.ts:22`) | **Không ai** | ⚠️ Trường về `undefined` |
| `OPEN_STATUSES` (`overview.ts:40`) | TypeScript một phần | Task lặng lẽ biến mất khỏi báo cáo |
| `overview-data.ts:55` danh sách `.in("status", …)` | Không ai | Task biến mất khỏi báo cáo |
| `buildOptimisticTaskPatch` (`TaskBoardClient.tsx:2455`) | Không ai | Giờ hiển thị sai tới khi tải lại |

Ba dòng ⚠️ là lý do plan bản 1 chưa đủ: chúng **không báo lỗi**, chỉ âm thầm làm sai.

### Cơ chế đồng hồ

Mỗi stage có đồng hồ theo đúng một khuôn (`schema.sql:1425-1435`, `1506-1508`):

| Cột | Ý nghĩa |
|---|---|
| `<stage>_started_at` | Chỉ khác null **khi task đang ở stage đó**; xoá khi rời. |
| `<stage>_seconds` | Tổng tích luỹ của mọi lượt đã đóng. |

Mỗi lần đổi stage phải **gửi ngân hàng** số giây của stage đang rời rồi mới **mở** đồng hồ mới. Thiếu một vế là giờ công biến mất hoặc bị đếm hai lần.

Hiện có: `todo`, `in_progress`, `waiting`. Billing là cái thứ tư — và logic này tồn tại **ba bản song song** phải sửa cùng lúc: `transitions.ts` (nguồn), `patch_task_atomic` (SQL thực thi), `buildOptimisticTaskPatch` (client hiển thị tạm).

### Dữ liệu thật (đọc production 2026-09-12)

done 153 · waiting 29 · in_progress 14 · todo 1 · backlog 1 · **cancel 0**

`task_stage_cycles` không có lượt `cancel` nào; `task_notifications` không có cái nào loại `cancelled`.
→ Bỏ cột Cancel **không giấu mất task nào**, và không cần migrate dữ liệu.

---

## 2. Bước 1 — Database

### 1.1 Nới ràng buộc (3 chỗ)

- `tasks_status_check` — **định nghĩa hai lần** trong `schema.sql` (dòng 1330 inline và 1537 alter). Sửa sót một chỗ thì database dựng mới sẽ khác production, và lỗi chỉ lộ ra rất muộn.
- `task_stage_cycles.stage` check (dòng 1605).

Thêm `'billing'`, **giữ nguyên `'cancel'`**.

### 1.2 Hai cột đồng hồ

```sql
alter table tasks add column if not exists billing_started_at timestamptz;
alter table tasks add column if not exists billing_seconds integer not null default 0;
```

### 1.3 ⚠️ Hai atomic writer — phần dễ bỏ sót nhất

`resolveTaskPatch()` **không tự ghi database**. Nó chỉ dựng ra một object patch, rồi:

- `PATCH /api/tasks/[id]` → `patch_task_atomic`
- tạo task → `create_task_atomic`

`patch_task_atomic` **liệt kê từng cột một** (`schema.sql:3180-3183`):

```sql
todo_seconds = case when p_patch ? 'todo_seconds' then (p_patch->>'todo_seconds')::integer else todo_seconds end,
in_progress_seconds = case when p_patch ? 'in_progress_seconds' then … end,
waiting_started_at = case when p_patch ? 'waiting_started_at' then … end,
```

Nghĩa là nếu chỉ sửa `transitions.ts`, patch sẽ chứa `billing_seconds` — và **SQL lặng lẽ vứt nó đi**. Không lỗi, không cảnh báo, chỉ là giờ Billing luôn bằng 0.

Phải cập nhật:

- `patch_task_atomic`: thêm `billing_started_at` / `billing_seconds` vào khối SET, và thêm nhánh `when 'billing'` vào `old_started_at` / `next_started_at` (dòng 3313-3316) — chỗ quyết định mốc thời gian khi mở/đóng một lượt trong `task_stage_cycles`. Thiếu nhánh này thì lượt Billing lấy sai mốc.
- `create_task_atomic`: whitelist status, và insert `billing_*` nếu task được tạo thẳng vào Billing.

### 1.4 Backfill

Cập nhật khối backfill `task_stage_cycles` (`schema.sql:1644`) và khối tích luỹ `*_seconds` (dòng 1672) để biết tới billing. Cả hai idempotent.

---

## 3. Bước 2 — Enum, nhãn, và cột dữ liệu

```ts
// TASK_STATUSES: thêm "billing", GIỮ "cancel"
["backlog","todo","in_progress","waiting","billing","done","cancel"]

// KANBAN_STATUSES: thêm "billing" trước "done", BỎ "cancel"
["todo","in_progress","waiting","billing","done"]
```

- `STATUS_LABEL.billing`, `BOARD_COLUMN_LABEL.billing`.
- `TaskRow`: `billing_seconds`, `billing_started_at`.
- ⚠️ **`TASK_COLUMNS` và `TASK_COLUMNS_LEGACY`** (`queries.ts:22-25`) là hai chuỗi select viết tay. Không thêm `billing_started_at,billing_seconds` vào đó thì UI nhận `undefined` — TypeScript không cứu được vì chuỗi không được kiểm.

Sau bước này TypeScript sẽ tự chỉ ra phần lớn chỗ còn lại: mọi `Record<TaskStatus, …>` báo thiếu khoá.

---

## 4. Bước 3 — Ba bản logic đồng hồ

### 4.1 `transitions.ts` (nguồn sự thật)

- Thêm nhánh bank khi rời Billing và mở đồng hồ khi vào Billing, cạnh ba nhánh hiện có (dòng 229-246).
- `closed_at`: giữ cho `done`/`cancel`. Billing **không** đặt `closed_at`.
- Không thêm luật bắt buộc nào (Billing tuỳ chọn). Luật "phải qua In Progress mới Done" giữ nguyên.
- Từ Billing về In Progress/Waiting: cho phép, không cần lý do — chỉ Done/Cancel mới cần Reopen.

### 4.2 `patch_task_atomic` — xem §1.3

### 4.3 ⚠️ `buildOptimisticTaskPatch` (`TaskBoardClient.tsx:2455`)

Client tự mirror phần bank/mở đồng hồ để card cập nhật ngay khi kéo, trước khi server trả lời. Nó hiện chỉ biết To Do, In Progress, Waiting. Bỏ qua chỗ này thì card vừa kéo sang Billing sẽ **hiển thị giờ sai** cho tới khi tải lại — một lỗi rất khó báo cáo vì nó tự khỏi.

**Test bắt buộc:** đường kéo In Progress → Billing → Done, kiểm cả ba bản cho ra cùng kết quả.

---

## 5. Bước 4 — Bỏ cột Cancel khỏi board

### 5.1 ⚠️ `columnOf()` phải đổi

```ts
// KanbanBoard.tsx:71 — hiện tại
function columnOf(task: TaskRow): BoardColumn {
  if (task.status === "backlog") return "todo";
  return task.status;          // ← sau khi bỏ cancel, đây không còn là BoardColumn
}
```

Sau khi `cancel` rời `KANBAN_STATUSES`, `task.status` không còn gán được vào `BoardColumn`. Nếu ép kiểu cho hết lỗi thì task Cancel sẽ bị **map nhầm sang một cột khác** — tệ hơn là ẩn đi.

Đổi `columnOf` trả `BoardColumn | null`, `null` nghĩa là không thuộc cột nào; rà lại các nhánh kéo-thả và sắp xếp thủ công đang dùng nó.

### 5.2 Vẫn phải có lối xem

Board vẽ bằng cách duyệt từng cột (`KanbanBoard.tsx:97`), task không thuộc cột nào thì **không được vẽ, không lỗi**. Đó đúng ý, nhưng:

- **List view** lọc theo `TASK_STATUSES` (`TaskToolbar.tsx:173`) nên Cancel vẫn lọc được ✅ không phải sửa.
- Kéo thả **không còn đặt được Cancel** — phải làm từ List hoặc màn chi tiết.

---

## 6. Bước 5 — Overview, nhắc hạn, giao diện

### 6.1 ⚠️ Overview: Billing phải là "việc đang mở"

Nếu chỉ lo "không tính hoàn thành" thì Billing sẽ **biến mất khỏi mọi báo cáo** — không nằm trong nhóm đã đóng, cũng không nằm trong nhóm đang mở:

| Nơi | Hiện tại |
|---|---|
| `overview-data.ts:55` | `.in("status", ["backlog","todo","in_progress","waiting"])` |
| `overview-data.ts:60` | `.in("status", ["done","cancel"])` |
| `overview.ts:40` | `OPEN_STATUSES = ["todo","in_progress","waiting"]` |

Phải thêm `billing` vào nhóm **đang mở** ở cả ba, cộng `overview-types.ts` và ma trận stage trong `sorting.ts`. Nếu không, task Billing mất khỏi CS workload, work mix và gợi ý phân việc.

### 6.2 ⚠️ Nhắc "task ỉm" (stale) đang mâu thuẫn sẵn

- `isStale()` (`reminders.ts:34-39`) loại trừ `done`/`cancel`/`backlog` → **Billing được coi là có thể ỉm**.
- Nhưng cron lại chỉ truy vấn `todo` / `in_progress` / `waiting` → **Billing không bao giờ được quét**.

Hai bên nói khác nhau. Phải chọn một: thêm Billing vào truy vấn cron (nếu nó là stage làm việc bình thường), hoặc ghi rõ đây là ngoại lệ có chủ đích và viết test khoá lại. **Đề xuất: thêm vào**, cho nhất quán với quyết định "Billing là đang chạy".

Nhắc quá **Due Date** thì áp dụng bình thường cho Billing vì nó không nằm trong `TERMINAL_STATUSES` — không phải sửa gì.

### 6.3 Những nơi coi "kết thúc" — giữ nguyên, chỉ kiểm

`due-date.ts:79`, `filtering.ts:168`, `history.ts:55,76`, `overview.ts:313` đều dùng `done | cancel`. Giữ nguyên; việc cần làm là **kiểm** rằng Billing không lọt vào nhóm này.

### 6.4 Giao diện

- **Board**: cột mới tự hiện từ `KANBAN_COLUMNS`; chọn màu cho Billing.
- **List**: thêm `billingTime` (`task-list-columns.ts:25-27`, `sorting.ts:30-32,197`) — kèm renderer, bề rộng cột, và hàm lấy giá trị sắp xếp.
- **Màn chi tiết**: thêm Billing vào `StageTimeBreakdown.tsx` và điều kiện hiển thị trong `TaskDetailDrawer`.
- **Cấu hình cột**: seed một dòng `table_column` hệ thống cho cột giờ mới, để admin bật/tắt/sắp xếp được như các cột khác.

---

## 7. SLA: Billing tạm dừng, y hệt Waiting — ĐÃ CHỐT

SLA **chỉ chạy khi ở In Progress**. Rời In Progress là `in_progress_seconds` được
gửi ngân hàng và đồng hồ SLA dừng; quay lại thì đếm tiếp từ phần đã tích luỹ.

Billing đi theo đúng khuôn đó: vào Billing thì SLA tạm dừng, quay về In Progress
thì đếm tiếp. Giống hệt Waiting đang làm.

**Không phải sửa gì cho phần này** — cơ chế hiện tại đã đúng, chỉ cần Billing có
đủ hai cột đồng hồ và các nhánh bank/mở ở §4. Nhưng phải **viết test khoá lại**:
In Progress (10 phút) → Billing (1 giờ) → In Progress → Done, và khẳng định SLA
chỉ tính 10 phút cộng phần In Progress sau đó, không tính 1 giờ ở Billing.

## 8. Kiểm chứng

- To Do → In Progress → Billing → Done: `billing_seconds` cộng đúng, `billing_started_at` bị xoá khi rời. **Kiểm trong database**, không chỉ trên màn hình — đây là chỗ `patch_task_atomic` có thể nuốt mất.
- Kéo In Progress → Billing: giờ trên card đúng **ngay lập tức** (bản optimistic) và vẫn đúng sau khi tải lại (bản server).
- Kéo thẳng In Progress → Done: vẫn được.
- Task ở Billing: có trong Overview phần **đang mở**; **không** có trong số liệu hoàn thành; vẫn bị bôi đỏ nếu quá Due Date.
- Đặt Cancel từ List: rời board, vẫn tìm được bằng bộ lọc; **không** bị hiện nhầm ở cột khác.
- `npx vitest run` — đặc biệt `transitions.test.ts` (17KB, viết riêng cho phần đồng hồ này), `sorting.test.ts`, `overview.test.ts`.

## 9. Thứ tự triển khai

1. **Chạy rollout SQL trước.** Nó chỉ nới ràng buộc và thêm cột — code cũ không sinh ra `billing` nên chạy trước là an toàn.
2. Deploy code.
3. Không có bước migrate dữ liệu.

## 10. Một điều về quy trình

Bỏ cột Cancel nghĩa là **không còn đặt Cancel bằng kéo thả**. Nếu đội vẫn huỷ task thường xuyên, cân nhắc thêm một hành động "Huỷ task" rõ ràng ở màn chi tiết thay vì để người dùng tự tìm trong dropdown trạng thái.

---

## 11. Trạng thái hiện thực — 2026-09-12

Kế hoạch trên đã code xong. Ghi lại những chỗ **lệch hoặc thêm** so với bản kế hoạch:

**Thêm `billing_reminded_at`.** Kế hoạch §1.2 chỉ nói hai cột đồng hồ. Đã thêm cột
thứ ba cho đủ bộ như waiting. **Chưa nối cron** — loại nhắc riêng "nằm Billing quá
N giờ" vẫn là câu hỏi còn treo; cột có sẵn để sau này khỏi migrate lần nữa.

**Rollout trích thân hàm, không gõ tay.** §1.3 lo hai atomic writer trôi lệch với
`schema.sql`. Cách làm: sửa `schema.sql` trước, rồi trích nguyên văn hai hàm sang
`supabase/rollouts/2026-09-12-billing-stage.sql` bằng `sed`. Hai file không thể
khác nhau. Rollout có thêm truy vấn đọc ngược `pg_get_functiondef()` trên database
để xác nhận thân hàm đang chạy thật sự có cột billing — đây là chốt chặn cho đúng
kiểu lỗi mà §1.3 cảnh báo (SQL vứt cột đi mà không báo gì).

**Guard SLA trong SQL phải sửa thêm 3 chỗ** mà kế hoạch chưa liệt kê. Ngoài các
nhánh `when 'billing'`, ba điều kiện `waiting_started_at is null and waiting_seconds = 0`
(hai trong khối `fallback-close`, một ở `next_sla_active`) đều phải nhân đôi cho
billing — nếu không, task quay lại In Progress sau Billing sẽ được cấp `due_at`
mới và bị báo quá hạn oan. Đây chính là hệ quả của quyết định ở §7.

**`hasEnteredWaiting` đổi tên thành `hasBeenParked`.** Một vị từ cho cả hai chặng
đỗ, thay vì hai hàm gần giống nhau rồi có ngày lệch. Kéo theo `bankWaitingSeconds`
→ `bankParkedSeconds`.

**Sửa kèm một lỗi có sẵn ngoài phạm vi kế hoạch.** Hai route assignee đổi status
task về Backlog khi gỡ hết người, nhưng không hạ đồng hồ chặng — `waiting_started_at`
treo lại trên task đã rời Waiting, nên số giờ Waiting hiển thị phình mãi. Đã thêm
`bankParkedStageOnLeave()` và gọi ở cả hai route, sửa cho **cả Waiting lẫn Billing**:
thả chặng mới vào đúng cái bẫy cũ thì vô lý. Đây là thay đổi hành vi cho Waiting,
nằm ngoài phạm vi ban đầu — cần biết khi đọc lại.

**Cột list theo chặng:** không thêm `billingTime`/`billingStarted`. Lý do: các key
`todoTime`/`waitingTime`... tuy còn trong `KnownTaskListColumnKey` và có code render,
nhưng **không** nằm trong `TASK_LIST_COLUMNS`, nên `taskListColumnsFromConfig()`
lọc chúng ra hết — chúng là code chết. Thêm cột billing vào đó chỉ là thêm code
chết nữa. Thời gian Billing hiện ở `StageTimeBreakdown` (drawer), nhãn hàng list,
và thẻ board.

**Kiểm chứng đã chạy** (Node 22 — Node 18 trên máy này quá cũ cho Next 16 và làm
28 test lỗi vì thiếu `File`/`crypto.randomUUID`):

- `tsc --noEmit` — sạch
- `eslint` — 0 lỗi (2 cảnh báo có sẵn từ trước)
- `vitest run` — **154 file / 1243 test pass**, gồm các regression test SLA
  cho Billing
- `next build` — thành công

Test quan trọng nhất là `pauses the SLA across In Progress -> Billing -> In Progress -> Done`
trong `transitions.test.ts`. Nó có **assertion đối chứng** ở đầu (SLA đang chạy
thật trước khi đỗ) — không có nó thì test vẫn xanh kể cả khi Billing chẳng dừng
SLA gì cả, vì `isSlaActiveInProgress` cũng đọc `overdue_count` và fixture thiếu
trường đó sẽ luôn trả false.

**Chưa làm:** chạy rollout trên production (`supabase/rollouts/2026-09-12-billing-stage.sql`),
và quyết định về nhắc riêng cho Billing.

### Review follow-up [codex]

- [codex] Lượt kiểm cuối sau các sửa review: `tsc --noEmit`, `eslint` (0 error,
  2 warning có sẵn), `vitest run` (**154 file / 1244 test**) và `next build` đều xanh.
- [codex] `check-overdue` chỉ nạp marker Waiting khi quét task In Progress.
  Sau `Billing → In Progress`, `hasBeenParked()` vì thế nhận object thiếu
  `billing_started_at` / `billing_seconds` và có thể mở lại SLA trên cron.
  Đã bổ sung cả hai cột vào query + kiểu dữ liệu, đồng thời thêm regression
  test cho `isSlaActiveInProgress`, `isTaskOverdue` và `currentStintDueAt`.
- [codex] Semantics đã chốt: Billing là Waiting cụ thể hơn. Cùng `waitingHours`,
  cùng notification và cùng parked-stage attention; chỉ giữ nhãn/cột riêng để
  phân biệt loại chờ. `billing_reminded_at` là marker riêng để đổi Waiting ↔
  Billing bắt đầu một chu kỳ nhắc mới, không gửi trùng.
