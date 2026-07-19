# Role-Based User Guide and System Review

Cập nhật: 2026-07-19

Tài liệu này dùng cho 2 mục tiêu:

1. Người dùng từng role đọc vào biết mình thấy được màn nào, làm được gì, dùng notification ra sao.
2. Admin/dev đọc vào biết logic hiện tại đang hoạt động thế nào, thiếu điểm nào, UI nên chỉnh gì tiếp.

## 1. Cách hệ thống phân quyền

Web hiện tại chạy theo permission, không chỉ theo tên role. Một account có thể được gán role khác nhau, và role đó chứa các permission mở từng khu vực của portal.

Riêng Task Management có một rule đặc biệt:

- Task admin/manager view cần cả `task.manage` và role hệ thống dạng admin/Super Admin.
- User có `task.manage` nhưng không phải admin vẫn có quyền vào task board như worker/agent-scope, không tự động thấy toàn bộ admin overview.
- User có `task.work` được làm task được giao, task được mention, hoặc task trong phạm vi agent/team mà hệ thống cho phép.

Permission chính:

| Permission | Khu vực mở ra | Ghi chú |
| --- | --- | --- |
| `customer_registration.health` | Customer Registration / Health | Nhập, sửa, import/export enrollment Health |
| `customer_registration.pc` | Customer Registration / P&C | Nhập, sửa, import/export P&C |
| `automation.health_statement` | Automation / Health Statement | Upload data, preview, tạo Excel statement |
| `automation.pc_statement` | Automation / P&C Statement | Upload data, preview, tạo Excel statement |
| `automation.provider_finder` | Automation / Provider Finder | Tìm provider theo địa chỉ, bảo hiểm, specialty |
| `agent_dashboard.health` | Dashboard / Health agent view | Dashboard scoped theo agent/user |
| `agent_dashboard.pc` | Dashboard / P&C agent view | Dashboard scoped theo agent/user |
| `company_dashboard.health` | Dashboard / Health company view | Company/Sales dashboard |
| `company_dashboard.pc` | Dashboard / P&C company view | Company/Sales dashboard |
| `company.view_all` | Mở rộng dữ liệu toàn công ty | Dùng trong dashboard/registration để xem toàn bộ |
| `task.work` | Task Management worker | Làm task, comment, nhận notification |
| `task.manage` | Task Management admin capability | Cần thêm admin role để vào admin view |
| `management.account_manager` | Account Manager | Tạo/sửa/xóa account, reset password, gán role |
| `management.role_manager` | Role Manager | Tạo/sửa role, bật/tắt role, gán permission |
| `settings.access` | Settings | Đổi password; UI email/avatar hiện chưa hoàn chỉnh |

## 2. Tổng quan tính năng web

### Customer Registration

Health Registration và P&C Registration là các màn dạng spreadsheet để nhập dữ liệu đăng ký khách hàng.

Người dùng có thể:

- Nhập dữ liệu trực tiếp theo dòng/cột.
- Import CSV hàng loạt.
- Search theo policy/name.
- Export Excel.
- Save Changes để lưu thay đổi.
- Nếu có `company.view_all`, xem được toàn bộ records. Nếu không, dữ liệu bị scope theo user/agent tùy query của từng module.

### Automation Tool

Health Statement:

- Upload carrier payment data.
- Nhập statement number/month.
- Run Report để build preview.
- Xem Statement Summary, Statement Reconcile, Excel Preview.
- Create Excel File để tải file kết quả.

P&C Statement:

- Upload payment/policy files.
- Run Report để build preview.
- Xem summary/reconcile/Excel Preview.
- Create Excel File để xuất báo cáo.

Provider Finder:

- Nhập address, insurance, specialty/radius.
- Run để tìm Top 10 Providers.
- Xem danh sách provider và map.
- Chọn provider để inspect vị trí/thông tin.

### Dashboard

