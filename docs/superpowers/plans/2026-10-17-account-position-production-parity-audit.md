# [Codex review] Audit quyền production cho Account / Position

Ngày 2026-10-17. Tài liệu này để người code phản biện và sửa trước khi deploy code đang ở
working tree. Đây là **review + plan**, chưa sửa code ứng dụng, chưa chạy SQL ghi production.

## Mục tiêu và chuẩn so sánh

Yêu cầu của user: sau khi deploy đợt đổi Account UI / Position, **mỗi account production phải
giữ nguyên** tab/API vào được, tập task/lead/enrollment xem và sửa được, quyền được giao việc,
người nhận notification, trạng thái nhận task CS và quyền Time Off. Role và Position có thể
hiện khác trên UI, nhưng các đầu vào quyết định quyền phải tương đương. Một thao tác admin **cố
ý** đổi Role hoặc Agent/Assistant sau deploy vẫn là thao tác đổi quyền như production cũ; audit
phải phân biệt thao tác ấy với thay đổi do migration/deploy tự gây ra.

Mốc code để đối chiếu tạm là `HEAD` (`db131d8`, branch `main`) và toàn bộ tracked + untracked
changes hiện có. Theo `changelog.md`, SQL S1/S2 và SQL bỏ guard CS Manager đã chạy production,
code mới chưa deploy. **Chưa xác minh độc lập Vercel production commit SHA**, nên không được gọi
`HEAD` là production code đã xác nhận cho tới khi kiểm tra deployment.

## Bằng chứng đã kiểm

- Read-only query qua service role từ `.env.local` ngày 17/10: 49 account, 20 dòng Agent,
  17 link Assistant thuộc 12 account. Có **1 Assistant gắn nhiều Agent**. Không có account vừa
  Agent vừa Assistant; không có link trỏ Agent thiếu roster, Agent inactive hoặc roster thiếu
  account. Position hiện khớp roster và link Assistant ở mọi account được kiểm.
- 11/12 Assistant **không có `portal_account.manager_id`**; 1 người có manager đúng Agent đang
  hỗ trợ. Có 1 Assistant có CS queue `is_enabled=true`. Các số này chỉ là tổng hợp, không lưu
  email/PII vào git.
- `npm run typecheck`: pass. ESLint các phần Account/Role/API/admin mới: pass.
  `npm run test:run`: **210 files, 1.721 tests pass**. Đây là test code, chưa phải phép so
  quyền production trước/sau.
- Không có diff trong Task/Lead/Enrollment access resolvers hay các module tạo notification;
  diff tác động quyền tập trung ở write path `task_agents` / `agent_members` / Role.
- Snapshot `access_backup` không được expose qua PostgREST (`PGRST106`), nên audit này **chưa tự
  chạy phép diff trực tiếp** giữa `before-s2` và bảng live. `changelog.md` ghi 0 khác biệt sau
  rollout, nhưng cần chứng cứ read-only từ SQL editor/DB connection để kết luận độc lập.

## Findings để người code phản biện

### F1 — Blocker kiểm chứng: chưa có phép diff đủ cho lời hứa 100% parity

`2026-10-16-access-backup.sql` lưu Role, membership, queue và notification preferences.
`2026-10-16-access-restore-preview.sql` chỉ so Role/membership/queue và một số cột account;
**không so `notification_preferences`**, dù restore script sẽ xóa/ghi lại toàn bộ bảng ấy.
Nó cũng không dựng effective permission keys và tập người nhận notification từng loại.

**Hệ quả:** 0 dòng drift Position và test xanh chưa chứng minh không đổi thông báo hoặc quyền
thực tế từng người. Không chạy restore chỉ dựa vào preview hiện tại.

**Cần phản biện:** đưa kết quả `EXCEPT` hai chiều từ snapshot `before-s2` đến live cho
`user_roles`, `roles.is_active`, `role_permissions`, `task_agents`, toàn bộ `agent_members`
(kể cả `is_assistant=false`), queue, notification preferences và account active. Cùng lúc
chứng minh input recipient của Task/Enrollment/Time Off không đổi. Không in PII vào log/PR.

