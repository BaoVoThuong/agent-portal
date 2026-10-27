# Chuẩn hoá Role + Position — audit và plan

Ngày: 2026-10-17. Dữ liệu đọc từ production (chỉ SELECT) và code trên `main` (`8360508`).

**Cách dùng file này:** mục 1–4 là audit (hiện trạng + vấn đề). Mục 5 là mô hình đích. Mục 6 là các câu user cần trả lời. Mục 7 là lộ trình theo phase. Mỗi phase chỉ viết plan code chi tiết (tự chứa, có code thật) khi user duyệt phase đó, đúng cách làm từng bước đã thống nhất từ 16/10.

**Luật giữ nguyên, plan này không đụng tới:**
- Quyền do ô tick quyết định.
- Không có quyền chéo module.
- Admin là role cố định, khoá trong Role Manager.
- Manage bao gồm Work.
- Task CS và Enrollment dùng chung `task.*`.
- Chỉ Admin có Role Manager / Account Manager (U1).
- Không xoá role còn người giữ (U2).
- Không đổi email (U3).
- Chỉ Disable account (U4).
- Account Manager gọi Role là "Accessibility", Role Manager giữ chữ "Role" (chốt 17/10).

File này chưa commit (repo origin public, và có tên người).

---

## 1. Tóm tắt

- Hệ thống có 4 thứ cùng nói về một người: **Role**, **Position**, **Manager**, và **nhãn bên Task** (do code tự suy ra). Hai thứ cuối hay trùng chữ với hai thứ đầu nhưng khác nghĩa. Ví dụ Charlotte To: Role "Admin Health Task", Position "CS Manager", nhãn Task "Admin".
- Có 2 role đặt theo tên người (**Linh Le**, **Nhi Vu**), và role "Nhi Vu" lại do account "Life Admin" giữ. Có 1 role chết (**Agent**, 0 người).
- Có 2 ô tick thừa hoặc vô dụng:
  - Accounting có cả Manage lẫn Work.
  - Admin Health Task có "Provider List - Manage" mà không có "Provider Finder", nên không mở được Provider List.
- Trang Settings (đổi mật khẩu, tên, avatar) bị khoá sau một ô tick, nên Jackie (Referrals) không tự đổi mật khẩu được.
- 4 account active chưa có Position.
- Code cho một account giữ nhiều role, trong khi giao diện chỉ cho 1 và thực tế 47/47 account có đúng 1.

Dữ liệu không có chỗ nào sai lệch nguy hiểm: Position Agent/Assistant khớp 100% với `task_agents` / `agent_members`. Việc cần làm chủ yếu là dọn tên, dọn tick, khoá mô hình cho khỏi trôi lại.

---

## 2. Mô hình đang chạy

| Khái niệm | Trả lời câu hỏi | Lưu ở | Code quyết định |
|---|---|---|---|
| **Role** (Account Manager gọi "Accessibility") | Được **mở trang nào, làm việc gì** | `roles`, `role_permissions`, `user_roles` | `src/lib/rbac/permissions.ts`, `routes.ts`, `requirePermission` |
| **Position** | **Là ai** trong công ty, và với Task/Lead/Enrollment thì **thấy dữ liệu của ai** | `positions` (`kind`: agent / assistant / cs / other), `portal_account.position_id` | `update_account_atomic` ghi `task_agents` / `agent_members`; phạm vi ở `src/lib/admin/account-config.ts` (`taskScope`) |
| **Manager** | Ai là sếp trực tiếp (cây tổ chức) | `portal_account.manager_id` | Không cấp quyền gì |
| **Nhãn Task** (Admin / Agent / Assistant / Customer Service) | Chữ hiện cạnh tên ở Task Board, @mention, CS Overview, tiêu đề "Admin Task Board"… | Không lưu, tự suy ra | `src/lib/tasks/positions.ts` (`taskPositionKind`): `task.manage` → Admin, rồi Agent, Assistant, CS |

Phạm vi thấy Task/Lead/Enrollment (`taskScope`):
- Có `task.manage` → **mọi task**.
- Position Agent → **task của mình**.
- Position Assistant → **task của các Agent mình hỗ trợ**.
- Còn lại, có `task.work` → **hàng chờ chung của công ty**.