Health Dashboard và P&C Dashboard có 2 kiểu view:

- Agent view: dữ liệu của agent/user hiện tại, hoặc toàn bộ nếu user có `company.view_all`.
- Company view: dữ liệu company/sales nếu có permission company dashboard.

Người dùng có thể:

- Lọc report month/date range, carrier, policy, statement, state/city, agent/agency tùy dashboard.
- Xem KPI tổng quan, trend, bảng theo agent/carrier/state/city/policy.
- Export XLSX ở các bảng hỗ trợ export.
- Dùng Dashboard Assistant để hỏi nhanh về số liệu dashboard.

### Management

Account Manager:

- Tạo account mới.
- Sửa email/name/agent id.
- Gán role.
- Reset password.
- Xóa account.
- Bật/tắt trạng thái active thông qua edit account.

Role Manager:

- Tạo role.
- Duplicate role.
- Sửa tên/mô tả/permission.
- Search permission.
- Bật/tắt role.
- Xóa role không protected.
- Protected role như Super Admin/Admin không nên sửa/xóa trực tiếp.

### Settings

Settings hiện có:

- Đổi password thật qua API.
- Upload Image và Save email đang là UI placeholder, chưa có API lưu avatar/email.

Ghi chú UI: route `/settings` có trong route guard, nhưng sidebar hiện chưa expose mục Settings. Nên thêm vào sidebar cho user có `settings.access`.

## 3. Task Management: khái niệm chính

Task có các field quan trọng:

- Key: mã task hiển thị dạng `TASK-xxx`.
- Summary/title: nội dung chính.
- Agent: agent/account liên quan đến task.
- Assignee(s): người đang xử lý task.
- Creator/reporter: người tạo task.
- Category: loại task, ví dụ Call Insurance Company, Resolve Billing Issue.
- Priority: Urgent, High, Medium, Low.
- Status: Backlog, To Do, In Progress, Waiting, Done, Cancel.
- SLA: thời gian active dựa trên priority/category.
- QC: task Done có thể cần review/tick QC.

Ý nghĩa status:

| Status | Ý nghĩa | Rule chính |
| --- | --- | --- |
| Backlog | Task chưa assign | Chỉ task không có assignee mới ở Backlog |
| To Do | Đã assign, chưa bắt đầu | Có thể bị reminder nếu nằm lâu |
| In Progress | CS đang xử lý | SLA active lần đầu, có due soon/overdue |
| Waiting | Đang chờ ngoài hệ thống/khách/hãng | SLA không tiếp tục active; dùng waiting reminder |
| Done | Đã xong | Có thể cần QC review |
| Cancel | Hủy | Có thể reopen có reason |

Rule SLA/overdue:

- SLA snapshot khi task lần đầu vào In Progress.
- Overdue chỉ tính khi task đang In Progress, chưa từng qua Waiting, và chưa từng overdue trước đó.
- Sau khi task đã overdue một lần, `overdue_count` giữ lịch sử "was overdue"; task không bị overdue lại lần 2 theo cùng SLA logic.
- Unlock overdue cần reason và đưa task về To Do.
- Reopen Done/Cancel cũng cần reason.
- Filter Overdue trong List nên bắt cả task đang overdue và task từng overdue/reopened.

## 4. Hướng dẫn theo role

### A. Admin / Super Admin / Task Manager

Mục tiêu role: nhìn toàn bộ tình hình workload, quyết định assign/reassign, xử lý backlog, quản lý SLA/category/group, kiểm soát task health.

Admin sẽ thấy Task Management với thứ tự tab:

1. Overview
2. Board
3. List
4. Backlog

Overview:

- Dùng để xem tình hình workload của từng CS, không chỉ để xem recommendation.
- KPI đầu trang cho biết CS pool, open tasks, urgent/high, needs attention, unassigned.
- Attention areas cho biết nhóm rủi ro lớn như overdue in progress, todo stuck, waiting stuck, unknown effort.
- Work mix là bảng stage x priority, tách riêng Todo overdue và In progress overdue để admin biết risk thật.
- CS workload table cho biết từng CS đang có bao nhiêu task mở, task ở stage nào, overdue bao nhiêu, oldest task date, done 24h, SLA exposure.
- Assignments outside CS pool cho biết task đang assign ra ngoài nhóm CS.
- Unassigned queue cho biết task chưa assign, gồm task, agent, category, created, priority, SLA, action Recommend.

Board:

- Dùng cho vận hành kiểu kanban.
- Kéo task giữa To Do, In Progress, Waiting, Done/Cancel nếu transition hợp lệ.
- Backlog không nằm trong Board chính; Backlog là tab riêng.

List:

- Dùng khi cần audit nhiều task cùng lúc.
- Cột nên ưu tiên: Key, Assignee, Creator, Summary, Category, Created, Priority, Status, QC.
- Filter theo agent, assignee, status, priority, overdue, category, date range.
- Search tìm trong title/comment.

Backlog:

- Dùng để xử lý task chưa có assignee.
- Admin có thể assign thủ công hoặc dùng Recommend từ Overview.
- Task Backlog phải không có assignee.

Admin actions:

- New task: tạo task, chọn agent, category, priority, assignee(s).
- Agent Groups: quản lý agent nào có CS nào hỗ trợ và assistant nào được quyền hỗ trợ.
- Categories: quản lý loại task.
- SLA Times: quản lý SLA theo priority/category.
- Assign/Reassign: gán người xử lý.
- QC: tick task Done đã review.
- Delete task khi cần.
- Reopen Done/Cancel có reason.
- Unlock overdue có reason.

Admin nên dùng notification khi:

- Có overdue unlocked để biết CS đã giải quyết overdue với lý do gì.
- Có QC stale để kiểm task Done lâu chưa review.
- Có stale task để biết task im lặng lâu.
- Có assignment/reassignment liên quan đến mình.

### B. Agent Owner

Mục tiêu role: quản lý task liên quan đến agent của mình, giao việc cho CS team, theo dõi tiến độ.

Agent owner có thể:

- Xem task thuộc agent của mình.
- Tạo task cho agent của mình nếu có task scope hợp lệ.
- Assign/reassign task trong phạm vi agent/team.
- Edit content task trong phạm vi agent của mình.
- Change status nếu là agent owner/assistant của task.
- Delete task thuộc agent của mình nếu backend cho phép.
- Review QC task thuộc agent của mình.
- Nhận notification comment/mention/overdue liên quan.

Lưu ý UI hiện tại:

- Backend có khái niệm agent owner/assistant manage own agent group, nhưng nút `Agent Groups` trên header hiện chỉ hiện cho manager/admin. Nếu muốn agent owner tự quản lý group, cần expose nút này theo `canManageOwnAgentGroup`.

Agent owner nên dùng notification khi:

- CS comment hoặc mention mình để hỏi thông tin.
- Task được reopen hoặc overdue unlocked.
- QC needed/QC stale cho task Done của team.
- Waiting reminder để follow up blocker.

### C. Assistant

Assistant là người được promote để hỗ trợ một hoặc nhiều agent.

Assistant có thể:

- Xem task của agent mình hỗ trợ.
- Tạo task trong scope agent được hỗ trợ.
- Assign/reassign trong phạm vi agent/team nếu backend xác định là assistant của agent đó.
- Change status, unlock overdue, reopen trong task thuộc agent được hỗ trợ.
- QC/review task của agent được hỗ trợ.
- Comment/mention và nhận notification như agent owner.

Assistant nên dùng notification khi:

- Có task của agent được hỗ trợ bị overdue hoặc waiting lâu.
- Có comment/mention cần phản hồi.
- Có QC needed/QC stale.

### D. CS / Worker

