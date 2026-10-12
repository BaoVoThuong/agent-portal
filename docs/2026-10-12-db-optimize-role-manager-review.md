# Review DB optimize + Role Manager — 12/10/2026

## Phạm vi và cách kiểm tra

Đọc trạng thái worktree hiện tại, gồm các thay đổi chưa commit: `datasync`, các rollout SQL ngày 09–12/10, `supabase/schema.sql`, luồng đăng nhập, RBAC, Role Manager, Account Manager và các API dùng quyền Task/Lead. Đối chiếu các hàm gọi với schema và test hiện có. Chưa chạy rollout hoặc kiểm tra dữ liệu production; các lỗi dưới đây là kết luận từ code, không phải xác nhận đã xảy ra trên production.

Đã chạy: `npm run typecheck` (qua), 103 test liên quan RBAC/Task/datasync (qua), `npm run lint` (0 lỗi, 2 cảnh báo ở `public/sw.js` và `LeadTable.tsx`), `git diff --check` (qua). Test hiện tại chưa kiểm tra giao dịch nhiều bước, request đồng thời và trường hợp role bị tắt.

## Cần sửa trước khi đưa thay đổi vào vận hành

### 1. [Cao] Role đã tắt vẫn cho phép chọn người nhận Task/Lead

- **Vị trí:** `src/lib/tasks/assignees.ts:79-107`, `src/lib/leads/assignees.ts:17-51`; đường kiểm tra Task tại `src/lib/tasks/assignees.ts:110-129`.
- **Lỗi:** Hai hàm lấy role có `task.work`/`task.manage` hoặc `lead.work`/`lead.manage`, rồi lấy account đang hoạt động, nhưng không lọc `roles.is_active`. RBAC đăng nhập lại bỏ quyền của role đã tắt (`src/lib/rbac/access.ts:28-33`).
- **Tác động:** Sau khi tắt role trong Role Manager, account của role đó vẫn nằm trong picker. Các API giao Task dùng `isEligibleTaskAssigneeEmail` cũng nhận account này, dù họ không còn quyền mở Task; Lead picker tương tự.
- **Gợi ý sửa:** Chỉ lấy `user_roles` gắn với role đang hoạt động, hoặc dùng một truy vấn/RPC chung lấy account có *effective permission*. Kiểm tra cả picker và API validation khi tắt một role Task/Lead.

### 2. [Cao] Hai thao tác Admin cùng lúc có thể làm mất Admin cuối cùng

- **Vị trí:** `src/app/api/admin/users/[id]/route.ts:394-403`, `:425-440`, `:509-533`; `src/lib/rbac/role-management.ts:263-276`.
- **Lỗi:** Quy tắc “còn ít nhất một Admin active” được kiểm tra bằng truy vấn trước khi đổi role/tắt/xóa user. Hai request đồng thời nhắm vào hai Admin khác nhau đều có thể thấy Admin còn lại, cùng qua kiểm tra rồi cùng ghi.
- **Tác động:** Hệ thống có thể còn 0 tài khoản Admin active, trái với invariant được mô tả và có nguy cơ mất đường quản trị.
- **Gợi ý sửa:** Chuyển thao tác thay role, tắt hoặc xóa Admin cùng kiểm tra invariant vào một transaction/RPC có khóa chung phù hợp. Thêm test đồng thời hai request.

### 3. [Cao] Cập nhật Account/Role có thể lưu một nửa rồi trả lỗi

- **Vị trí:** `src/app/api/admin/users/[id]/route.ts:425-450`, `src/app/api/admin/roles/route.ts:93-114`, `src/app/api/admin/roles/[id]/route.ts:135-145`.
- **Lỗi:** Account Manager đổi `user_roles` trước khi update `portal_account`. Role Manager tạo/cập nhật row `roles` rồi mới gọi RPC thay `role_permissions`. Các bước là request DB riêng. Nếu bước sau lỗi, bước đầu đã commit.
- **Tác động:** Form báo lưu thất bại nhưng role của user đã đổi; role mới có thể tồn tại với 0 quyền; tên/trạng thái role có thể đổi dù quyền chưa đổi. Điều này đặc biệt nguy hiểm với phân quyền.
- **Gợi ý sửa:** Gom mỗi thao tác thành một RPC transaction; validate dữ liệu và trần ủy quyền trước khi ghi, rồi cập nhật account/role/quyền trong cùng transaction. Test lỗi cưỡng bức ở bước sau và kiểm tra DB không đổi.

### 4. [Cao] Đăng nhập Google có thể tạo account không có role hoặc báo thành công dù tạo account lỗi

- **Vị trí:** `src/auth.ts:120-140`, `src/lib/rbac/access.ts:63-83`.
- **Lỗi:** `signIn` trả `true` ngay cả khi insert `portal_account` không trả `createdUser`. `assignDefaultRoleToUser` chỉ log khi không tìm thấy role mặc định; lỗi `delete`/`insert` `user_roles` bị bỏ qua.
- **Tác động:** Người thuộc domain hợp lệ có thể nhận phiên đăng nhập nhưng không có quyền, hoặc account active bị bỏ lại không role. Lần đăng nhập sau thấy account tồn tại nên không thử gán role lại.
- **Gợi ý sửa:** Chỉ cho đăng nhập khi tạo account và gán default role đều thành công; dùng một transaction/RPC để tạo và gán. Trả lỗi rõ ràng khi không có default role active hoặc insert role thất bại.

### 5. [Cao] Sync cũ đang finalize có thể ghi đè dữ liệu của sync mới

