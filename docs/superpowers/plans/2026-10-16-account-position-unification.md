# Account, Role, Position, Manager — plan thống nhất cấu hình

> **[Codex · 2026-10-16] Trạng thái:** plan để review, chưa triển khai, chưa chạy SQL production.
> Bản này ghi lại các quyết định đã chốt cho Account, Position, Agent/Assistant và Time Off.
> Tài liệu `2026-10-13-account-role-redo.md` và bản review được nhắc trong hội thoại hiện
> không có trong checkout này; trước khi triển khai cần đối chiếu lại nếu chúng được cung cấp.
> Không dùng checklist/SQL cũ thay cho các gate parity trong bản này.
>
> **Giới hạn bắt buộc của đợt này:** triển khai cấu trúc và nơi cấu hình, **không thay đổi
> quyền thực tế của bất kỳ account production nào**. “Quyền thực tế” gồm tab/API được vào,
> thao tác được làm, task/lead được xem hoặc sửa, hàng chờ CS, và quyền xem/duyệt Time Off.
> Mọi migration có thể làm một người được xem thêm hoặc mất dữ liệu đều bị loại khỏi đợt này.

> **[Claude · 2026-10-17] S0–S3 đã code. Rollout S1 + S2 + `2026-10-17-drop-cs-manager-guard.sql`
> đã chạy production; S3 không có SQL. Code CHƯA commit/deploy.** Review của Codex:
> `2026-10-17-account-position-production-parity-audit.md` (phản biện F1–F8 ở cuối file đó).
>
> - **BỎ luật "CS Manager cần Role có task.manage"** (user chốt 17/10, thay quyết định 3, §S2 và
>   §8). Live DB không còn 4 trigger `cs_manager_guard_*` và hàm `assert_cs_managers_have_task_manage`.
>   CS Manager chỉ là Position. ĐỪNG khôi phục guard từ bản plan này.
> - Account Manager hiển thị Role là **"Accessibility"** (chỉ chữ).
> - Assistant: "Manager" hiển thị = các Agent trong `agent_members`; `manager_id` của Assistant
>   không dùng cho gì (không auth, không Time Off). Người khác: Manager = `manager_id`.
> - Chỉ Position nhóm Agent / Assistant đổi quyền (qua `task_agents` / `agent_members`: phạm vi
>   Task/Lead/Enrollment, CS pool, một số thông báo). Position nhóm CS/Other và Manager không đổi gì. Các điểm dưới đây THẮNG nội dung tương ứng phía dưới:
> - **Nhãn giữ "Admin"** cho người có `task.manage` (user chốt 14–16/10). Bỏ quyết định 6 và
>   việc đổi copy sang "Task Manager" ở S1/S3.
> - **Bỏ cột Position suy ra** (`account-position.ts`) ở Account Manager; cột Position chỉ còn
>   Position do admin gán.
> - **Assistant chọn được NHIỀU Agent** (ô "Hỗ trợ Agent" = `agent_members`); ô Manager một người,
>   chỉ là cây quản lý, không bắt buộc là Agent. Lý do: audit S0 thấy Cheryl To là Assistant của 6
>   Agent; giữ nguyên quyền cô ấy. Thay quyết định 4, §1 "chỉ chọn một người", §4.4 và gate §5 về
>   "Assistant >1 Agent". Không thêm unique index "một Assistant một Agent" (§4.9).
> - **`portal_account.manager_id` đã có trên production** (nhánh `org-chart` 12/09, chưa merge):
>   FK `on delete set null`, check not-self, trigger `portal_account_manager_no_cycle`, index;
>   2 account test có giá trị. S1 chỉ thêm `positions` + `position_id`.
> - **Trigger `prevent_personal_lead_account_deactivation` KHÔNG có trên production** (§3.2 sai).
>   Hiện tắt Agent không bị DB chặn; đợt này giữ nguyên hành vi đó.
> - Bỏ `positions.is_active` (chưa có luồng nào dùng).
> - **Đổi Position KHỎI Agent được phép** (user 16/10): làm đúng như "Remove Agent" cũ
>   (`delete_task_agent_atomic`), form cảnh báo các Assistant bị ảnh hưởng. Thay §4.10 và
>   "không có luồng bỏ Agent" ở quyết định 4.
> - **S2 bỏ hẳn tab Agent membership** (không giữ read-only): API ghi cũ trả 410; ô Position ở danh
>   sách account hiện "Assists / Assistants". Role nằm trong Edit account, bỏ modal Change role.
> - Backup/khôi phục: schema `access_backup`, script `supabase/rollouts/2026-10-16-access-*.sql`;
>   kiểm lệch `2026-10-16-position-drift-check.sql` (chạy sau mỗi deploy).
> - Reconcile mỗi stage: snapshot chỉ đọc per-account (Role, tick đã mở rộng, Agent, Assistant của
>   ai, dòng `agent_members` cũ, hàng chờ CS, sound) + md5 các bảng nguồn; so với baseline S0.

