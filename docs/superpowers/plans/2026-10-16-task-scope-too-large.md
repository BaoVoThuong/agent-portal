# Sửa lỗi `TaskScopeTooLargeError` ở `/tasks` — điều tra và plan

> **Trạng thái:** lỗi đã sửa theo hướng §2, qua plan `2026-10-16-task-scope-in-sql.md` (code
> `eef54d5`, rollout `29c1b7d`, deploy production 2026-10-16). **P3 (đồng bộ search) chưa làm.**
> Phần dưới là bản điều tra ban đầu, giữ nguyên.

## 1. Kết luận điều tra

Ảnh cho thấy `TaskScopeTooLargeError` với **6.246 byte, 155 ID** ở
`fetchTasksForActor` (`src/lib/tasks/queries.ts:160-168`). Code đặt ngưỡng
`SCOPE_FILTER_MAX_BYTES = 6_000`. Với actor bị giới hạn phạm vi, nó lấy toàn bộ
`task_assignees.task_id` và `task_participants.task_id` theo email, ghép UUID vào hai mệnh đề
`id.in.(...)` của một chuỗi PostgREST `.or(...)`, đo byte rồi ném lỗi **trước khi query tasks**.
`155` là tổng độ dài hai danh sách, chưa khử trùng giữa chúng; không phải số task đang mở.

Đường lỗi:

1. `src/app/(authed)/tasks/page.tsx:51` gọi `fetchTasksForActor(actor)` trong `Promise.all`.
2. `resolveTaskQueueScope` trả `seesAllTasks = false` cho Agent/Assistant; manager và CS thường
   không dựng chuỗi scope này (`src/lib/tasks/membership.ts:119-136`). Ảnh chứng minh actor đang đi
   nhánh scoped, nhưng không đủ dữ liệu để xác định tài khoản hoặc tỷ lệ assigned/participant.
3. `buildWorkerTaskOrs` (`queries.ts:475-506`) ghép email, Agent và hai tập UUID. 6.246 > 6.000
   nên lỗi làm cả Server Component `/tasks` không render. Nhãn “stale Turbopack” chỉ là thông tin
   môi trường dev, không phải nguyên nhân.
4. Cùng helper được dùng bởi `GET /api/tasks` (map lỗi thành 503 `TASK_SCOPE_TOO_LARGE`) và export
   (chưa map lỗi này, có thể thành 500). Search không dùng helper nhưng cũng tải toàn bộ hai tập ID
   để lọc sau (`src/lib/tasks/search.ts:330-338`), nên có rủi ro cùng loại khi dữ liệu tăng.

Đây là **giới hạn thiết kế đã biết**, không phải query database hỏng. Đợt phân trang trước cố ý
fail closed để tránh hai kết quả sai: URL vượt giới hạn gateway, hoặc bỏ scope rồi lấy tối đa 5.000
task toàn công ty khiến task hợp lệ nằm ngoài 5.000 dòng và biến mất khỏi bảng. Changelog và
`docs/superpowers/plans/2026-09-04-task-list-pagination.md` gọi việc chuyển scope xuống SQL là
**Phase B0**, hiện chưa có `task_ids_visible_to`/RPC tương đương trong schema.

Nâng ngưỡng 6.000 chỉ trì hoãn lỗi. Xoá ID cũ, đổi người này thành CS thường/manager, bỏ `.or`,
hoặc cắt danh sách ID đều thay đổi quyền xem hoặc làm thiếu task; không dùng làm bản sửa.

## 2. Hướng sửa được chọn

**Áp phạm vi trong PostgreSQL trước `ORDER BY id`, phân trang keyset, `COUNT` và giới hạn
`TASK_MAX_ROWS`.** Không chuyển danh sách UUID lịch sử qua URL hoặc trả danh sách UUID từ RPC rồi
đưa lại vào `.in(...)`.

Giữ nguyên hai kiểu actor:

