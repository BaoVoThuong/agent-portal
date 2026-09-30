# Code review nhánh `feat/authz-phase-b`

Ngày review: 2026-09-26. Phạm vi: 23 file thay đổi giữa Phase A (`ba69ee9`) và Phase B (`638cc62`), đối chiếu các đường đăng nhập, Account/Role Manager và rollout SQL với code hiện hữu. Review thực hiện trên snapshot riêng của commit Phase B; worktree hiện tại ở `feat/authz-phase-d` không bị chỉnh sửa. Những mục dưới đây có thể đã được xử lý ở phase sau.

## Kết luận

Phase B đặt nền hợp lý: catalog action/scope ở `src/lib/authz/catalog.ts`, suy grant tương thích ở `compat.ts`, principal không đưa danh sách grant vào JWT, và `access_version` để rút ngắn thời gian làm mới quyền. Tuy nhiên, **chưa nên phát hành Phase B riêng** khi còn phiên JWT cũ không có `accountId` và DB gate chưa chạy rollout Phase B. Cam kết thu hồi quyền trong 30 giây hiện phụ thuộc RPC tăng version thành công; code đang coi lỗi RPC là thành công của mutation.

## Phát hiện cần xử lý

### [sol5.5] P1-01 — Phiên JWT cũ có thể gắn sang account khác sau khi email được tái sử dụng

**Đường đi:** `src/auth.ts:188-204` chỉ kiểm `access_version` khi token có `accountId`; sau TTL, token cũ thiếu trường này gọi `getUserAccess({ accountId: null, email: token.email })`. `src/lib/rbac/access.ts:82-107` tra account theo email khi thiếu ID; `src/lib/auth/token-access.ts:25-35` chép `access.userId` mới vào token. Account Manager cho đổi email khi không tìm thấy tham chiếu ở `src/app/api/admin/users/[id]/route.ts:255-301`, và email cũ sau đó có thể được cấp cho account khác.

**Tác động:** với cookie đã phát hành trước Phase B, nếu account A đổi email rồi email cũ được tạo thành account B trước lúc A refresh, cookie của A có thể nhận role/permission của B. Đây là điều kiện phụ thuộc việc tái sử dụng email; với JWT đã có `accountId`, nhánh kiểm ID + email hiện tại đã chặn đúng tình huống này.

**Đề nghị:** không nâng cấp JWT cũ sang `accountId` bằng email đơn thuần. Buộc đăng nhập lại đối với token thiếu ID, hoặc chỉ chuyển đổi khi có một định danh account bất biến cũ được xác minh. Test chuỗi A đăng nhập bằng cookie kiểu cũ → đổi email A → tạo B ở email cũ → gọi `auth()` sau TTL; kỳ vọng phiên A bị từ chối, không nhận quyền B.

### [sol5.5] P2-01 — Tăng `access_version` là bước riêng và lỗi bị nuốt

`src/app/api/admin/roles/[id]/route.ts:104-120` cập nhật role/permission rồi mới gọi `bumpRoleMembersAccessVersion`. Account Manager cũng cập nhật role/trạng thái/email rồi gọi `bumpAccessVersion` tại `src/app/api/admin/users/[id]/route.ts:439-467`. Hai hàm ở `src/lib/authz/versions.ts:91-114` chỉ log lỗi RPC; response quản trị vẫn có thể báo thành công. `fetchAccessVersion` trả `unknown` khi lỗi/cột chưa có và `isAccessVersionStale` coi đó là không stale (`:25-35,76-84`). Khi RPC hỏng, quyền cũ tồn tại tới TTL 5 phút ở `src/auth.ts:42`, thay vì cửa sổ 30 giây được nêu trong comment `versions.ts:10-13`.

**Đề nghị:** tách rõ SLA bình thường và fallback trong tài liệu/monitoring; phát cảnh báo khi bump lỗi. Khi triển khai lâu dài, gộp mutation quyền và bump vào cùng transaction/RPC (Phase C đã đi theo hướng này). Thêm test lỗi RPC sau khi mutation đã commit và xác minh cách hệ thống/đội vận hành nhận biết quyền chưa thu hồi.

### [sol5.5] P2-02 — DB gate của chính nhánh Phase B chưa áp rollout mới

`supabase/rollouts/2026-09-27-authz-phase-b.sql:15-45` thêm cột và hai RPC phục vụ kiểm version, nhưng `.github/workflows/db-persistence-gate.yml:48-65` ở snapshot Phase B vẫn dùng danh sách rollout từ Phase A, không có file này. Unit test `src/lib/authz/versions.test.ts` chứng minh logic cache giả lập, không chứng minh SQL chạy được trên PostgreSQL hoặc quyền EXECUTE đã khóa đúng.

**Đề nghị:** thêm rollout B vào DB gate cùng assert sự tồn tại và quyền của cột/RPC trước khi phát hành B độc lập. Phase C đã cập nhật danh sách workflow; cần xác nhận workflow thực tế xanh trên nhánh/commit được deploy.

### [sol5.5] P2-03 — Chưa có đối chiếu quyết định trên account/role thật trước khi dùng grant để gác API

`src/lib/authz/compat.test.ts:15-67` dùng các persona viết tay; `:69-143` so một số quyết định Task/Lead/Import với helper cũ. Đây là test hữu ích nhưng không bao phủ tổ hợp role, permission và dữ liệu production; `grantsForRoles` ở `src/lib/authz/principal.ts:109-151` hiện chưa được chạy ở chế độ so sánh/log sai khác với quyết định cũ trên traffic thật. Plan cho Phase B có bước quan sát chênh lệch, còn code Phase B chỉ chuẩn bị mô hình. Khi Phase C bật Role Manager dạng grant, ánh xạ ngược từ grant sang permission cũ sẽ là ranh giới an ninh mới.

**Đề nghị:** xuất ma trận đã khử thông tin cá nhân từ role/account đang dùng, chạy dual decision cho các action/scope quan trọng, lưu và xử lý mọi sai khác trước khi cho role tùy chỉnh dùng grant. Test thêm grant tối thiểu theo hướng *read-only*, *single domain* và scope hẹp; các persona hiện có chủ yếu kiểm tương thích role cũ.

## Những phần đã kiểm và đạt

- `getUserAccess` kiểm email khớp khi token đã có `accountId`; `applyRefreshedAccess` kết thúc phiên khi account bị khóa/xóa và rút permission khi lookup lỗi.
- RPC Phase B trong rollout có `SECURITY DEFINER`, `search_path` cố định và thu hồi EXECUTE khỏi `public`, `anon`, `authenticated`.
- `npm run typecheck`: đạt. `npm run test:run`: **196 file, 1.656 test đạt**. `git diff --check ba69ee9..638cc62`: đạt.
- **Chưa chạy được PostgreSQL DB gate tại máy review:** sandbox không cho PostgreSQL tạo shared memory (`shmget: Operation not permitted`). Kết quả SQL/CI production cần kiểm trên môi trường DB thực.

## Thứ tự đề nghị

1. Xử lý cookie thiếu `accountId` trước khi deploy Phase B cho người dùng đang có phiên; đây là rủi ro gắn nhầm danh tính.
2. Bổ sung DB gate cho rollout B và cảnh báo khi bump version thất bại.
3. Có baseline/dual decision từ role thực tế trước khi Phase C cho chỉnh grant độc lập.