## 1. Mục tiêu và ví dụ nghiệp vụ

Người quản trị hiện phải đặt Role trong Account rồi sang tab Agent membership để đánh dấu Agent
và gắn Assistant cho Agent. Điều đó khiến cùng một account có nhiều chỗ cấu hình và khó nhìn ra
ai quản lý ai. Đích đến là:

- **Account Manager** là nơi gán cho một người: một Role, một Position chính, một manager trực
  tiếp, Agent ID (tùy chọn), trạng thái account. Một lần lưu cho các dữ kiện liên quan.
- **Role Manager → tab Position** là nơi tạo danh mục Position. Người có
  `management.role_manager` quản lý danh mục; người có `management.account_manager` gán Position
  và manager cho account.
- Chọn Position nhóm Agent trong Account là **đường UI duy nhất** để xác định ai là Agent. Không
  có công tắc Agent hoặc tab gán Assistant độc lập.
- Với Position nhóm Assistant, manager phải là một Agent đang hoạt động. Manager ấy cũng là
  Agent mà Assistant hỗ trợ; chỉ chọn **một người**. Một Agent có thể có nhiều Assistant.
- Với CS hoặc Position khác, manager có thể là bất kỳ account đang hoạt động nào. Quan hệ manager
  phục vụ cây quản lý; trong đợt này **chưa thay đổi** luồng duyệt nghỉ phép.

Ví dụ kiểm chứng UI sau cutover:

| Account | Role/quyền hiện có | Position | Manager | Kết quả đợt này |
|---|---|---|---|---|
| Khang | có thể là Admin hoặc quyền khác | Agent | tùy chọn | Vẫn là Agent; không đổi quyền task/lead |
| Kay | có thể có `task.manage` | Assistant | Khang | Vẫn có mọi quyền do Role cấp; một ô manager thể hiện quan hệ Assistant |
| Chị Dung | Role có `task.manage` | CS Manager | tùy chọn | Vẫn quản lý toàn bộ Tasks; nhận task tự động vẫn do CS Overview quyết định |
| CS thường | `task.work` hoặc Role hiện có | CS hoặc chưa có Position | Chị Dung | Phạm vi task/hàng chờ giữ nguyên |

> **[Codex] Role quyết định quyền; Position không cấp hoặc thu hẹp quyền.** Kay có Position
> Assistant và `task.manage` vẫn xem/quản lý mọi task như hiện tại. Assistant chỉ có
> `task.work` vẫn có các quyền agent-owner hiện tại trên task của Agent được hỗ trợ.
> `task.manage` không được đổi nghĩa trong đợt này.

## 2. Quyết định đã chốt với user

1. Mỗi account có **một Role** và tối đa **một Position chính**. Role bắt buộc khi tạo account;
   Position và manager có thể đặt sau. Account chưa có Position mà Role có `task.work` vẫn hành
   xử như CS thường, đúng logic hiện tại.
2. Position có tên và **nhóm nghiệp vụ** Agent / Assistant / CS / Khác. Nhóm này xác định dữ kiện
   Agent/Assistant cần đồng bộ, **không phải một nguồn quyền**. Position CS Manager là một mục
   riêng trong danh mục. Agent ID không bắt buộc.