- **Vị trí:** `datasync/schema.sql:882-899`, `:926-979`; `datasync/lib/sync-runner.js:119-160`.
- **Lỗi:** `finalize_sheet_sync` khóa run của chính nó rồi lấy advisory lock theo tab, nhưng không kiểm tra có run mới hơn đã `finalized` hay chưa. Prune chỉ chạy *sau* khi sync mới commit và là lệnh DELETE riêng. Nếu finalizer cũ đã khóa row của mình, lệnh prune phải chờ; sau khi sync mới nhả advisory lock, finalizer cũ vẫn có thể lấy lock và thay partition bằng bản Sheet cũ. Khi đó run cũ thành `finalized`, nên prune không còn xóa được.
- **Tác động:** Hai lần sync chồng nhau hoặc `--resume-run` chồng với cron có thể để raw table/mart quay về dữ liệu cũ. Advisory lock hiện tại chỉ tuần tự hóa, chưa đảm bảo thứ tự phiên bản.
- **Gợi ý sửa:** Ngay trong `finalize_sheet_sync`, sau khi lấy advisory lock và trước DELETE partition, kiểm tra run cùng tab có `created_at` mới hơn đã `finalized`; nếu có thì từ chối finalizer cũ. Dùng thời gian/sequence do DB cấp để so thứ tự, không dựa vào giờ máy chạy script. Test hai finalizer đồng thời theo cả hai thứ tự khóa.

## Nên sửa tiếp

### 6. [Trung bình] Rollout RBAC không chạy lại được dù ghi là idempotent

- **Vị trí:** `supabase/rollouts/2026-10-09-rbac-cleanup.sql:18`, `:38-49`, `:138-269`.
- **Lỗi:** Guard chỉ chấp nhận MD5 của thân hàm `assign_unassigned_task` *trước* rollout. Lần chạy đầu thay thân hàm. Lần chạy thứ hai gặp MD5 mới và tự abort ngay, dù các bước dữ liệu còn lại dùng `on conflict`/`if not exists`.
- **Tác động:** Không thể rerun an toàn khi xác minh hoặc triển khai lại; comment “Idempotent” gây hiểu sai.
- **Gợi ý sửa:** Chấp nhận cả hash trước và sau rollout (kiểm tra signature cụ thể), hoặc phát hiện trạng thái đã áp dụng trước khi thực hiện guard. Nếu cố ý chỉ chạy một lần, sửa tài liệu và tên quy trình cho đúng.

### 7. [Trung bình] Staging vẫn tăng vô hạn nếu nhiều lần sync đều thất bại

- **Vị trí:** `datasync/lib/sync-runner.js:119-160`, `supabase/rollouts/2026-10-09-sheet-sync-staging-cleanup.sql:15-25`.
- **Lỗi:** Cleanup tự động chỉ chạy sau khi `finalize_sheet_sync` thành công. Nếu nhiều run cùng tab liên tục timeout trước khi có run thành công, mọi run vẫn `running` và giữ toàn bộ staged rows. SQL cleanup một lần cũng chỉ xóa run có run mới hơn đã `finalized`.
- **Tác động:** Trường hợp đã tạo 366 MB staging có thể lặp lại trong một đợt lỗi kéo dài; database tiếp tục đầy trước khi sync được sửa.
- **Gợi ý sửa:** Đặt retention cho các run thất bại cũ nhưng giữ lại run mới nhất có thể resume; ghi trạng thái `failed`/`abandoned` rõ ràng, giới hạn số run/staging theo tab và cảnh báo dung lượng. Tránh xóa run đang upload.

### 8. [Trung bình] PATCH Role không có thay đổi vẫn đọc và trả toàn bộ role cho request thiếu quyền

- **Vị trí:** `src/app/api/admin/roles/[id]/route.ts:40-48`, `:97-103`, `:147-151`.
- **Lỗi:** Quyền `management.role_manager` chỉ được kiểm tra bên trong các nhánh field. Request `PATCH {}` không vào nhánh nào, vẫn gọi `fetchRoleById` rồi `fetchRolesWithPermissions` và trả danh sách role/quyền/người dùng.
- **Tác động:** Một account đã đăng nhập nhưng không có quyền Role Manager có thể đọc dữ liệu quản trị qua endpoint PATCH, trong khi GET bị chặn.
- **Gợi ý sửa:** Kiểm tra quyền một lần ở đầu handler, trước `params`/body/DB; trả 400 khi payload không có field hợp lệ.

### 9. [Thấp] Không có cách đổi default role theo thông báo của Role Manager

- **Vị trí:** `src/app/api/admin/roles/[id]/route.ts:117-122`, `:177-184`; toàn bộ Role Manager UI/API chỉ đọc `is_default`.
- **Lỗi:** API không cho tắt/xóa default role và trả “Choose another default role first”, nhưng không có UI hoặc API đặt role khác thành default. `supabase/schema.sql` và rollout chỉ mặc định chọn `Agent` nếu chưa có default.
- **Tác động:** Quản trị viên không thể hoàn thành thao tác được hướng dẫn trên màn hình nếu muốn đổi role mặc định; phải sửa SQL thủ công.
- **Gợi ý sửa:** Thêm thao tác chuyển default role nguyên tử (xóa cờ cũ, đặt cờ mới, kiểm tra role mới active) hoặc nói rõ cần migration SQL và thay thông báo lỗi.

## Thứ tự xử lý đề xuất

Sửa mục 1–5 trước, vì liên quan quyền thực tế, tính toàn vẹn account và nguy cơ raw data bị ghi đè bằng bản cũ. Sau đó sửa mục 6–8 trước khi rerun rollout hoặc để sync chạy dài ngày. Mục 9 là khoảng trống vận hành, có thể làm sau nếu default role `Agent` vẫn là lựa chọn cố định.