Pool chia việc CS tự động (`assign_unassigned_task`): account active có `task.work` hoặc `task.manage`, role khác "Admin", không phải Agent/Assistant, và không bị tắt ở CS Overview → Assignment queue.

---

## 3. Hiện trạng production (đọc 2026-10-17)

### 3.1 Các role và người giữ

| Role | Người (active) | Position của họ | Mở được gì (nói gọn) |
|---|---|---|---|
| **Admin** (hệ thống) | 3: Bao Vo, Khang Nguyen, Nam Nguyen | Agent ×3 | Mọi thứ. Không lưu `task.work`/`lead.work` vì Manage đã bao gồm |
| **Task CS** | 21 | Customer Service 10, Assistant 10, trống 1 (Jin) | Task Board (Work), Provider Finder, Settings |
| **Health Agent** | 15 | Agent ×15 | Health Registration, Health Statement, Provider Finder, Dashboard Agent-Health, Task (Work), Leads (Work), Settings |
| **Admin Health Task** | 4 (+1 đã tắt: Bao Vo Test) | CS Manager 3 (Admin QA, Charlotte To, Dung Ha), Assistant 1 (Kay Huynh) | Task (Manage), Leads (Work), Provider List - Manage, Settings |
| **Linh Le** | 1: Linh Le | Agent | 16 quyền: gần như Admin. Thiếu Account/Role Manager, Notification Alerts, Task Import, Time Off, Lead Manage (chỉ có Lead Work) |
| **Nhi Vu** | 1: **Life Admin** | trống | Dashboard Agent + Company (Health, P&C), View All Agents, Lead Manage, Task (Work), Settings |
| **Accounting** | 1: Ha Nguyen | trống | Health + P&C Statement, Dashboard Company (Health, P&C), Task (Manage **+ Work**), Settings |
| **Referrals** | 1: Jackie | trống | Chỉ Lead Manage. **Không có Settings** |
| **Agent** | **0** (kể cả account đã tắt) | — | 7 quyền. Mô tả "Default access for regular agents." giống hệt role Linh Le |

Không role nào là role mặc định (`is_default` đều false). Đây là cố ý từ 17/10: account mới không tự có role.

### 3.2 Ma trận role × quyền

`x` = có tick. ADM Admin, AHT Admin Health Task, LIN Linh Le, NHI Nhi Vu, HAG Health Agent, AGT Agent, ACC Accounting, TCS Task CS, REF Referrals.

```
permission                         ADM  AHT  LIN  NHI  HAG  AGT  ACC  TCS  REF
automation.health_statement          x    .    x    .    x    x    x    .    .
automation.pc_statement              x    .    x    .    .    x    x    .    .
automation.provider_finder           x    .    x    .    x    x    .    x    .
automation.provider_manage           x    x    x    .    .    .    .    .    .
customer_registration.health         x    .    x    .    x    x    .    .    .
customer_registration.pc             x    .    x    .    .    x    .    .    .
customer_registration.view_all       x    .    x    .    .    .    .    .    .
agent_dashboard.health               x    .    x    x    x    x    .    .    .
agent_dashboard.pc                   x    .    x    x    .    .    .    .    .
company_dashboard.health             x    .    x    x    .    .    x    .    .
company_dashboard.pc                 x    .    x    x    .    .    x    .    .
company.view_all                     x    .    x    x    .    .    .    .    .
lead.manage                          x    .    .    x    .    .    .    .    x
lead.work                            .    x    x    .    x    .    .    .    .
management.account_manager           x    .    .    .    .    .    .    .    .
management.notification_alerts       x    .    .    .    .    .    .    .    .
management.role_manager              x    .    .    .    .    .    .    .    .
settings.access                      x    x    x    x    x    x    x    x    .
task.manage                          x    x    x    .    .    .    x    .    .
task.work                            .    .    .    x    x    .    x    x    .
task.export                          x    .    x    .    .    .    .    .    .
task.import                          x    .    .    .    .    .    .    .    .
timeoff.user                         x    .    .    .    .    .    .    .    .
timeoff.admin                        x    .    .    .    .    .    .    .    .
```

