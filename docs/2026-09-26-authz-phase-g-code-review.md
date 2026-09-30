# Code review Phase G

Ngày review: 2026-09-26. Phạm vi `429fa5f..ff40980`: implementation G `2148438` và tài liệu `ff40980`; 20 file, 706 dòng thêm / 146 dòng xóa. Review SQL rollout, schema, route, workload, grant/delegation, CI và test liên quan. Đây là review tĩnh; không có quyền đọc ACL hoặc dữ liệu production.

## Kết luận

Phase G đã đưa điều kiện tham gia hàng đợi CS vào grant `task.queue.member`, đổi route roster/delegation sang RPC có audit cùng transaction và cập nhật Role Manager cho người quản lý cấp grant hàng đợi. Tuy vậy, ranh giới quyền của RPC `assign_unassigned_task` **phụ thuộc ACL đã có trong DB**: Phase G bỏ kiểm permission trong hàm `SECURITY DEFINER` nhưng không tự khóa `EXECUTE` của chính hàm này. Workload và route assign cũng chưa cùng một policy chọn người hợp lệ; role chỉ có queue grant có thể hiện trong bảng nhưng không giao được Task.

## Phát hiện cần xử lý trước rollout

### [sol5.5] P1-01 — RPC gán Task bỏ kiểm grant bên trong nhưng rollout không khóa quyền gọi trực tiếp

`supabase/rollouts/2026-09-30-authz-phase-g.sql:15-57` thay thân `assign_unassigned_task` (`SECURITY DEFINER`) và xóa điều kiện `task.work`/Admin; hàm chỉ còn kiểm account active, roster, assistant và queue toggle. Route `src/app/api/tasks/[id]/assign/route.ts:43-69` kiểm actor `canAssign` và target `task.queue.member`, nhưng `:72-96` gọi RPC qua service role. Cuối rollout chỉ `REVOKE/GRANT EXECUTE` cho **bốn RPC roster/delegation mới** (`:288-295`), không có cặp ACL cho `assign_unassigned_task`. `supabase/schema.sql:4192-4334` cũng không khai báo ACL cạnh hàm; sweep ở cuối schema (`:7817-7859`) chỉ bảo vệ DB dựng mới/chạy lại toàn schema. CI dựng schema rồi mới chạy rollout (`.github/workflows/db-persistence-gate.yml:45-70`), nên ACL sạch trên CI không chứng minh ACL production trước migration.

**Điều kiện tác động:** `CREATE OR REPLACE FUNCTION` giữ ACL hiện tại. Nếu production đã thu hồi `EXECUTE` của `PUBLIC`, `anon`, `authenticated`, route là cổng duy nhất và không có bypass qua PostgREST. Nếu chưa thu hồi, người có anon/authenticated key có thể gọi `/rpc/assign_unassigned_task` trực tiếp, tự đặt `p_actor_email`, chỉ cần biết UUID Task backlog và email account active phù hợp; không qua `canAssign`/`task.queue.member`, mutation chạy bằng quyền definer. Function được tạo ở commit cũ không có revoke cạnh định nghĩa, nên **không được giả định ACL production an toàn**. P1 này là rủi ro triển khai có điều kiện, không phải bằng chứng production đang mở RPC.

**Sửa:** thêm `REVOKE ALL ON FUNCTION assign_unassigned_task(uuid,text,timestamptz,text) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role` vào **chính rollout G** và schema cạnh hàm, trong cùng transaction. Chạy preflight read-only `has_function_privilege('anon'/'authenticated', 'public.assign_unassigned_task(uuid,text,timestamptz,text)', 'EXECUTE')` trước deploy và assert false sau deploy. Test DB theo đường nâng cấp từ schema cũ có ACL PUBLIC, không chỉ fresh schema đã sweep; thử gọi bằng role authenticated phải bị `permission denied`.

## Phát hiện chức năng/chính sách

### [sol5.5] P2-01 — Queue grant một mình hiện trong workload nhưng route không cho gán

`src/lib/tasks/overview-data.ts:102-111,155-183` đặt `canWork` chỉ từ `task.queue.member`; `src/lib/tasks/overview.ts:465-472` đưa account active, không Admin/Agent/Assistant vào pool. Nhưng route gán gọi `isEligibleTaskAssigneeEmail` **trước** khi kiểm queue grant (`src/app/api/tasks/[id]/assign/route.ts:50-69`); hàm này dựa `fetchTaskAssignees`, chỉ lấy account giữ `task.read` (`src/lib/tasks/assignees.ts:56-87`). Role tùy chỉnh chỉ có `task.queue.member:*` vì vậy xuất hiện trong workload nhưng POST trả 400 “Assignee is not eligible”, chưa đến RPC. `route.test.ts:55-62` chỉ test target có cả `task.queue.member` và `task.read:shared_queue`, nên không bắt lệch.

**Sửa:** định nghĩa rõ điều kiện thành viên hàng đợi là `queue.member ∧ task.read` hay queue grant tự bao hàm quyền đọc; dùng cùng policy trong overview, picker, route và RPC. Nếu cần cả hai, Role Manager phải trình bày dependency/bundle và test queue-only, read-only, cả hai.

