# Code review tổng hợp nhánh `feat/authz`

Ngày review: 2026-09-26. Snapshot `6bbeb69`, so với `main` tại merge-base `6aefde0`: 233 file, 15.694 dòng thêm / 2.967 dòng xóa, gồm Phase A–H và 8 commit sửa sau review. Tôi đối chiếu diff, các review từng phase, luồng API → policy → truy vấn → UI → notification → SQL và code tại HEAD. Các tài liệu review A–H chưa commit trong worktree được dùng làm đầu vào đối chiếu, **không** tính là code của nhánh.

## Kết luận

Lớp quyền hiện đã có catalog action/scope, principal suy grant từ role, guard backend, policy theo domain, registry điều hướng, kiểm người nhận thông báo và RPC quản trị nguyên tử. Các bản vá sau H thực sự khép một số lỗi A–C. Tuy nhiên, **chưa nên coi nhánh đã sẵn sàng bật role/scope tùy chỉnh rộng rãi hoặc dùng dry-run H làm cổng deploy**. Các lỗi phạm vi Task/Enrollment, import theo ID, định danh hoa hồng theo alias, Web Push, ACL RPC và completeness của migration vẫn còn trên HEAD. Tôi tìm thêm một đường mở rộng quyền đọc Task khi roster vượt giới hạn trả trang.

## Phát hiện ưu tiên cao

### [sol5.5] P1-01 — Roster bị cắt trang có thể biến Agent thành CS thấy toàn bộ Task

`src/lib/tasks/assignees.ts:37-42` tải **toàn bộ** `task_agents` bằng một `.select("email")` không phân trang/count. `resolveTaskQueueScope` lấy tập này để xác định người đang là Agent; nếu không có email trong tập và không có assistant relation, grant `task.read:shared_queue` làm `seesAllTasks=true` (`src/lib/tasks/membership.ts:103-123`). `fetchTasksForActor` khi đó bỏ mệnh đề lọc scope (`src/lib/tasks/queries.ts:138-168`). Một Agent nằm sau giới hạn hàng trả về của PostgREST, nhưng đang giữ grant `shared_queue` như role `task.work` tương thích (`src/lib/authz/compat.ts:59-64,94-100`), sẽ được đối xử như CS thường và thấy Task toàn công ty. Bộ lọc notification lặp lại lỗi: `loadViewers` đọc roster không phân trang (`src/lib/notifications/audience.ts:71-85`), `viewerSeesTask` dùng sự vắng mặt đó để bật `seesAllTasks` (`:176-184`). **Điều kiện:** roster lớn hơn giới hạn response thực tế; chưa có bằng chứng production đã tới ngưỡng.

**Sửa:** kiểm Agent theo email cụ thể trong policy request; với xử lý hàng loạt, phân trang roster và chứng minh đọc đủ trước khi suy “không phải Agent”. Nếu tính đầy đủ không xác minh được, từ chối `shared_queue`. Test roster vượt một trang, đặt Agent đang giữ `task.read:shared_queue` ở trang sau, kiểm cả Task list/detail và notification audience.

### [sol5.5] P1-02 — Scope `agent_owned` và `assistant_for_agent` vẫn bị gộp ở các action ghi

`src/lib/tasks/access.ts:103-105` bật cùng lúc hai fact từ một boolean; `canCreateTaskWithScope`, QC, assign, delete và activity dùng fact này (`:122-126,156-167,224-230`). Route DELETE truyền `isAgentOwnerOrAssistant` vào `canDeleteTask` (`src/app/api/tasks/[id]/route.ts:691-699`), nên Assistant có `task.delete:agent_owned` nhưng không có `task.delete:assistant_for_agent` vẫn qua guard cho Task của Agent. Enrollment có cùng lỗi trong `src/lib/enrollment/policy.ts:65-76,85-114`; PATCH record truyền boolean gộp (`src/app/api/enrollment/[id]/route.ts:133-154`). Đây là [D P1-01](./2026-09-26-authz-phase-d-code-review.md) còn nguyên trên HEAD.

**Sửa:** truyền agent email và relation Assistant tách biệt vào mọi policy, kể cả capability UI; test role chỉ giữ từng scope trên API thật.

### [sol5.5] P1-03 — `enrollment.import` vẫn ghi theo ID mà không kiểm scope của từng record

