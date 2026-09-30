# Code review nhánh `feat/authz-phase-c`

Ngày review: 2026-09-26. Phạm vi: 32 file thay đổi giữa Phase B (`638cc62`) và Phase C (`e6854ca`), gồm Role/Account Manager, grant projection, API guard, SQL RPC, UI và CI; đồng thời truy vết các API cũ tiêu thụ `role_permissions`. Review thực hiện trên snapshot commit Phase C, không dùng các thay đổi chưa commit của worktree `feat/authz-phase-d`.

## Kết luận

Phase C cải thiện rõ tính nhất quán: role/account mutation, `access_version` và audit nằm trong cùng RPC; `system_key` thay tên role cho Admin/default role; API Role/Account Manager dùng grant guard và trần ủy quyền ở server. **Chưa nên mở Role Manager dạng grant tùy chỉnh cho production**: phép chiếu grant mới sang permission phẳng cũ đang cấp quyền vượt grant ở những API chưa migrate. Đây là vấn đề backend có thể khai thác qua request trực tiếp, không chỉ là UI hiển thị sai. Các test hiện tại kiểm role cũ và RPC riêng lẻ, chưa kiểm bất biến “grant mới không mở thêm action/scope/domain cũ”.

## Phát hiện cần xử lý trước khi cho cấu hình grant tùy chỉnh

### [sol5.5] P1-01 — Grant chỉ đọc bị chiếu thành permission cho phép ghi/xóa

**Đường đi:** `src/app/api/admin/roles/route.ts:47-65` và `[id]/route.ts:81-105` lưu grant rồi gọi `projectLegacyPermissions`; SQL `supabase/rollouts/2026-09-28-authz-phase-c.sql:144-159` thay toàn bộ `role_permissions` bằng bản chiếu. `src/lib/authz/delegation.ts:40-65` dùng sự hiện diện của *read* để phát permission phẳng có ý nghĩa rộng hơn:

| Grant tối thiểu | Permission cũ được phát | API/hành vi phát sinh ngoài grant |
|---|---|---|
| `registration.health.read:all` | `registration.health`, `company.view_all` | `src/app/api/entries/[id]/route.ts:57-104,127-163` cho PATCH/DELETE mọi Health entry dù thiếu `registration.health.update` |
| `provider.read:*` | `automation.provider_finder` | `src/app/api/automation/provider-list/[id]/route.ts:23-29,105-114` cho PATCH dù thiếu `provider.update` |
| `lead.read:all` | `lead.manage`, `lead.work` | `src/lib/leads/access.ts:42-56` đặt `isManager=true`; `src/app/api/leads/assign/route.ts:20-27` và `src/app/api/leads/import/route.ts:67-74` cho gán/import dù thiếu grant ghi/quản trị |
| `task.read:assigned` | `task.work` | `src/lib/tasks/access.ts:38-50,128-145,169-189` cho worker đổi status task được giao và sửa/xóa task mình sở hữu dù thiếu grant update/delete |
| `task.read:all` với tên role `Task Admin` | `task.manage`, `task.work` | `src/lib/tasks/access.ts:16-50` đặt `isManager=true`, cho quản mọi task, assignment, QC và cấu hình |

**Tác động:** Role Manager mô tả các action riêng, nhưng backend cũ vẫn xem permission cũ như một gói quyền. Người cấu hình một role đọc sẽ vô tình cấp quyền ghi, kể cả xóa dữ liệu. Trường hợp Task Admin còn bị khuếch đại bởi phụ thuộc tên role chưa được gỡ.

**Đề nghị:** không chiếu một grant hẹp sang permission cũ có nhiều hành vi hơn. Trước khi role tùy chỉnh được dùng, migrate guard của các route trên sang action/policy tương ứng hoặc giới hạn UI/API chỉ cho các tổ hợp grant tương thích chính xác với permission cũ. Thêm test âm cho từng hàng: grant đọc không cho POST/PATCH/DELETE/assign/import, kể cả khi gọi API trực tiếp và khi role mang tên đặc biệt. `src/lib/authz/delegation.test.ts:51-94` hiện chỉ kiểm round trip của role cũ, nên vẫn xanh với các tổ hợp trên.

### [sol5.5] P1-02 — Một scope `all` ở Health mở rộng dữ liệu của P&C/dashboard

`src/lib/authz/delegation.ts:49-55` phát `company.view_all` khi **bất kỳ** một trong bốn grant registration/dashboard có scope `all`. Permission này dùng chung giữa các domain. Ví dụ role có `registration.health.read:all` và `registration.pc.read:own`: `src/app/api/pc-entries/route.ts:24-46` và `src/app/api/pc-entries/[id]/route.ts:60-76,133-158` xem `company.view_all`, nên phạm vi P&C thành toàn công ty. Tương tự, role có `registration.health.read:all` và `dashboard.pc.agent.read:own` có thể hỏi AI dashboard P&C toàn công ty vì `src/app/api/ai/dashboard-chat/route.ts:129-147` dùng `canViewAll` toàn cục để bỏ lọc agent.

