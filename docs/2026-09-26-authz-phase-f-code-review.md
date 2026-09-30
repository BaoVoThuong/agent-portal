# Code review Phase F

Ngày review: 2026-09-26. Phạm vi commit `6e12a9a..429fa5f`: F1 `e2e416f`, F2 `11e282b`, F3 `d9ec14b` và tài liệu `429fa5f`; 12 file, 774 dòng thêm / 24 dòng xóa. Đối chiếu với E và code đang ở HEAD G; các file thực thi Phase F không đổi ở G.

## Kết luận

F1 đặt bộ lọc người nhận chung tại hai hàm insert notification, F2 kiểm lại quyền xem khi đọc chuông, F3 thêm replay chỉ đọc. Cách đặt bộ lọc ở producer và consumer là hợp lý, và đã thu hẹp đường rò `notify.*` của [review D](./2026-09-26-authz-phase-d-code-review.md) đối với Task/Enrollment thông thường. Tuy nhiên, ngoại lệ `unassigned` vẫn gửi **tiêu đề Task qua Web Push sau khi người nhận mất quyền**. Việc redaction trong chuông còn để lộ metadata, và bộ lọc theo lô có thể đọc thiếu quan hệ khi vượt giới hạn trả hàng của PostgREST. Do đó không nên coi D P1-04 đã khép hoàn toàn.

## Phát hiện

### [sol5.5] P1-01 — Ngoại lệ `unassigned` vẫn gửi tiêu đề Task tới người vừa mất quyền

`src/lib/tasks/notifications.ts:89-125` miễn `unassigned` khỏi `taskViewersAmong`, kể cả khi kiểm quyền lỗi. Sau insert, `:140-148` vẫn chuyển **toàn bộ** `rows` sang `pushForTaskNotifications`. Hàm push dùng service role đọc `tasks.title,display_number` rồi đưa tiêu đề vào payload (`src/lib/notifications/push-dispatch.ts:133-169`; `src/lib/notifications/push-server.ts:214-227`). Hai đường bỏ assignee thực sự sinh loại này sau mutation (`src/app/api/tasks/[id]/route.ts:573-579`; `src/app/api/tasks/[id]/assignees/[email]/route.ts:137-144`). Người bị bỏ giao và không có scope khác vẫn thấy tiêu đề, số Task và actor trên thông báo hệ điều hành, dù GET chuông đã redacted và trang Task từ chối. Nếu tiêu đề được sửa trước callback `after()`, push còn có thể mang nội dung **mới** sau khi mất quyền.

Đây là ngoại lệ nghiệp vụ có chủ ý để báo “bạn không còn được giao”, nhưng payload đang dùng chung với notification được xem resource. **Sửa:** định nghĩa payload `unassigned` riêng không đọc title/display number, không gắn URL tới resource không còn mở được; hoặc chỉ push title khi kiểm lại `taskViewersAmong` ngay trước gửi. Test bằng người chỉ có `task.read:assigned`, bỏ giao rồi kiểm payload push và GET chuông đều không chứa title.

### [sol5.5] P2-01 — Dòng bị redacted vẫn trả actor, loại sự kiện và ID resource/comment

`src/app/api/tasks/notifications/route.ts:223-274` tạo base với `task_id`, `entity_id`, `actor_email`, `comment_id`, `type`. Nhánh redacted chỉ ghi đè `detail`, `task_title`, `comment_body`, display number, nhưng `...n` vẫn giữ các trường trên và còn thêm `actor_name` từ `portal_account` (`:415-429`). `NotificationBell.tsx:614-640` tiếp tục hiển thị tên actor và action cho dòng redacted. Chế độ `mode=summary` cũng trả `unreadAssignedTaskIds` không qua kiểm scope (`route.ts:32-61,111-137`). Vì vậy thay đổi role/quan hệ không xóa được dấu vết về bản ghi khỏi response, dù không lộ title/body. `comment_id` và `entity_id` là định danh nội bộ; actor và event có thể là thông tin nhạy cảm sau khi rút quyền.

**Sửa:** xác định rõ phần metadata nào được phép lưu và hiện sau revoke. Nếu chủ đích chỉ giữ dòng để mark-read/unread, trả DTO redacted tối thiểu (`id`, `is_read`, `created_at`, `redacted`, câu chung) và lọc ID trong summary qua cùng visibility policy. Với `unassigned`, chỉ giữ câu nghiệp vụ đã duyệt. Test JSON response và UI sau revoke, không chỉ `visibleNotificationEntities` trả tập rỗng.

### [sol5.5] P2-02 — Hàm audience mới chia URL nhưng không bảo đảm đọc hết số hàng

`src/lib/notifications/audience.ts:37-56` chia `.in()` theo 100 ID nhưng mỗi chunk chỉ gọi một `.select()` không phân trang/count. Một trăm Task có thể sinh hơn giới hạn một trang `task_assignees`/`task_participants`; phần quan hệ sau giới hạn bị thiếu và thông báo của người hợp lệ bị drop hoặc bị redacted (`:120-171`). `loadViewers` cũng đọc toàn bộ roster `task_agents` và kết quả `agent_members` một trang (`:71-100`). Nếu Agent ở ngoài trang đầu, `isAgent=false`; với `task.read:shared_queue`, `seesAllTasks` thành true và Task notification ngoài nhóm có thể được gửi/hiện. Helper Task hiện hành `fetchSelectedAgentEmails` cũng dùng một trang (`src/lib/tasks/assignees.ts:42-49`), nên đây là rủi ro **xuyên policy**, không chỉ F.