Mục tiêu role: xử lý task được giao, cập nhật status đúng, comment rõ khi bị blocker.

CS có thể:

- Xem task được assign cho mình.
- Xem task mình được @mention, vì mention sẽ thêm mình vào participants.
- Xem task trong phạm vi team nếu logic agent/team cho phép.
- Move task mình được assign: To Do -> In Progress -> Waiting/Done/Cancel theo rule.
- Unlock overdue task mình được assign, bắt buộc nhập reason.
- Reopen task Done/Cancel mình được phép thao tác, bắt buộc nhập reason.
- Comment, reply, mention người khác.
- Upload attachment nếu có quyền view/mutate theo task.
- Tick/untick QC chỉ khi có quyền review, thường không phải CS thường.

CS không nên/có thể không được:

- Tạo task nếu không có agent scope.
- Assign task cho người khác nếu không phải manager/agent owner/assistant.
- Xem toàn bộ task pool.
- Quản lý category/SLA/agent groups.

CS nên dùng notification khi:

- Assigned: có task mới được giao.
- Mentioned/commented: có người hỏi hoặc update trong task.
- Due soon: task In Progress sắp hết SLA.
- Overdue: task In Progress đã quá SLA, cần xử lý hoặc unlock với reason nếu vẫn cần làm tiếp.
- Todo reminder: task ở To Do lâu chưa start.
- Waiting reminder: task Waiting lâu, cần follow up.
- Reopened: task Done/Cancel bị mở lại, cần làm tiếp.
- Unassigned: mình bị gỡ khỏi task.

Best practice cho CS:

- Chỉ chuyển In Progress khi thật sự bắt đầu xử lý.
- Dùng Waiting khi đang chờ external party, không dùng để né SLA.
- Khi unlock overdue, reason phải đủ rõ để admin hiểu: đang chờ gì, đã làm gì, next step khi nào.
- Comment mỗi lần có blocker hoặc update quan trọng.

### E. Mentioned participant

Người được @mention trong comment sẽ được thêm vào participant để xem task.

Participant có thể:

- Mở task từ notification.
- Đọc context.
- Comment/reply lại.

Participant thường không thể:

- Assign/reassign.
- Change status nếu không phải assignee/agent owner/admin.
- Edit task content nếu không phải reporter/agent owner/admin.

### F. Account Manager

Account Manager có thể:

- Tạo account mới.
- Gán role khi tạo account.
- Sửa account.
- Reset password.
- Delete account.
- Gán lại role.

Khi dùng role:

- Chỉ gán role đúng chức năng thật sự cần.
- Account CS làm task cần role có `task.work`.
- Admin task cần role admin/Super Admin và permission `task.manage`.
- Agent owner/assistant cần được cấu hình đúng trong Agent Groups/task_agents để backend nhận diện scope.

### G. Role Manager

Role Manager có thể:

- Tạo role mới.
- Duplicate role để tạo role gần giống role cũ.
- Bật/tắt role.
- Delete role không protected.
- Search và tick permission theo group.

Best practice:

- Tạo role theo job thật, ví dụ `CS Worker`, `Task Admin`, `Health Dashboard Viewer`.
- Không gán quá rộng `company.view_all` nếu user chỉ cần data của mình.
- Không trộn `task.manage` với role non-admin nếu kỳ vọng user thấy admin overview, vì task admin view còn cần admin role.

### H. Dashboard-only user

Dashboard-only user chỉ cần permission dashboard tương ứng.

Họ có thể:

- Xem Health/P&C dashboard theo scope.
- Dùng filters.
- Export bảng hỗ trợ export.
- Dùng Dashboard Assistant.

Họ không có task notification nếu không có task permission hoặc không liên quan task.

### I. Automation user

Automation user dùng các tool statement/provider theo permission được cấp.

Họ có thể:

- Upload file input.
- Run/refresh preview.
- Validate summary/reconcile.
- Export Excel result.