**Đề nghị:** bỏ bản chiếu scope `all` liên domain ở nơi API cũ còn dùng. Migrate các route sang `registration.pc.read:all`, `dashboard.pc.agent.read:all` riêng, hoặc tạm chỉ cho phép cấp scope `all` khi toàn bộ quyền liên quan cũng được cấp đúng mức. Test ma trận Health/P&C × own/all trên list, detail, mutation và AI; tuyệt đối không suy scope P&C từ grant Health.

### [sol5.5] P1-03 — Import/export của một domain có thể mở sang domain khác

`src/lib/authz/delegation.ts:63-64` phát `task.export` từ **bất kỳ** `task.export`, `enrollment.export`, `provider.export`; tương tự phát `task.import` từ `enrollment.import` **hoặc** `provider.import`. `src/app/api/automation/provider-list/import/route.ts:34-45` chỉ đòi `automation.provider_finder` và `task.import`. Vì `provider.read:*` cũng chiếu ra `automation.provider_finder`, role có `provider.read:*` + `enrollment.import:*` có thể import/ghi đè Provider dù không có `provider.import:*`. Ngược lại, grant `provider.import:*` đơn lẻ có thể không dùng được vì thiếu permission mở Provider List. Export cũng dùng quyền cũ dùng chung ở `src/lib/table-config/export-access.ts:7-20` và `src/app/api/automation/provider-list/export/route.ts:21-34`.

**Đề nghị:** gác từng endpoint bằng grant đúng domain (`provider.import`, `enrollment.import`, `provider.export`, v.v.) trước khi cho phép grant độc lập. Giữ `task.import/export` phẳng chỉ cho role legacy chưa migrate. Test các tổ hợp một domain được phép, hai domain còn lại bị từ chối; bao gồm cả thiếu quyền đọc và role Task Admin.

## Phát hiện tiếp theo

### [sol5.5] P2-01 — Role mặc định có thể bị tắt nhưng Google vẫn gán cho account mới

`src/app/api/admin/roles/[id]/route.ts:57-80` và `upsert_role_atomic` tại `supabase/rollouts/2026-09-28-authz-phase-c.sql:108-134` chỉ bảo vệ `super_admin`; role có `system_key='default_new_account'` vẫn đổi tên/tắt được. `src/lib/rbac/access.ts:143-169` tìm role theo `system_key` rồi gán cho account Google mới mà không kiểm `is_active`; `src/auth.ts:119-149` coi việc gán thành công là đăng nhập thành công. Account mới sẽ mang role inactive và không có permission hiệu lực. Account Manager tạo account thủ công thì đã chặn role inactive tại `src/app/api/admin/users/route.ts:72-85`.

**Đề nghị:** chặn tắt default role khi còn dùng làm mặc định, hoặc yêu cầu chọn một default role active mới trong cùng transaction. Google self-provision phải kiểm role active và rollback sạch khi không có default hợp lệ. Test disable default role → Google login mới.

### [sol5.5] P2-02 — Backfill `system_key` phụ thuộc tên chính xác trong production

`supabase/rollouts/2026-09-28-authz-phase-c.sql:23-28` chỉ gắn `super_admin` cho role tên `Admin` và `default_new_account` cho role tên `Agent`. DB gate `supabase/checks/ci-authz-rpc.sql:9-17` chạy trên `schema.sql` vốn tạo đúng hai tên này, nên không kiểm dữ liệu production đã đổi tên/thiếu role. Sau rollout, `src/lib/rbac/role-management.ts:163-173` chỉ rơi về tên khi query cột `system_key` **bị lỗi**, không rơi về khi cột có nhưng không có hàng mang key.

**Đề nghị:** chạy preflight theo role ID và membership thực trước migration; gắn `system_key` theo mapping đã xác nhận, assert đúng một role active cho mỗi key. Nếu preflight fail, dừng rollout và sửa dữ liệu có kiểm soát. Test DB fixture với role Agent/Admin đã đổi tên.

### [sol5.5] P2-03 — Request grant sai bị cắt bỏ âm thầm, có thể lưu role thiếu quyền

`src/app/api/admin/roles/role-input.ts:11-25` lọc mọi giá trị không phải string rồi `normalizeGrants` bỏ action/scope không hợp lệ; `src/lib/authz/grants.ts:25-33` xác nhận hành vi này. POST/PATCH vẫn gọi RPC và trả thành công với phần còn lại, kể cả mảng rỗng. Với typo trong API client hoặc catalog mới/chưa đồng bộ, role đang dùng có thể mất quyền hàng loạt mà người quản trị không biết.

**Đề nghị:** validate toàn bộ input và trả 400 kèm grant sai; chỉ chấp nhận `[]` khi client cố ý gửi mảng rỗng. Test request một grant hợp lệ + một grant sai, và grant sai duy nhất.

### [sol5.5] P2-04 — Account create/update chưa nguyên tử trên toàn bộ thao tác

`src/app/api/admin/users/route.ts:97-139` insert account rồi mới gọi `assign_account_access_atomic`; khi RPC lỗi, code xóa account để bù nhưng bỏ qua lỗi cleanup. `src/app/api/admin/users/[id]/route.ts:406-435` commit role/status bằng RPC rồi mới update email/name/password/agent ID; nếu update sau thất bại, API trả 500 dù quyền/trạng thái đã đổi. `src/auth.ts:119-145` có cùng chuỗi insert → gán role → xóa bù cho Google login.

