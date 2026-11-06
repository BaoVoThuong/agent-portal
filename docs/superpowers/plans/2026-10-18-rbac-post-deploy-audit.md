# RBAC audit sau khi phát hành Org chart

Ngày: 2026-10-18. Commit đang chạy: `dc70ee0`. Audit chỉ đọc code và production; không sửa Role, Position, manager, notification hay database.

## Đã kiểm

- `origin/main`, `vercel/main` cùng `dc70ee0`; Vercel production build `READY`.
- `typecheck`, build, 216 file test / 1.749 test pass; lint 0 error, 2 warning ở file không đổi.
- 49 account, 47 active. Không account nào giữ nhiều Role hoặc thiếu Role. Không có Role mặc định. Ba account có `management.role_manager` và `management.account_manager` đều thuộc Role Admin. Admin active có đủ mọi quyền định nghĩa (trừ `task.work` và `lead.work` được Manage bao gồm). Dòng `settings.access` cũ vẫn còn trong DB, đã ẩn ở giao diện.
- 19 Agent active đều nằm trong `task_agents`; 11 Assistant active đều có link `agent_members`. Cây manager hiện không có vòng lặp, tự quản lý hay manager id mồ côi.
- Org chart chỉ cho người có `management.account_manager` thao tác; kéo manager gọi lại `PATCH /api/admin/users/[id]` với `expected` snapshot. Assistant không kéo để đổi Agent hỗ trợ. Chart không tự cấp quyền.

## Phát hiện cần phản biện

### P1 — Notification có thể lộ nội dung khi phiên còn hiệu lực nhưng quyền đã bị gỡ

`GET /api/tasks/notifications` và `POST /api/tasks/notifications/read` chỉ kiểm session email, không kiểm account còn active. GET nạp tiêu đề task, body comment và chi tiết time-off rồi trả cho email đó. Nó chỉ redaction Enrollment; Task và Time Off luôn được coi là xem được (`src/app/api/tasks/notifications/route.ts`, đoạn tạo `notifications`). Vì vậy account bị tắt nhưng còn cookie, hoặc account mất quyền Task, vẫn có thể đọc notification cũ có nội dung task. `POST /api/notifications/push/subscribe` cũng chỉ kiểm email, cho account đã tắt ghi subscription mới. Đây là lỗ hổng trong code hiện hành; chưa thực hiện thử bằng account thật.

Hướng sửa: dùng một helper server kiểm account tồn tại và active cho các endpoint chỉ dựa vào email; dùng phạm vi Task/Enrollment/Time Off hiện tại để lọc/redact từng notification. Giữ riêng số đếm, cursor và khả năng thông báo của module còn quyền. Viết test cho disabled session, account không Role, mất `task.work`, Agent/Assistant đổi membership và Admin; so unread/toast với production trước khi deploy.

`src/auth.ts` còn dùng RBAC lookup cache 60 giây theo từng server instance. `invalidateRbacLookups()` chỉ xóa cache của instance nhận thao tác, nên sau khi tắt account hoặc gỡ Role, request tới instance khác có thể giữ quyền cũ tối đa khoảng một phút. Đường notification ở trên nguy hiểm hơn vì sau khi cache hết hạn nó vẫn chỉ kiểm email. Cần quyết định thời gian thu hồi quyền chấp nhận được rồi kiểm thử qua hai instance; nếu cần tức thời, dùng phiên bản quyền/timestamp chung hoặc tra trạng thái account trực tiếp ở mutation nhạy cảm, kèm đo latency.

### P1 tiềm ẩn — Xóa Role và chuyển người có thể vượt trần ủy quyền

`DELETE /api/admin/roles/[id]` yêu cầu `management.role_manager`, nhưng khi có `moveToRoleId` chỉ kiểm Role đích active, không kiểm permission của Role đích có nằm trong permission của người thao tác. Nếu sau này giao Role Manager cho một Role hạn chế, người đó có thể chuyển mình/người khác sang Admin khi xóa Role nguồn. Hiện production chỉ ba Admin có `management.role_manager`, nên chưa có đường khai thác từ người quyền thấp.

Hướng sửa: trước UPDATE, đọc permission Role đích và dùng trần ủy quyền giống Account Manager. Thêm test Role Manager hạn chế chuyển sang Admin bị 403, chuyển sang Role trong trần được phép. Cân nhắc gộp chuyển người + xóa Role vào một RPC transaction: hiện UPDATE có thể thành công rồi DELETE thất bại, dẫn đến quyền người dùng đã đổi dù API trả 500.

### Đính chính P2 — Production đã có guard cho cây manager

Audit ban đầu chỉ đọc `update_account_atomic` và bỏ sót constraint `portal_account_manager_not_self` cùng trigger `portal_account_manager_no_cycle` trên `portal_account`. Ngày 2026-10-18 đã kiểm trực tiếp `pg_constraint` và `pg_trigger` ở production: cả hai tồn tại, trigger đang bật (`tgenabled = 'O'`). Vì vậy kết luận API có thể tạo self/cycle là **sai**; không cần thêm migration manager. Đây là lỗi của bản audit, không phải lỗi production.

### Chưa triển khai quyết định nghiệp vụ, không tự sửa trong đợt audit

- Yêu cầu mới: mỗi Assistant chỉ hỗ trợ một Agent. Code/UI/SQL vẫn hỗ trợ nhiều; production có **một** Assistant active gắn **sáu** Agent. Chuyển ngay sang một Agent sẽ làm mất phạm vi dữ liệu, vì vậy cần kế hoạch chuyển dữ liệu và quyết định Agent đích trước.
- Yêu cầu mới: đơn nghỉ tự lấy manager trong Account và manager có quyền duyệt team. `POST /api/time-off` vẫn nhận `manager_id` từ body; quyết định duyệt chỉ dựa `timeoff.admin`, chưa có team scope. Hiện Time Off chỉ ba Admin có quyền ở production. Làm riêng trước khi cấp Time Off cho nhân viên.

## Thứ tự đề xuất

1. Sửa notification leak, deploy với test parity cho quyền xem và unread.
2. Khóa trần ủy quyền của Delete Role; nếu làm RPC transaction thì migration/rollback riêng.
3. Lập rollout riêng cho một Agent/Assistant và Time Off manager theo quyết định nghiệp vụ; chụp access matrix trước/sau, không tự đổi production khi chưa có dữ liệu chuyển đổi được duyệt.
