# Code review Phase E

Ngày review: 2026-09-26. Phạm vi chính xác: `fa1f6ea..6e12a9a` trên nhánh `feat/authz-phase-e` (HEAD `feat/authz-phase-f` hiện trỏ cùng commit), gồm E1 `435ba31`, E2 `6ee4081` và commit tài liệu `6e12a9a`; 36 file, 488 dòng thêm / 331 dòng xóa. Chỉ review code đã commit, không tính các tài liệu chưa track trong worktree.

## Kết luận

E1 đã chuyển Sidebar, trang đích sau đăng nhập và TopBar sang grant; E2 tách capability mức board của Task, Lead, Enrollment và dùng chung policy sửa mặc định Dashboard giữa page/API. Hướng đi đúng, không thấy Phase E mở thêm đường ghi backend ngoài grant. **Phase E chưa khép kín phần frontend của role tùy chỉnh**: registry điều hướng có trường hợp hiện sai/ẩn sai, còn các nút sửa/tạo/Activity suy từ quan hệ hoặc quyền đọc thay vì action thực. Backend vẫn từ chối các request không có grant, nên các phát hiện mới dưới đây chủ yếu là sai lệch UI và workflow. Bốn P1 của [review Phase D](./2026-09-26-authz-phase-d-code-review.md) vẫn tồn tại vì Phase E không sửa policy/import/commission identity/recipient routing.

## Phát hiện cần sửa

### [sol5.5] P2-01 — Registry `/config` không khớp page guard, trái mục tiêu “một chỗ”

`src/lib/authz/navigation.ts:63-67` cho mở menu Configuration nếu có `enrollment.options.manage`, `task.config.manage` **hoặc** `lead.config.manage`; không có `provider.update`. Nhưng `src/app/(authed)/config/page.tsx:68-93` dựng scope từ `loadConfigAdmin()` (đòi **cả** `enrollment.read` và `enrollment.options.manage`, `src/lib/table-config/access.ts:36-45`), `lead.config.manage`, hoặc `provider.update`. Do đó:

| Grant tùy chỉnh | Registry/Sidebar | `/config` thực tế |
|---|---|---|
| `task.config.manage:*` (không có `enrollment.options.manage`) | Hiện mục | Redirect `/unauthorized` |
| `enrollment.options.manage:*` (không có `enrollment.read`) | Hiện mục | Redirect `/unauthorized` |
| `provider.update:*` (không có hai nhóm trên) | Ẩn mục; `getFirstAccessiblePath` cũng bỏ qua `/config` | Page cho mở bảng Provider |

`src/lib/authz/navigation.test.ts:39-55` bỏ mục `config` khỏi phép so sánh persona legacy, không test các tổ hợp grant độc lập trên. Đây là lỗi ngay ở E1 và còn ảnh hưởng trang đích khi page khác từ chối (`src/lib/authz/page-guards.ts:14-20,33-42`).

**Đề nghị:** định nghĩa một policy thuần trả các scope config có thể mở từ grant/điều kiện tiên quyết, dùng chung cho registry và page. Tối thiểu, registry phải thêm `provider.update`, chỉ coi `enrollment.options.manage` là đủ khi kèm `enrollment.read`, và quyết định rõ `task.config.manage` có cho vào `/config` hay chỉ các trang cài đặt Task khác. Test ma trận từng grant đơn lẻ và tổ hợp, so `visibleNavKeys`, landing path và page gate.

### [sol5.5] P2-02 — Lead `canEdit` vẫn lấy từ phạm vi **đọc**, bỏ qua `lead.update`

E2 truyền `access: LeadBoardAccess` từ `src/app/(authed)/tasks/leads/page.tsx:57-63`, nhưng `editableOwnerEmails` vẫn lấy qua `resolveLeadOwnerEmails(actor)` (`:36-38`), hàm này chỉ đọc scope `lead.read` (`src/lib/leads/membership.ts:23-35`). `LeadsClient.tsx:1367-1405` đưa danh sách đó cho bảng và drawer; `LeadTable.tsx:277-289` gọi `leadIsInScope` làm `canEdit`. Với role `lead.read:all` **không có** `lead.update`, owner list là `null`, `leadIsInScope` luôn true (`src/lib/leads/capabilities.ts:45-51`), nên UI bật sửa mọi Lead; PATCH backend vẫn gác `lead.update` qua `resolveLeadCapabilities` (`src/app/api/leads/[id]/route.ts:64-72`). Ngược lại, role `lead.read:assigned` + `lead.update:all` bị UI giới hạn nút sửa vào lead assigned dù backend cho phép sửa lead khác nếu biết ID.

