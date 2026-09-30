# Code review Phase D — 7 commit

Ngày review: 2026-09-26. Snapshot được review: `e6854ca..fa1f6ea` (`feat/authz-phase-d`, đồng thời là HEAD của `feat/authz-phase-e` lúc bắt đầu review), **158 file**, 3.262 dòng thêm / 1.428 dòng xóa. Bảy commit: D1 `099dafd` (Task/Enrollment), D2 `a3ff937` (Lead), D3 `616bdb5` (Registration/Dashboard/Automation/Provider/Time off/Settings/Import-Export), D4 `344dc66` (grant holders), D5 `a63fd77` (commission identity), D6 `7c39791` (decision diff), tài liệu `fa1f6ea`. Các thay đổi chưa commit trong worktree hiện tại không thuộc review này; kiểm chứng chạy trên bản `git archive fa1f6ea` riêng.

## Kết luận

Phase D đã thay các guard backend chính từ permission phẳng/tên role sang grant theo action và scope; Lead tách `read/update/log`, Registration tách Health/P&C và read/update, Provider tách read/update/import, export trả về dữ liệu theo scope. D4 đưa picker/người nhận giám sát về cùng phép suy grant hiệu lực. D5 tách tên hiển thị khỏi khóa hoa hồng. D6 thêm đối chiếu quyết định cũ/mới. Đây là tiến bộ đúng hướng, nhưng **chưa nên coi Phase D sẵn sàng cho role grant tùy chỉnh ở production**: có đường ghi ngoài phạm vi, scope Agent/Assistant bị gộp, alias hoa hồng có thể tái sử dụng, và thông báo có thể lộ dữ liệu ngoài scope.

## Phát hiện P1 — cần xử lý trước khi bật role grant tùy chỉnh

### [sol5.5] P1-01 — `agent_owned` và `assistant_for_agent` bị gộp trong policy Task/Enrollment

`src/lib/tasks/access.ts:103-105` đặt **cả hai fact** `agent_owned` và `assistant_for_agent` từ một boolean. Các hàm `canCreateTaskWithScope`, `canReviewDoneTask`, `canAssignToTask`, `canDeleteTask`, `canReadTaskActivity` dùng fact này (`:122-126,156-167,224-230`). `src/lib/tasks/membership.ts:130-143` trả cùng `true` cho Agent sở hữu và Assistant được ủy quyền; route DELETE truyền thẳng kết quả vào `canDeleteTask` (`src/app/api/tasks/[id]/route.ts:691-699`), route assignee cũng vậy (`src/app/api/tasks/[id]/assignees/route.ts:43-48`). Vì thế Assistant có `task.read:assistant_for_agent` + `task.delete:agent_owned` nhưng không có `task.delete:assistant_for_agent` vẫn xóa được Task của Agent; tương tự assign/QC/activity/create. Các policy Task khác đã phân biệt đúng khi có `task.agent_email` (`src/lib/tasks/access.ts:84-100,171-221`), cho thấy lỗi tập trung ở adapter boolean.

Enrollment lặp lại lỗi ở `src/lib/enrollment/policy.ts:65-77,107-115`: `enrollmentFacts` và `canCreateEnrollmentWithScope` bật đồng thời hai scope. `src/app/api/enrollment/[id]/route.ts:133-154` truyền `isAgentOwnerOrAssistant`; Assistant có `enrollment.read:assistant_for_agent` + `enrollment.content.update:agent_owned` có thể sửa hồ sơ của Agent. Route tạo mới cũng truyền boolean tương tự (`src/app/api/enrollment/route.ts:209-220`). `src/lib/authz/equivalence.test.ts:220-232` chỉ kiểm tách scope ở `canViewTask`, chưa kiểm các đường trên.

**Sửa:** truyền `agent_email` của resource/requested agent cùng email actor vào policy; fact `agent_owned` chỉ đúng khi trùng email, `assistant_for_agent` chỉ đúng khi quan hệ ủy quyền thực sự đúng và actor khác Agent. Áp dụng cho mọi action và capability trả UI. Thêm test âm riêng cho từng action với grant chỉ có một trong hai scope, gồm request API trực tiếp.