`src/app/api/enrollment/import/route.ts:98-108` chỉ đòi mở module và grant `enrollment.import`; đường update lấy ID từ payload rồi `.update(...).eq("id", recordId).eq("program", program)` qua service role (`:143-146,235-255`). Không có `loadScopedEnrollmentRecord`, quyền `enrollment.content.update`/`fields.update`, hay kiểm trạng thái/tác động theo từng record. Role tùy chỉnh có `enrollment.read:reported` + `enrollment.import:*` có thể ghi đè record ngoài scope nếu biết UUID. Chính `src/lib/table-config/export-access.ts:21-24` ghi rõ lỗ hổng. Đây là [D P1-02](./2026-09-26-authz-phase-d-code-review.md) chưa được vá.

**Sửa:** chặn tạm bằng bundle quản trị `read:all` + quyền ghi phù hợp; đích đúng là dùng chung policy record và transaction/audit với PATCH, kiểm mọi ID trước mutation.

### [sol5.5] P1-04 — Alias hoa hồng có thể tái cấp, mở dữ liệu lịch sử của người khác

`set_commission_name_atomic` cho xóa/đổi alias rồi cấp lại alias cũ cho account khác (`supabase/rollouts/2026-09-29-authz-phase-d.sql:62-81`); unique index chỉ bảo vệ alias **hiện tại** (`:26-37`). Truy vấn Registration/Agent Dashboard/AI vẫn dựa vào tên lấy từ mapping hiện tại (`src/lib/agent-identity.ts:29-56`), còn quyền sửa entry so `selected_agent` cũ với alias hiện tại (`src/app/api/entries/[id]/route.ts:83-102`; P&C tương đương). A đổi alias `ANN` sang tên khác, B được cấp `ANN` sẽ thấy/sửa entry lịch sử của A. `fetchScopeAgentName` còn fallback sang tên hiển thị khi gặp `PGRST200/205` (`src/lib/agent-identity.ts:23-51`). Đây là [D P1-03/P2-04](./2026-09-26-authz-phase-d-code-review.md), không được các commit review-fixes giải quyết.

**Sửa:** khóa alias không thể tái cấp khi còn record tham chiếu, hoặc chuyển entry sang `agent_account_id` bất biến và migrate dữ liệu; bỏ fallback schema sau rollout D. Test alias A → đổi/xóa → cấp cho B.

### [sol5.5] P1-05 — Web Push `unassigned` vẫn đưa tiêu đề Task cho người vừa mất quyền

`src/lib/tasks/notifications.ts:93-124` miễn `unassigned` khỏi kiểm quyền xem; route bỏ assignee gửi event này sau mutation (`src/app/api/tasks/[id]/assignees/[email]/route.ts:133-145`). Chuông có thể rút gọn lúc đọc, nhưng push dispatch vẫn tải `tasks.title` và đưa vào payload (`src/lib/notifications/push-dispatch.ts:133-160`; `src/lib/notifications/push-server.ts:214-228`). Người đã mất mọi quan hệ với Task vẫn nhận tiêu đề, có thể chứa thông tin khách hàng, trên thiết bị. Đây là [F P1-01](./2026-09-26-authz-phase-f-code-review.md) còn mở. Ngoài ra recipient được kiểm tại insert nhưng push chạy sau response; chưa kiểm lại scope ngay trước gửi.

**Sửa:** payload `unassigned` chỉ chứa thông báo chung, không có title/ID/URL dẫn tới dữ liệu; hoặc chốt entitlement tối thiểu riêng cho event. Test luồng bỏ assignee tới payload push thực.

### [sol5.5] P1-06 — ACL `assign_unassigned_task` trên production chưa được migration G khóa

`supabase/rollouts/2026-09-30-authz-phase-g.sql:15-57` thay `SECURITY DEFINER` RPC, bỏ kiểm grant trong SQL và tin route `src/app/api/tasks/[id]/assign/route.ts:43-72`; cuối rollout chỉ thu hồi `EXECUTE` cho bốn RPC mới (`:288-295`), không thu hồi của `assign_unassigned_task`. `2026-10-02-authz-review-fixes.sql` cũng không sửa ACL này. Fresh `schema.sql` có sweep bảo vệ, nhưng workflow DB dựng schema sạch trước rollout (`.github/workflows/db-persistence-gate.yml:45-71`), nên không kiểm ACL còn lại trên DB nâng cấp. **Nếu** ACL cũ cho `anon`/`authenticated` gọi RPC, họ có thể bỏ qua guard route và tự truyền `p_actor_email`; chưa có bằng chứng ACL production đang mở. Đây là [G P1-01](./2026-09-26-authz-phase-g-code-review.md) còn mở có điều kiện.