3. Role và Position chọn độc lập. Ngoại lệ kiểm tra tính nhất quán: gán Position hệ thống
   CS Manager cần Role có `task.manage`; Role Manager không được bỏ tick đó hoặc vô hiệu hóa
   Role khi còn account CS Manager dùng Role ấy. Kiểm tra này không tự cấp `task.manage`.
4. Agent và Assistant không kiêm nhau. Một Assistant có đúng một Agent; một Agent có thể có nhiều
   Assistant. Position Agent không có luồng “bỏ Agent” thường ngày sau khi đã gán.
5. Position đang có account dùng thì **không có action sửa/xóa**, kể cả đổi tên hoặc nhóm.
   Muốn sửa danh mục phải chuyển hết account khỏi Position đó trước; Position hệ thống cần
   bảo vệ riêng vì Assistant→CS sau này dùng Position CS mặc định.
6. Kay có `task.manage` thì “Task Manager” là nhãn chính trên Task Board/danh sách; Position
   Assistant vẫn hiện trong chi tiết Account. Agent + Admin hoặc Agent + `task.manage` là hợp lệ.
7. Manager là một quan hệ trực tiếp; không có quyền nào tự phát sinh từ manager. Cấm tự quản lý
   chính mình và vòng lặp trong cây.
8. Công tắc nhận task CS **ở lại CS Overview**. Chị Dung không nhận task tự động; trạng thái
   queue hiện có của mọi người được giữ nguyên.
9. Không đổi email account. Không xóa account trong đợt này; luồng Disable hiện có vẫn theo
   ràng buộc production hiện tại.
10. Quyết định tương lai, **không nằm trong rollout này**: manager theo Account duyệt nghỉ phép
    team trực tiếp qua tick riêng; quyền duyệt toàn bộ hiện có vẫn toàn bộ; người nộp không chọn
    manager từng đơn; đổi manager chuyển đơn pending; Admin xử lý khi manager thiếu quyền/vắng.
    Agent bị Disable vẫn đứng tên task/lead cũ, còn Assistant chuyển CS thường, manager trống,
    queue tạm tắt và không tự khôi phục khi Agent bật lại. Các quyết định này cần rollout quyền
    và ràng buộc DB riêng, sau khi đợt cấu trúc đạt parity.

## 3. Hiện trạng code/DB cần giữ nguyên hiệu lực

### 3.1 Quyền và phạm vi dữ liệu

- `roles` → `role_permissions` → `user_roles` là nguồn quyền. Code đọc tick, không suy quyền từ
  tên Role (trừ role Admin cố định trong các chỗ đã được allow-list).
- `src/lib/tasks/access.ts`: `task.manage` là quyền manager toàn bộ Tasks; `task.work` là worker.
  Agent/Assistant có `task.work` được agent-owner rights trên task của Agent tương ứng: tạo,
  sửa nội dung, giao việc, đổi trạng thái, xóa, QC. Không gán `task.manage` để “mở khóa” một
  Assistant nếu yêu cầu chỉ là các thao tác agent-owner đó.
- `src/lib/tasks/membership.ts` và `src/lib/leads/membership.ts` đọc `agent_members`. Assistant
  thường chỉ thấy phạm vi Agent; người có quyền Manage toàn bộ vẫn được Role cho toàn bộ.
- `task_agents(email)` là roster Agent đang được Tasks/Leads/Enrollment dùng.
  `agent_members(agent_email, cs_email, is_assistant)` là quan hệ hỗ trợ, hiện cho phép nhiều
  Agent trên mỗi Assistant ở mức schema. Nhiều code dùng email làm khóa nối.
- CS queue là `task_assignment_queue_members`, chỉnh ở `/api/tasks/assignment-queue` /
  CS Overview; SQL `assign_unassigned_task` còn kiểm eligibility theo Role, Agent roster,
  Assistant membership và queue. Đợt này không sửa các predicate đó.
- `src/lib/tasks/positions.ts` và `account-position.ts` đang tạo **nhãn suy ra từ quyền và
  membership**, chưa phải Position do admin gán. Không dùng nhãn này làm nguồn migration.

### 3.2 Account, Position, Time Off