### [sol5.5] P1-02 — `enrollment.import` ghi đè hồ sơ bất kỳ theo ID, bỏ qua scope và quyền sửa

`src/app/api/enrollment/import/route.ts:98-108` chỉ cần account mở được Enrollment (`loadEnrollmentActor` đòi `enrollment.read` ở **bất kỳ** scope, `src/lib/enrollment/access.ts:20-33`) và `enrollment.import:*`. Sau đó route nhận ID từ file (`:135-145`) và dùng service-role `.update(...).eq("id", recordId).eq("program", program)` (`:235-255`), không gọi `loadScopedEnrollmentRecord`, `resolveEnrollmentCapabilities` hoặc policy transfer/stage cho từng dòng. Một role tùy chỉnh có `enrollment.read:reported` + `enrollment.import:*` có thể POST ID của hồ sơ ngoài phạm vi và ghi đè các trường được import. `src/lib/table-config/export-access.ts:13-31` và `src/lib/authz/catalog.ts:133-140` công khai `enrollment.import` như grant độc lập; comment ở export-access cũng thừa nhận import bỏ qua object scope. Grant tương thích chỉ cấp import cho task admin (`src/lib/authz/compat.ts:110-114`), nhưng điều đó không bảo vệ role đã chuyển grant.

**Sửa:** trước mắt gác import bằng `enrollment.read:all` cộng các quyền ghi `all` cần thiết, hoặc không cho Role Manager cấp `enrollment.import` ngoài bundle quản trị. Đích đúng là kiểm record scope, capability theo cột, ownership/agent transfer và audit trong một đường import dùng chung policy với PATCH; xác thực từng ID trước update. Test role `read:reported + import` gửi ID ngoài scope phải bị từ chối, kể cả khi biết UUID.

### [sol5.5] P1-03 — Tên hoa hồng duy nhất **ở hiện tại** nhưng có thể tái cấp và mở dữ liệu lịch sử

`supabase/rollouts/2026-09-29-authz-phase-d.sql:26-37` đặt unique index trên mapping hiện tại. RPC `set_commission_name_atomic` cho xóa/đổi mapping (`:67-81`), sau đó tên cũ trở nên tự do. `src/lib/agent-identity.ts:29-56` lấy tên hiện tại làm scope; `src/lib/agent-name.ts:12-23` lọc các entry cũ qua `selected_agent` bằng tên đó. Kịch bản: Agent A có tên hoa hồng `ANN`, nhiều `health_entries`/`pc_entries` lịch sử mang `selected_agent=ANN`; quản trị đổi hoặc xóa mapping của A, rồi đặt `ANN` cho B. B lập tức thấy và có thể sửa/xóa các entry lịch sử của A nếu có grant Registration tương ứng (`src/app/api/entries/[id]/route.ts:83-102`, route P&C tương đương). Unique index không chặn tái sử dụng theo thời gian. Dashboard và AI cũng lấy scope từ `fetchScopeAgentName` (`src/app/(authed)/dashboard/health/page.tsx:62-63`, `src/app/api/ai/dashboard-chat/route.ts:128-149`). Đây là cùng lớp rò rỉ mà D5 muốn sửa, chỉ còn ở trục thời gian.

**Sửa:** khóa định danh không thể tái cấp khi còn record mang tên đó, hoặc lưu `agent_account_id` bất biến trên entry và truy vấn bằng ID; đổi alias phải rekey/backfill dữ liệu trong transaction có đối chiếu. Có thể lưu bảng lịch sử alias để chống reuse và audit. Test A → đổi/xóa alias → B nhận alias cũ; B không được thấy entry của A.

### [sol5.5] P1-04 — Grant nhận thông báo giám sát không kiểm người nhận có xem được resource

