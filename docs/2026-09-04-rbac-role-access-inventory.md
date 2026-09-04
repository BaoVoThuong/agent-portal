# RBAC & Role Access Inventory

**Audit date:** 2026-09-04
**Scope:** toàn bộ portal: page guard, API guard, role/permission, membership scope và snapshot account hiện tại.
**Mục đích:** tạo một nguồn tham chiếu trước khi clean lại RBAC; phân biệt rõ *được vào đâu*, *được làm gì* và *được xem dữ liệu nào*.

> Snapshot account/role trong file này được đọc read-only từ database production vào ngày 2026-09-04. Không ghi password, token hoặc secret. Kết quả trả về 43 account đang active; không thấy account inactive trong snapshot đó. Nếu role/account thay đổi sau thời điểm này, cần chạy lại query snapshot trước khi dùng file làm nguồn triển khai.

---

## 1. Kết luận nhanh

RBAC hiện không chỉ có một lớp. Quyền thực tế của một account là kết quả của nhiều lớp cùng lúc:

1. role_permissions quyết định permission.
2. portal_account.role (admin/agent) vẫn là nguồn legacy để suy ra admin ở một số module.
3. Tên role hard-code trong code (Admin Health Task, Task Admin) thay đổi task admin behavior.
4. task_agents và agent_members thay đổi data scope của task/enrollment nhưng không nằm trong Role Manager.
5. Owner/assignee/caller/responsible/member quyết định được xem hoặc sửa từng record.

Vì vậy không thể đọc riêng cột role rồi kết luận quyền. Ví dụ:

- Admin Health Task không phải full portal admin nhưng được xem là task manager vì tên role bị hard-code.
- Task CS có task.work, nhưng data task là toàn công ty nếu account không phải selected agent/assistant; nếu là assistant thì bị thu hẹp theo agent.
- lead.manage và task.manage không tạo ra cùng một khái niệm manager: task dùng permission AND admin-like role, lead dùng permission OR admin-like role.
- Snapshot hiện tại chỉ role Admin có timeoff.user/timeoff.admin và lead permissions; nhiều custom role không thấy menu Time Off/Leads dù rollout trước đó mô tả quyền rộng hơn.

---

## 2. Mô hình authorization hiện tại

### 2.1 Nguồn dữ liệu quyền

| Nguồn | Bảng/file | Vai trò trong quyết định | Có hiển thị trong Role Manager? |
|---|---|---|---|
| Permission catalogue | src/lib/rbac/permissions.ts | Danh sách 20 permission hợp lệ và mô tả | Có |
| Role | roles | Nhóm permission và trạng thái active | Có |
| Role permission | role_permissions | Nối role với permission | Có |
| User role | user_roles | Nối account với role | Có, nhưng policy hiện chỉ giữ 1 role/account |
| Legacy role | portal_account | Một số module coi admin là admin override | Account Manager |
| Task agent membership | task_agents | Đánh dấu agent và thu hẹp task/enrollment scope | Không |
| Assistant membership | agent_members | Cho CS scope theo agent được assist | Không |
| Record ownership | owner/assignee/caller/responsible/creator columns | Cho phép xem/sửa một record cụ thể | Không phải RBAC |
| Session/JWT | src/auth.ts | Cache roles/permissions của user trong session | Không |

### 2.2 Luồng tính quyền

    portal_account + user_roles + roles + role_permissions
                        ↓
                  session/JWT (cache 5 phút)
                        ↓
          page guard / API guard / module actor
                        ↓
       data scope (company, own, agent, assistant, owner, assignee)

Sidebar chỉ ẩn/hiện menu theo permission. Đây không phải security boundary; page và API mới là lớp bắt buộc phải kiểm tra.

### 2.3 Chính sách role assignment

- Database có unique index user_roles_one_role_per_user_idx: một account chỉ có một role active.
- API/UI nhận mảng roleIds nhưng chỉ lưu role đầu tiên.
- portal_account.role và role RBAC có thể drift nếu cập nhật legacy role riêng.
- Permission update có thể chưa phản ánh ngay vì JWT refresh theo TTL khoảng 5 phút.

---

## 3. Permission catalogue: làm được gì và xem dữ liệu gì

Nguồn chính: src/lib/rbac/permissions.ts.