- `src/app/(authed)/account-manager/AccountManagerClient.tsx` có form Account, modal Role và
  tab Agents riêng. `AgentMembershipSection.tsx` gọi API Agent/Assistant riêng.
- `update_account_atomic` trong `supabase/rollouts/2026-10-13-account-atomic.sql` ghi account
  và Role trong một transaction; không bao gồm roster/membership. Cần mở rộng cùng transaction,
  không ghi 2–3 request rồi báo “Save thành công”.
- `portal_account` chưa có `position_id`/`manager_id`; `agent_id` là metadata riêng, tùy chọn.
  `portal_account.role` legacy không được dùng để phân quyền.
- Time Off hiện cho người nộp chọn `time_off_requests.manager_id` từng đơn để **nhận thông báo**;
  chỉ `timeoff.admin` được duyệt. `src/app/api/time-off/route.ts`,
  `src/app/api/time-off/requests/[id]/route.ts` và `src/lib/time-off/access.ts` đang thực thi
  điều đó. **Không đổi code, UI, permission hay dữ liệu Time Off trong rollout này.**
- Trigger `prevent_personal_lead_account_deactivation` trong
  `supabase/rollouts/2026-10-03-lead-personal-agent-integrity.sql` đang chặn Disable Agent còn
  Personal lead active. Chưa nới trigger trong đợt cấu trúc.

### 3.3 Ràng buộc từ code và tài liệu từng được nhắc

- Tài liệu review 13/10 hiện không có trong checkout. Nếu lấy lại được trước lúc triển khai,
  đối chiếu các nhận xét với code. Những điểm đã biết cần kiểm độc lập: atomic save, lock
  ordering, membership grants, cache invalidation, label parity, Role/Account delegation,
  và ranh giới module.
- `AGENTS.md` yêu cầu đọc tài liệu Next.js 16 trong `node_modules/next/dist/docs/` trước khi
  sửa code Next.js. Không dùng giả định API Next.js từ bản khác.
- Các RPC atomic và luồng quản lý Account/Role hiện đã có trong checkout. **Kiểm trạng thái
  code hiện tại trước khi sửa**, không triển khai lại phần đã có chỉ vì tên plan cũ.

## 4. Mô hình dữ liệu đích cho rollout cấu trúc

1. Thêm bảng `positions`: `id`, `name` unique, `kind` = agent/assistant/cs/other,
   `system_key` nullable unique, `is_active`, timestamps. Seed Position hệ thống Agent,
   Assistant, Customer Service, CS Manager. CS Manager có `kind=cs` và `system_key=cs_manager`;
   kiểm tra theo `system_key`, **không so tên**. Position hệ thống không xóa.
2. Thêm `portal_account.position_id` nullable FK và `portal_account.manager_id` nullable FK
   self-reference. Thêm index theo hai cột, check manager != self và cơ chế ngăn vòng lặp.
   Không thêm `position` vào session permission hay RBAC resolver. Đặt tên type/field UI cho
   Position cấu hình khác `AccountPosition` đang là nhãn suy ra, tránh ghi đè ý nghĩa cũ.
3. **Quyền vẫn đọc bảng cũ** `task_agents`/`agent_members` trong đợt này. Khi account được sửa
   qua form mới, một RPC transaction đồng bộ Position/manager với hai bảng đó. Như vậy không
   phải sửa đồng loạt các query Tasks/Leads/Enrollment và không đổi phạm vi đọc hiện tại.
4. Với Position Agent mới: thêm email vào `task_agents`. Với Position Assistant mới: cần
   `manager_id` là account active có Position nhóm Agent; tạo đúng một `agent_members` row
   `is_assistant=true`. Với Position khác: không tạo link Agent/Assistant.
5. `manager_id` của CS/Position khác chỉ là cây quản lý trong giai đoạn này. Không áp dụng nó
   cho Task/Lead/Time Off authorization. Một CS có manager là Agent **không** trở thành Assistant.
6. Không sửa `task_agents` hoặc `agent_members` cho bất kỳ account cũ chỉ vì backfill Position.
   Backfill Position là ánh xạ **từ dữ liệu cũ sang cột mới**, không phải chiều ngược lại.
   Các row `agent_members.is_assistant=false` cũng giữ nguyên.
