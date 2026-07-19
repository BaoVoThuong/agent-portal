# User Guide

Cập nhật: 2026-07-19

Tài liệu này dành cho người dùng portal. Nội dung tập trung vào:

- Mỗi role có thể làm gì.
- Từng màn có feature nào.
- Cách dùng Task Management.
- Khi nào nhận notification và cần xử lý thế nào.

## 1. Cách đọc tài liệu này

Portal dùng quyền truy cập theo permission. Role của bạn quyết định bạn thấy menu nào trên sidebar và có thể thao tác gì trong từng màn.

Nếu bạn không thấy một màn hoặc một nút nào đó, thường là do account chưa được cấp đúng permission hoặc chưa được đưa vào đúng agent/team scope.

Các khu vực chính:

- Customer Registration
- Automation Tool
- Dashboard
- Task Management
- Management
- Settings
- Notification Bell

## 2. Navigation chung

Sau khi đăng nhập:

1. Sidebar bên trái hiển thị các khu vực bạn có quyền truy cập.
2. Top bar bên phải có thông tin user, notification bell, và menu account.
3. Nếu bạn không có quyền vào bất kỳ màn nào, hệ thống sẽ đưa bạn tới trang unauthorized.
4. Notification bell dùng chủ yếu cho Task Management.

Các hành động chung:

- Dùng sidebar để đổi module.
- Dùng filter/search ở từng màn để thu hẹp dữ liệu.
- Dùng export nếu màn đó có nút Export.
- Nếu thấy dữ liệu thiếu, kiểm tra lại date range/filter trước khi báo lỗi.

## 3. Ba role chính

Portal hiện chia người dùng thành 3 nhóm role chính:

1. Admin
2. Agent/Assistant
3. CS

Một số màn như Dashboard, Automation, Registration, Account Manager, Role Manager vẫn mở theo permission. Nhưng khi hướng dẫn vận hành, chỉ cần hiểu theo 3 nhóm role trên.

### Admin

Admin là người quản trị và điều phối toàn bộ hệ thống.

Admin có thể:

- Xem toàn bộ task trong Task Management.
- Dùng Task Overview để biết workload của từng CS.
- Dùng Board/List/Backlog để vận hành task.
- Tạo task mới.
- Assign/reassign task cho CS.
- Quản lý Agent Groups.
- Quản lý Categories.
- Quản lý SLA Times.
- Review QC.
- Unlock overdue.
- Reopen task Done/Cancel.
- Xử lý Unassigned queue.
- Xem assignments outside CS pool.
- Xem dashboard company nếu được cấp permission dashboard.
- Dùng Customer Registration, Automation Tool nếu được cấp permission tương ứng.
- Quản lý account/role nếu được cấp permission Management.
- Đổi password trong Settings.

Admin nên dùng:

- Overview để quyết định workload và ưu tiên.
- Board để theo dõi tiến độ theo stage.
- List để audit/filter task.
- Backlog để xử lý task chưa assign.
- Account Manager để tạo/sửa account, reset password, gán role.
- Role Manager để tạo/sửa role và permission.

Admin nên check mỗi ngày:

- CS nào quá tải.
- Task nào urgent/high.
- Task nào overdue.
- Task nào Waiting lâu.
- Task nào To Do lâu chưa start.
- Task nào chưa assign.
- Task Done nào chưa QC.

### Agent/Assistant

Agent và Assistant là nhóm phụ trách task theo phạm vi agent/team được cấu hình.

Agent/Assistant có thể:

- Xem task thuộc agent/team mình phụ trách.
- Tạo task trong phạm vi agent nếu được cấp scope.
- Assign/reassign task trong phạm vi team/scope nếu được phép.
- Theo dõi task của CS trong team.
- Comment/reply trong task.
- @mention người cần phản hồi.
- Upload attachment nếu task cho phép.
- Follow up task Waiting/Overdue.
- Review QC nếu được cấp quyền trong scope.
- Reopen hoặc unlock overdue trong task thuộc scope nếu được phép.
- Xem dashboard/registration/automation nếu được cấp permission tương ứng.
- Đổi password trong Settings.

