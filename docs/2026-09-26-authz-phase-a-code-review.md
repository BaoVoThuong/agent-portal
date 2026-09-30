# Code review nhánh `feat/authz-phase-a`

Ngày review: 2026-09-26. Phạm vi: toàn bộ 50 file thay đổi giữa `main` (`6aefde0`) và `feat/authz-phase-a` (`ba69ee9`), gồm A1–A10, SQL, CI, frontend, backend, thư viện, test và tài liệu. Đây là nhận xét trên **snapshot của nhánh Phase A**; nhánh đang checkout khi review là `feat/authz-phase-d`, có thay đổi cục bộ và không bị chỉnh sửa. Những mục bên dưới có thể đã được xử lý ở nhánh sau.

## Kết luận

Phase A đã chặn được nhiều đường truy cập rõ ràng: PATCH Role Manager body rỗng, Task Overview chỉ dựa vào tên role, tự nhận làm Agent ngoài roster, import Enrollment bằng một permission đơn lẻ, và thông báo `task_created`/comment gửi cho người không xem được bản ghi. Các thay đổi dùng guard backend và có test, không chỉ ẩn UI.

**Chưa nên coi Phase A là hoàn tất để phát hành riêng.** Còn một cửa sổ tối đa 5 phút sau khi khóa account hoặc thu hồi role mà API có thể tiếp tục tin JWT cũ; kiểm chứng dữ liệu và production theo A0/A1 chưa có trong nhánh; một số đường thông báo vẫn dùng logic người nhận cũ. Các kết luận về production và DB gate CI cần bằng chứng vận hành, không thể suy ra từ unit test.

## Phát hiện cần xử lý

### [sol5.5] P1-01 — Thu hồi account/quyền chưa có hiệu lực ngay tại API

**Đường đi:** `src/auth.ts:33-35,139-175` đặt `RBAC_REFRESH_TTL_MS = 5 * 60 * 1000`; `jwt()` trả lại token nguyên trạng trước TTL. `src/lib/auth/token-access.ts:21-31` chỉ trả `null` khi đã thực sự đọc lại account. `src/auth.config.ts:25-33` ở proxy chỉ kiểm tra email. Các route như `src/app/api/tasks/notifications/route.ts:19-21` và `src/app/api/notifications/push/subscribe/route.ts:32-35` chỉ dựa vào session email.

**Tác động:** ngay sau khi Account Manager khóa account, người dùng có JWT vừa được refresh có thể tiếp tục gọi các API vốn tin session hoặc permission cũ trong gần 5 phút. Xóa subscription và lọc account active ở `src/app/api/admin/users/[id]/route.ts:458-467` cùng `src/lib/notifications/push-server.ts:160-163` bảo vệ **push gửi đi**, nhưng không thu hồi API/session tức thời. Thay đổi role cũng có cùng độ trễ.

**Đề nghị:** ghi rõ SLA thu hồi quyền. Với thao tác nhạy cảm, kiểm `account_id + is_active + authz_version` tại server hoặc dùng cache ngắn có invalidation; tăng version khi khóa account/đổi role. Cho đến khi có cơ chế đó, các self-service route xử lý dữ liệu nhạy cảm nên kiểm account active tươi. Test ở mức callback/API với JWT vừa refresh, sau đó khóa account/thu hồi role và gọi lại ngay; test helper `applyRefreshedAccess` hiện chưa bao phủ thời điểm refresh.

### [sol5.5] P1-02 — Tên hiển thị trong DB vẫn là khóa phạm vi dữ liệu; thiếu kiểm tra trùng tên trước khi ship

**Đường đi:** `src/lib/agent-identity.ts:5-28` đọc `portal_account.name` để lọc Registration, Dashboard và AI; `src/app/api/admin/users/[id]/route.ts:302-305` cho Account Manager đặt tên mới mà không kiểm tra trùng tên chuẩn hóa. `src/lib/ai/pc-query-builder.ts:83-86` và `src/lib/ai/health-query-builder.ts:52-55` lọc theo tên đó. Plan yêu cầu A0 kiểm tên trùng trước A6 tại `docs/superpowers/plans/2026-09-26-authorization-final-plan.md:360-365,1777`, nhưng **không có** `docs/2026-09-26-authz-baseline.md` trong nhánh Phase A.