7. Thêm version/concurrency guard cho snapshot cấu hình account hoặc kiểm tra expected state
   trong RPC; hai admin mở cùng account không được âm thầm ghi đè Position/manager/link của nhau.
   Lấy khóa people graph trước các khóa hiện có theo thứ tự cố định; giữ check “còn Admin”.
8. API cũ ghi Agent/Assistant phải chuyển sang cùng write path hoặc bị ngừng sau cutover; không
   được để đường cũ ghi bảng membership mà không cập nhật Position/manager. GET có thể giữ tạm.
9. Về lưu trữ quan hệ Assistant: `portal_account.manager_id` là manager trực tiếp, còn
   `agent_members` là projection tương thích cho module cũ. Chỉ write path chung được đổi cả hai.
   DB invariant/unique index cho “một Assistant một Agent” chỉ được thêm **sau** audit và khi
   production không có bản ghi vi phạm; không tự xóa link để pass constraint.
10. Account đã mang Position Agent không được chuyển sang Position khác hoặc bỏ Position qua
    luồng Account thông thường. Chặn ở server/DB, không chỉ khóa ô UI. Một thay đổi loại này
    là migration nghiệp vụ riêng vì có thể đổi phạm vi dữ liệu.

## 5. Trước khi rollout: audit và baseline parity

Chỉ chạy truy vấn production sau khi có quyền truy cập và chốt thời điểm với user. Lưu baseline
theo **account ID**, so sánh bằng tập hợp, không chỉ so số lượng:

1. Role hiện tại, expanded permission keys, trạng thái active, Admin cuối cùng.
2. Tập `task_agents` và tập `agent_members.is_assistant=true`, gồm Agent/Assistant inactive,
   link mồ côi, Assistant gắn >1 Agent, người vừa là Agent vừa Assistant.
3. Phạm vi hiệu lực từng account: `task.manage`/`task.work`, Agent/Assistant scope, plain-CS
   company queue, Lead Manage/Work scope; queue on/off trong `task_assignment_queue_members`.
4. `timeoff.user`/`timeoff.admin` của từng account, danh sách người có thể duyệt; pending requests
   và `manager_id` trên từng đơn chỉ để xác nhận migration cấu trúc **không đụng** tới chúng.
5. Personal leads/task còn đứng tên Agent, vì logic Disable sau này cần kế hoạch riêng.

**Gate:** Nếu thấy Assistant >1 Agent, một account đồng thời Agent+Assistant, roster Agent
không khớp account đang có, hoặc link không thể
gắn một manager duy nhất mà vẫn giữ nguyên scope, **không tự chọn một Agent, không cắt link, không
cutover UI**. Ghi danh sách trường hợp để user xử lý bằng một thay đổi quyền được duyệt riêng,
hoặc thiết kế compatibility mode giữ nguyên tất cả link legacy. Bản plan này không âm thầm đổi
access để ép dữ liệu vào mô hình mới.

Sau mỗi bước triển khai, diff baseline với trạng thái mới của **mọi production account**. Cần
so cả tập Agent/Assistant, hiệu lực Role, queue và Time Off. Chọn cửa sổ rollout không có admin
đồng thời chỉnh Account/Role/Agent; nếu không thể khóa thao tác này, ghi audit delta và tách
các thay đổi có chủ ý trước khi so. Khác biệt không giải thích được thì dừng/rollback trước
bước kế tiếp.

## 6. Các phase triển khai của đợt này

### S0 — Preflight và thử migration trên snapshot

- Chạy audit `5`, lưu kết quả kiểm chứng nhưng không đưa email/sensitive data vào plan/git.
- Kiểm tra schema production thực tế vì `supabase/schema.sql` có drift với một số rollout
  Time Off; migration viết theo schema đang chạy.
- Kiểm chứng trường hợp Assistant đơn Agent, Agent+Assistant, queue và các account Role Manage.
- Viết rollback tương ứng từng rollout. Không chạy SQL production trong lúc soạn plan.