- Manager và CS thường (`seesAllTasks = true`): giữ đường query hiện tại, toàn bộ task chưa archive.
- Agent/Assistant (`seesAllTasks = false`): query có predicate tương đương chính xác với code hiện
  tại, trên `tasks.archived_at is null`:
  - `tasks.assignee_email = actor.email` (cột legacy);
  - `tasks.agent_email = actor.email`;
  - `tasks.reporter_email = actor.email`;
  - `EXISTS task_assignees(task_id, email = actor.email)`;
  - `EXISTS task_participants(task_id, email = actor.email)`;
  - `tasks.agent_email` thuộc `scope.agentEmails` do `resolveTaskQueueScope` trả về.

Dùng `EXISTS` để mỗi task xuất hiện một lần dù người xem có nhiều quan hệ. `actor.email` và
`scope.agentEmails` chỉ lấy từ session + server resolver, không nhận từ browser. Next vẫn gác
`task.work`/`task.manage`; SQL RPC chỉ cấp `EXECUTE` cho `service_role`. Giữ `canViewTask` sau khi
enrich như lớp kiểm tra thứ hai; SQL phải trả cờ `viewer_is_participant` cho từng task, còn
`attachAssigneesToTasks` cung cấp assignee của trang đó. Không tiếp tục tải *mọi* assigned/
participant ID lịch sử vào Node chỉ để post-filter.

RPC cần hai thao tác dùng chung **một predicate**: (a) đếm số task thấy được ở trang đầu;
(b) trả tối đa 1.000 task với `id > afterId`, sắp `id` tăng dần. Hàm page trả đúng cột mà
`TASK_COLUMNS` cần cùng `viewer_is_participant`. Tách count và page hoặc gom vào một response đều
được nếu kiểm chứng không tính count lại trên từng trang và không materialize toàn bộ task để lấy
một trang. Không dùng offset. Giữ `TASK_MAX_ROWS = 5_000` và cờ `truncated`; export vẫn từ chối khi
truncated. Đo `EXPLAIN (ANALYZE, BUFFERS)` trước khi chọn dạng SQL cuối.

**Không sao chép B0 cũ nguyên xi:** ví dụ `task_ids_visible_to` chỉ trả ID, các nhánh `UNION` của
`task_assignees`/`task_participants` không tự lọc task archived, và ghi chú “thiếu index
`task_participants(email)`” đã cũ: `supabase/schema.sql:3082` hiện có index đó. Dùng nó làm bối cảnh,
không làm SQL rollout.

## 3. Kế hoạch triển khai

### P0 — Chốt baseline và kiểm thử hiện trạng (không đổi DB)

- Thêm test tái hiện actor scoped có hơn 155 ID: code hiện tại ném
  `TaskScopeTooLargeError` trước khi gọi bảng `tasks`. Test tách assigned/participant, trùng ID,
  và giải thích `idCount` không phải số task còn active.
- Ghi số lượng theo từng nguồn, byte filter và loại actor vào log server ở mức tổng hợp; không log
  email, UUID hay nội dung task. Xác nhận từ tài khoản test Agent và Assistant. Không cần dữ liệu
  production để chứng minh nguyên nhân; nếu muốn đối chiếu tài khoản trong ảnh thì cần truy vấn
  chỉ đọc được user đồng ý.

### P1 — Rollout SQL additive trước code

- Tạo `supabase/rollouts/2026-10-16-task-visible-page.sql` và file `.rollback.sql`. Thêm RPC
  đếm/trả trang scoped theo hợp đồng §2; giới hạn `p_limit` trong SQL và từ chối email rỗng.
  Dùng tên RPC riêng, không thay signature function đang chạy.
- `SECURITY DEFINER` có `search_path` cố định; revoke khỏi `PUBLIC`, `anon`, `authenticated`, grant
  `EXECUTE` chỉ cho `service_role`. Đưa định nghĩa vào `supabase/schema.sql` phía trên ACL sweep.
- Tạo fixture SQL/transaction rollback so sánh tập ID với predicate cũ: Agent, Assistant nhiều
  Agent, assignee junction, assignee legacy, participant, reporter, task archived, task khớp nhiều
  nhánh, account không có task. Kiểm trang đầu/cuối, count và không trùng ID.