| Permission | Trang/API chính | Chức năng được mở | Data scope mặc định |
|---|---|---|---|
| customer_registration.health | /, /api/entries* | Xem/tạo/sửa/xóa Health registration theo ownership | Account xem record của mình; thêm company.view_all mới xem toàn bộ |
| customer_registration.pc | /customer-registration/pc, /api/pc-entries* | Xem/tạo/sửa/xóa P&C registration theo ownership | Account xem record của mình; thêm company.view_all mới xem toàn bộ |
| automation.health_statement | /automation/health-statement, report preview/run API | Chạy Health statement automation | Dữ liệu theo input/report mà API cho phép; không phải company-wide dashboard permission |
| automation.pc_statement | /automation/pc-statement, payment/policy/report/review/run API | Chạy P&C statement automation | Dữ liệu theo request automation |
| automation.provider_finder | /automation/provider-finder, search API | Tìm provider | Dữ liệu provider/search result; không mở registration/dashboard |
| agent_dashboard.health | /dashboard/health | Mở Health dashboard dạng agent | Thường lọc theo agent hiện tại; không tự xem toàn công ty |
| agent_dashboard.pc | /dashboard/pc | Mở P&C dashboard dạng agent | Thường lọc theo agent hiện tại; không tự xem toàn công ty |
| company_dashboard.health | /dashboard/health?view=sales, /sales-dashboard/health | Mở Health sales/company dashboard | Company-wide sales data; AI/filter API còn kiểm tra scope riêng |
| company_dashboard.pc | /dashboard/pc?view=sales, /sales-dashboard/pc | Mở P&C sales/company dashboard | Company-wide P&C sales data |
| company.view_all | /api/entries*, /api/pc-entries*, dashboard/filter/AI scope | Bỏ bộ lọc record của tôi ở registration/dashboard | Xem dữ liệu của tất cả agent/company; đây là scope permission, không phải page permission |
| management.account_manager | /account-manager, /api/admin/users* | Tạo account; sửa profile/email/agent/status; assign role; reset password; deactivate/delete theo guard | Xem danh sách account và metadata account mà API trả về |
| management.role_manager | /role-manager, /api/admin/roles*, /api/admin/permissions | Tạo/sửa/xóa/deactivate custom role; thay toàn bộ permission của role | Xem role catalogue, permission và user count của role |
| timeoff.user | /time-off, /api/time-off | Xem balance bản thân; tạo request; xem/cancel request pending của mình; xem shared calendar/US holiday/company day off | Chỉ own leave/balance/request; calendar approved visibility là shared |
| timeoff.admin | /time-off administration; approvals/balances/accruals/history/company days off API | Duyệt/reject request; xem balance toàn team; adjust/bulk adjust; monthly accrual setup/apply; xem leave history; thêm/sửa company day off | Team-wide leave, balances, adjustments, accrual rules, company holidays và approval log |
| settings.access | /settings | Xem/cập nhật setting cá nhân và đổi password | Chỉ profile/settings của chính account |
| task.manage | /tasks, /enrollment, task admin API, /config | Điều kiện cần để thành Task manager; tạo/assign/manage task; xem backlog/overview; quản lý categories/SLA/reminder/config theo role | Nếu là task manager: toàn bộ task/enrollment trong scope manager; không tự mở lead |
| task.work | /tasks, /enrollment, task detail/comment/activity API | Làm task được phép: xem detail, comment/reaction/attachment, đổi field/status trong capability | Plain CS có thể thấy shared/all task queue; selected agent/assistant bị scope theo agent + record liên quan |
| task.export | /api/tasks/export, /api/enrollment/export | Export bảng task/enrollment | Dữ liệu export còn phải đi qua actor/scope của endpoint; không nên hiểu là bypass scope |
| lead.manage | /tasks/leads, lead assign/import/distribute/events/settings/vocabulary/config API | Quản lý Event Leads: xem toàn bộ, assign, import, distribute pool, sửa cấu hình/vocabulary | Toàn bộ leads và queue |
| lead.work | /tasks/leads, lead detail/interactions API | Xem lead được giao; log interaction; sửa theo capability | Lead của mình + lead của agent mình assist; không có plain-CS xem toàn công ty như task |

### 3.1 Permission không đồng nghĩa với capability đầy đủ

Một permission chỉ mở module/API gate. Capability bên trong vẫn phụ thuộc actor và record:

- Task: task.manage không tự đủ nếu thiếu admin-like role; owner/reporter/assignee có thể có một phần mutate.
- Enrollment: không có permission riêng; dùng task.manage/task.work và task actor.
- Lead: lead.manage mới assign/import/distribute; lead.work chỉ work trong owner scope.
- Time Off: timeoff.user cho request cá nhân; timeoff.admin mới approve/adjust/company holiday.
- Registration: company.view_all mở rộng data scope nhưng không thay thế customer_registration.health hoặc .pc.

---

## 4. Page guard và API guard

### 4.1 Page-level guard

| Page | Guard hiện tại | Quyền/data cần lưu ý |
|---|---|---|
| / | customer_registration.health | company.view_all mới xem mọi record |
| /customer-registration/pc | customer_registration.pc | Tương tự Health |
| /automation/health-statement | automation.health_statement | Module-specific |
| /automation/pc-statement | automation.pc_statement | Module-specific |
| /automation/provider-finder | automation.provider_finder | Module-specific |
| /dashboard/health | ANY(agent_dashboard.health, company_dashboard.health) | Cùng page nhưng agent/company view khác nhau |
| /dashboard/pc | ANY(agent_dashboard.pc, company_dashboard.pc) | Cùng page nhưng agent/company view khác nhau |
| /sales-dashboard/health | company_dashboard.health | Company view |
| /sales-dashboard/pc | company_dashboard.pc | Company view |
| /tasks | ANY(task.manage, task.work) | Board access; action còn do task actor quyết định |
| /enrollment | ANY(task.manage, task.work) | Enrollment mượn task permission |
| /tasks/leads | ANY(lead.manage, lead.work) | Manager-only view/operation bị gác tiếp |
| /config | Actor/config scope | Task config và lead config dùng luật khác nhau; fallback route table đang chỉ biết task.manage |
| /time-off | getTimeOffActor() | Cần timeoff.user hoặc timeoff.admin; admin tab chỉ với .admin |
| /account-manager | management.account_manager | User/account management |
| /role-manager | management.role_manager | Role/permission management |
| /settings | settings.access | Personal settings |