### [sol5.5] P2-02 — Legacy Admin có queue grant: API nhận, workload ẩn

`src/lib/tasks/overview-data.ts:159-179` đặt `isAdmin = account.role === 'admin' || (!queueMember && task.read:all)`; `aggregateOverview` loại mọi `isAdmin` khỏi pool (`src/lib/tasks/overview.ts:465-472`). Trái lại route gán chỉ cần target grant và assignee có `task.read` (`src/app/api/tasks/[id]/assign/route.ts:50-69`); RPC mới không loại `portal_account.role='admin'` (`supabase/rollouts/2026-09-30-authz-phase-g.sql:37-55`). Nếu Admin legacy được cấp tường minh `task.queue.member`, người đó bị ẩn ở workload nhưng vẫn có thể nhận Task bằng API trực tiếp. Đây cũng là phần tên/cột role còn quyết định eligibility trong code G dù mục tiêu là grant điều khiển hàng đợi.

**Sửa:** chọn một luật duy nhất. Nếu grant có hiệu lực cả với Admin, bỏ điều kiện legacy Admin khỏi pool; nếu Admin tuyệt đối không tham gia, từ chối ở route/RPC và không cho cấu hình queue grant cho account đó. Test role Admin + queue grant trên cả overview và POST trực tiếp.

### [sol5.5] P2-03 — Audit roster ghi thiếu trạng thái bị xóa ngoài Assistant

`remove_task_agent_atomic` chụp `assistants` bằng `agent_members ... is_assistant` (`supabase/rollouts/2026-09-30-authz-phase-g.sql:217-225`), rồi gọi `delete_task_agent_atomic`. Hàm cũ xóa **mọi** `agent_members` của Agent, không chỉ Assistant (`supabase/schema.sql:4024-4045`). Nếu còn membership `is_assistant=false`, mutation xóa nó nhưng audit `before` không chứa; không thể dựng lại tác động của thay đổi roster. Route mới đã dùng RPC mới (`src/app/api/config/agents/route.ts:65-84`), nên đây là thiếu sót của sự kiện audit mới, không phải audit rời cũ.

**Sửa:** chụp toàn bộ membership trước khi xóa, gồm `is_assistant`, và ghi snapshot đúng những dòng đã xóa; thêm fixture một non-assistant + một assistant, so audit với state trước/sau. Nếu non-assistant đã hết dùng, dọn dữ liệu và ràng buộc schema để trạng thái này không tái xuất hiện.

### [sol5.5] P2-04 — Các RPC cũ vẫn là đường ghi không tạo audit mới

G chỉ đổi hai route sang wrapper audit (`src/app/api/config/agents/route.ts:48-80`; `src/app/api/config/assistants/route.ts:67-109`). `create_agent_membership_atomic(text,text)` và `delete_task_agent_atomic(text)` vẫn giữ `EXECUTE` cho service role (`supabase/schema.sql:4021-4049`) và trực tiếp mutate relation mà không ghi `access_audit`. Không tìm thấy route hiện tại còn gọi chúng từ TypeScript; wrapper G tự gọi cả hai. Nhưng một job/service-role script tương lai vẫn có thể bypass audit mà DB không chặn, nên phát biểu “mọi thay đổi roster/delegation được audit nguyên tử” chỉ đúng cho hai route đã migrate.

**Sửa:** dồn logic mutation vào một hàm nội bộ không expose qua PostgREST, hoặc đưa audit bắt buộc vào trigger/primitive dùng chung; giới hạn `EXECUTE` của RPC cũ nếu không còn caller độc lập. Test mọi entry point service-role được hỗ trợ, không chỉ route mới.

## Kiểm chứng và giới hạn

- `src/app/api/tasks/[id]/assign/route.test.ts:41-63` chỉ chứng minh route kiểm target grant, không kiểm direct RPC/ACL hoặc pool. `supabase/checks/ci-authz-rpc.sql:81-105` kiểm audit và rollback basic; chưa kiểm non-assistant, ACL `assign_unassigned_task`, hoặc account queue-only. `decision-diff.ts:205-210` so boolean grant cũ/mới, không kiểm dependency `task.read` và trạng thái workload.
- Trên HEAD `ff40980`: `npm run typecheck` đạt, `npm run test:run` đạt **205 file / 1.766 test**, `npm run lint` exit 0 với hai warning cũ tại `public/sw.js` và `LeadTable.tsx`; `git diff --check 429fa5f..ff40980` đạt. DB gate không chạy tại máy review; không suy đoán ACL production từ test CI fresh schema.
- G sửa được phát hiện C P2-05 trên đường quản trị hiện hành: roster/delegation và audit commit cùng transaction. Các P1 D về scope Agent/Assistant, import Enrollment và commission identity vẫn chưa được G sửa; xem [review D](./2026-09-26-authz-phase-d-code-review.md). Các lệch UI Phase E và leak Web Push Phase F cũng còn nguyên.

## Thứ tự sửa

1. Chốt ACL của `assign_unassigned_task` ngay trong rollout G và kiểm production trước/sau.
2. Hợp nhất policy eligibility queue giữa overview, picker, route và RPC; test các grant tổ hợp và Admin legacy.
3. Đảm bảo audit nắm đủ state mutation và không còn đường service-role không audit.