Notification bell hiện không gửi noti cho automation job hoàn tất/thất bại; thông tin nằm trong màn tool.

## 5. Notification hoạt động thế nào

Notification hiện tập trung cho Task Management.

Cách delivery:

- Bell ở top bar hiển thị unread count.
- Dropdown lấy 30 notification gần nhất.
- Poll API định kỳ: khoảng 20 giây nếu có realtime, fallback 10 giây nếu không.
- Supabase realtime broadcast chỉ gửi "ping", nội dung notification vẫn lấy từ DB.
- Khi có notification mới sau lần load đầu: phát chime, hiện toast trong app, tối đa 4 toast.
- Nếu browser đã grant permission, hiện native OS notification.
- Click notification mở task detail hoặc điều hướng tới `/tasks?task=<id>`.
- Có Mark all read và read theo notification khi mở.

Các loại notification:

| Type | Khi nào trigger | Ai nhận | User nên làm gì |
| --- | --- | --- | --- |
| `assigned` | Task được tạo/assign/reassign cho user | Assignee mới | Mở task, đọc yêu cầu, đưa vào To Do/In Progress đúng thời điểm |
| `unassigned` | User bị gỡ khỏi task | Assignee cũ | Không cần làm nữa, check nếu bị gỡ nhầm |
| `mentioned` | User được @mention trong comment | Người được mention | Trả lời hoặc xử lý phần được hỏi |
| `commented` | Có comment mới trong task mình liên quan | Assignee, participant, reporter, agent owner tùy task | Đọc update, phản hồi nếu cần |
| `due_soon` | In Progress gần hết SLA | Assignee | Ưu tiên xử lý hoặc comment blocker |
| `overdue` | In Progress quá SLA lần đầu | Assignee | Xử lý ngay hoặc unlock overdue với reason |
| `overdue_reminder` | Task vẫn overdue sau reminder interval | Assignee | Follow up ngay |
| `todo_reminder` | Task To Do quá lâu chưa start | Assignee | Start task hoặc comment vì sao chưa làm |
| `waiting_reminder` | Task Waiting quá lâu | Assignee | Follow up external party, cập nhật comment |
| `stale` | Task không có activity quá lâu | Assignee/related recipients theo cron | Update trạng thái hoặc comment |
| `qc_needed` | Task Done cần review | Agent owner/assistant/admin recipients | Review và tick QC |
| `qc_stale` | Task Done lâu chưa QC | Agent owner/assistant | Review QC ngay |
| `reopened` | Done/Cancel task bị reopen | Assignee | Đọc reason, xử lý tiếp |
| `overdue_unlocked` | Overdue được unlock về To Do với reason | Agent owner/assistant + admins | Kiểm tra reason và follow up nếu cần |

Những thứ hiện chưa có task notification:

- Attachment added: có activity log nhưng không notify assignee/watchers.
- Comment edit/delete: không notify.
- Account/role/settings changes: không notify qua bell.
- Automation job complete/fail: không notify qua bell.
- Dashboard data anomaly: không notify qua bell.

## 6. Review logic/code hiện tại

### High priority

1. Notification `detail` đang bị mất.

- Schema có cột `task_notifications.detail`.
- UI đã render `Reason:` nếu notification có `detail`.
- Overdue unlock route gửi `detail: reason`.
- Nhưng helper `insertNotifications()` không insert `detail`, nên reason không lưu vào DB.
- Tác động: admin/agent nhận `overdue_unlocked` nhưng không thấy lý do, làm mất giá trị audit.
- Nên fix: thêm `detail: r.detail ?? null` vào insert mapping và test notification detail.

2. Multi-assignee API có thể assign tới email bất kỳ.