### 4.2 API groups

| API group | Guard/capability | Read scope | Write scope |
|---|---|---|---|
| /api/entries* | Health registration + optional company.view_all | Own hoặc all | Owner/selected agent; company view all override |
| /api/pc-entries* | P&C registration + optional company.view_all | Own hoặc all | Owner/selected agent; company view all override |
| /api/admin/users* | management.account_manager | Account list/detail | Create/edit/status/password/role, protected last-admin/self rules |
| /api/admin/roles*, permissions | management.role_manager | Roles/permission catalogue | Custom role CRUD + arbitrary permission assignment |
| /api/tasks* | Task actor + membership/capabilities | Manager all; worker scope/record relation | Owner/assignee/reporter/manager tùy field |
| /api/enrollment* | Enrollment actor = task actor | Manager all; worker scope/record relation | Enrollment capability matrix |
| /api/tasks/export, enrollment export | task.export + actor | Export endpoint should preserve actor scope | No data mutation |
| /api/leads* | Lead actor + lead scope | Manager all; worker own + assistant scope | Manager assign/import/distribute/settings; worker interaction/allowed edit |
| /api/config* | Config actor/admin per scope | Task scopes hoặc lead scope | Task admin/lead manager only |
| /api/time-off* | getTimeOffActor | Own data for user; team data for admin | User create/cancel own pending; admin approve/reject/adjust/accrual/company days |
| /api/dashboard*, AI | Relevant dashboard permission + data scope checks | Agent/company according to permission and company.view_all | Mostly read-only/filter preferences |
| /api/notifications* | Authenticated recipient email | Chỉ notification gửi tới email session | Mark own notification read |
| /api/cron* | Cron secret/header, không phải user RBAC | System job data | System mutation; excluded from normal auth proxy |

### 4.3 Sidebar visibility hiện tại

src/app/(authed)/_components/Sidebar.tsx lọc menu như sau:

- Health/P&C: permission registration tương ứng.
- Automation: từng permission automation tương ứng.
- Dashboard: agent/company permission theo product.
- Task Management: bất kỳ task hoặc lead permission; sub-menu Health/ACA/Medicare dùng task; Event Leads dùng lead; Table Configuration dùng task/lead.
- Time Off: timeoff.user hoặc timeoff.admin.
- Account Management: management.account_manager và management.role_manager tương ứng.

Sidebar không thay thế API authorization. Nếu một API chỉ dựa vào auth() mà không kiểm tra permission, đó là điểm phải review riêng.

---

## 5. Module-specific data scope

### 5.1 Customer Registration

| Account có | Có thể xem | Có thể sửa/xóa |
|---|---|---|
| Registration permission, không company.view_all | Record submitter/selected agent theo logic hiện tại | Record do mình submit hoặc selected-agent ownership |
| Registration permission + company.view_all | Toàn bộ Health/P&C entry tương ứng | Có company-wide override theo route |
| Chỉ company.view_all, không registration permission | Không mở được registration page/API | Không có |

Ownership hiện còn dựa một phần vào selected_agent/display name và session name, chưa thống nhất bằng stable account id/email. Đổi tên agent hoặc trùng tên có thể làm record bị ẩn hoặc ownership sai.

### 5.2 Dashboard

- agent_dashboard.*: góc nhìn dữ liệu của agent hiện tại.
- company_dashboard.*: mở sales/company dashboard, thường là company-wide.
- company.view_all: scope override cho registration và dashboard/filter/AI; không tự cấp dashboard page permission.
- Dashboard Health/P&C cho phép nhiều permission vào cùng page nhưng UI phải xác định rõ đang ở agent view hay company view.

### 5.3 Task và Enrollment

| Actor | Task/enrollment visible scope | Typical actions |
|---|---|---|
| Task manager (task.manage + admin-like role) | Tất cả task/enrollment | Create, assign, backlog, categories, SLA/reminder, review, delete theo endpoint |
| Worker có selected agent scope | Task của agent được chọn + record mình được assign/participate/report | Comment, reaction, attachment, status/field trong capability |
| Assistant của agent | Task/enrollment của agent mình assist + record liên quan | Tương tự worker trong scope |
| Plain CS worker (task.work, không selected agent/assistant) | Shared/all task queue theo logic hiện tại | Work trên task trong capability; không mặc nhiên có manager actions |
| Account có task.manage nhưng không admin-like role | Worker behavior ở task; không phải task manager | Đây là điểm khác lead và dễ gây hiểu nhầm |

Admin Health Task và Task Admin được nhận diện bằng tên role trong src/lib/tasks/access.ts; rename role trong Role Manager làm thay đổi behavior mà không có migration/cảnh báo.

Enrollment không có enrollment.work/enrollment.manage; mọi scope/capability kế thừa task. Khi clean nên quyết định đây là chủ ý hay nợ mô hình.

### 5.4 Event Leads

| Actor | Lead visible scope | Actions |
|---|---|---|
| Lead manager (lead.manage hoặc admin override) | Tất cả leads | Assign, import, distribute pool, settings/vocabulary/config, edit/log |
| Lead worker (lead.work) | Lead của mình + agent mình assist | View/detail, log interaction và edit allowed fields |
| Worker không có lead permission | Không vào được leads | Không có |