### F2 — Cấu trúc “Assistant có một Agent là manager” chưa đúng, nhưng không được sửa dữ liệu âm thầm

`AccountWorkFields.tsx` dùng `TaskSelect multi` cho “Manager (Agents they support)” và chỉ
thay `assistedAgentEmails`; `EditAccountDialog.tsx` / `buildAccountConfigPatch()` không suy ra
hay ghi `manager_id` từ Agent đã chọn. `OrgTree` dùng link Assistant như manager hiển thị.
Vì vậy cây có thể hiện manager trong khi cột `portal_account.manager_id` còn null hoặc khác.
Production đang có 1 Assistant hỗ trợ nhiều Agent; ép về một Agent sẽ làm người ấy mất scope.

**Hệ quả hiện tại:** chưa thấy thay đổi quyền từ deploy nếu link giữ nguyên; mô hình manager
chưa thể làm nguồn duyệt nghỉ phép. API còn cho sửa `manager_id` của Assistant độc lập với link,
khiến hai nguồn sự thật lệch thêm. Time Off hiện vẫn đọc manager trên từng request, không đọc
manager account.

**Cần phản biện:** trình bày chính xác nguồn manager đang dùng và xử lý 1 account nhiều Agent.
Trong đợt giữ quyền, bảo toàn mọi link; không tự chọn/gỡ Agent hay backfill manager sai. Chốt
quy tắc cho dữ liệu đặc biệt trước một migration nghiệp vụ riêng.

### F3 — Edit account gửi lại Name và Agent ID dù chỉ sửa Position/Manager/Role

`EditAccountDialog.tsx:109` luôn gửi `name` và `agentId`. API ghi lại cả hai
(`src/app/api/admin/users/[id]/route.ts:177-216`). `expected` trong RPC chỉ so Position,
manager và Assistant links (`2026-10-17-drop-cs-manager-guard.sql:67-79`). Nếu admin A mở form,
admin B đổi Name/Agent ID, rồi A chỉ sửa manager, save của A sẽ ghi đè giá trị mới của B mà
không báo conflict. Đây là regression của form gộp mới.

**Cần sửa:** form chỉ gửi field thực sự đổi; với field có thể đổi đồng thời, dùng expected
snapshot/version để trả 409 thay vì last writer wins. Test hai admin cùng mở, B sửa Name/Agent
ID, A sửa Position hoặc manager: Name/Agent ID của B phải giữ nguyên hoặc A nhận conflict.

### F4 — Create account mới thêm bước thứ ba nhưng không atomic

`POST /api/admin/users` insert account, gán Role, rồi mới RPC ghi Position/manager/membership
(`src/app/api/admin/users/route.ts:108-159`). Nếu RPC lỗi, route gọi `.delete()` để hoàn tác
nhưng **không kiểm lỗi delete**. Nếu delete bị từ chối hoặc kết nối lỗi, route trả failure trong
khi account + Role vẫn tồn tại; nhánh này còn đặt `createdUserId = null` dù delete thất bại,
nên catch ngoài không thử lại. Luồng cũ đã có insert + gán Role ở hai bước; form mới thêm bước
config, làm cửa sổ partial write rộng hơn.

**Cần sửa:** một transaction cho account + Role + Position + manager + membership; hoặc chứng
minh compensation idempotent, kiểm lỗi rollback và không báo “đã hoàn tác” khi chưa xác nhận.
Test injection lỗi ở từng bước, nhất là RPC config lỗi rồi delete lỗi. Broadcast là best-effort
và trả boolean; không dùng kết quả broadcast để đảo transaction đã commit. Không cho một
request thất bại để lại account có quyền mà không báo rõ.

### F5 — “Position chỉ mô tả công việc” chưa nói đủ tác động notification và scope