- `task_assignees.email` chỉ là text, không FK tới active account.
- `/api/tasks/[id]/assignees` hiện comment rõ người có assign right có thể assign ANY account.
- Tác động: gọi API trực tiếp có thể assign email không tồn tại, inactive user, hoặc người ngoài CS pool.
- Nên fix: validate target email là active portal account có `task.work`/`task.manage`; với agent owner/assistant thì target phải thuộc team/allowed scope, hoặc policy sản phẩm phải định nghĩa rõ "assign any task worker".

3. Assignment scope đang không thống nhất giữa routes.

- PATCH route single-assignee đã chặn non-manager assign ngoài team.
- Multi-assignee route lại cho assign ANY account.
- UI picker có props `agentEmail`/`agentMembersByAgent` nhưng cần chắc chắn dùng để filter đúng scope ở mọi nơi.
- Nên fix: gom assignment validation vào một shared helper và dùng ở create, patch, add assignee, recommend assign.

### Medium priority

4. Overview recommend API chỉ check admin role, chưa check `task.manage` trong endpoint.

- Page đã gate bởi task permission, nhưng API nên tự check đầy đủ.
- Nên dùng `buildTaskActor(...).isManager` thay vì chỉ `isTaskViewAdmin()`.

5. Agent owner/assistant group-management UI chưa expose đúng nếu sản phẩm muốn họ tự quản lý group.

- Backend/UI state có `canManageOwnAgentGroup`.
- Header button `Agent Groups` hiện chỉ render khi `isManager`.
- Nếu agent owner/assistant cần tự chỉnh team, đổi condition hiển thị button và giới hạn modal theo manageable agent emails.

6. Settings có route nhưng sidebar chưa có mục Settings.

- User có `settings.access` có thể được redirect tới `/settings`, nhưng sidebar không có entry.
- Nên thêm section/profile menu link cho Settings.

7. Native notification permission đang request ngay khi component mount.

- Browser prompt có thể xuất hiện trước khi user hiểu feature.
- Nên đổi thành explicit button trong bell: "Enable desktop notifications".

8. Settings avatar/email là placeholder.

- Upload Image và Save email chưa có API thật.
- Nên disable rõ hoặc implement đầy đủ để tránh user tưởng đã lưu.

9. Attachment activity không gửi notification.

- Nếu file upload là workflow quan trọng, nên notify assignee/participant/agent owner.

### Nice to have

10. Notification preferences chưa có.

- Nên cho user chọn nhận chime/toast/native cho từng loại notification.
- Admin nên có setting reminder interval ngay trong UI.

11. Assignment recommendation nên có "why".

- Khi admin bấm Recommend, nên hiện lý do: CS đang free/busy, open tasks, urgent/high, overdue, waiting, SLA load.
- Giúp admin tin dashboard hơn và audit được quyết định assign.

12. Cần audit view cho overdue/reopen.

- Có activity và overdue_events, nhưng UI nên có panel "SLA history" trong task detail: overdue at, unlocked at, reason, actor.

## 7. UI nên chỉnh tiếp

### Task toolbar admin

Layout hợp lý hiện tại:

- Dòng 1: tab view bên trái, date range bên phải.
- Dòng 2: filters theo thứ tự Agent, Assignee, Status, Priority, Overdue, Category; task count nằm bên phải.
- Dòng 3: search/comment search full width.

Nên thêm:

- Clear all chỉ hiện khi có filter active.
- Overdue filter nhìn như toggle rõ trạng thái active/inactive.
- Date range label nên nhất quán: `All task dates`, `This week`, custom range.

### Task List table

Admin table nên ưu tiên decision-making:

| Cột | Vì sao cần |
| --- | --- |
| Key | Audit/reference |
| Assignee | Biết ai đang xử lý |
| Creator | Biết ai tạo/cần hỏi nguồn |
| Summary | Nội dung task |
| Category | Loại việc |
| Created | Task được tạo ngày nào |
| Priority | Mức độ khẩn cấp |
| Status | Stage hiện tại |
| QC | Tick nhỏ cuối dòng |