Lead không có plain-CS fallback xem toàn bộ. Đây là data scope khác Task/Enrollment.

### 5.5 Time Off

| Actor | Visible data | Mutations |
|---|---|---|
| User (timeoff.user) | Policies/balance/request của mình; approved shared calendar; US federal holidays; company days off | Tạo request; cancel pending request của mình |
| Admin (timeoff.admin) | Toàn bộ pending approval, team balances, adjustment/accrual, leave history, company days off | Approve/reject; adjust/bulk adjust; configure/apply accrual; add/edit company days off |
| Admin có cả .user và .admin | Cả hai scope trên | Cả hai nhóm action |

Current live snapshot chỉ thấy timeoff.user/timeoff.admin trên role Admin, nên 40 account còn lại không pass Time Off actor nếu chưa có grant bổ sung.

### 5.6 Management và Settings

- Account Manager thấy metadata account và có thể thay role/status/password, nhưng không nên được xem là full admin nếu không có permission khác.
- Role Manager có thể gán bất kỳ permission catalogue nào vào custom role; vì vậy đây là quyền có khả năng cấp gián tiếp account_manager, role_manager, task.manage, timeoff.admin, company dashboard…
- Settings chỉ là self-service; không mở data của người khác.

---

## 6. Role catalogue và effective access hiện tại

> Các role dưới đây là role đang tồn tại trong database tại thời điểm snapshot. Assigned accounts là số account đang gắn role; role không có account vẫn liệt kê để nhận diện quyền dormant.

| Role | Active accounts | Legacy role admin? | Permissions hiện có |
|---|---:|---|---|
| Admin | 3 | Có | Tất cả 20 permission |
| Admin Health Task | 5 | Không | settings.access, task.manage |
| Task CS | 20 | Không | settings.access, task.work |
| Health Agent | 13 | Không | customer_registration.health, automation.health_statement, automation.provider_finder, agent_dashboard.health, settings.access, task.work |
| Accounting | 1 | Không | automation.health_statement, automation.pc_statement, company_dashboard.health, company_dashboard.pc, settings.access |
| Agent | 1 | Không | customer_registration.health, customer_registration.pc, automation.health_statement, automation.pc_statement, automation.provider_finder, agent_dashboard.health, settings.access |
| P&C Agent | 0 | Không | customer_registration.pc, automation.pc_statement, agent_dashboard.pc, settings.access |
| Sub Admin | 0 | Không | customer_registration.health, customer_registration.pc, automation.health_statement, automation.pc_statement, automation.provider_finder, agent_dashboard.health, agent_dashboard.pc, company_dashboard.health, company_dashboard.pc, company.view_all, task.manage, task.work, task.export, settings.access |

### 6.1 Effective access theo role

#### Admin — 3 accounts

- Portal: tất cả menu và tất cả API group.
- Registration: Health/P&C toàn bộ data nhờ company.view_all.
- Automation: Health statement, P&C statement, provider finder.
- Dashboard: agent + company dashboard Health/P&C; company-wide data.
- Tasks/Enrollment: task manager toàn bộ; export; config; SLA/reminder/category/assignment.
- Leads: lead manager toàn bộ queue, assign/import/distribute/config.
- Time Off: own flow + toàn bộ admin tabs, approval, balances, accruals, leave history, company days off.
- Management: account manager + role manager.
- Accounts: bao.vo@excelplannings.com, khang.nguyen@excelplannings.com, nam.nguyen@excelplannings.com.

#### Admin Health Task — 5 accounts

- Có task.manage và tên role nằm trong task admin allow-list nên effective task actor là manager.
- Được vào Task/Enrollment, xem toàn bộ task/enrollment, create/assign/backlog/overview và task config/SLA/reminder theo guard.
- Có settings cá nhân.
- Không có task export, lead, registration, dashboard, timeoff, account manager hoặc role manager.
- Không phải full admin dù tên có Admin.
- Accounts: admin.qa@epsins.co, baovothuong69@gmail.com, charlotte.tocs@epsins.co, dung.ha@epsins.co, kayhuynh@epsins.co.

#### Task CS — 20 accounts

- Có task worker và settings.
- Được vào Task/Enrollment và work theo task actor.
- Plain CS không nằm trong selected-agent/assistant membership có thể thấy shared/all queue; account là selected agent/assistant thì scope bị thu hẹp.
- Có thể comment/reaction/attachment và mutate field/status tùy owner/assignee/reporter/capability; không phải manager nên không mặc định create/assign/backlog/admin config/export.
- Không có lead, registration, dashboard, automation, timeoff.

#### Health Agent — 13 accounts

- Registration Health và Health automation/provider finder.
- Agent Health dashboard; dữ liệu dashboard/registration mặc định theo agent hiện tại, không company-wide.
- Có task worker; task scope phụ thuộc selected-agent/assistant membership như Task CS.
- Có settings.
- Không có P&C registration, company dashboard, lead, timeoff, export.

#### Accounting — 1 account

- Health/P&C company dashboard và Health/P&C statement automation.
- Company dashboard là company-wide sales view theo API.
- Có settings.
- Không có registration CRUD, task/lead/timeoff/management.
- Account: eps.healthcommission@gmail.com.

#### Agent — 1 account