**Đề nghị:** tính capability từng Lead bằng `resolveLeadCapabilities` với relation facts hoặc truyền tập quan hệ cho **action update** riêng; không dùng `lead.read` làm quyền sửa. Test giao diện role `read:all` không `update`, và `read:assigned` + `update:all`, kèm API trực tiếp để xác nhận backend giữ nguyên guard.

### [sol5.5] P2-03 — Nút tạo Task/Enrollment vẫn suy từ persona, không kiểm grant `create` hẹp

`taskBoardAccessFor` chỉ có `createsAny = task.create:all` (`src/lib/tasks/access.ts:237-254`). `TaskBoardClient.tsx:1124-1128,2018,2089,2229` hiện nút tạo nếu account là Agent/Assistant trong roster (`canManageOwnAgentGroup`), **dù không có** `task.create:agent_owned`/`:assistant_for_agent`; dialog còn cho chọn assignee nhờ quan hệ đó (`NewTaskDialog.tsx:200-205`). POST kiểm grant thật ở `src/app/api/tasks/route.ts:154-169`, nên role chỉ có `task.read:agent_owned` vẫn thấy form rồi nhận 403.

Enrollment tương tự: `enrollmentBoardAccessFor` chỉ xuất `createsAny` (`src/lib/enrollment/policy.ts:123-139`); `EnrollmentClient.tsx:1147-1161,1846,1972` hiện nút khi `myAgents`/`myAssistantAgents` không rỗng, không kiểm `enrollment.create` scope tương ứng. Với `enrollment.read:all`, `enrollment/page.tsx:69-78` còn đặt `myAgents` thành mọi Agent, nên role đọc toàn bộ nhưng không có create thấy form tạo cho bất kỳ Agent nào; API POST từ chối (`src/app/api/enrollment/route.ts:209-225`).

**Đề nghị:** capability tạo phải xét `scopeMatches` với từng Agent được chọn; board chỉ hiện nút khi có ít nhất một Agent thỏa `create` policy. Truyền danh sách Agent được phép tạo từ server hoặc evaluator thuần dùng cùng grant và quan hệ; giữ API là cổng cuối. Test role read-only là Agent/Assistant, `read:all` không create, và `create:assistant_for_agent` chỉ cho Agent được ủy quyền.

### [sol5.5] P2-04 — Tab Activity Task vẫn hiện cho Agent/Assistant thiếu `task.activity.read`

E2 thêm `activityAll`, nhưng `TaskBoardClient.tsx:2015-2017` tính `canViewOpenNonCommentDetail = activityAll || isAgentOwnerOrAssistantOf(...)`. Quan hệ Agent/Assistant tự làm tab Activity/Overdue hiện (`TaskDetailDrawer.tsx:1101,1161-1174`), dù role chỉ có `task.read:agent_owned` hoặc `task.read:assistant_for_agent` và **không** có `task.activity.read`. API Activity lại dùng `canReadTaskActivity` (`src/app/api/tasks/[id]/activity/route.ts:57-65`), nên request bị 403. Đây là sai lệch mới trong phép chuyển từ cờ `isManager` sang capability, cùng họ với P2-03.

**Đề nghị:** tính quyền Activity theo `canReadTaskActivity(actor, relation)` cho Task đang mở và trả capability tương ứng; không coi quan hệ là grant. Test Agent/Assistant chỉ có read và Agent/Assistant có activity grant đúng scope.

### [sol5.5] P2-05 — Chuông thông báo không xét grant `notify.*`

`src/lib/authz/navigation.ts:91-103` chỉ bật chuông khi có `task.read`, `enrollment.read` hoặc quyền Time Off. D4 đã cho cấp `notify.task.escalation`, `notify.enrollment.qc` và `notify.timeoff.submitted` độc lập (`src/lib/authz/catalog.ts:206-216`, `src/lib/tasks/membership.ts:192-219`). Account được cấu hình chỉ nhận thông báo giám sát và có một trang khác để đăng nhập sẽ được ghi/push notification nhưng TopBar ẩn chuông (`src/app/(authed)/layout.tsx:39-46`, `TopBar.tsx:60-64`). Đây là mất đường xem lại thông báo; đồng thời liên quan P1-04 Phase D: quyền nhận thông tin phải được định nghĩa rõ với quyền đọc resource.