D4 thay `fetchAdminEmails` bằng `fetchGrantHolderEmails("notify.*")` (`src/lib/tasks/membership.ts:192-211`). Nhưng các đường Task overdue/backlog và Enrollment QC/escalation ghép trực tiếp người giữ grant vào recipients, không qua `filterTaskRecipientsWithAccess`/`filterEnrollmentRecipientsWithAccess`: `src/app/api/tasks/route.ts:399-408`, `src/app/api/cron/check-overdue/route.ts:483-518`, `src/app/api/enrollment/route.ts:336-358`, `src/app/api/cron/check-enrollment-due/route.ts:168-180`. Người chỉ có `notify.task.escalation:*` hoặc `notify.enrollment.qc:*`, không có quyền đọc resource, vẫn nhận notification. `src/app/api/tasks/notifications/route.ts:150-156,274-320,357-365,417-422` enrich response bằng Task title hoặc tên khách hàng Enrollment mà không kiểm lại object scope. Chính Task-created đã lọc view scope (`src/app/api/tasks/route.ts:419-425`), nên các event giám sát đang không nhất quán với mục tiêu tránh lộ tiêu đề ngoài phạm vi.

**Sửa:** xác định rõ grant `notify.*` có cho phép nhận **nội dung** ngoài scope hay chỉ cho phép làm ứng viên nhận. Nếu không cấp quyền đọc nội dung, lọc từng recipient theo policy xem resource trước khi insert/push và khi enrich notification; với giám sát toàn công ty, yêu cầu thêm read:all phù hợp. Test role chỉ có notify grant và role read:assigned nhận event cho record không được giao, cả bell và push đều không tiết lộ tên/chi tiết. `src/lib/tasks/recipient-access.ts:43-48` còn truyền Task thiếu `agent_email`, khiến P1-01 có thể làm lọc `task_created` nhận sai scope; cần truyền agent email thực.

## Phát hiện P2 — sai lệch chức năng, vận hành và độ tin cậy

### [sol5.5] P2-01 — Frontend Task/Lead vẫn gộp nhiều action vào `isManager = read:all`

Backend D1/D2 đã tách `task.create`, `task.overview.read`, `lead.create`, `lead.assign`, `lead.import`, `lead.overview.read` (`src/lib/tasks/access.ts:107-146`, `src/lib/leads/access.ts:32-75`). Nhưng `src/app/(authed)/tasks/page.tsx:95` và `src/app/(authed)/tasks/leads/page.tsx:62` vẫn chỉ gửi `actor.isManager` xuống client; cờ này là `task.read:all` hoặc `lead.read:all`. `TaskBoardClient.tsx:2011-2018,2084-2087,2208-2228` dùng nó để hiện tạo Task/Overview/activity; `LeadsClient.tsx:1064-1099,1267-1279` và `LeadDetailDrawer.tsx:356` dùng nó cho tạo/import/overview/assign. Role `read:all` thiếu action ghi vẫn thấy nút rồi bị API từ chối; role có `lead.assign` hoặc `lead.overview.read` nhưng chỉ `lead.read:assigned` bị ẩn chức năng mà API đã cho. Server page guard Overview Lead (`tasks/leads/page.tsx:32-33`) đúng nhưng client ẩn tab.

**Sửa:** page tính và truyền capability riêng cho từng action; component render theo capability đó, object action vẫn theo `resolveTaskCapabilities`/`resolveLeadCapabilities`. Test UI với tổ hợp grants rời nhau, không suy từ `read:all`.

### [sol5.5] P2-02 — `task.export` còn phụ thuộc ngầm vào `enrollment.read`

`src/app/api/tasks/export/route.ts:49-57` dùng `loadEnrollmentActor`, nên role có `task.read` + `task.export` nhưng không có `enrollment.read` nhận 403 trước khi tới `fetchTasksForActor` (`:60-64`). Đây là coupling cũ còn lại sau khi D3 tách grant export theo domain. UI Task có thể hiện Export theo `task.export`, nhưng API vẫn từ chối.

**Sửa:** dùng `taskActorForUser` và kiểm `canAccessBoard` + `task.export` trong route; tiếp tục lấy file từ `fetchTasksForActor` để giữ scope. Test Task Export khi không có quyền Enrollment và ngược lại.

### [sol5.5] P2-03 — Picker/recipient holder có thể bỏ sót account khi vượt giới hạn một trang