Position bản thân không được access resolver đọc. Nhưng đổi vào/ra `kind=agent` trong RPC
ghi/xóa `task_agents`; đổi Assistant ghi/xóa `agent_members`
(`2026-10-17-drop-cs-manager-guard.sql:111-198`). Các bảng này được Task, Lead và Enrollment
dùng để quyết định scope. `managerRecipientsForCase()` còn dùng Agent roster để lọc manager
nhận Task/Enrollment notification: manager `task.manage` mà là Agent chỉ nhận case của mình.
Assistant link cũng quyết định người nhận một số Task/Enrollment notification.

`accountConfigEffects()` chỉ cảnh báo Task/Lead/Enrollment ở vài nhánh, không nhắc manager
notifications hoặc khả năng worker chuyển thành plain CS và thấy company queue khi bỏ link
Assistant (`src/lib/tasks/membership.ts:119-136`). Có 1 Assistant hiện bật CS queue, nên trạng
thái queue cũng phải được kiểm theo người sau mọi thay đổi link.

**Cần sửa:** copy và confirm nêu đúng “Agent/Assistant Position thay đổi phạm vi và thông báo”;
chỉ Position nhóm CS/Other và direct manager mới là nhãn/cây thuần. Test recipient sets và
`seesAllTasks` cho vào/ra Agent/Assistant, gồm `task.manage` + Agent, `task.work` + Assistant,
`task.work` + plain CS và queue enabled.

### F6 — Xóa endpoint Agent/Assistant cũ là thay đổi API edit có thật

Working tree xóa `/api/config/agents` và `/api/config/assistants`; production code cũ có
GET/POST/DELETE tại đó. Tab mới thay được thao tác trong UI, nhưng old browser tab hoặc client
đang gọi endpoint cũ sẽ gặp 404. Nếu “can edit 100% như production” bao gồm API contract,
đây là khác biệt, dù không tự thay đổi quyền của account đang lưu.

**Cần phản biện:** kiểm tra có client ngoài UI hoặc cửa sổ browser cũ đang dùng API. Nếu cần
giữ contract, cung cấp compatibility adapter với cùng auth/delegation và cùng transaction
projection Position; nếu chủ ý bỏ, ghi rõ đây là ngoại lệ không đạt API parity và plan deploy
để chặn old client trước khi xóa.

### F7 — UI Assistant candidate và lỗi tải membership khác production cũ

Tab cũ chỉ hiện account có `task.work`/`task.manage` trong picker Assistant (API cũ tự nó chỉ
kiểm active account); form mới cho chọn Assistant Position với bất kỳ Role. Điều này không tự
cấp Task quyền, nhưng có thể tạo link được Lead/Enrollment resolver dùng nếu Role có quyền đó.
`account-manager/page.tsx` trước đây vẫn mở Accounts khi roster/link query lỗi và chỉ khóa
Agent membership; code mới để lỗi membership làm cả trang Account Manager fail.

**Cần phản biện:** xác nhận Role và Position độc lập có chủ đích cho case không có Task access;
test Lead/Enrollment scope khi thêm link cho Role đó. Với lỗi query, ưu tiên fail-closed:
Accounts có thể read-only nhưng không được giả sử danh sách link là rỗng rồi cho Save.

### F8 — Plan gốc và SQL hiện tại bất đồng về CS Manager

`2026-10-16-account-position-unification.md` vẫn ghi CS Manager bắt buộc Role có
`task.manage`, nhưng `2026-10-17-drop-cs-manager-guard.sql` đã gỡ điều kiện ấy và
`changelog.md` ghi SQL này đã chạy production theo quyết định 17/10. Current `schema.sql`
cũng không còn guard. Nếu người triển khai đọc plan gốc như checklist rồi khôi phục guard,
họ sẽ làm hẹp khả năng sửa Role so với production hiện tại.

**Cần sửa:** cập nhật plan gốc/acceptance criteria để ghi rõ quyết định mới và kiểm live DB
không còn 4 trigger guard. CS Manager hiện chỉ là Position; quyền Task vẫn do Role quyết định.

## Plan khép audit