### 3.3 Position

| Position | kind | Active | Đi cùng role |
|---|---|---|---|
| Agent | agent | 19 | Health Agent 15, Admin 3, Linh Le 1 |
| Assistant | assistant | 11 | Task CS 10, Admin Health Task 1 |
| Customer Service | cs | 10 | Task CS 10 |
| CS Manager | cs | 3 | Admin Health Task 3 |
| *(trống)* | — | 4 | Accounting (Ha Nguyen), Nhi Vu (Life Admin), Referrals (Jackie), Task CS (Jin) |

Đối chiếu với bảng thật quyết định phạm vi:
- `task_agents`: 20 dòng, đều là Position Agent (1 dòng là account đã tắt).
- `agent_members`: 16 dòng của 11 Assistant active, đúng 11 người có Position Assistant. Ngoài ra có 1 dòng test `is_assistant=false` và 3 dòng của account đã tắt.
- **Không có lệch.**

### 3.4 Pool chia việc CS hiện tại (16 người)

Gồm 11 người Task CS (Customer Service + Jin), 3 người CS Manager (Admin QA, Charlotte To, Dung Ha), Life Admin và **Ha Nguyen (Accounting)**. Trong đó có 5 người đang bị tắt ở Assignment queue (Life Admin, Jin, Ann Do, Hoang Minh Doan, Huy). Ha Nguyen và Admin QA đang **bật** (không có dòng queue), nhưng 30 ngày qua chưa nhận task nào.

---

## 4. Vấn đề, xếp theo mức nên sửa

| # | Vấn đề | Ví dụ thật | Hậu quả |
|---|---|---|---|
| V1 | **Role đặt theo tên người** | Role "Linh Le" (người Linh Le giữ). Role "Nhi Vu" nhưng account giữ là "Life Admin" | Đọc tên role không biết nó cho quyền gì. Người đó nghỉ hoặc đổi việc thì role mồ côi. Ai cần y như vậy phải tạo thêm role theo tên người khác |
| V2 | **Role chết** | "Agent": 0 người, mô tả giống hệt role "Linh Le" (role Linh Le được nhân bản từ Agent) | Dễ bị chọn nhầm khi tạo account (7 quyền khác hẳn Health Agent: có P&C, không có Task/Leads) |
| V3 | **Tick vô dụng** | Admin Health Task có "Provider List - Manage" nhưng thiếu "Provider Finder". Trang Provider List đòi Provider Finder (`src/app/(authed)/tasks/providers/page.tsx:24`), mô tả quyền ghi "Needs Provider Finder as well" | 4 người có quyền sửa danh sách Provider mà không mở được trang đó. Chỉ còn sửa được cột Provider ở `/config` |
| V4 | **Tick thừa** | Accounting có `task.manage` + `task.work`. Khi lưu, Role Manager tự bỏ Work (`normalizeExclusivePermissionKeys`), nhưng dòng cũ trong DB vẫn còn | Không đổi quyền gì, chỉ làm ma trận khó đọc và dễ hiểu sai |
| V5 | **Trang cá nhân bị khoá bằng quyền** | `settings.access` gác `/settings`, `/api/settings/password`, `/api/settings/profile` (`/api/settings/avatar` thì không gác, nhưng nút đổi avatar nằm trong trang Settings). Jackie (Referrals) không có | Jackie không tự đổi được mật khẩu, tên, avatar. Mọi role mới đều phải nhớ tick ô này |
| V6 | **Ba chữ cho cùng một người** | Charlotte To: Role "Admin Health Task", Position "CS Manager", nhãn Task "Admin". Ha Nguyen (Accounting): Position trống mà Task Board vẫn hiện "Admin" (vì có `task.manage`) | Người dùng hỏi "Ha là Admin à?". Nhãn Task (`lib/tasks/positions.ts`) và Position gán (`lib/admin/positions.ts`) cùng gọi là "position" trong code |
| V7 | **Account active thiếu Position** | Jin (Task CS), Ha Nguyen, Life Admin, Jackie | Account Manager lọc theo Position bị sót người. Jin là CS nhưng không hiện là Customer Service |
| V8 | **Nhiều role/người về mặt kỹ thuật** | `user_roles` không chặn 2 role/người. SQL pool loại Admin **theo từng dòng role** | Nếu một người giữ cả Admin lẫn Task CS (chỉ cần ghi tay vào DB hoặc API cũ) thì họ lọt vào pool CS. Giao diện thì chỉ đọc `roleIds[0]` |
| V9 | **Pool có người có thể không nên nhận việc** | Ha Nguyen (Accounting) và Admin QA (nghe như account test) đang bật trong pool | 30 ngày qua chưa sao, nhưng hàng chờ mà dồn thì họ bị chia task CS |
| V10 | **Nhận diện Admin bằng tên** | `isAdminRoleName` (`src/lib/rbac/admin-role.ts`) và `lower(btrim(r.name)) <> 'admin'` trong `assign_unassigned_task` | Cách này đã được user chấp nhận (D5) và tên đã khoá đổi. Rủi ro thấp; Position thì đã dùng `system_key` |
| V11 | Rác nhỏ | Account đã tắt còn trong `task_agents` (Bao Vo Test) và `agent_members` (3 dòng). `schema.sql` seed role "Agent" có `timeoff.user`, production thì không | Không ảnh hưởng ai |