**Tác động:** hai account có cùng tên sau khi chuẩn hóa có thể cùng khớp dữ liệu hoa hồng/health theo tên Agent. Khóa chức năng tự sửa tên ở Settings là giảm thiểu hợp lý, nhưng Account Manager vẫn có thể tạo va chạm; dữ liệu hiện có chưa được chứng minh không va chạm. Đây là rủi ro có điều kiện, không phải bằng chứng đã có leak trên production.

**Đề nghị:** hoàn thành truy vấn A0 về tên trùng và lưu kết quả đã khử dữ liệu nhạy cảm; chặn tên trùng trong Account Manager hoặc ít nhất cảnh báo và chặn thao tác đổi tên gây va chạm. Ưu tiên ánh xạ `account_id → agent_id` ổn định ở Phase D. Test hai account trùng tên với dữ liệu khác nhau và thay đổi tên sau khi đăng nhập. Đã kiểm tra trường hợp tên rỗng ở AI: builder vẫn `.eq(..., "")`, nên **không** phải đường mở quyền ở Phase A.

### [sol5.5] P1-03 — Lọc người nhận `task_created` nhưng bỏ qua `backlog_attention`

**Đường đi:** `src/app/api/tasks/route.ts:403-438` dùng `filterTaskRecipientsWithAccess` riêng cho `createdRecipients`, còn `backlogAttentionRecipients` lấy từ `fetchAgentAssistantEmails` và `fetchAdminEmails` rồi đưa thẳng vào `buildCreateTaskNotificationRows`. `src/lib/tasks/membership.ts:184-193` chọn admin theo `portal_account.role = 'admin'`, không kiểm `task.manage` hoặc quyền xem task. `src/lib/tasks/create-notifications.ts:32-55` ghi thông báo backlog trước và loại trùng với `task_created`.

**Tác động:** một account còn legacy role `admin` nhưng không có `task.manage`, hoặc một Assistant đã mất quyền/scope, vẫn có thể nhận thông báo backlog chứa thông tin task. Đây là cùng lớp rò rỉ mà A5 xử lý cho `task_created`; đường backlog có độ ưu tiên cao hơn nên bộ lọc mới không cứu được người đó.

**Đề nghị:** lọc **toàn bộ** danh sách người nhận của `assigned`, `backlog_attention`, `task_created` qua cùng quyết định `canViewTask` tại thời điểm gửi, sau đó mới chọn loại thông báo ưu tiên. Viết test integration cho task Backlog High/Urgent với legacy admin thiếu permission và Assistant vừa rời Agent.

### [sol5.5] P1-04 — Thiếu bằng chứng cho các cổng A0/A1 trước production

**Đường đi:** plan chỉ định `docs/2026-09-26-authz-baseline.md` và thứ tự A0 → A1 → … ở `docs/superpowers/plans/2026-09-26-authorization-final-plan.md:179-200,204-215,2665-2668`; nhánh không chứa file baseline. `supabase/rollouts/2026-09-26-rls-lockdown.sql:23-49` bỏ qua bảng chưa tồn tại bằng `to_regclass`, và truy vấn cuối `:53-60` chỉ **trả dòng**, không tự `RAISE EXCEPTION`. `.github/workflows/db-persistence-gate.yml:47-64` có assert trên DB dùng một lần nhưng không chứng minh rollout đã chạy trên production.

**Tác động:** code có thể xanh trên CI trong khi production vẫn còn bảng mở, rollout chưa chạy, hoặc dữ liệu thực tế vi phạm giả định A6/A7/A8. Đây là thiếu bằng chứng phát hành, không phải khẳng định production đang hở.

