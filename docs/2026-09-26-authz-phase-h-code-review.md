# Code review Phase H

Ngày review: 2026-09-26. Phạm vi `ff40980..8e8acee`: H1 `0918618`, H2 `d30131e`, H3 `7944219` và tài liệu `8e8acee`; 34 file, 775 dòng thêm / 313 dòng xóa. Đánh giá trên snapshot **cuối Phase H**, không lấy các commit sửa review sau đó làm bằng chứng Phase H đã an toàn. Không đọc dữ liệu hay cấu hình production.

## Kết luận

Phase H đã bỏ đường suy grant từ permission, tên role và cột `portal_account.role` khi xử lý request. `principal.ts` chỉ nhận grant từ `role_grants`; `super_admin` có bộ grant hệ thống; role chưa chuyển không có quyền. Việc chuyển dữ liệu diễn ra qua RPC nguyên tử có audit. Đây là hướng đi đúng, nhưng **chưa nên dùng dry-run hiện tại làm cổng deploy**: script có thể bỏ sót role/account do giới hạn trả trang, không kiểm role hệ thống bắt buộc, và chỉ so một tập quyết định hữu hạn. Một kết quả “0 account đổi quyết định” chưa chứng minh rollout giữ nguyên hành vi.

## Phát hiện chặn rollout

### [sol5.5] P1-01 — Script chỉ lấy trang đầu của role và account, có thể báo sai “0 thay đổi”

`scripts/authz-migrate-role-grants.ts:42-49` lấy toàn bộ role qua `fetchRoleRows()`, nhưng hàm này gọi một lần `.select(ROLE_SELECT)` không có phân trang hay kiểm `count` (`src/lib/authz/principal.ts:79-85`). Script cũng lấy account active bằng một truy vấn không phân trang (`scripts/authz-migrate-role-grants.ts:51-60`). Với giới hạn số dòng của PostgREST/Supabase, dữ liệu ở các trang sau không được chuyển, không được đưa vào `changes` hoặc `withoutRole`. Dry-run vẫn có thể exit 0 (`:99-105`), `--apply` vẫn báo thành công sau khi xử lý riêng các role đã đọc (`:108-124`). Sau deploy, role bị bỏ sót trở thành không có grant theo `src/lib/authz/principal.ts:114-116,159-170`; account bị bỏ sót có thể đổi quyền mà không được cảnh báo.

**Sửa:** phân trang theo khóa ổn định cho cả `roles` và `portal_account`, kiểm tổng số dòng từ DB khớp số đã đọc, và kiểm cả các relation `user_roles` liên quan. Trước khi cho deploy, assert không còn role chưa `grants_managed` (trừ `super_admin`) bằng truy vấn DB ở `supabase/rollouts/2026-10-01-authz-phase-h.sql:67-70`; script nên tự chạy kiểm hậu chuyển và trả mã lỗi nếu còn. Test với dữ liệu vượt giới hạn một trang và role cần chuyển nằm ở trang sau.

### [sol5.5] P1-02 — Không xác nhận `system_key` của role hệ thống trước khi bỏ fallback theo tên

Phase C chỉ tự gắn `super_admin`/`default_new_account` cho role có tên đúng `Admin`/`Agent` (`supabase/schema.sql:389-394`). H bỏ fallback theo tên ở `src/lib/rbac/access.ts:141-158` và `src/lib/rbac/role-management.ts:154-165`, nhưng preflight H chỉ đếm role và so quyết định của **account active hiện có** (`scripts/authz-migrate-role-grants.ts:42-105`); không assert hai key tồn tại và role đang hoạt động. DB đã có unique index cho `system_key` (`supabase/schema.sql:387`). Nếu role Agent đã đổi tên trước rollout hoặc key chưa được backfill, dry-run vẫn có thể báo 0 thay đổi cho account cũ, trong khi đăng nhập Google lần đầu thất bại rồi xóa account vừa tạo (`src/auth.ts:135-145`), còn tạo account không chọn role trả 400 (`src/app/api/admin/users/route.ts:90-103`). Thiếu `super_admin` đúng key cũng làm mất danh tính admin khôi phục của H (`src/lib/authz/principal.ts:114-116`; `src/lib/rbac/role-management.ts:49-56`).

**Sửa:** preflight độc lập bắt buộc có đúng một role active cho từng key và ít nhất một account active giữ `super_admin`; xác thực default role có các grant dự kiến. Kiểm bằng ID/key, không suy từ tên. Thêm fixture role `Agent` đã đổi tên trước Phase C nhưng chưa có `system_key`, và assert dry-run/deploy gate thất bại rõ ràng.

## Phát hiện cần xử lý

### [sol5.5] P2-01 — Account đang khóa không được so quyết định trước khi có thể mở lại