1. **Đóng mốc production:** xác minh Vercel production commit SHA và live SQL function/trigger
version. Lưu snapshot read-only ngay trước deploy; ghi thời điểm và audit delta của mọi thao
tác admin phát sinh trong rollout. Không lấy `HEAD` làm mốc chỉ vì branch tên `main`.
2. **Khép F1:** mở rộng preview chỉ đọc để so notification preferences và toàn bộ input quyền.
So bằng tập hợp theo account ID, không chỉ số lượng. Dùng snapshot `before-s2` để kiểm các SQL
đã chạy; dùng snapshot mới để kiểm code deploy. Reviewer ký vào kết quả diff 0 sau khi loại
trừ admin edits có chủ đích.
3. **Sửa F3/F4/F5:** field-level patch + conflict guard; atomic create; copy/confirm mô tả đủ
scope và notification. Mỗi fix phải có test mô phỏng lỗi/race và so kết quả với old behavior.
4. **Giữ legacy data F2/F6/F7/F8:** không rút Assistant nhiều Agent về một; không đổi Role,
membership, queue, notification preferences để ép model. Chốt compatibility API và candidate
rules trước deploy. Không phục hồi guard CS Manager từ plan cũ. Direct manager của Assistant
chưa được dùng cho auth/Time Off trong đợt này.
5. **Parity matrix trên snapshot production:** cùng một actor và record mẫu, chạy code cũ và
code mới cho: tab/API access; Task view/create/edit/assign/delete/QC, plain CS queue; Lead
view/edit/distribute/import; Enrollment view/edit; Task/Enrollment notification recipients;
Time Off submit/approve/notification; alerts toggle. So từng account/record/recipient set.
6. **Release gate:** không deploy nếu còn diff ngoài admin action có chủ đích, endpoint không
có quyết định tương thích, hoặc F3/F4 chưa khép. Sau deploy kiểm lại cùng SQL/read-only probes;
rollback app trước rồi SQL theo thứ tự script nếu cần. Không chạy restore data khi preview còn
khác biệt do admin sửa hợp lệ.

## Điều kiện để nói “100% giống production về quyền”

Chỉ dùng câu này khi: production commit được xác nhận, diff hai chiều của toàn bộ bảng nguồn
quyền/notification = 0 theo từng account, parity matrix pass, và không còn đường create/edit
thất bại nhưng vẫn để lại Role hoặc membership khác trước. Test xanh và Position drift 0 **chưa
đủ** cho kết luận đó.

## Format phản biện mong muốn

Với từng F1–F8, ghi **đồng ý / bác bỏ / đã sửa**, dẫn đúng code hoặc SQL production chứng minh,
case tái hiện và test bảo vệ. Nếu bác bỏ một tác động quyền, cần đưa tập account/record/recipient
trước–sau; lý giải bằng UI hoặc unit test riêng không đủ để bác bỏ tác động của bảng membership.

---

## [Claude · 2026-10-17] Phản biện F1–F8

Bằng chứng production đọc bằng Supabase CLI (role postgres, read-only, không in PII). Mốc so:
snapshot per-account chụp **trước S1** (16/10) + backup `access_backup` label `before-s2`.

**Mốc code production.** `vercel/main` = `29c1b7d` (remote Vercel deploy từ đó; deploy thành công đã
ghi nhận 16/10). Chưa đọc SHA từ Vercel API, nên đúng như F-intro: đây là suy ra từ remote, chưa xác
nhận trực tiếp. `HEAD` = `db131d8` chỉ hơn `29c1b7d` một commit docs.

### F1 — Đồng ý một phần, đã sửa preview
- Preview giờ so thêm `notification_preferences` (toàn row jsonb).
- Kết quả `EXCEPT` hai chiều `before-s2` ↔ live (17/10): `user_roles` 0/0, `roles` 0/0,
  `role_permissions` 0/0, `agent_members` (mọi dòng, kể cả `is_assistant=false`) 0/0, queue 0/0,
  `notification_preferences` 0/0. `portal_account` 16/16 chỉ ở cột `position_id` và `manager_id`
  (gán Position/Manager qua UI; không cột nào quyết định quyền). `task_agents` 1/1: một account test
  vào danh sách Agent và một account Referrals ra khỏi danh sách — cả hai qua form mới trên localhost
  (drift check = 0), user đang xác nhận có chủ ý.