- Health/P&C registration, Health agent dashboard, Health/P&C statement automation, provider finder, settings.
- Registration vẫn là own scope vì không có company.view_all.
- Không có P&C agent dashboard trong permission hiện tại dù có P&C registration/automation.
- Không có task, lead, timeoff, export, management.
- Account: lifeadmin@excelplannings.com.

#### P&C Agent — chưa assigned

- Nếu được assign: P&C registration + P&C automation + P&C agent dashboard + settings.
- Own/agent scope, không company-wide.
- Chưa có account production trong snapshot.

#### Sub Admin — chưa assigned

- Nếu được assign: Health/P&C registration, all listed automation, agent/company dashboards, company.view_all, task worker + task.manage + export, settings.
- Do role name không nằm trong task admin allow-list và legacy role không phải admin, task.manage không tự làm cho actor thành task manager; thực tế cần xem như worker có permission rộng nếu policy không đổi.
- Không có account production trong snapshot.

---

## 7. Snapshot toàn bộ account hiện tại

> Tất cả dòng dưới đây đều active. Cột effective role là role RBAC hiện tại; legacy là portal_account.role. Chi tiết quyền/data scope được suy ra từ bảng role ở §6 và module scope ở §5.

Do policy database hiện chỉ cho một role/account, bảng này là mapping đầy đủ: mỗi account nhận đúng toàn bộ permission của effective role tương ứng ở §6. Những khác biệt còn lại không nằm ở role mà nằm ở membership/ownership, được ghi tại §8 và §5.

| # | Account | Display name | Legacy | Effective role |
|---:|---|---|---|---|
| 1 | admin.qa@epsins.co | Admin QA | agent | Admin Health Task |
| 2 | ann.docs@epsins.co | Ann Do | agent | Task CS |
| 3 | ann.strambler@excelplannings.com | Ann Strambler | agent | Health Agent |
| 4 | bao.trancs@epsins.co | Quoc Bao | agent | Task CS |
| 5 | bao.vo@excelplannings.com | Bao Vo | admin | Admin |
| 6 | baovocs04@gmail.com | Bao Vo Test 04 | agent | Task CS |
| 7 | baovothuong69@gmail.com | Bao Vo Test | agent | Admin Health Task |
| 8 | charlotte.tocs@epsins.co | Charlotte To | agent | Admin Health Task |
| 9 | cheryl.tocs@epsins.co | Cheryl To | agent | Task CS |
| 10 | christina.docs@epsins.co | Christina Do | agent | Task CS |
| 11 | daphne.lecs@epsins.co | Daphne Le | agent | Task CS |
| 12 | dung.ha@epsins.co | Dung Ha | agent | Admin Health Task |
| 13 | eps.healthcommission@gmail.com | Ha Nguyen | agent | Accounting |
| 14 | gianguyen0901@gmail.com | Zoe Nguyen | agent | Task CS |
| 15 | han.nguyencs@epsins.co | Han Nguyen | agent | Task CS |
| 16 | hoang.doancs@epsins.co | Hoang Minh Doan | agent | Task CS |
| 17 | jennifer.le.insagent@gmail.com | Jennifer Le | agent | Health Agent |
| 18 | juliemai1996@gmail.com | Thuy Mai | agent | Health Agent |
| 19 | kathy.lecs@epsins.co | Kathy Le | agent | Task CS |
| 20 | kayhuynh@epsins.co | Kay Huynh | agent | Admin Health Task |
| 21 | khang.nguyen@excelplannings.com | Khang Nguyen | admin | Admin |
| 22 | khanhchau.nguyencs@epsins.co | Khanh Chau | agent | Task CS |
| 23 | lifeadmin@excelplannings.com | Life Admin | agent | Agent |
| 24 | linh.le@excelplannings.com | Linh Le | agent | Health Agent |
| 25 | minhvan.insagent@gmail.com | Minhvan Nguyen | agent | Health Agent |
| 26 | nam.nguyen@excelplannings.com | Nam Nguyen | admin | Admin |
| 27 | ngthinhuquynh1411@gmail.com | Lucy | agent | Task CS |
| 28 | nguyen.ngan0312@gmail.com | Ngan Nguyen | agent | Task CS |
| 29 | nmhuydc.error404@gmail.com | Huy | agent | Task CS |
| 30 | phinguyen.insagent@gmail.com | Phi Nguyen | agent | Health Agent |
| 31 | phxuanh.2204@gmail.com | Xuan Anh | agent | Task CS |
| 32 | quele.insagent@gmail.com | Que Le | agent | Health Agent |
| 33 | quin06101@gmail.com | Thao Huynh | agent | Health Agent |
| 34 | tamiphanod.lifeins@gmail.com | Tami Phan | agent | Health Agent |
| 35 | teamsup.tl@gmail.com | Andy | agent | Task CS |
| 36 | thanhhuexhh@gmail.com | Lily | agent | Task CS |
| 37 | thaoanhlephuong.1501@gmail.com | Tessie | agent | Task CS |
| 38 | thuy.insagent@gmail.com | Trish | agent | Health Agent |
| 39 | thuytienhoang.eps@gmail.com | Thuy Tien Hoang | agent | Health Agent |
| 40 | timothykoo.insagent@gmail.com | Timothy Koo | agent | Health Agent |
| 41 | tranlyaibao2612@gmail.com | Jin | agent | Task CS |
| 42 | tringuyen.ins@gmail.com | Tri Nguyen | agent | Health Agent |
| 43 | vyquancs@epsins.co | Quan Nguyen | agent | Task CS |