`src/lib/authz/holders.ts:33-38` tải tất cả active `portal_account` bằng một `.select()` không phân trang, không count/kiểm `truncated`; `scripts/authz-decision-diff.ts:32-38` làm tương tự. Nếu PostgREST/server giới hạn số dòng trả về, phần account sau trang đầu bị bỏ qua **không báo lỗi**. `fetchTaskAssignees`, `fetchLeadAssignees`, `fetchAdminEmails`, `fetchTaskManagerEmails`, time-off recipients cùng dùng helper này (`src/lib/tasks/assignees.ts:61-67`, `src/lib/leads/assignees.ts:12-16`, `src/lib/tasks/membership.ts:200-219`, `src/lib/time-off/notifications.ts:64-67`). Hậu quả là người hợp lệ biến khỏi picker hoặc không được thông báo; decision diff có thể báo sai rằng đã duyệt toàn bộ account. Task list đã có pagination/count và xử lý cắt trần (`src/lib/tasks/queries.ts:180-229`), nên cùng nguyên tắc cần áp dụng ở holder.

**Sửa:** keyset pagination theo `id` kèm count/completeness assertion; tránh `.in()` quá dài khi tải role; test > page-size account và account ở trang cuối.

### [sol5.5] P2-04 — Fallback tên hiển thị quá rộng; onboarding mới thiếu mapping mặc định

`src/lib/agent-identity.ts:25-26,41-51` coi mọi `PGRST200` (không tìm thấy quan hệ embed), `PGRST205` hoặc `42P01` là “Phase D chưa rollout” và quay lại `portal_account.name`. Sau khi bảng đã tồn tại, lỗi quan hệ/schema cache cũng có thể kích hoạt fallback, mở lại va chạm tên mà D5 muốn chặn. Test hiện hành còn khẳng định fallback cho `PGRST200` không phân biệt hoàn cảnh (`src/lib/agent-identity.test.ts:50-57`). Mặt khác, account tạo mới chỉ đặt mapping khi payload có `commissionName` (`src/lib/admin/user-input.ts:73-82`, `src/app/api/admin/users/route.ts:160-176`); form mặc định để rỗng (`src/app/(authed)/account-manager/AccountManagerClient.tsx:45-52`) và Google self-provision không tạo mapping (`src/auth.ts:119-149`). Agent mới không thấy record do người khác nhập bằng tên mình cho tới khi quản trị nhớ cấu hình riêng.

**Sửa:** sau rollout xác nhận, bỏ fallback hoặc bật bằng cờ rollout tắt rõ ràng; chỉ rơi về legacy khi kiểm chứng thật sự *chưa có schema*. Đưa commission identity vào workflow onboard Agent như bước bắt buộc/cảnh báo rõ, kèm preflight account active chưa có mapping và tên trùng trước deploy (`supabase/rollouts/2026-09-29-authz-phase-d.sql:94-129`).

### [sol5.5] P2-05 — `read` vẫn ngầm cho phép ghi comment và @mention

Role grant hẹp có thể chỉ giữ `task.read:assigned` hoặc `enrollment.read:reported`, nhưng POST comment chỉ dùng cùng cổng xem như GET (`src/app/api/tasks/[id]/comments/route.ts:58-80,111-116,150-158`; `src/app/api/enrollment/[id]/comments/route.ts:50-55,72-83,220-230`). Task comment còn nhận `p_mentions`; SQL `supabase/schema.sql:2891-2894` thêm người được nhắc vào `task_participants`, có thể mở thêm đường xem Task. Legacy “ai xem thì bình luận” có thể là hành vi mong muốn, nhưng trong catalog mới nhãn `task.read`/`enrollment.read` là “View”, không mô tả quyền ghi hay mời người khác.

**Sửa:** xác nhận nghiệp vụ; nếu role chỉ đọc phải thật sự bất biến, thêm `task.comment.create` / `enrollment.comment.create` và quyền mention/attachment phù hợp, cấp grant tương thích cho role cũ rồi gác POST/attachments/reactions. Nếu comment là một phần cố ý của read, ghi rõ trong catalog/Role Manager và test hành vi đó.

### [sol5.5] P2-06 — Decision diff chưa là gate an toàn cho dữ liệu/resource thực