---

## 5. Mô hình đích

1. **Role = gói tính năng.**
   - Đặt tên theo **nhóm việc**, không theo người.
   - Không trùng tên một Position.
   - Không chứa chữ "Admin" trừ role Admin hệ thống.
   - Có mô tả một câu nói rõ cho ai.
   - Mỗi account **đúng 1 role**, khoá ở DB.
2. **Position = chức danh + phạm vi dữ liệu.**
   - Mọi account active **phải có** Position.
   - `kind` quyết định phạm vi: agent → của mình, assistant → của Agent mình hỗ trợ, cs/other → hàng chờ chung (nếu có quyền Task).
   - Người làm việc ngoài Task (Accounting, Referrals…) dùng Position `kind = other`.
3. **Manager = cây tổ chức**, không cấp quyền (giữ như cũ).
4. **"Manage bao gồm Work/View" áp cho mọi module có cặp đó:** task, lead và thêm **provider** (`automation.provider_manage` ⇒ `automation.provider_finder`).
5. **Trang cá nhân (Settings) mở cho mọi người đã đăng nhập**, không cần tick.
6. **Nhãn bên Task** lấy theo Q2 (mục 6).
7. **Admin hệ thống nhận diện bằng `roles.system_key = 'admin'`** (giống `positions.system_key`). Tên chỉ còn là chữ hiển thị.

Tên đề xuất (user chốt ở Q1):

| Hiện tại | Đề xuất | Vì sao |
|---|---|---|
| Admin | Admin (giữ) | Role hệ thống |
| Task CS | **Customer Service** hoặc giữ "Task CS" | Phải khác tên Position "Customer Service" → đề xuất **giữ "Task CS"** |
| Health Agent | Health Agent (giữ) | Tên theo dòng sản phẩm, khác Position "Agent" |
| Admin Health Task | **Health Task Manager** | Bỏ chữ "Admin" để khỏi nhầm với role Admin và nhãn "Admin" |
| Linh Le | **Senior Agent** (hoặc tên user chọn) | Agent có thêm quyền quản lý Task, Export, dashboard công ty, xem mọi registration |
| Nhi Vu | **Life Admin** → nhưng chứa chữ "Admin" → đề xuất **Life Team Lead** | Đặt theo account đang giữ ("Life Admin") |
| Accounting | Accounting (giữ) | |
| Referrals | Referrals (giữ) | |
| Agent | **Xoá** | 0 người |

---

## 6. Câu hỏi cho user

Mỗi câu có đề xuất. Trả lời ngắn kiểu "Q1 ok, Q3 b" là đủ.