`scripts/authz-migrate-role-grants.ts:51-55` chỉ chọn `is_active=true`, còn RPC chuyển role tăng `access_version` cho **mọi** account giữ role (`supabase/rollouts/2026-10-01-authz-phase-h.sql:50-52`). Account đang khóa chưa thể gọi API ngay, nhưng khi mở lại sau Phase H sẽ dùng grant mới. Nếu cột legacy `role`, role assignment và grant mới không khớp, hành vi sau mở khóa có thể đổi mà dry-run vẫn báo 0. Ví dụ một account `role='admin'` nhưng chỉ giữ role thường trước đây còn có quyền legacy admin bổ sung (`src/lib/authz/compat.ts:202-208`); H không còn cấp quyền đó.

**Sửa:** so cả account inactive, ghi rõ tập nào sẽ đổi sau khi mở khóa; yêu cầu giải quyết hoặc chấp thuận có hồ sơ trước rollout. Test inactive account có cột legacy admin lệch với role và sau đó kích hoạt lại.

### [sol5.5] P2-02 — `diffDecisions` chưa đủ làm bằng chứng bảo toàn quyền

Script dùng `diffDecisions(legacy, after)` làm điều kiện duy nhất để quyết định exit 0 hoặc cho `--apply` (`scripts/authz-migrate-role-grants.ts:66-79,99-105`). Danh sách so sánh thủ công trong `src/lib/authz/decision-diff.ts:193-219` có `notify.task.escalation` và `notify.enrollment.qc`, nhưng thiếu `notify.enrollment.escalation`, dù action này có trong catalog (`src/lib/authz/catalog.ts:219-229`) và được luật cũ cấp cho legacy admin (`src/lib/authz/compat.ts:202-208`). Ma trận cũng dùng vài mẫu facts cố định, không chứng minh mọi resource scope, trạng thái và quan hệ.

**Sửa:** trước tiên so **tập grant hiệu lực đầy đủ** của từng account giữa luật cũ và luật mới; khai báo ngoại lệ có chủ đích, nhất là `SUPER_ADMIN_GRANTS`, bằng allowlist được duyệt. Duy trì decision diff để kiểm hành vi theo resource, nhưng bắt buộc mọi action trong catalog được phân loại là đã so, không áp dụng, hoặc thay đổi có chủ đích. Thêm case `notify.enrollment.escalation` và facts scope biên.

### [sol5.5] P2-03 — Cổng CI “không còn phân quyền theo tên role” có nhiều điểm mù

`src/lib/authz/no-role-name-checks.test.ts:15-35,52-69` chỉ quét từng dòng TypeScript trong `src`, chỉ tìm `===`, `!==`, `includes` với một danh sách tên cố định. Điều kiện viết nhiều dòng, `switch`, `Set.has`, tên role mới, helper đọc `role` qua biến trung gian và code ở `scripts` đều lọt qua. Phần SQL chỉ quét function body trong `supabase/schema.sql` (`:72-85`), bỏ các rollout SQL. Vì vậy test đạt không đồng nghĩa không có code chạy thật tái đưa role-name authorization trở lại. Đây là điểm yếu của **gate phòng hồi quy**, chưa phải bằng chứng có bypass mới trong runtime Phase H.

**Sửa:** dùng AST/lint để cấm đọc `portal_account.role` và so `roles.name` ở module authorization/runtime, allowlist hẹp cho hiển thị/compat; quét cả rollout và RPC SQL theo danh sách object đang deploy. Thêm negative fixtures cho `switch`, `Set.has`, điều kiện nhiều dòng và tên role không nằm trong danh sách cũ.

## Kiểm chứng và rủi ro còn tồn

- Trên snapshot `8e8acee`: `npm run typecheck` đạt; `npm run test:run` đạt **207 file / 1.770 test**; `npm run lint` exit 0 với hai warning cũ tại `public/sw.js` và `LeadTable.tsx`; `git diff --check ff40980..8e8acee` đạt. Không chạy DB gate hoặc dry-run trên dữ liệu production, nên chưa xác nhận số role/account thực và ACL production.
- RPC H `convert_role_to_grants_atomic` khóa role, cập nhật grant và audit trong cùng transaction, đồng thời chỉ cấp `EXECUTE` cho `service_role` (`supabase/rollouts/2026-10-01-authz-phase-h.sql:21-63`). Phần này không có phát hiện bypass trực tiếp trong review.
- H không giải quyết các phát hiện độc lập từ [review D](./2026-09-26-authz-phase-d-code-review.md), [review F](./2026-09-26-authz-phase-f-code-review.md) và [review G](./2026-09-26-authz-phase-g-code-review.md), gồm scope dữ liệu, Web Push và ACL/eligibility hàng đợi. Không coi chúng là lỗi mới của H.

## Thứ tự sửa

1. Phân trang và đối soát đủ số role/account; tự chặn deploy nếu còn role chưa chuyển.
2. Bắt buộc kiểm hai `system_key` và account admin khôi phục trước khi cắt fallback.
3. So cả inactive account và toàn bộ grant/action; sau đó tăng độ phủ CI gate.