### 7.1 Account counts

| Group | Count | Effective implication |
|---|---:|---|
| Legacy admin + RBAC Admin | 3 | Full portal admin |
| Task manager custom role | 5 | Full task/enrollment manager, not full admin |
| Task CS | 20 | Task worker; scope depends membership |
| Health Agent | 13 | Health registration/automation/dashboard + task worker |
| Accounting | 1 | Company Health/P&C dashboards + statements |
| Agent | 1 | Registration/automation + Health agent dashboard |
| Unassigned roles (P&C Agent, Sub Admin) | 0 | Permission template dormant |
| Inactive accounts in snapshot | 0 | Không có dòng inactive được trả về |

---

## 8. Membership data đang làm thay đổi scope

> Đây không phải role permission, nhưng phải audit cùng RBAC vì nó trực tiếp thay đổi dữ liệu account thấy.

### 8.1 task_agents

Snapshot hiện có selected-agent records cho các email agent đã được cấu hình trong task module, gồm nhóm bao.vo@excelplannings.com, baovothuong69@gmail.com, nam.nguyen@excelplannings.com, khang.nguyen@excelplannings.com, thuy.insagent@gmail.com.

Account có trong task_agents được xem là agent scope; account không có trong đó có thể rơi vào plain-CS shared queue nếu có task.work.

### 8.2 agent_members

| Agent owner | Assistant/CS members hiện tại |
|---|---|
| ann.strambler@excelplannings.com | nmhuydc.error404@gmail.com, thaoanhlephuong.1501@gmail.com, tranlyaibao2612@gmail.com |
| bao.vo@excelplannings.com | baovocs04@gmail.com |
| baovothuong69@gmail.com | bao.vo@excelplannings.com, baovocs04@gmail.com |
| jennifer.le.insagent@gmail.com | phxuanh.2204@gmail.com |
| khang.nguyen@excelplannings.com | gianguyen0901@gmail.com, kayhuynh@epsins.co, nguyen.ngan0312@gmail.com |
| linh.le@excelplannings.com | teamsup.tl@gmail.com, thanhhuexhh@gmail.com |
| nam.nguyen@excelplannings.com | baovocs04@gmail.com |
| thuy.insagent@gmail.com | ngthinhuquynh1411@gmail.com |

Có assistant ở đây không có nghĩa là được assign permission mới trong Role Manager; đó là data relationship riêng. Cần tránh để một UI config thay đổi quan hệ này ngoài audit log.

---

## 9. Những điểm cần clean / rủi ro hiện tại

### P0 — cần chốt trước khi chỉnh permission

1. Dual source of truth: portal_account.role và RBAC roles/permissions cùng quyết định admin. Cần chọn RBAC làm nguồn duy nhất và migration legacy.
2. Permission grant không khớp live rollout: migration 2026-09-02-time-off.sql mô tả grant timeoff.user rộng hơn, nhưng snapshot chỉ Admin có timeoff permissions. Cần xác minh migration đã chạy ở production chưa hay role assignment đã bị ghi đè.
3. Lead grant không khớp expected policy: rollout lead mô tả non-admin có lead.work, nhưng live role permissions custom không có lead permission. Cần chốt worker nào thực sự được dùng Event Leads.
4. Task manager dựa vào tên role: Admin Health Task/Task Admin là allow-list hard-code. Rename role trong UI làm đổi privilege mà không có migration/cảnh báo.
5. Task/Lead manager semantics khác nhau: task dùng permission + admin-like role; lead dùng permission hoặc admin override. Cần chuẩn hóa hoặc ghi thành policy rõ ràng.

### P1 — rủi ro scope/data

6. Plain CS task worker có thể thấy toàn bộ task queue: đây là policy có chủ đích hiện tại nhưng task.work không diễn đạt điều đó. Cần đổi tên/scope hoặc thêm permission task.view_all.
7. Membership ngoài RBAC: task_agents/agent_members thay đổi visibility nhưng không có trong Role Manager và chưa được nhìn như một access grant trong account detail.
8. Ownership theo display name: registration/dashboard còn dùng session name/selected-agent name ở một số nơi thay vì stable account id/email.
9. Một permission timeoff.admin quá rộng: approval, balance, bulk adjustment, accrual, company holiday và team log nằm cùng một quyền. Nên tách nếu có nhiều nhóm HR/admin.
10. company.view_all nằm lẫn trong nhóm Dashboard: đây là data scope cross-module, nên tách khỏi page permission để tránh cấp nhầm.

### P2 — maintainability/operational