| # | Câu hỏi | Đề xuất | Ai bị đổi gì nếu làm |
|---|---|---|---|
| Q1 | Đổi tên role theo bảng mục 5? | Đồng ý, user sửa tên nào thì nói | Không ai đổi quyền. Chỉ đổi chữ hiển thị |
| Q2 | Nhãn cạnh tên ở Task Board / @mention / CS Overview: (a) giữ luật suy ra hiện tại (Admin > Agent > Assistant > CS, chốt 14/10 lúc chưa có Position) hay (b) hiện **Position đã gán**? Tiêu đề board ("Admin Task Board"…) vẫn theo quyền như cũ | (b). Lý do: nay Admin đã gán Position cho từng người. Ví dụ: Charlotte To hiện "CS Manager" thay vì "Admin"; Bao Vo hiện "Agent"; Ha Nguyen hiện Position được gán ở Q5 | Không đổi quyền, chỉ đổi chữ. Chọn (a) thì phase 4 chỉ còn đổi tên file code |
| Q3 | Admin Health Task có "Provider List - Manage" mà không mở được Provider List: (a) thêm "Provider Finder" cho role này, hay (b) bỏ "Provider List - Manage"? | Hỏi user: 4 người này có cần xem/sửa danh sách Provider không? Có → (a), không → (b) | (a): Admin QA, Charlotte To, Dung Ha, Kay Huynh **được thêm** trang Provider List. (b): họ **mất** quyền sửa cột Provider ở Table Configuration |
| Q4 | Mở Settings (mật khẩu, tên, avatar) cho mọi người, bỏ ô tick `settings.access`? | Đồng ý | Jackie **được thêm** trang Settings. Những người khác không đổi |
| Q5 | Position cho 4 account đang trống. Jin → Customer Service. Ha Nguyen, Life Admin, Jackie → tạo Position `other`: "Accounting", "Life Team", "Referrals" (tên user chốt). Từ nay Position bắt buộc khi tạo/sửa account active? | Đồng ý | Không ai đổi quyền. Position `cs`/`other` cho cùng phạm vi "hàng chờ chung" |
| Q6 | Ha Nguyen (Accounting) và Admin QA đang bật trong pool chia việc CS. Tắt ở Assignment queue? | Admin QA là account test thì tắt. Ha Nguyen: user quyết | Người bị tắt không còn được giao task CS tự động. Vẫn mở Task Board như cũ |
| Q7 | Xoá role "Agent" (0 người)? | Đồng ý | Không ai |
| Q8 | Khoá mỗi account đúng 1 role ở DB? | Đồng ý | Không ai (47/47 đang có 1 role) |
| Q9 | Admin nhận diện bằng `system_key` thay vì tên (thuần kỹ thuật)? | Đồng ý, làm sau cùng | Không ai |

---

## 7. Lộ trình

Phase nào cũng làm như nhau:
- Trước khi làm: nói rõ ai bị đổi gì.
- Chụp access matrix production **trước và sau**: tab vào được, task/lead/enrollment thấy được, quyền sửa, pool CS, thông báo giám sát. Chỉ được lệch đúng những dòng user đã duyệt.
- Có file rollback.
- Mọi SQL **có ghi** đều hỏi user trước từng lần. SQL chỉ đọc chạy tự do.
- Ghi `changelog.md`.
- Commit/push chỉ khi user bảo.
- Script access matrix cũ (scratchpad phiên 16/10) không còn. Phase 1 viết lại thành `supabase/rollouts/2026-10-xx-access-matrix.sql` (chỉ đọc), dùng chung cho mọi phase. Backup/restore dùng lại `2026-10-16-access-backup.sql` / `-restore-preview.sql` / `-restore.sql`.

**Phụ thuộc:** working tree đang có WIP "Role Manager master-detail" (chưa commit: `RoleManagerClient.tsx`, `RoleList.tsx`, `RolePanel.tsx`, `permission-groups.ts`, `role-management.ts`). Phase 3–4 đụng Role Manager, nên **chỉ làm sau khi WIP đó vào main**. Phase 1–2 chỉ đụng DB và vài route, làm trước được.

### Phase 1 — Dọn dữ liệu, không đổi quyền ai (Q1, Q5, Q7 + tick thừa của Accounting)

- SQL rollout `2026-10-xx-rbac-tidy.sql` (+ `.rollback.sql`), có guard:
  - Xoá role "Agent" **chỉ khi** còn 0 dòng `user_roles`.
  - Xoá `task.work` khỏi Accounting **chỉ khi** role đó còn `task.manage`.
  - Đổi tên role theo Q1, khoá theo `id` chứ không theo tên.
  - Tạo các Position `other` theo Q5, gán Position cho 4 account bằng `update_account_atomic` (cùng đường ghi của Account Manager).