**Sửa:** `REVOKE ALL ... FROM PUBLIC, anon, authenticated` và `GRANT EXECUTE ... TO service_role` ngay trong rollout nâng cấp; đọc ACL production trước/sau và test nâng cấp từ DB có ACL cũ mở.

### [sol5.5] P1-07 — Chuyển dữ liệu H có thể báo hoàn tất khi chưa đọc đủ account/role

`scripts/authz-migrate-role-grants.ts:42-55` lấy role và account active bằng hai truy vấn không phân trang; `fetchRoleRows` cũng chỉ gọi một `.select()` (`src/lib/authz/principal.ts:79-85`). `--apply` chỉ chuyển tập đã nhận rồi return 0 (`scripts/authz-migrate-role-grants.ts:99-124`), trong khi role chưa chuyển bị runtime cấp **0 grant** (`src/lib/authz/principal.ts:114-116,160-168`). Script cũng không so inactive account trước ngày mở lại, không bắt buộc hai `system_key` có mặt, và `diffDecisions` chưa bao trùm mọi action; xem [H review](./2026-09-26-authz-phase-h-code-review.md). Commit `8e328f5` đã thêm assert key vào **rollout C**, nhưng không biến dry-run H thành kiểm đủ dữ liệu nếu C đã chạy từ trước hoặc bước C bị bỏ qua.

**Sửa:** phân trang + đối soát count cho role, account active/inactive và relation; assert key hệ thống/active admin; so tập grant đầy đủ; hậu kiểm DB `roles_not_converted = 0` bằng exit code trước deploy.

## Phát hiện mức P2 và lệch trải nghiệm

| ID | Luồng còn lệch tại HEAD | Hướng sửa |
|---|---|---|
| [sol5.5] P2-01 | `fetchGrantHolders` (`src/lib/authz/holders.ts:32-57`) và Account Manager (`src/app/(authed)/account-manager/page.tsx:36-45`) không phân trang; picker, recipient, user count có thể thiếu account. | Phân trang, kiểm completeness; test vượt giới hạn PostgREST. |
| [sol5.5] P2-02 | `task.queue.member` một mình đưa người vào workload (`src/lib/tasks/overview-data.ts:154-180`), nhưng route assign đòi xuất hiện trong `fetchTaskAssignees`, vốn cần `task.read` (`src/app/api/tasks/[id]/assign/route.ts:50-69`; `src/lib/tasks/assignees.ts:56-78`). | Một policy eligibility cho workload, picker, route và RPC; test queue-only/read-only. |
| [sol5.5] P2-03 | Task Export vẫn gọi `loadEnrollmentActor` trước khi xét `task.export` (`src/app/api/tasks/export/route.ts:42-64`); role chỉ có Task bị 403. | Dùng TaskActor + Task scope, test không có Enrollment grant. |
| [sol5.5] P2-04 | Lead drawer suy `canEdit`/`canLog` từ scope **đọc** (`src/app/(authed)/tasks/leads/_components/LeadDetailDrawer.tsx:333-357`) dù backend tách `lead.update`/`lead.interaction.log` (`src/lib/leads/access.ts:148-170`). Registry `/config` cũng thiếu `provider.update` dù page cho vào (`src/lib/authz/navigation.ts:63-67`; `src/app/(authed)/config/page.tsx:68-89`). | Tính capability từ action đúng và đồng bộ navigation/page. |
| [sol5.5] P2-05 | Người được chọn nhận tin Time Off có thể không xem nội dung: recipient lấy `managerEmail` bất kể grant (`src/lib/time-off/notifications.ts:55-75`), read policy chỉ cho requester hoặc `timeoff.manage` (`src/lib/notifications/read-access.ts:57-83`). Dòng Task/Enrollment đã redacted vẫn trả `entity_id`, `type`, `actor_email` (`src/app/api/tasks/notifications/route.ts:414-428`). | Chốt entitlement thông tin tối thiểu và trả DTO rút gọn thật sự. |
| [sol5.5] P2-06 | `task.read`/`enrollment.read` vẫn đủ để POST comment và Task mention có thể thêm participant (`src/app/api/tasks/[id]/comments/route.ts:111-157`; `src/app/api/enrollment/[id]/comments/route.ts:50-82`). | Quyết định rõ read có bao gồm comment/mention; nếu không, thêm action ghi riêng. |
| [sol5.5] P2-07 | `remove_task_agent_atomic` chỉ chụp assistant trước khi gọi hàm cũ xóa mọi membership (`supabase/rollouts/2026-09-30-authz-phase-g.sql:217-225`; `supabase/schema.sql:4224-4249`); các RPC cũ còn có thể mutate ngoài wrapper audit. | Audit toàn bộ row bị xóa, dồn mutation vào primitive bắt buộc audit. |
| [sol5.5] P2-08 | Gate “không còn so tên role” chỉ là test regex giới hạn (`src/lib/authz/no-role-name-checks.test.ts:15-85`), trong repo không có workflow chạy `npm run test:run` khi `src/**` đổi; DB workflow chỉ chạy PR đổi `supabase/**` (`.github/workflows/db-persistence-gate.yml:9-14`; `package.json:5-12`). | Bổ sung CI cho authz TS/test và gate AST/SQL; kiểm negative fixtures. |
| [sol5.5] P2-09 | Decision diff H chỉ so danh sách quyết định thủ công, thiếu `notify.enrollment.escalation` (`src/lib/authz/decision-diff.ts:193-219`; catalog `src/lib/authz/catalog.ts:219-229`); script D đọc một trang và có đường `--json` return trước exit code (`scripts/authz-decision-diff.ts:32-38,70-86`). | So grant set/action coverage và resource facts; exit nonzero khi mismatch chưa duyệt, kể cả JSON. |