`src/lib/authz/decision-diff.ts:27-39,69-108` dùng email và quan hệ giả lập (`ME`, `OTHER`, tổ hợp flags); script chỉ đọc account/role thật (`scripts/authz-decision-diff.ts:32-64`). Nó không đối chiếu Task/Enrollment/Lead thật, query scope thực, notification recipients, alias hoa hồng hay API import. Nếu account bị cắt trang theo P2-03, coverage càng thiếu. Khi role đã chuyển grant, mọi mismatch chỉ in để “duyệt từng dòng” và script exit 0 (`scripts/authz-decision-diff.ts:75-85`), kể cả thay đổi nguy hiểm; bản `--json` cũng return trước khi đặt exit code (`:71-74`). Vì vậy không nên dùng green exit code làm chứng cứ production không lệch quyền.

**Sửa:** xuất số account expected/actual, đánh dấu mismatch mở rộng quyền, bắt buộc allowlist/acknowledgement có định danh cho thay đổi chủ đích; thêm fixture resource thật và API test âm cho các P1. Ghi rõ trong báo cáo D6 rằng script kiểm mô hình policy trên principal thật nhưng object facts giả lập.

## Phần đã kiểm và cần giữ

| Mảng | Quan sát trên snapshot D | Giới hạn còn lại |
|---|---|---|
| Task/Enrollment | Action policy và grant tương thích được dùng ở route/page (`src/lib/tasks/access.ts`, `src/lib/enrollment/policy.ts`) | P1-01, P1-02 và comment read/write; UI module còn gộp |
| Lead | `lead.read/update/interaction.log` tách scope đúng theo assigned/assistant (`src/lib/leads/access.ts:91-150`); assign target dùng grant (`src/lib/leads/assign-target.ts:10-17`) | UI vẫn suy quyền từ `read:all` |
| Registration/Dashboard/AI | Scope Health/P&C và own/all lấy từ action riêng (`src/app/api/entries/route.ts:13-39`, `src/app/api/ai/dashboard-chat/route.ts:128-149`) | Commission name vẫn là khóa dữ liệu mutable, P1-03 |
| Provider/Export | Import Provider đòi cả update + import (`src/app/api/automation/provider-list/import/route.ts:35-45`); Enrollment export áp `resolveEnrollmentScope` (`src/app/api/enrollment/export/route.ts:72-86`) | Import Enrollment và Task export còn lỗi nêu trên |
| Notification | D4 gom grant holders và Task-created lọc view (`src/lib/authz/holders.ts`, `src/app/api/tasks/route.ts:419-425`) | Event giám sát không lọc; holder không bảo đảm đầy đủ |
| Migration/SQL | Commission mapping có unique, audit và service-role RPC; CI thêm rollout (`supabase/rollouts/2026-09-29-authz-phase-d.sql`, `.github/workflows/db-persistence-gate.yml`) | Unique chỉ bảo vệ cùng thời điểm; cần preflight dữ liệu thật và DB gate CI |

## Kiểm chứng

- Chạy trên **snapshot sạch `fa1f6ea`** tại `/private/tmp/authz-phase-d-review.1wgM92` với `node_modules` của project: `npm run typecheck` đạt; `npm run test:run` đạt **201 file / 1.744 test**; `npm run lint` exit 0, hai warning ở `public/sw.js` và `LeadTable.tsx`.
- `git diff --check e6854ca..fa1f6ea` đạt. `src/app/api/route-guards.test.ts:5-14,116-164` là kiểm tĩnh dấu hiệu guard, tự nêu rõ nó không chứng minh policy đúng; các P1 là tổ hợp grant mới chưa có test API âm. DB persistence gate không chạy tại máy review vì sandbox không cho PostgreSQL tạo shared memory; cần lấy kết quả CI thật. Không có truy cập production DB, nên mức độ dữ liệu lịch sử/tên trùng và số account active cần preflight trước rollout.

## Thứ tự xử lý đề nghị

1. Khóa cấp role grant tùy chỉnh nhạy cảm cho tới khi xử lý P1-01/02/03/04; kiểm test API âm theo ma trận scope Agent/Assistant, import ngoài scope, alias tái cấp và recipient ngoài scope.
2. Chuyển capability UI theo từng action, gỡ gate `enrollment.read` khỏi Task Export; phân trang holders và decision diff.
3. Quyết định semantics comment/read; chốt quy trình commission identity và bỏ fallback sau rollout. Chạy DB gate CI và preflight trên dữ liệu thật trước khi triển khai.