**Đề nghị:** đưa create-account + assign-role và PATCH role/status + profile fields cần nhất quán vào RPC/transaction phù hợp; trước mắt kiểm lỗi cleanup, trả trạng thái partial rõ ràng và có reconciliation job/query cho account không role. Test lỗi ở bước thứ hai và xác nhận state cuối cùng, `access_version`, audit.

### [sol5.5] P2-05 — Audit thay đổi Agent/Assistant tách khỏi mutation và có thể mất bản ghi

`src/app/api/config/agents/route.ts:48-55,68-75` và `src/app/api/config/assistants/route.ts:67-85,107-121` mutate roster/delegation rồi gọi `recordAccessAudit`. Helper ở `src/lib/authz/audit.ts:18-34` chỉ log khi insert audit lỗi; mutation vẫn thành công. Đây là các thay đổi trực tiếp tới scope dữ liệu, nhưng `access_audit` có thể thiếu event dù UI báo thành công. Ngoài ra `before`/`after` đều để null, chưa chứng minh được quyền đã thay đổi từ gì sang gì.

**Đề nghị:** ghi audit trong cùng transaction/RPC với mutation và lưu trạng thái trước/sau tối thiểu; thêm test rollback khi audit insert thất bại và xác nhận actor/target chính xác.

### [sol5.5] P2-06 — Fallback schema dựa trên regex có thể suy grant từ permission cũ khi bảng grant đã tồn tại

`src/lib/authz/principal.ts:53-95` rơi về query legacy với mọi lỗi có chứa `role_grants`, `grants_managed` hoặc `system_key`, không chỉ lỗi PostgreSQL/PostgREST xác nhận cột/bảng chưa tồn tại. Khi role đã `grants_managed=true`, fallback làm `grants=null` (`:62-75`), rồi `grantsForRoles` suy lại từ `role_permissions` (`:156-171`). Vì bản chiếu có thể rộng hơn grant thật như P1-01/P1-02, một lỗi query liên quan bảng grant có thể làm grant hiệu lực rộng lên. `src/lib/rbac/role-management.ts:93-103` có fallback tương tự cho màn hình quản trị.

**Đề nghị:** fallback chỉ với mã lỗi schema xác định và chỉ trong cửa sổ rollout; sau khi C được xác nhận, bỏ fallback. Nếu role đã managed mà không đọc được grant thì fail closed, không suy từ bản chiếu. Test lỗi query chứa tên bảng nhưng không phải “missing schema”.

### [sol5.5] P2-07 — Trần ủy quyền so chuỗi tuyệt đối, không hiểu scope bao hàm

`src/lib/authz/delegation.ts:12-18` chỉ chấp nhận grant target nếu actor có đúng chuỗi đó. Một role chỉ có `task.read:all` không cấp được `task.read:assigned`, dù scope `all` bao trùm `assigned` khi xét tài nguyên; `RoleManagerClient.tsx:96,140-146,159-170` cũng ẩn checkbox tương tự. Đây là chính sách bảo thủ, không mở quyền, nhưng dễ buộc người quản trị cấp `all` rộng hơn ý định hoặc khiến việc sao chép role thất bại âm thầm.

**Đề nghị:** định nghĩa quan hệ bao hàm scope theo từng action, dùng chung cho API và UI; test `all → scope hẹp` được phép, `scope hẹp → all` bị chặn. Nếu yêu cầu nghiệp vụ là “chỉ grant đúng chuỗi mình giữ”, ghi rõ quy tắc đó trong UI.

## Kiểm chứng và giới hạn

- `npm run typecheck`: đạt. `npm run test:run`: **198 file, 1.673 test đạt**. `npm run lint`: exit 0 với 2 warning cũ (`public/sw.js`, `LeadTable`). `git diff --check 638cc62..e6854ca`: đạt.
- `supabase/checks/ci-authz-rpc.sql:22-36` kiểm RPC lưu grant và permission nhưng truyền `task.read:all` cùng `task.manage` trực tiếp; không kiểm bản chiếu là subset an toàn của grant. `src/lib/authz/delegation.test.ts:51-94` chỉ kiểm role cũ và round trip. Vì vậy test xanh **không phủ** các P1 bên trên.
- **Chưa chạy được PostgreSQL DB gate tại máy review:** sandbox không cho PostgreSQL tạo shared memory (`shmget: Operation not permitted`). Cần kết quả CI thật và preflight dữ liệu production cho `system_key`, role membership, permission trước rollout.

## Thứ tự đề nghị

1. Khóa việc dùng grant độc lập trong production hoặc migrate ngay các API cũ bị P1-01/02/03 tác động; thêm test âm ở cấp API cho các tổ hợp grant tối thiểu.
2. Kiểm migration `system_key` trên dữ liệu thật và bảo vệ default role/Google onboarding.
3. Hoàn thiện atomicity của account/roster/delegation, siết input validation và bỏ schema fallback sau rollout.