## Những điểm đã sửa sau Phase H

| Vấn đề review cũ | Kiểm trên HEAD |
|---|---|
| Cookie cũ thiếu `accountId` có thể gắn sai account | `src/auth.ts:147-148` kết thúc phiên theo `src/lib/auth/token-access.ts:39-50` (`125630c`). |
| Trần ủy quyền không hiểu `all` và bản chiếu permission cũ nới quyền | `src/lib/authz/delegation.ts:26-35,59-78` đã xét scope và chỉ chiếu key có luật cũ nằm trong grant (`a8e1747`, `05e94ff`). Đây là **an toàn khi rollback**, chưa chứng minh rollback giữ nguyên mọi chức năng. |
| Tạo/sửa account có bước ghi rời | `create_account_atomic`/`update_account_atomic` và route gọi qua RPC (`supabase/rollouts/2026-10-02-authz-review-fixes.sql:120-266`; `src/app/api/admin/users/route.ts:112-137`; `src/app/api/admin/users/[id]/route.ts:417-443`) (`fea26d5`). |
| Thiếu role hệ thống và role mặc định bị tắt | Rollout C nay dừng khi thiếu key active (`supabase/rollouts/2026-09-28-authz-phase-c.sql:30-42`); RPC từ chối tắt role hệ thống (`2026-10-02-authz-review-fixes.sql:43-51`) (`8e328f5`). |
| RLS thiếu hậu kiểm và lọc recipient theo từng người | `2026-09-26-rls-lockdown.sql` đã raise trong transaction; `src/lib/tasks/recipient-access.ts:15-35` và Enrollment tương đương dùng batch (`e3566d0`, `6c8be9e`). |

## Kiểm chứng, giới hạn và thứ tự xử lý

- Trên HEAD `6bbeb69`: `npm run typecheck` đạt; `npm run test:run` đạt **208 file / 1.776 test**; `npm run lint` exit 0 với 2 warning cũ (`public/sw.js`, `LeadTable.tsx`). `git diff --check main...feat/authz` báo một dòng trống dư ở EOF `src/lib/rbac/access.ts:135` (chỉ vấn đề format).
- Đây là review tĩnh và test local; không chạy DB persistence gate trên một bản sao production, không đọc ACL hay số lượng roster/account/role của production, không gửi Web Push thực. Các findings phụ thuộc quy mô/ACL được ghi rõ điều kiện.
- Ưu tiên sửa **P1-01 đến P1-03** trước khi cấp scope tùy chỉnh; chốt alias và payload Push (**P1-04/05**), khóa RPC trong migration (**P1-06**), rồi hoàn thiện và kiểm đủ dữ liệu chuyển grant (**P1-07**) trước deploy H. Sau đó sửa lệch UI/notification và dựng CI chạy test TS trên mọi PR authz.