11. Nhiều kiểu API guard: requirePermission, module actor, config gate, session-only notification, cron secret. Cần chuẩn hóa helper và error contract.
12. Permission failure trả HTTP 401/redirect không thống nhất: cần phân biệt unauthenticated (401), authenticated but forbidden (403), UI redirect chỉ ở page.
13. /config fallback route chưa phản ánh lead-only config: route priority hiện thiên về task.manage, dễ đưa user lead manager tới unauthorized dù có lead config access.
14. Role Manager có thể cấp quyền nhạy cảm tùy ý: người có management.role_manager có thể tạo custom role chứa account_manager, role_manager, task.manage, timeoff.admin… Cần protected permission policy hoặc approval.
15. Role assignment thực tế single-role: UI/API cho cảm giác hỗ trợ nhiều role nhưng database chỉ lưu một role; nên bỏ mảng hoặc triển khai multi-role thật.
16. Role sync có nhánh nuốt lỗi: assignDefaultRoleToUser có thể không báo rõ lỗi delete/insert role mapping, dẫn tới account mới không có role mà UI vẫn tưởng thành công.
17. Session cache 5 phút: revoke/role change không immediate. Quyền nhạy cảm cần session version/revocation hoặc refresh sau mutation.
18. Admin notification recipient không cùng nguồn: task manager emails dùng RBAC, còn fetchAdminEmails vẫn dựa legacy portal_account.role=admin; recipient có thể lệch với người có quyền thực tế.

---

## 10. Đề xuất target model để discuss

Đây là đề xuất thiết kế, chưa phải thay đổi code.

### 10.1 Một nguồn quyền

- RBAC (roles + role_permissions + user_roles) là nguồn duy nhất.
- portal_account.role chỉ giữ compatibility trong migration, sau đó bỏ khỏi authorization path.
- Không dùng display name/role name để cấp privilege.

### 10.2 Permission theo capability, không theo role name

- Thay TASK_ADMIN_ROLE_NAMES bằng permission rõ nghĩa, ví dụ task.admin hoặc tách task.create, task.assign, task.configure.
- Đổi tên role không làm đổi behavior.
- Không dùng Admin/Super Admin như implicit override trong domain actor; nếu cần full access, cấp permission explicitly.

### 10.3 Tách page access, action và data scope

Ví dụ Task:

    task.view              → vào board/detail
    task.view_all          → xem toàn bộ task
    task.create            → tạo task
    task.assign            → assign/reassign
    task.manage_config     → category/SLA/reminder/config
    task.export            → export

Tương tự Time Off có thể tách:

    timeoff.user
    timeoff.approve
    timeoff.balance.manage
    timeoff.accrual.manage
    timeoff.company_days.manage
    timeoff.history.view_all

### 10.4 Scope bằng stable IDs

- Registration/dashboard: agent id/email chuẩn hóa.
- Task/enrollment: membership và assistant relation phải có access audit.
- Lead: owner/assistant scope giữ riêng nhưng dùng cùng helper policy.
- Không dùng tên hiển thị để authorize.

### 10.5 Account detail phải hiển thị effective access

Trong Account Manager nên có read-only panel:

- direct role + permissions;
- effective admin/manager flags theo module;
- data scope: company/agent/assistant/own;
- task agent memberships/assistants;
- thời điểm permission/session refresh gần nhất;
- audit log thay đổi role/permission.

---

## 11. Checklist validate sau khi clean

- [ ] Query không còn authorization nào dựa vào portal_account.role hoặc tên role hard-code.
- [ ] Một account chỉ có một nguồn effective permission.
- [ ] task.manage, lead.manage, timeoff.admin có semantics được viết thành test.
- [ ] Test matrix cho Admin, Task Admin, plain CS, selected agent, assistant, lead worker, timeoff user/admin.
- [ ] Test data scope với duplicate display name/rename agent.
- [ ] Test revoke permission có hiệu lực ngay hoặc có cơ chế invalidate session.
- [ ] Test account create/role update rollback nếu role mapping fail.
- [ ] Test every sensitive API trả 401/403 đúng ngữ nghĩa.
- [ ] Test notification recipients theo effective permission, không theo legacy role.
- [ ] Verify production migration grants: Time Off và Lead rollout phải khớp role snapshot.
- [ ] Re-run account snapshot sau migration và lưu diff.

---

## 12. Source map

- Permission catalogue: src/lib/rbac/permissions.ts
- Role normalization/session access: src/lib/rbac/system-roles.ts, src/lib/rbac/access.ts, src/lib/rbac/server.ts, src/auth.ts
- Route fallback: src/lib/rbac/routes.ts
- Sidebar visibility: src/app/(authed)/_components/Sidebar.tsx
- Task authorization/scope: src/lib/tasks/access.ts, src/lib/tasks/membership.ts
- Enrollment authorization/scope: src/lib/enrollment/access.ts, src/lib/enrollment/scope.ts
- Lead authorization/scope: src/lib/leads/access.ts, src/lib/leads/capabilities.ts, src/lib/leads/membership.ts
- Table config/export: src/lib/table-config/access.ts, src/lib/table-config/scope-access.ts, src/lib/table-config/export-access.ts
- Time Off authorization/queries: src/lib/time-off/access.ts, src/lib/time-off/queries.ts, src/app/(authed)/time-off/page.tsx
- Account Manager API: src/app/api/admin/users/route.ts, src/app/api/admin/users/[id]/route.ts
- Role Manager API: src/app/api/admin/roles/route.ts, src/app/api/admin/roles/[id]/route.ts
- Schema/RBAC seed and constraints: supabase/schema.sql, supabase/rollouts/2026-09-01-lead-role-grants.sql, supabase/rollouts/2026-09-02-time-off.sql, supabase/rollouts/2026-08-09-task-export-permission.sql
- Existing broad audit: docs/rbac-audit-2026-09-04.md

---