**Xong khi:** Có baseline per-account, không có conflict chưa xử lý cho cutover; biết rõ
backfill Position nào chắc chắn và account nào cần để null.

### S1 — Danh mục Position và cột Account, chưa đổi auth

- Additive SQL cho `positions`, `position_id`, `manager_id`; seed Position hệ thống.
- Backfill **chỉ** các mapping chắc chắn: `task_agents` → Agent Position;
  Assistant đúng một Agent → Assistant Position và manager là Agent đó.
  Không suy CS Manager từ `task.manage` và không đoán Position cho account còn lại; để null.
- UI Role Manager thêm tab Position: tạo Position, xem số account dùng, chặn mọi action khi đã
  dùng, chặn xóa Position hệ thống. API kiểm `management.role_manager`.
- Account list hiển thị Position cấu hình và manager, nhưng chưa dùng hai cột này để quyết định
  quyền. Giữ nhãn quyền chính theo Task Board hiện tại; đổi copy “Admin Task Board” thành nhãn
  Task Manager nếu chỉ là text và không đổi auth.

**Xong khi:** Baseline auth/scope trước và sau giống hệt; dữ liệu Position mới khớp các mapping
chắc chắn; không có thay đổi `task_agents`/`agent_members`/Role/queue/Time Off.

### S2 — Một form Account và write transaction

- Một drawer/form cho Role, Position, Manager, Agent ID; Role bắt buộc, Position optional.
  Khi Position Assistant: manager picker lọc Agent active, bắt chọn một; khi khác: chọn bất kỳ
  account active hoặc để trống. Hiện preview “Role cho quyền gì / Position và manager là ai /
  Agent hoặc Assistant scope nào”, không dùng Position để grant/deny.
- Mở rộng `update_account_atomic` (hoặc RPC thay thế có migration rõ ràng) để ghi Role,
  Position, manager và delta projection `task_agents`/`agent_members` cùng transaction.
  Không gọi các route ghi tuần tự. Server/API kiểm Role CS Manager có `task.manage` và kiểm
  Role Manager không thể gỡ tick đó hoặc vô hiệu hóa Role còn holder CS Manager. Kiểm tra
  liên quan phải nằm trong transaction/DB guard để hai admin thao tác đồng thời không lọt.
- Bảo toàn trần ủy quyền, check tự đổi Role, last Admin, khóa chống race, lỗi có mã rõ,
  invalidate RBAC/membership cache và phát realtime sau commit.
- Giữ nguyên hành vi của nút Disable hiện tại trong rollout này; không tự chuyển Assistant
  thành CS và không nới guard Personal lead.
- Tắt write từ tab Agent cũ sau khi drawer mới đã đọc/ghi đúng; xóa hoặc chuyển tab đó sang
  read-only để không còn hai nơi cấu hình. CS Overview queue vẫn giữ nguyên.

**Xong khi:** Lưu không đổi gì là no-op thật; lưu Role/Position/manager một lần thành công hoặc
rollback toàn bộ; API cũ không gây drift; baseline của account không được admin chủ ý chỉnh
trong rollout vẫn khớp.

### S3 — Cây quản lý và dọn UI

- Danh sách Account có filter Role, Position, manager và trạng thái; view cây đọc-only theo
  `manager_id`, có root không manager và node manager inactive. Không suy quyền theo cây.
- Badge chính dựa Role/Task capability (ví dụ Kay là Task Manager); Position và manager là
  thông tin phụ nhìn thấy được. Không gọi Position “quyền”.
- Hướng dẫn ngắn trong UI: “Role quyết định quyền; Position và manager quyết định quan hệ
  công việc. Assistant chọn một Agent tại ô manager.”
- Gỡ Agent membership editor cũ sau khi parity và đường ghi chung đạt gate. Giữ CS queue
  controls ở CS Overview.

**Xong khi:** Người quản trị cài một account tại Account Manager; không có bước gán Agent hay
Assistant ở nơi thứ hai; rollout tự nó không đổi permission/scope production so với baseline.

## 7. Không làm trong đợt này — backlog đã chốt ý nghĩa

Các việc dưới đây **đổi quyền hoặc hành vi production**, phải có rollout và bộ kiểm chứng riêng:

1. **Time Off theo manager:** thêm tick `timeoff.approve_team` cho duyệt đơn của direct reports;
   `timeoff.admin` vẫn duyệt toàn bộ; manager thiếu tick/vắng thì Admin duyệt. Đơn tự lấy manager
   từ Account, người nộp không đổi; khi manager đổi, pending chuyển người duyệt và có audit;
   đơn đã xử lý giữ lịch sử. Manager thường inactive vẫn hiện trong cây, Admin fallback. Không
   dùng `manager_id` để cấp quyền Time Off khi tick chưa tồn tại.
2. **Disable Agent khi còn Personal lead:** giữ nguyên người đứng tên mọi task/lead cũ, nhưng
   account inactive không nhận việc mới. Cần thay trigger `prevent_personal_lead_account_deactivation`
   và audit tất cả đường assign mới trước khi mở Disable. Không tự chuyển ownership.
3. **Assistant của Agent bị Disable:** chuyển sang Position CS hệ thống, manager null, queue CS
   tắt; bật lại Agent không tự khôi phục. Với manager không phải Agent bị Disable, giữ liên kết
   trong cây và Admin xử lý Time Off. Đây là data-scope change nên không trộn vào S1–S3.
4. **Dọn legacy nhiều Agent/Assistant:** bất kỳ việc gỡ link nào có thể làm người đó mất hoặc
   rộng thêm phạm vi task/lead. Cần danh sách cụ thể và quyết định riêng.
5. **Thay đổi permission keys hoặc Role của account đang chạy:** không làm chỉ để khớp tên
   Position. `task.manage` và `task.work` giữ nguyên ý nghĩa trong rollout cấu trúc.

## 8. Test, triển khai và rollback

- Unit/integration: Role là nguồn quyền duy nhất; Agent/Assistant Position không tự cấp quyền;
  Kay Assistant + `task.manage` vẫn global; Assistant `task.work` vẫn chỉ Agent; không Position
  + `task.work` vẫn CS; CS Manager Role mismatch bị chặn.
- SQL transaction: tạo/sửa account không partial; Assistant cần đúng một Agent active; Agent
  có nhiều Assistant; không Agent+Assistant; manager không tự trỏ/vòng lặp; Position đang dùng
  không sửa/xóa; concurrent saves trả conflict thay vì overwrite; last Admin vẫn được giữ.
- Parity test đối chiếu `task_agents`, `agent_members`, `user_roles`, `role_permissions`,
  queue rows và Time Off rows trước/sau migration. Test task/lead access bằng cùng resolver
  production, không chỉ so nhãn Position.
- UX smoke: tạo account Role trước rồi bổ sung Position; set Agent qua Position; set Assistant
  với một ô manager; Kay Task Manager + Assistant; chị Dung CS Manager không nhận queue tự động;
  cây quản lý có manager inactive.
- Rollout additive trước, code đọc song song/sau đó write chung, rồi mới ẩn editor cũ.
  Mỗi SQL rollout có rollback; trước khi deploy kiểm lại baseline, sau deploy so parity per-account.
  Nếu parity lệch, ngắt write path mới và quay về UI/API cũ; không drop cột/bảng cũ trong đợt này.
- Không commit/push/deploy hay chạy SQL production như một phần của việc **soạn** plan.
  Việc triển khai sẽ được yêu cầu riêng.

## 9. Tiêu chí chấp nhận cuối cùng

1. Có thể chọn ai là Agent và gán Assistant đúng một Agent từ **Account**, không cần tab thứ hai.
2. Role Manager quản lý danh mục Position; Position đã có người dùng bất biến.
3. Rollout không tự đổi permission keys, tab/API access, task/lead effective scope, queue state
   hoặc Time Off approval của account production. Không chỉ “tổng số người” giống nhau mà
   **từng người không có chỉnh sửa có chủ ý** phải khớp baseline.
4. Manager tree hiện được quan hệ trực tiếp, nhưng không tạo thêm quyền Time Off hoặc Tasks.
5. Không có drift giữa Position/manager và `task_agents`/`agent_members` sau bất kỳ save mới nào.