**Đề nghị:** xác định `notify.*` là quyền nhận nội dung độc lập hay chỉ là ứng viên phải qua read policy. Sau khi chốt, `canUseNotifications` dùng chính entitlement của kênh thông báo và test role chỉ có `notify.*`, role Time Off và role chỉ có read. Không chỉ sửa điều kiện chuông nếu recipient routing vẫn có thể lộ resource ngoài scope.

### [sol5.5] P2-06 — Registration grid chưa nhận capability update; read-only role vẫn thấy ô sửa

E2 chuyển Task/Lead/Enrollment nhưng không chuyển Registration. `src/app/(authed)/page.tsx:11-42` và `customer-registration/pc/page.tsx:11-42` chỉ lấy `registration.*.read` để dựng grid, không truyền quyền `create/update`; `EntryGrid.tsx:166-210` và `PcEntryGrid.tsx:175-225` đánh dấu nhiều cột `editable: true`. Role grant tùy chỉnh chỉ có `registration.health.read:all` hoặc `registration.pc.read:own` vẫn thấy thao tác sửa, còn API PATCH/DELETE đòi `registration.*.update` (`src/app/api/entries/[id]/route.ts:61-71`, P&C tương tự). Plan cũng thừa nhận thiếu sót này ở `docs/superpowers/plans/2026-09-26-authorization-final-plan.md:2751-2758`, nhưng trường hợp read-only hoàn toàn rộng hơn ví dụ `read:all + update:own` ghi trong plan.

**Đề nghị:** truyền capability `create` và `update` theo đúng action/scope vào grid, tính `isCellEditable`/nút xóa theo từng row; test read-only, own-update và all-update cho cả hai domain.

## Điểm tốt và giới hạn kiểm chứng

- `src/lib/authz/navigation.ts:40-89` là nguồn chung cho menu và landing path của phần lớn page; `layout.tsx:26-46` tính từ principal server thay vì gửi permission cũ xuống Sidebar. `src/lib/authz/page-guards.ts:14-42` dùng grant cho redirect; middleware vẫn chỉ kiểm đăng nhập, nên backend guard tiếp tục là nguồn quyết định.
- `src/lib/leads/access.ts:78-102` tách `read/overview/create/assign/import` rõ; `src/lib/tasks/access.ts:237-254` và `src/lib/enrollment/policy.ts:123-139` tạo board capability; Dashboard dùng `canEditDashboardDefault` chung cho page/API (`src/lib/dashboard-filter-defaults.ts:38-62`, `src/app/api/dashboard-filter-defaults/route.ts:1-32`). Đây là nền tốt để sửa các lệch trên.
- `src/lib/authz/navigation.test.ts:38-69` kiểm persona legacy và landing cơ bản. E2 không thêm test ma trận UI role tùy chỉnh; vì vậy các tổ hợp grant tách rời ở P2-02/03/04/06 vẫn xanh. `Sidebar.tsx:22-142` còn giữ `href` riêng ngoài `NAV_ROUTES` (`src/lib/authz/navigation.ts:40-72`); hiện các route chính khớp, nhưng nên có test mapping hoặc dùng một registry để tránh drift lần sau.
- Kiểm trên snapshot commit `6e12a9a`: `npm run typecheck` đạt; `npm run test:run` đạt **202 file / 1.757 test**; `npm run lint` exit 0 với hai warning ở `public/sw.js` và `LeadTable.tsx`; `git diff --check fa1f6ea..6e12a9a` đạt. Không chạy DB gate vì Phase E không có SQL/migration. Test xanh không chứng minh UI và API thống nhất ở các role grant tùy chỉnh.

## Thứ tự xử lý

1. Chốt và sửa policy điều hướng Configuration; thêm test ma trận nav → page guard, gồm Provider và grant đơn lẻ.
2. Truyền capability theo **action + resource** cho Lead edit, Task/Enrollment create và Activity; xử lý Registration grid theo cùng nguyên tắc.
3. Chốt semantics `notify.*` rồi đồng bộ bell với recipient policy. Trước khi bật role grant tùy chỉnh trên production, giải quyết bốn P1 kế thừa Phase D.