**Sửa:** phân trang đến hết hoặc chuyển sang RPC trả facts cho đúng cặp `(entity,recipient)`; kiểm count và fail closed khi bị cắt, đặc biệt với roster/delegation dùng để **loại trừ** `shared_queue`. Test mock >1 trang roster và >1 trang assignee cho một batch. Không xem chia UUID 100 là bảo đảm đủ số hàng.

### [sol5.5] P2-03 — Lỗi một domain làm rút gọn mọi notification trong batch

`src/lib/notifications/read-access.ts:35-53` đặt Task, Enrollment, Time Off trong cùng `Promise.all` và một `catch` trả tập rỗng. Một lỗi đọc `agent_members` làm cả đơn nghỉ của chính người dùng và Task khác bị redacted dù các kiểm tra độc lập vẫn chạy được. Đây là fail closed về bảo mật, nhưng làm chuông mất nội dung hàng loạt trong một outage cục bộ. `read-access.test.ts:59-66` chỉ xác nhận hành vi rút gọn toàn bộ, không kiểm cách ly lỗi.

**Sửa:** xử lý lỗi theo từng domain, chỉ redacted loại không xác minh được; log/metric số dòng bị rút gọn và lý do. Duy trì nguyên tắc không cho hiện nội dung khi kiểm tra của chính domain đó thất bại.

### [sol5.5] P2-04 — Người được chọn nhận tin Time Off không xem được thông báo của chính mình

`src/lib/time-off/queries.ts:349-355` cho người nộp chọn **bất kỳ** đồng nghiệp active làm người nhận tin; `src/app/api/time-off/route.ts:245-260` chỉ kiểm account active. `resolveTimeOffRecipients` ghi thông báo cho người được chọn dù họ không giữ `timeoff.manage` (`src/lib/time-off/notifications.ts:55-75`). F2 lại chỉ cho xem nội dung đơn nếu người nhận có `timeoff.manage`, hoặc có `timeoff.request` **và là requester** (`src/lib/notifications/read-access.ts:57-84`). Với đồng nghiệp bình thường được chọn, dòng notification được insert nhưng GET trả redacted; nếu họ không có quyền Time Off, E1 còn ẩn chuông (`src/lib/authz/navigation.ts:96-102`). Mục đích nghiệp vụ “chọn người để báo tin, không cấp quyền duyệt” vẫn đúng, nhưng sản phẩm đang gửi một tin không có nội dung hữu ích.

**Sửa:** xác định nội dung tối thiểu người được chọn được phép nhận và hiện mà không mở đơn, hoặc giới hạn người chọn vào người có quyền xem đơn. Nếu cần quyền xem riêng, thêm relation `selected_manager` vào policy Time Off và chỉ cấp đúng record đó. Test người được chọn không có `timeoff.manage`, người chỉ có `notify.timeoff.submitted`, và người duyệt thật trên insert, GET chuông và điều hướng.

## Giới hạn và kiểm chứng

- `src/lib/notifications/audience.test.ts:62-113` kiểm vài persona legacy trên dữ liệu nhỏ; chưa kiểm managed grants, tràn trang, `unassigned` push, JSON redaction hoặc thay quyền giữa insert và push. Replay `scripts/authz-notification-replay.ts:1-10,41-69` dùng **quyền hiện tại**, không tái dựng quyền lúc gửi; kết quả là danh sách cần duyệt, không phải bằng chứng lịch sử đã hoặc chưa rò. Replay còn miễn `unassigned`, nên không phát hiện P1-01.
- Trên HEAD G (F code không đổi): `npm run typecheck` đạt, `npm run test:run` đạt **205 file / 1.766 test**, `npm run lint` exit 0 với hai warning cũ tại `public/sw.js` và `LeadTable.tsx`. `git diff --check 6e12a9a..429fa5f` đạt. Không gửi thử Web Push thực hoặc đọc DB production trong review.
- So với D: lọc Task/Enrollment tại insert và GET đã giảm rủi ro recipient ngoài scope, nhưng `notify.*` độc lập hiện chỉ tạo ứng viên; nếu cần người giám sát không có quyền đọc vẫn nhận **nội dung**, phải thiết kế entitlement thông tin riêng, không lách qua ngoại lệ của notification.
- So với E P2-05: role **chỉ** có `notify.task.*`/`notify.enrollment.*` nay thường không còn được ghi Task/Enrollment notification vì F1 đòi thêm quyền xem, nên phần “chuông ẩn dù đã ghi” của E không còn đúng cho hai nguồn này. Time Off vẫn có thể ghi cho `notify.timeoff.submitted` hoặc người được chọn rồi bị ẩn/redacted như P2-04. Cần cập nhật policy sản phẩm, không chỉ sửa điều kiện hiện chuông.

## Thứ tự sửa

1. Bịt payload Web Push `unassigned` và test từ route bỏ assignee đến payload thực.
2. Chốt/redact metadata sau revoke, gồm `summary` và native notification.
3. Đồng bộ recipient Time Off với quyền xem nội dung và điều hướng chuông; bảo đảm facts audience đầy đủ, cách ly lỗi theo domain.