**Đề nghị:** bổ sung baseline A0 với các mục plan yêu cầu; chạy rollout và kiểm tra read-only trên production theo A1, lưu kết quả 0 dòng và thời điểm chạy. Đổi hậu kiểm rollout thành assert lỗi rõ ràng khi phát hiện bảng có grant mà chưa có RLS; với bảng bắt buộc, phân biệt "chưa tồn tại hợp lệ" và "migration bị bỏ sót".

## Rủi ro còn lại và cải thiện nên đưa vào các phase sau

### [sol5.5] P2-01 — Thông báo cũ vẫn được đọc và làm giàu theo email người nhận, không kiểm scope hiện tại

`src/app/api/tasks/notifications/route.ts:138-187,274-346` tải notification theo `recipient_email`, sau đó dùng service role lấy title/comment/record tương ứng mà không kiểm người nhận còn quyền xem resource. Nếu quyền hoặc assignment thay đổi **sau** lúc tạo thông báo, chuông vẫn có thể hiển thị nội dung cũ. A5 kiểm một số đường **ghi mới** (`src/lib/enrollment/recipient-access.ts`, `src/lib/tasks/recipient-access.ts`) nhưng chưa xử lý quyền đọc lại, thông báo trước A5, các producer khác như `src/app/api/enrollment/[id]/route.ts` và cron. Nên lọc hoặc redaction tại read/delivery theo scope hiện tại, đồng thời thống nhất policy cho mọi producer. Test người nhận mất scope sau khi thông báo đã được tạo.

### [sol5.5] P2-02 — Bộ lọc người nhận tạo nhiều truy vấn theo số người nhận

`src/lib/enrollment/recipient-access.ts:31-44` gọi `resolveEnrollmentScope` cho từng email; `src/lib/tasks/recipient-access.ts:27-52` gọi `isAgentOwnerOrAssistant` và `resolveTaskQueueScope` cho từng email. Có batch đọc RBAC nhưng membership/scope vẫn tăng theo số người nhận; `Promise.all` còn tạo burst đồng thời. `src/lib/notifications/push-server.ts:122-132` quét toàn bộ active account cho mỗi lượt gửi push. Đề nghị batch roster, membership, active account theo tập ứng viên và tính decision trong bộ nhớ hoặc giới hạn concurrency; đo latency/query count với comment nhiều watcher và task có nhiều manager trước khi tối ưu.

### [sol5.5] P2-03 — Import Enrollment vẫn bỏ qua lịch sử thay đổi khi update

`src/app/api/enrollment/import/route.ts:233-256` update trực tiếp `enrollment_records`; nhánh tạo mới dùng `create_enrollment_atomic` có activity ở `:259-264`. A8 (`:98-107`) đã giới hạn import cho task admin, nên đóng cửa leo quyền từ `task.import`, nhưng một import có thể thay đổi stage/owner hàng loạt mà không ghi activity/stage cycle/notification tương ứng. Cần định nghĩa hành vi import mong muốn rồi chuyển update sang mutation/RPC thống nhất; test audit trail và side effects. Đây là vấn đề toàn vẹn nghiệp vụ còn lại, không phải bằng chứng A8 guard bị vượt qua.

### [sol5.5] P2-04 — Registry route là inventory tĩnh, chưa là chứng minh enforcement

`src/app/api/route-guards.test.ts:16-110` tìm chuỗi bất kỳ trong source và snapshot; `:116-144` chỉ bắt sự hiện diện marker, không bắt thứ tự guard, từng HTTP method, hay object scope. Marker có thể nằm trong comment hoặc nhánh không chạy. File đã ghi rõ giới hạn này; nên giữ nó như công cụ phát hiện route mới, rồi bổ sung test gọi API cho các mutation và IDOR ưu tiên cao. Đặc biệt các fix A5/A7/A8 hiện chủ yếu test helper, chưa có test route chứng minh guard được gọi đúng với payload và thứ tự thực thi.