## 13. Bổ sung [claude] — đo thực tế và bất đối xứng giữa các module

Phần này bổ sung cho §1–§12, không thay thế. Mọi con số đo read-only trên production 2026-09-04.

### 13.1 Phân bố thực tế — ai đang thấy gì

| Nhóm | Người | Tầm nhìn task |
|---|---|---|
| Manager | **8** | Toàn bộ + sửa hết |
| Agent (có tên trong `task_agents`) | 13 | Chỉ task có `agent_email` = mình |
| Assistant (có tên trong `agent_members`) | 10 | Task của agent mình phụ trách |
| **Plain-CS** | **10** | **ĐỌC TOÀN BỘ task công ty** |
| Không có quyền task | 2 | — |

Đo tầm nhìn thật trên 141 task active:

```
AGENT      ann.strambler@…      thấy  37
ASSISTANT  thaoanhlephuong…     thấy  37   ← phụ trách Ann, ĐÚNG cùng 37 task
ASSISTANT  tranlyaibao2612…     thấy  37   ← cũng vậy
AGENT      thuy.insagent@…      thấy  22
PLAIN-CS   cheryl.tocs@…        thấy 141   ← tất cả
```

### 13.2 ⚠ 5/8 manager phụ thuộc chuỗi hard-code

`Admin Health Task` có đúng 2 permission: `settings.access` + `task.manage`. Họ thành manager **chỉ vì tên role khớp chuỗi** trong `src/lib/tasks/access.ts:18`.

→ Đổi tên role đó trong Role Manager = **62% manager mất quyền tức thì**, không lỗi, không log.

### 13.3 ⚠ Role `Task CS` — 20 người, cùng permission, hai mức truy cập ngược nhau

```
Task CS = { settings.access, task.work }     ← y hệt cho cả 20 người

10 người có tên trong agent_members  →  chỉ thấy task của agent mình
10 người KHÔNG có tên                →  thấy TOÀN BỘ 141 task
```

Role không nói lên được người đó thấy gì. Và **tầm nhìn suy ra từ sự VẮNG MẶT** — không có tên trong bảng thì thấy *nhiều hơn*. Không màn hình nào hiển thị điều này.

### 13.4 ⚠ Cùng hình dạng code, nghĩa NGƯỢC nhau giữa Task và Lead

```ts
// src/lib/tasks/access.ts:47
isManager: hasManage && Boolean(opts?.isAdmin)                    // VÀ

// src/lib/leads/access.ts:51
isManager: can(permissions, LEAD_MANAGE) || Boolean(opts?.isAdmin) // HOẶC
```

Người có cả `task.manage` + `lead.manage` nhưng role không nằm trong danh sách hard-code: **là manager đầy đủ ở Lead, KHÔNG phải manager ở Task**. Giao diện không giải thích gì.

### 13.5 Agent và Assistant hiện KHÔNG khác quyền

`src/lib/tasks/access.ts:153-154` ghi thẳng:

> *"`isAgentOwner` đã bao gồm assistant (xem `isAgentOwnerOrAssistant`), nên không cần cờ riêng cho assistant."*

Đo lại xác nhận: agent và assistant của agent đó thấy **cùng một tập**. Khác biệt hiện chỉ là **hướng quan hệ** (ai sở hữu quan hệ khách hàng), không phải quyền.

Luật thực tế: **agent → tập { chính mình }; assistant → tập { các agent mình phụ trách }**. Cộng thêm: ai cũng thấy task được gán cho mình / mình tham gia / mình tạo.

### 13.6 Một lý do trong code đã hết đúng

`src/lib/table-config/scope-access.ts:11` ghi:
> *"hai tài khoản trên production chỉ có `lead.manage` và không có `task.manage`"*

Thực tế: cả **3** người có `lead.manage` đều **có** `task.manage`. Trường hợp biện minh cho cơ chế tách `configScopesFor` không còn tồn tại. Cơ chế vẫn có thể đáng giữ, nhưng lý do phải viết lại.

### 13.7 `task.manage` hiện chưa bao giờ đứng một mình

8 người có `task.manage`, cả 8 đều là manager. Toán tử `&&` ở `access.ts:47` **hiện không lọc ai cả** — nghĩa là bỏ nó đi không đổi quyền của ai (đã mô phỏng trên cả 43 tài khoản: **0 người bị đổi**).

### 13.8 Không có API route nào hở

Đã rà **toàn bộ 104** route dưới `src/app/api/**`. Tất cả đều có cổng gác — nhưng qua **7 cơ chế khác nhau** (`requirePermission`, `isTaskViewAdmin`, `loadEnrollmentActor`, `isLeadViewAdmin`, `getTimeOffActor`, `loadConfigAdmin*`, cron secret). Người thêm route mới phải đoán dùng cái nào.

### 13.9 ⚠ Thay đổi quyền CHƯA COMMIT trong working tree

`src/lib/tasks/access.ts` đang có sửa đổi chưa commit: `canEditTaskDueDate` nới từ *"chỉ agent của task + assistant + admin"* thành *"ai xem được task thì dời được hạn"*.

Hệ quả với dữ liệu hiện tại: **10 người plain-CS (thấy toàn bộ 141 task) sẽ dời được Due Date của bất kỳ task nào**. Cần xác nhận đây là ý định trước khi commit.