Agent/Assistant nên dùng:

- Board/List để theo dõi task của agent/team.
- Filter Agent/Assignee để không lẫn task ngoài scope.
- Notification bell để phản hồi comment, mention, overdue, waiting, QC.
- Comment để giải thích blocker hoặc request từ agent/customer/carrier.

Agent/Assistant nên check mỗi ngày:

- Task Waiting lâu.
- Task Overdue.
- Task có comment/mention cần phản hồi.
- Task Done cần QC.
- CS nào đang bị quá tải trong phạm vi team.

### CS

CS là người trực tiếp xử lý task.

CS có thể:

- Xem task được assign cho mình.
- Xem task được @mention.
- Đọc task detail.
- Chuyển status task mình được giao.
- Comment/reply.
- @mention agent/admin/assistant/CS khác khi cần.
- Upload attachment nếu task cho phép.
- Nhận notification khi có task mới, comment mới, due soon, overdue, reminder.
- Unlock overdue task mình được giao nếu cần tiếp tục xử lý, bắt buộc nhập reason.
- Reopen task nếu có quyền và có reason.
- Xem dashboard/registration/automation nếu được cấp permission tương ứng.
- Đổi password trong Settings.

CS không nên:

- Chuyển task sang In Progress nếu chưa thật sự bắt đầu.
- Để task overdue mà không comment hoặc unlock reason.
- Dùng Waiting nếu không thật sự chờ external party.
- Assign task cho người khác nếu không được cấp quyền.
- Tạo task ngoài phạm vi được cấp.

CS nên check mỗi ngày:

- Notification bell.
- Task Assigned mới.
- Task Due soon.
- Task Overdue.
- Task Waiting cần follow up.
- Comment/Mention cần trả lời.

## 4. Customer Registration

Customer Registration có 2 màn:

- Health
- P&C

### Health Registration

Dùng để nhập và quản lý enrollment Health.

Cách dùng:

1. Vào Customer Registration > Health.
2. Nhập dữ liệu trực tiếp vào grid hoặc dùng Import CSV.
3. Dùng search để tìm theo policy/name.
4. Kiểm tra dữ liệu trước khi lưu.
5. Bấm Save Changes.
6. Dùng Export Excel nếu cần gửi/report.

Feature chính:

- Manual data entry.
- Bulk CSV import.
- Search policy/name.
- Export Excel.
- Save Changes.

### P&C Registration

Dùng để nhập và quản lý registration P&C.

Cách dùng:

1. Vào Customer Registration > P&C.
2. Nhập dữ liệu hoặc Import CSV.
3. Search theo policy/name nếu cần.
4. Save Changes.
5. Export Excel khi cần.

Feature chính:

- Manual data entry.
- Bulk CSV import.
- Search.
- Export Excel.
- Save Changes.

## 5. Automation Tool

### Health Statement

Dùng để tạo monthly Health statement report từ carrier payment data.

Cách dùng:

1. Vào Automation Tool > Health Statement.
2. Upload carrier payment data.
3. Nhập thông tin statement/month nếu màn yêu cầu.
4. Bấm Run Report.
5. Kiểm tra Statement Summary.
6. Kiểm tra Statement Reconcile.
7. Xem Excel Preview.
8. Bấm Create Excel File để xuất file.

Feature chính:

- Upload input data.
- Build report preview.
- Summary/reconcile.
- Excel preview.
- Export Excel file.

### P&C Statement

Dùng để tạo P&C statement report.

Cách dùng:

1. Vào Automation Tool > P&C Statement.
2. Upload payment/policy files.
3. Bấm Run Report.
4. Kiểm tra preview, summary, reconcile.
5. Bấm Create Excel File để xuất kết quả.

Feature chính:

- Upload input files.
- Run/Refresh Preview.
- Statement summary.
- Statement reconcile.
- Excel preview.
- Export Excel file.

### Provider Finder

Dùng để tìm provider gần địa chỉ khách hàng theo insurance/specialty.

Cách dùng:

1. Vào Automation Tool > Provider Finder.
2. Nhập address.
3. Chọn/nhập insurance và specialty.
4. Chọn radius nếu có.
5. Bấm Run.
6. Xem Top 10 Providers.
7. Mở map để xem vị trí.
8. Chọn provider để xem chi tiết.

Feature chính:

- Search provider theo address.
- Filter theo insurance/specialty.
- Ranking Top 10.
- Map view.
- Provider detail.

## 6. Dashboard

Dashboard có 2 nhóm:

- Health Dashboard
- P&C Dashboard

Mỗi dashboard có thể có:

- Agent view
- Company view

### Agent View

Dùng để xem dữ liệu liên quan tới agent/user hiện tại.

Cách dùng:

1. Vào Dashboard > Health hoặc Dashboard > P&C.
2. Chọn Agent view nếu có switch.
3. Chọn date/report month range.
4. Dùng filter carrier/policy/state/agent tùy dashboard.
5. Xem KPI, chart, table.
6. Export XLSX nếu cần.
7. Dùng Dashboard Assistant nếu muốn hỏi nhanh số liệu.

### Company View

Dùng để xem dữ liệu toàn công ty/sales.

Cách dùng:

1. Vào Dashboard > Health hoặc Dashboard > P&C.
2. Chọn Company view nếu có quyền.
3. Set report month/date range.
4. Dùng filter.
5. Xem portfolio overview, trend, tables.
6. Export dữ liệu khi cần.

### Dashboard Assistant

Dùng để hỏi nhanh về dữ liệu dashboard.

Ví dụ câu hỏi:

- How many clients by carrier?
- Estimate unpaid commission by agent.
- My agent commission this year.

Lưu ý:

- Assistant trả lời dựa trên dữ liệu dashboard hiện có.
- Nếu filter đang áp dụng, kết quả có thể bị ảnh hưởng bởi filter.

## 7. Task Management

Task Management là khu vực quản lý công việc CS.

Các view chính:

1. Overview
2. Board
3. List
4. Backlog

### Task Overview

Overview dành cho admin/task manager để biết tình hình workload.

Dùng để trả lời:

- CS nào đang quá tải?
- Ai còn free?
- Bao nhiêu task urgent/high?
- Bao nhiêu task cần attention?
- Bao nhiêu task chưa assign?
- Task nào đang overdue?
- Task nào waiting lâu?
- Task nào todo lâu chưa start?

Các phần chính:

- KPI summary.
- Attention areas.
- Work mix stage x priority.
- CS workload table.
- Assignments outside CS pool.
- Unassigned queue.

Cách dùng:

1. Mở Task Management > Overview.
2. Xem KPI đầu trang.
3. Check Attention areas để biết risk lớn nhất.
4. Check Work mix để hiểu task đang nằm ở stage/priority nào.
5. Check CS workload table để biết từng CS đang load thế nào.
6. Check Unassigned queue để assign task chưa có người xử lý.
7. Dùng Recommend nếu muốn hệ thống gợi ý CS phù hợp.

### Task Board

Board là view kanban để kéo task theo stage.

Các stage thường dùng:

- To Do
- In Progress
- Waiting
- Done
- Cancel

Cách dùng:

1. Mở Board.
2. Dùng filter nếu cần.
3. Kéo task sang stage phù hợp.
4. Mở task detail để đọc/comment/update.
5. Nếu task bị rule chặn, đọc error và chỉnh theo workflow đúng.

Rule quan trọng:

- Task chưa assign sẽ ở Backlog, không nằm trong Board chính.
- Task phải có assignee mới vào To Do/In Progress/Waiting/Done.
- Task chưa từng In Progress không nên Done trực tiếp.
- Done/Cancel muốn mở lại cần Reopen reason.
- Overdue muốn tiếp tục xử lý cần Unlock reason.

### Task List

List dùng để audit nhiều task cùng lúc.

Cột thường thấy:

- Key
- Assignee
- Creator
- Summary
- Category
- Created
- Priority
- Status
- QC

Cách dùng:

1. Mở List.
2. Dùng filter Agent/Assignee/Status/Priority/Overdue/Category.
3. Dùng date range để lọc theo ngày task.
4. Dùng search để tìm trong task/comment.
5. Click task để mở detail.
6. Tick QC nếu bạn có quyền review.

### Backlog

Backlog là queue task chưa assign.

Cách dùng:

1. Mở Backlog.
2. Chọn task cần xử lý.
3. Assign cho CS phù hợp.
4. Khi có assignee, task sẽ chuyển ra khỏi Backlog.

Backlog dành chủ yếu cho admin/agent owner/assistant có scope.

### New Task

Dùng để tạo task mới.

Cách dùng:

1. Bấm New task.
2. Nhập Summary/title.
3. Nhập Description nếu cần.
4. Chọn Agent.
5. Chọn Category.
6. Chọn Priority.
7. Chọn Assignee nếu có quyền.
8. Thêm FUB link/attachment nếu cần.
9. Create.

Sau khi tạo:

- Nếu có assignee, người được assign nhận notification `assigned`.
- Nếu chưa có assignee, task nằm ở Backlog/Unassigned queue.

### Task Detail

Task detail là nơi xem và xử lý một task cụ thể.

Thông tin thường có:

- Summary.
- Description.
- Agent.
- Assignee(s).
- Category.
- Priority.
- Status.
- SLA.
- Comments.
- Attachments.
- Activity/history.
- QC/overdue/reopen controls nếu có quyền.

Cách dùng:

1. Click task từ Board/List/Notification.
2. Đọc description và comment mới nhất.
3. Update status đúng workflow.
4. Comment khi có update/blocker.
5. Mention người cần phản hồi.
6. Upload attachment nếu có tài liệu cần đính kèm.
7. Done khi xử lý xong.

### Comments và Mentions

Comment dùng để trao đổi trong task.

Cách dùng:

- Viết update ngắn, rõ next step.
- Dùng `@name` hoặc mention picker để gọi người cần phản hồi.
- Reply vào comment nếu muốn giữ thread rõ ràng.
- Mention sẽ gửi notification và có thể thêm người đó vào task participants.

Nên comment khi:

- Bắt đầu xử lý task quan trọng.
- Có blocker.
- Chuyển Waiting.
- Unlock overdue.
- Reopen task.
- Cần hỏi agent/admin.

### Attachments

Attachment dùng để lưu file liên quan đến task/comment.

Cách dùng:

1. Mở task detail.
2. Chọn upload/add attachment.
3. Kiểm tra file hiện trong task.
4. Comment giải thích file nếu cần.

Lưu ý: upload attachment có thể hiện trong activity, nhưng không phải mọi attachment đều tạo notification riêng.

### SLA và Overdue

SLA là thời gian active cho task In Progress.

Cách hoạt động:

- SLA bắt đầu khi task vào In Progress.
- Due soon notification gửi trước khi hết SLA.
- Overdue notification gửi khi task quá SLA.
- Nếu task đang chờ external party, chuyển sang Waiting.
- Nếu task đã overdue và cần làm tiếp, dùng Unlock overdue và nhập reason.

CS nên làm gì khi Due Soon:

1. Ưu tiên xử lý.
2. Nếu có blocker, comment ngay.
3. Nếu đang chờ external party, chuyển Waiting với context rõ.

CS nên làm gì khi Overdue:

1. Mở task ngay.
2. Xử lý nếu có thể.
3. Nếu vẫn cần tiếp tục, Unlock overdue với reason rõ.
4. Comment next step.

Admin nên làm gì khi Overdue:

1. Check Overview/Attention areas.
2. Mở task.
3. Xem assignee, category, created date, status.
4. Follow up với CS/agent nếu reason không rõ.

### Waiting

Waiting dùng khi task đang chờ external party, carrier, customer, document, hoặc thông tin từ agent.

Khi đưa task vào Waiting:

- Comment đang chờ ai/cái gì.
- Ghi next follow-up date nếu có.
- Không dùng Waiting để né SLA.

Waiting reminder sẽ nhắc nếu task Waiting quá lâu.

### QC

QC dùng để review task Done.

Người có quyền QC có thể:

- Kiểm tra task Done.
- Tick QC nếu đạt.
- Comment nếu cần làm lại.
- Reopen nếu task cần xử lý tiếp.

QC notification:

- `qc_needed`: có task Done cần review.
- `qc_stale`: task Done lâu chưa được QC.

### Reopen

Reopen dùng để mở lại task Done/Cancel.

Cách dùng:

1. Mở task Done/Cancel.
2. Chọn Reopen.
3. Nhập reason.
4. Task quay lại workflow xử lý.

Assignee liên quan nhận notification `reopened`.

### Agent Groups

Agent Groups dùng để cấu hình agent và CS/assistant liên quan.

Dùng để:

- Chọn agent tham gia task workflow.
- Gán CS vào team agent.
- Gán assistant hỗ trợ agent.
- Quyết định scope xem/assign task.

Admin nên cập nhật Agent Groups khi:

- Có agent mới.
- Có CS mới.
- CS đổi team.
- Assistant được giao hỗ trợ agent.

### Categories

Categories là loại task.

Dùng để:

- Phân loại task.
- Filter task.
- Tính SLA theo category nếu có rule riêng.
- Report workload theo loại việc.

Admin nên giữ category rõ ràng, không tạo quá nhiều category trùng nghĩa.

### SLA Times

SLA Times dùng để cấu hình thời gian xử lý theo priority/category.

Dùng để:

- Đặt SLA default theo priority.
- Override SLA cho category cụ thể.
- Chỉnh reminder settings nếu UI hỗ trợ.

Admin nên review SLA khi:

- Category mới được thêm.
- Urgent/High task quá nhiều false alarm.
- Thực tế xử lý khác xa SLA hiện tại.

## 8. Notification Bell

Notification Bell nằm trên top bar.

Chức năng:

- Hiển thị số unread.
- Mở dropdown xem notification mới nhất.
- Click notification để mở task.
- Mark all read.
- Toast trong app khi có notification mới.
- Chime/ring khi có notification mới.
- Native browser notification nếu đã cho phép.

Notification hiện chủ yếu dành cho Task Management.

### Cách nhận notification

Bạn có thể nhận notification qua:

- Bell unread count.
- Dropdown list.
- Toast popup trong app.
- Chuông/ring.
- Browser native notification nếu permission đã bật.

### Các loại notification

| Notification | Khi nào nhận | Ai nhận | Cần làm gì |
| --- | --- | --- | --- |
| Assigned | Task được assign cho bạn | Assignee | Mở task, đọc yêu cầu, xử lý theo priority |
| Unassigned | Bạn bị gỡ khỏi task | Assignee cũ | Không xử lý nữa, hỏi admin nếu bị gỡ nhầm |
| Mentioned | Có người @mention bạn | Người được mention | Mở task và trả lời |
| Commented | Có comment mới trong task liên quan | Assignee/participant/reporter/agent liên quan | Đọc update, phản hồi nếu cần |
| Due soon | Task In Progress gần hết SLA | Assignee | Ưu tiên xử lý hoặc cập nhật blocker |
| Overdue | Task In Progress quá SLA | Assignee | Xử lý ngay hoặc unlock với reason |
| Overdue reminder | Task vẫn overdue sau interval | Assignee | Follow up ngay |
| Todo reminder | Task To Do lâu chưa start | Assignee | Start task hoặc comment lý do chưa start |
| Waiting reminder | Task Waiting lâu | Assignee | Follow up external party và update comment |
| Stale | Task lâu không có activity | Người liên quan theo rule | Update status/comment |
| QC needed | Task Done cần QC | Người có quyền review | Review và tick QC nếu đạt |
| QC stale | Task Done lâu chưa QC | Agent/Assistant/Admin | Review sớm |
| Reopened | Task Done/Cancel bị reopen | Assignee | Đọc reason và xử lý tiếp |
| Overdue unlocked | Overdue được unlock về To Do | Agent/Assistant/Admin | Đọc reason, follow up nếu cần |

### Cách dùng notification hiệu quả

CS:

- Luôn xử lý Assigned, Due soon, Overdue trước.
- Với Mentioned/Commented, trả lời sớm nếu đang block người khác.
- Với Waiting reminder, follow up và comment lại.

Admin:

- Ưu tiên Overdue, Overdue unlocked, QC stale, Stale.
- Dùng Overview để nhìn toàn cảnh trước khi assign lại.

Agent/Assistant:

- Ưu tiên Mentioned, Commented, Waiting reminder, QC needed.
- Nếu CS unlock overdue với reason chưa rõ, comment hỏi lại ngay.

Dashboard/Automation/Registration:

- Notification bell hiện không phải kênh chính cho dashboard/automation/registration.
- Các tool này thường báo trạng thái ngay trong màn thao tác, và role nào có permission thì role đó dùng được.

## 9. Workflow task khuyến nghị theo ngày

### Admin daily workflow

1. Mở Task Overview.
2. Check KPI và Attention areas.
3. Check Work mix stage x priority.
4. Check CS workload table.
5. Xử lý Unassigned queue.
6. Xử lý Overdue/Waiting/Todo stuck.
7. Check QC stale.
8. Dùng List để audit task còn rủi ro.

### Agent/Assistant daily workflow

1. Mở task board/list của agent mình.
2. Check task Waiting/Overdue.
3. Trả lời mentions/comments.
4. Review task Done cần QC.
5. Assign lại nếu CS quá tải hoặc task sai người.

### CS daily workflow

1. Check notification bell.
2. Mở List/Board task của mình.
3. Ưu tiên Urgent/High và Due soon/Overdue.
4. Start task khi thật sự làm.
5. Comment blocker.
6. Chuyển Waiting nếu cần chờ external party.
7. Done khi xử lý xong.

## 10. Settings

Settings dùng cho account cá nhân.

Hiện tại người dùng có thể:

- Đổi password.

Cách đổi password:

1. Mở Settings.
2. Nhập New Password.
3. Bấm Save.
4. Chờ message Password updated.

Lưu ý:

- Upload Image và email Save có thể xuất hiện trên UI nhưng chưa phải luồng chính để cập nhật account.

## 11. Quy tắc sử dụng tốt

Cho tất cả user:

- Luôn kiểm tra filter/date range trước khi kết luận thiếu dữ liệu.
- Dùng comment để để lại context, không xử lý task im lặng.
- Mention đúng người cần phản hồi.
- Không tạo category trùng nghĩa.
- Không assign task cho người không liên quan.
- Không chuyển status chỉ để làm đẹp board.

Cho admin:

- Overview là màn quyết định workload chính.
- Recommendation chỉ là hỗ trợ, không thay thế quyết định admin.
- Luôn kiểm tra workload, priority, overdue, waiting trước khi assign thêm.

Cho CS:

- In Progress nghĩa là đang làm thật.
- Waiting nghĩa là đang chờ thật.
- Overdue unlock luôn cần reason đủ rõ.
- Done chỉ khi task thật sự xong.

Cho admin khi quản lý account/role:

- Gán quyền tối thiểu đủ dùng.
- Không cấp `company.view_all` nếu user chỉ cần data của mình.
- Kiểm tra role sau khi tạo account.
- Khi user không thấy menu, kiểm tra permission trước.

## 12. Quick reference

Mở task mới:

1. New task.
2. Summary.
3. Agent.
4. Category.
5. Priority.
6. Assignee.
7. Create.

Xử lý task:

1. Read task.
2. Move In Progress khi bắt đầu.
3. Comment update/blocker.
4. Move Waiting nếu chờ external.
5. Move Done khi xong.

Xử lý overdue:

1. Open notification.
2. Read task.
3. Finish nếu có thể.
4. Nếu cần thêm thời gian, Unlock overdue.
5. Nhập reason rõ.
6. Comment next step.

Review QC:

1. Mở task Done.
2. Kiểm tra nội dung.
3. Tick QC nếu đạt.
4. Reopen/comment nếu chưa đạt.

Tìm task:

1. Dùng List.
2. Chọn filter.
3. Set date range.
4. Search title/comment.
5. Click task để mở detail.