- Ngoài bảng nguồn, đã có matrix kết quả per-account tính trong CÙNG một query với input trước S1 và
  input hiện tại: tab theo permission đã mở rộng, md5 tập task id (`tasks_visible_to_worker` thật),
  lead id, enrollment id, agent-owner rights, CS queue, loại thông báo giám sát (all / own case),
  thông báo Assistant cho Agent nào, thông báo Agent-owner, người duyệt Time Off, chuông/push, số
  thiết bị push. Khác biệt duy nhất: 2 account trên. Script ở scratchpad phiên Claude (không commit).

### F2 — Đồng ý là có hai nguồn; không sửa dữ liệu
- User chốt 16/10: với Assistant, "Manager" = các Agent trong `agent_members` (nhiều Agent được).
  `manager_id` của Assistant không được đọc ở đâu (grep: chỉ Account Manager hiển thị; Time Off đọc
  `time_off_requests.manager_id`). UI ẩn ô manager_id khi Position là Assistant.
- Không backfill, không gỡ link. Ghi vào plan gốc. Nếu sau này dùng manager cho Time Off thì cần
  migration nghiệp vụ riêng cho Assistant nhiều Agent.

### F3 — Đồng ý, đã sửa
- `EditAccountDialog` chỉ gửi `name`/`agentId` khi khác giá trị lúc mở. Hai admin cùng sửa CÙNG một
  ô vẫn là last-writer-wins như form cũ (form cũ cũng vậy); khác ô thì không còn ghi đè.

### F4 — Đồng ý, đã sửa
- `removeCreatedAccount` kiểm lỗi và số dòng xoá; thất bại thì trả 500 nêu rõ account còn tồn tại
  và cần Disable. Bước RPC config lỗi → transaction của RPC đã rollback, nên account còn lại (nếu
  xoá lỗi) chỉ có Role, không có membership.
- Chưa làm một RPC tạo account trọn gói: cần thêm SQL production. Luồng tạo cũ (insert + Role) vốn
  đã hai bước với cùng cơ chế bù.

### F5 — Đồng ý, đã sửa
- Câu mô tả đầu bảng: chỉ Position Agent/Assistant đổi quyền; Position khác và Manager không đổi.
- `accountConfigEffects(access)` nêu: phạm vi task trước/sau, vào/ra CS pool (cùng điều kiện
  `assign_unassigned_task`), thông báo manager khi người có task.manage vào/ra danh sách Agent.
  Test: plain CS → Agent; Assistant bỏ hết link (queue bật → vào CS pool); manager ra khỏi Agent;
  Position ngoài nhóm không đổi gì; người không có Task.

### F6 — Bác bỏ (ngoại lệ có chủ ý)
- Grep toàn repo (kể cả `apps-script/`, `scripts/`, `datasync/`): không client nào ngoài
  `AgentMembershipSection` (đã xoá) gọi `/api/config/agents|assistants`. Endpoint chỉ cho
  `management.account_manager` (3 Admin). Tab trình duyệt cũ mở trong lúc deploy sẽ nhận 404 thay
  cho thao tác ghi không có Position — cố ý, để không còn đường ghi membership bỏ qua Position.

### F7 — (a) Đồng ý, đã sửa; (b) giữ nguyên
- (a) Picker Assistant cũ = `fetchTaskAssignees` (role active có task.work/manage); picker Agent cũ =
  mọi account active. Form mới: Position nhóm Assistant bị khoá và Save bị chặn khi Accessibility
  không có quyền Task; Agent vẫn cho mọi account. Server không chặn, như API cũ.
- (b) Lỗi tải membership làm cả trang báo lỗi: fail-closed, không bao giờ Save với danh sách link
  rỗng giả. Đổi lại admin không disable/reset password được trong lúc lỗi; chấp nhận.

### F8 — Đồng ý, đã sửa
- Plan gốc ghi rõ đã BỎ luật CS Manager và cấm khôi phục. Live DB: 0 trigger `cs_manager_guard_*`,
  hàm guard không còn, `update_account_atomic` không nhắc `cs_manager`.