Nên tránh:

- Avatar-only assignee nếu admin cần đọc tên nhanh.
- Badge quá to làm table rối.
- Text bị truncate ở các cột quan trọng mà không có tooltip/title.

CS table nên gọn hơn:

- Key, Summary, Category, Created, Priority, Status, SLA, QC nếu có.
- Assignee có thể ẩn vì đa số là chính user.
- Creator nên giữ nếu CS cần biết hỏi ai.

### Task Overview dashboard

Nên giữ dashboard core là chart/table giúp admin ra quyết định:

- KPI summary.
- Attention areas.
- Work mix stage x priority, tách overdue rows.
- CS workload table.
- Unassigned queue.
- Recommendation chỉ là action append, không phải core.

Nên thêm:

- Export workload snapshot CSV/XLSX.
- Click KPI/filter để focus table/list.
- Tooltip giải thích SLA exposure là workload proxy, không phải ETA.
- "Last updated" + refresh rõ ràng.

### Notification UI

Nên thêm:

- Notification settings trong dropdown.
- Filter unread/all.
- Group by task khi nhiều notification cùng task.
- Hiển thị reason cho overdue unlock sau khi fix `detail`.
- Desktop notification opt-in button thay vì prompt tự động.

### Management UI

Nên thêm:

- Search account/role.
- Audit log account/role changes.
- Confirm rõ khi delete account/role.
- Show effective permissions của account sau khi chọn role.

## 8. Phần nên thêm vào sản phẩm

1. Shared assignment policy helper.

Một helper duy nhất trả lời:

- Ai được assign task này?
- Được assign cho ai?
- Vì sao không được?

Dùng chung ở create task, patch task, add/remove assignee, recommend assign, UI picker.

2. Notification preference + admin reminder settings UI.

- User tự bật/tắt chime/native/toast.
- Admin chỉnh due soon minutes, todo reminder hours, waiting reminder hours, overdue reminder hours, stale hours, QC stale hours.

3. Task audit/SLA history panel.

- Timeline rõ: created, assigned, started, waiting, overdue, unlock reason, reopen reason, done, QC.

4. Bulk action trong List/Backlog.

- Bulk assign.
- Bulk status change nếu hợp lệ.
- Bulk category/priority update.
- Bulk mark QC.

5. Saved views.

- Admin lưu filter như "Overdue + High", "Unassigned urgent", "Waiting > 24h".
- CS lưu "My due soon", "My waiting".

6. Export reports.

- Export CS workload overview.
- Export overdue/reopen report.
- Export task list theo filter hiện tại.

7. Better in-app help.

- Một Help drawer theo role, lấy nội dung rút gọn từ tài liệu này.
- Admin thấy hướng dẫn admin; CS thấy hướng dẫn CS.

## 9. Checklist vận hành nhanh

Admin mỗi ngày:

- Mở Overview đầu tiên.
- Check Attention areas.
- Check CS workload table theo Overloaded/Busy/Free.
- Check Unassigned queue và assignments outside CS pool.
- Assign/reassign task cần xử lý.
- Check QC stale và overdue unlocked notification.

Agent owner/assistant mỗi ngày:

- Check task của agent mình.
- Check Waiting/Overdue.
- Trả lời mentions/comments.
- Review QC.

CS mỗi ngày:

- Mở task board/list của mình.
- Xử lý Assigned/Commented/Mentioned notifications.
- Start task khi bắt đầu làm.
- Đưa Waiting khi chờ external party.
- Comment blocker.
- Không để due soon/overdue im lặng.

Account/Role admin khi có user mới:

- Tạo account.
- Gán role đúng permission.
- Nếu là CS, đảm bảo có `task.work`.
- Nếu là task admin, đảm bảo có admin/Super Admin role và `task.manage`.
- Nếu là agent owner/assistant, cấu hình agent/team scope tương ứng.