### [sol5.5] P2-05 — CI DB gate phụ thuộc danh sách rollout thủ công

`.github/workflows/db-persistence-gate.yml:47-60` áp một danh sách cố định các rollout-only trước khi assert; `supabase/checks/ci-rls-assert.sql:10-40` chỉ xét object **đã tồn tại**. Một rollout-only mới bị quên trong workflow sẽ không được kiểm trong DB test, dù được triển khai ở production. Nên xây manifest/schema full-state, hoặc test tự đối chiếu tập bảng/hàm bắt buộc với catalogue sau migration. Thêm một fixture cố ý thiếu RLS và một fixture thiếu rollout để chứng minh CI fail đúng. Không thay thế việc kiểm production ở P1-04.

### [sol5.5] P2-06 — Quyền quản trị Task vẫn phụ thuộc tên role cố định

`src/lib/tasks/access.ts:16-35,38-50` nhận diện Task Admin bằng hai tên role cụ thể, `portal_account.role = admin` hoặc Super Admin; `src/app/api/tasks/overview/route.ts:13-20` và `src/lib/table-config/export-access.ts:23-35` tiếp tục dùng `actor.isManager`. Điều này giữ đúng hành vi cũ trong Phase A, nhưng một role mới được cấp `task.manage` vẫn không có quyền Overview/import cho đến khi code nhận diện tên role đó. Nên ghi đây là **compatibility rule có thời hạn**, xác định capability/scope quản trị Task riêng trong phase kiến trúc, và có test chứng minh role mới được cấu hình không cần sửa danh sách tên.

### [sol5.5] P2-07 — Comment Enrollment lọc người nhận bằng snapshot record trước callback `after()`

`src/app/api/enrollment/[id]/comments/route.ts:111-147` dùng `loaded.record` đã lấy trước khi lưu comment; callback chạy sau response. Nếu Agent/caller/responsible của hồ sơ đổi đồng thời, danh sách người nhận có thể được quyết định theo scope cũ và lộ tên khách trong notification/push. Route reaction đã đọc lại record tại `src/app/api/enrollment/[id]/comments/[cid]/reactions/route.ts:92-109`. Nên đọc record hiện tại trong callback, lọc người nhận theo cùng snapshot đó và test cập nhật assignment giữa lúc lưu comment và gửi thông báo.

## Những phần đã kiểm và đạt

- A1 có RLS/revoke cho danh sách bảng được nêu; A2/A3 dùng guard backend trước khi trả dữ liệu; A6 AI query builder áp scope cả khi tên rỗng; A7 kiểm Agent nằm trong roster ở POST và khi đổi Agent trong PATCH; A8 dùng cùng helper cho UI và API.
- `npm run typecheck`: đạt trên snapshot Phase A.
- `npx vitest run` cho 10 file test Phase A: **35/35 đạt**.
- `npm run test:run`: **192 file, 1.587 test đạt**.
- `npm run lint`: exit 0; còn 2 warning không thuộc Phase A (`public/sw.js`, `LeadTable`).
- **Chưa chạy được DB gate PostgreSQL tại máy review:** sandbox không cho PostgreSQL tạo shared memory (`shmget: Operation not permitted`). Vì vậy không kết luận workflow A10 đã xanh hay SQL chạy đúng trên DB trống/production; cần kết quả GitHub Actions và kiểm tra production theo plan.

## Thứ tự đề nghị

1. Trước phát hành Phase A: hoàn thành A0/A1 production evidence, kiểm tên Agent trùng và xác nhận CI DB gate thực sự xanh.
2. Chốt SLA thu hồi phiên/quyền và sửa P1-01; đồng thời lọc mọi loại người nhận ở task create (P1-03).
3. Ở các phase tiếp theo: đưa account/Agent scope về định danh ổn định; thống nhất policy notification lúc ghi, gửi và đọc; xử lý audit trail của import; bổ sung test API/DB cho các đường bảo mật cao.