- Đo plan trên dữ liệu đại diện 1.000–5.000 task và nhiều assignment/participant. Schema đã có
  `tasks_assignee_idx`, `tasks_agent_email_idx`, `task_assignees_email_idx`,
  `task_participants_email_idx`; chỉ thêm index mới nếu `EXPLAIN` cho thấy cần, nhất là nhánh
  `reporter_email` chưa thấy index riêng trong schema.
- Sau khi được phép rollout: chạy SQL, kiểm quyền EXECUTE và reload schema PostgREST; code cũ vẫn
  dùng query cũ trong cửa sổ deploy.

### P2 — Chuyển board/API/export sang SQL scope

- Trong `src/lib/tasks/queries.ts`, chỉ nhánh scoped gọi RPC mới. Giữ
  `fetchAllByKeyset`, count trang đầu, retry transient, enrichment và cờ `truncated`. Bỏ
  `fetchAssignedTaskIdsForEmail`/`fetchParticipantTaskIds` toàn lịch sử trên đường board.
- Nhánh legacy `TASK_COLUMNS_LEGACY` phải dùng cùng SQL scope hoặc chỉ được gỡ sau khi xác nhận
  mọi DB đích có `custom_values`; không fallback sang query không scope hoặc `.or` cũ.
- Sau khi mọi đường list không còn dùng guard, gỡ `SCOPE_FILTER_MAX_BYTES`,
  `TaskScopeTooLargeError` và mapping 503 đặc thù ở `/api/tasks`. Lỗi RPC/schema-cache phải lộ rõ
  và fail closed, không tự chuyển sang query toàn công ty.
- Test code: >155 ID không tạo URL dài; mọi trang giữ đúng phạm vi; count/truncated đúng khi vượt
  5.000; task assigned/participant cũ vẫn thấy; task ngoài phạm vi không bao giờ tới client;
  manager/CS thường không đổi; export chỉ tạo file khi tập nhìn thấy đã tải đủ.
- Kiểm thủ công `/tasks`, refetch `/api/tasks`, export bằng tài khoản test Agent/Assistant; sau đó
  kiểm dashboard của tài khoản bị lỗi khi có quyền truy cập phù hợp. `npx tsc --noEmit`, vitest
  tập tasks, eslint. Ghi changelog.

### P3 — Đồng bộ search cùng nguồn quyền

- `runTaskSearch` còn dùng hai danh sách ID toàn lịch sử. Đổi sang kiểm assignment/participant
  theo **candidate task IDs của từng trang search**, hoặc dùng chung SQL predicate/flag đã có;
  giữ `MAX_SEARCH_SCAN` và giới hạn nhóm kết quả. Kiểm search, board và detail cho cùng fixture
  trả quyền xem thống nhất khi một người có hơn 1.000 assignment/participant.

## 4. Tiêu chí hoàn thành và rollback

- Ảnh lỗi 6.246 byte/155 ID không còn làm `/tasks` sập; test với tập lớn hơn vẫn không dựng
  `id.in.(...)` cho lịch sử assignment/participant.
- Không có task ngoài phạm vi ở bất kỳ trang nào; không có task hợp lệ bị thiếu vì trần URL hoặc
  vì lọc sau giới hạn 5.000 dòng. Banner/truncated và quy tắc export giữ nguyên.
- SQL scope có plan đo được và không làm tải trang scoped tăng quá ngân sách hiện tại; nếu chậm,
  tối ưu predicate/index theo `EXPLAIN` trước khi deploy code.
- Deploy SQL trước code. Nếu code có vấn đề, revert code trước; rollback SQL chỉ sau khi không còn
  caller RPC. Rollback đưa về guard cũ nên lỗi có thể tái xuất hiện, nhưng không mở rộng quyền hoặc
  trả bảng thiếu âm thầm. Không chạy SQL production trong bước lập plan này.

**Giới hạn kết luận:** chưa có log hoặc dữ liệu của tài khoản trong ảnh, nên không khẳng định 155 ID
đến từ assignment hay participant, hoặc task nào còn active. Stack trace và code đủ để xác định
đường gây lỗi và ngưỡng kích hoạt.