- Kỳ vọng access matrix: **0 khác biệt**.
  - Bỏ `task.work` khỏi Accounting không đổi pool, vì pool đếm cả `task.manage`.
  - Không đổi phạm vi, vì Accounting có `task.manage` → thấy mọi task.

### Phase 2 — Các thay đổi có đổi quyền (Q3, Q4, Q6), duyệt từng dòng

- Q3:
  - (a) Thêm tick `automation.provider_finder` cho role Admin Health Task.
  - hoặc (b) Bỏ tick `automation.provider_manage` khỏi role đó.
- Q4 (code):
  - Bỏ kiểm `PERMISSIONS.SETTINGS` ở `src/app/(authed)/settings/page.tsx:14`, `src/app/api/settings/password/route.ts:18`, `src/app/api/settings/profile/route.ts:14`; chỉ còn kiểm đã đăng nhập (`avatar` vốn chỉ kiểm đăng nhập).
  - `routes.ts`: mục `/settings` không cần quyền.
  - Gỡ ô tick khỏi Role Manager, nhưng giữ dòng `permissions` để JWT cũ không lỗi.
  - Thêm test: account không role vẫn đổi được mật khẩu.
- Q6: đặt `is_enabled = false` ở `task_assignment_queue_members` cho người user chọn, qua đúng nút ở CS Overview, không ghi tay.
- Kỳ vọng access matrix: chỉ lệch đúng các dòng trên.

### Phase 3 — Khoá mô hình cho khỏi trôi lại (Q8, mục 5.4, Q5 bắt buộc)

- DB:
  - `create unique index user_roles_one_role_per_account on user_roles (user_id)`, có guard: dừng nếu ai đang có > 1 role.
  - `update_account_atomic` / API `admin/users` nhận `roleId` đơn. Giữ `roleIds` một phần tử một thời gian cho client cũ.
- `IMPLIED_PERMISSIONS` thêm `automation.provider_manage → automation.provider_finder`. Chỉ làm sau Q3, để không ai tự dưng được thêm trang.
- Account Manager:
  - Position bắt buộc khi tạo account, và khi lưu account active.
  - Role Manager cảnh báo khi đặt tên role trùng tên một account, trùng tên Position, hoặc chứa "Admin".
- Test: `src/lib/rbac/permissions.test.ts` (luật kéo theo), test route users (1 role), `src/lib/admin/account-config.test.ts` (Position bắt buộc).

### Phase 4 — Chữ và nhãn (Q2, Q9)

- Q2 = (b): nhãn người ở Task Board / @mention / CS Overview lấy từ Position đã gán. Tiêu đề board vẫn theo `taskBoardTitle`.
- Đổi tên `src/lib/tasks/positions.ts` → `src/lib/tasks/person-labels.ts`, để "position" trong code chỉ còn nghĩa Position gán. Làm dù Q2 chọn (a) hay (b).
- Q9:
  - Thêm cột `roles.system_key` (`'admin'` cho Admin).
  - `isAdminRoleName` → `isAdminRole(role)` đọc `system_key`.
  - SQL `assign_unassigned_task` đổi `lower(btrim(r.name)) <> 'admin'` thành `r.system_key is distinct from 'admin'`, có guard md5 như các rollout trước.
  - `no-role-name-authz.test.ts` cấm luôn so tên "Admin".

### Ngoài phạm vi

- Đổi **mã quyền** (`timeoff.*`, `company.view_all`…): mã nằm trong JWT, DB và code; đổi rủi ro cao mà không lợi cho người dùng. Chỉ sửa **nhãn** nếu cần.
- Grant theo phạm vi (`action:scope`) của nhánh `feat/authz` cũ: đã bỏ ngày 09/10.
- Time Off: chưa go-live, `timeoff.*` chỉ Admin có.
- Dọn dòng của account đã tắt trong `task_agents` / `agent_members` (V11): không ảnh hưởng ai, làm khi có lý do.
