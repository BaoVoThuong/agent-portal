# Authorization Architecture Audit & Migration Plan

**Ngày:** 2026-09-25 · **Loại:** audit read-only + thiết kế — **không sửa một dòng code nào**.
**Phạm vi:** toàn bộ `agent-portal` (694 file TS/TSX, 104 API route, `supabase/schema.sql`, rollouts).
**Nền:** bản kiểm kê `docs/2026-09-04-rbac-role-access-inventory.md` (có snapshot production 43 account ngày 04/09). Tài liệu này **không** chép lại bảng account ở đó; nó đi sâu vào *vì sao* quyền rẽ nhánh, thiết kế đích và lộ trình. Snapshot production **không** được đọc lại lần này — mọi con số về người dùng lấy từ bản 04/09 và được đánh dấu *(snapshot 04/09)*.

Thay đổi liên quan quyền kể từ 04/09 (đã đọc diff): `task.import` tách khỏi `task.export` (`4967e97`), middleware dùng cấu hình nhẹ (`0196d14`), agent thôi nhận thông báo tự động (`ef67497`), scope `provider` vào table-config (`13b410e`), time-off chọn người nhận (`d997176`).

**Bản 3 (final, 2026-09-26) — đã xử lý 22 comment `[sol5.5]` của Codex** (đối chiếu ở §17; lộ trình và task chi tiết ở `docs/superpowers/plans/2026-09-26-authorization-final-plan.md`).

**Bản 2 (cùng ngày) — đã nhập khuyến nghị của Codex.** Codex viết một audit song song: `docs/2026-09-25-authorization-architecture-audit.md`. Bản này đã review từng điểm của Codex (kết quả ở §16) và đưa các khuyến nghị vào thiết kế đích (§9–§10), lộ trình (§11) và kiểm thử (§12). Mọi phát hiện có nguồn từ bản Codex (S0, S15–S27, F9–F13, R22–R24) chỉ được đưa vào sau khi đã tự đọc lại code để xác minh.

Nhãn độ tin cậy:
- **[code]** — đã đọc và lần theo đường code, trích file:dòng.
- **[prod?]** — phụ thuộc dữ liệu production, cần chạy lại truy vấn read-only để xác nhận.
- **[chưa thử]** — suy ra từ code, chưa tái hiện thực tế.

---

## 0. Tóm tắt

**Câu trả lời ngắn cho câu hỏi trung tâm:** RBAC hiện chỉ quyết định *được vào module nào*. Mọi thứ bên trong module — ai là "manager", thấy dữ liệu nào, có quyền chủ sở hữu trên bản ghi nào, ai nhận thông báo — được quyết định ở **9 nguồn khác** (tên role viết cứng, cột legacy `portal_account.role`, bảng `task_agents`/`agent_members` sửa trong màn Table Configuration, tên hiển thị trong session, seed của `schema.sql`, code notification từng route…).

**Không nên nhồi tất cả vào RBAC.** Hệ này có ba loại câu hỏi khác bản chất:

| Câu hỏi | Bản chất | Nơi nên sống |
|---|---|---|
| Người này được làm *loại* việc gì, ở *phạm vi* nào? | Tĩnh, theo chức năng | **RBAC** (role → grant `{action, scope}`) |
| Trên *bản ghi nào*? | Theo quan hệ: agent sở hữu sổ khách, assistant được uỷ quyền, người được giao, người tạo | **Relationship** (bảng quan hệ + cột bản ghi) |
| Kết hợp hai cái trên ra quyết định | Logic | **Policy** thuần, một module duy nhất |

Đích (đã nhập khuyến nghị của Codex):

- **Principal khoá theo account id**, không theo email.
- **Grant có kiểu `{action, scope}`**, cấu hình trong Role Manager.
- **Policy thuần** trong `src/lib/authz/`, trả về quyết định kèm lý do. Route, truy vấn, UI và thông báo đều hỏi policy.

Role chỉ còn là cấu hình. Phạm vi dữ liệu (assigned / agent_owned / shared_queue / all…) trở thành grant nhìn thấy được trong Role Manager, thay vì nằm ngầm trong code. Nhãn "Admin / Agent / Assistant / CS" chỉ còn để hiển thị.

**6 rủi ro bảo mật cần xem trước** (chi tiết §13):

| # | Mức | Vấn đề |
|---|---|---|
| S0 | **Nghiêm trọng nếu grant production mở** | 8 bảng mới (toàn bộ `time_off_*`, `push_subscriptions`, `notification_preferences`, `task_comment_edits`) **không có lệnh bật RLS** ở bất kỳ file SQL nào trong repo. Anon key nằm công khai trong bundle trình duyệt. Nếu grant mặc định của Supabase còn nguyên, ai có anon key đọc/ghi thẳng được các bảng này qua PostgREST. Cần chạy truy vấn kiểm read-only **ngay** (§13). |
| S1 | **Cao** | Dashboard Health/P&C, Customer Registration và AI chat lọc dữ liệu theo **tên hiển thị** trong session. Người dùng tự đổi được tên (Settings), và với đăng nhập Google thì tên lấy từ hồ sơ Google. Đổi tên = xem/sửa/xoá dữ liệu hoa hồng của agent khác. |
| S2 | Trung bình–Cao | Tài khoản có `task.work` mà **chưa** được khai là agent/assistant thì thấy **toàn bộ** task và enrollment công ty. Quyền rộng nhất đến từ *việc vắng mặt* trong một bảng. |
| S3 | Trung bình | Tên role là quyền: đặt tên role "Super Admin" / "Task Admin" / "Admin Health Task" là cấp quyền quản trị; đổi tên "Admin Health Task" là tước quyền 5/8 manager, không cảnh báo. |
| S4 | Trung bình | Người có `management.account_manager` tự gán được role Admin cho chính mình; người có `management.role_manager` tự thêm mọi permission vào role của mình. |
| S5 | Trung bình | CS thường tạo được task (API cho phép, UI ẩn nút) bằng cách khai `agent_email` là chính mình → thành "agent owner" của task đó, tự assign/xoá/QC. Ảnh hưởng tính toàn vẹn KPI. |

Các phát hiện còn lại (S6–S27) ở §13.

**Lộ trình (thứ tự theo Codex; chi tiết và task ở `docs/superpowers/plans/2026-09-26-authorization-final-plan.md`):** A bịt lỗ khẩn + baseline → B principal ổn định + API authz → C quản trị role/account → D data scope từng domain → E frontend song song F thông báo → G agent/assistant/roster → H gỡ legacy.

Hai lưới an toàn chạy song song:

- **Decision diff offline** trước khi deploy: so luật cũ và mới trên mọi account × mọi bản ghi (43 account là đủ nhỏ để làm được).
- **Shadow evaluation runtime** sau khi deploy, có feature flag cho từng route.

Điều kiện để chuyển sang đường mới: chênh lệch = 0, trừ các sửa lỗi đã được duyệt.

---

## 1. Kiến trúc authorization hiện tại

### 1.1 Mô hình dữ liệu **[code]**

```
portal_account ── id, email, name, agent_id, role('admin'|'agent'), is_active
     │                                     └─ LEGACY, vẫn được đọc để quyết định admin
     └─ user_roles (UNIQUE user_id ⇒ 1 role/account) ── roles (name UNIQUE, is_system, is_active)
                                                            └─ role_permissions ── permissions (key)

task_agents(email)                       ← "người này là agent sở hữu sổ khách"
agent_members(agent_email, cs_email, is_assistant)  ← "cs_email là assistant của agent_email"

Cột quan hệ trên bản ghi:
  tasks: agent_email, assignee_email + task_assignees, reporter_email, task_participants (@mention)
  enrollment_records: agent_email, caller_email, responsible_enroll_email, created_by_email
  leads: assigned_to_email
  health_entries / pc_entries: agent_email (người nhập), selected_agent (TÊN agent)
  health_mart / pc_mart: agent (TÊN agent, từ dữ liệu carrier)
```

- `schema.sql:14-22` cột `role` mặc định `'agent'`; `:42-51` check `role in ('admin','agent')`.
- `schema.sql:350-351` `user_roles_one_role_per_user_idx` — **một account một role**. `replace_user_roles` (`:131-158`) và `replaceUserRoles` (`src/lib/rbac/role-management.ts:229-238`) chỉ lấy phần tử đầu mảng.
- RLS chỉ bật trên **các bảng có tên trong vòng `protected_tables`** (`schema.sql:6206-6270`), và không có policy. Bảng tạo sau vòng đó, hoặc chỉ có trong rollout, phải tự bật — và nhiều bảng đã không bật (S0). Sweep SECURITY DEFINER (`schema.sql:7262-7319`) chỉ chứng minh trạng thái nếu `schema.sql` đầy đủ đã chạy **sau** mọi function; hàm tạo trong rollout sau đó phải kiểm `EXECUTE` trên DB live (A0 Step 3). Server dùng service role (`src/lib/supabase.ts:3-11`), nhưng điều đó không chứng minh mọi bảng/hàm trên production đã được khoá. ⇒ **Lớp ứng dụng Next.js là ranh giới bảo vệ duy nhất.** Route nào quên gác là lộ toàn bộ dữ liệu.

### 1.2 Luồng một request **[code]**

```
Đăng nhập (credentials | Google)
  └─ getUserAccessByEmail()  src/lib/rbac/access.ts:56-71
       └─ flattenAccess()    :28-54  → legacyRole, roles[] (TÊN role), permissions[], agentId
  └─ JWT: {role, roles, permissions, agentId, name}   src/auth.ts:134-177
       làm mới mỗi 5 phút (RBAC_REFRESH_TTL_MS, src/auth.ts:34)

proxy.ts (middleware)  → chỉ hỏi "đã đăng nhập chưa"  src/proxy.ts:15-22, src/auth.config.ts:26-35

Page:  requirePermission / requireAnyPermission     src/lib/rbac/server.ts:20-45
API:   7 cơ chế gác khác nhau (§4.1)

Trong module:
  buildTaskActor(permissions, email, {isAdmin: isTaskViewAdmin(user)})   tasks/access.ts:38-51
  buildLeadActor(permissions, email, {isAdmin: isLeadViewAdmin(user)})   leads/access.ts:42-57
  loadEnrollmentActor() = task actor                                     enrollment/access.ts:108-126
  getTimeOffActor()                                                      time-off/access.ts:28-49
       ↓
  Quan hệ: resolveTaskQueueScope / isAgentOwnerOrAssistant / resolveEnrollmentScope / resolveLeadOwnerEmails
       ↓
  Resolver thuần: resolveTaskCapabilities / resolveEnrollmentCapabilities / resolveLeadCapabilities
       ↓
  Lọc truy vấn (.or() PostgREST) + gửi capability xuống client
       ↓
  Notification: mỗi route/cron tự chọn người nhận
```

### 1.3 Chỗ chuỗi quyết định rời khỏi RBAC

| Bước | Quyết định bằng | Là RBAC? | Nguồn |
|---|---|---|---|
| Vào module | permission | ✅ | `requirePermission`, `can()` |
| "Admin" toàn cục | cột `portal_account.role` **HOẶC** tên role `Admin`/`Super Admin` | ❌ | `rbac/access.ts:43-46`, `rbac/system-roles.ts:30-35` |
| Task manager | `task.manage` **VÀ** tên role thuộc allow-list | nửa | `tasks/access.ts:16-19, 25-36, 47` |
| Lead manager | `lead.manage` **HOẶC** admin (legacy/tên role) | nửa | `leads/access.ts:30-40, 50-51` |
| Phạm vi task/enrollment | có/không có tên trong `task_agents`, `agent_members` | ❌ | `tasks/membership.ts:98-116`, `enrollment/scope.ts:37-76` |
| Quyền "chủ" trên bản ghi | `agent_email` = mình hoặc agent mình assist | ❌ | `tasks/membership.ts:122-136` |
| Dữ liệu hoa hồng "của tôi" | **tên hiển thị** trong session | ❌ | `dashboard/health/page.tsx:65-71`, `lib/agent-name.ts:12-24` |
| Ai được vào `/config` | 3 định nghĩa khác nhau | nửa | §4.2 (F3) |
| Ai nhận thông báo | code từng route/cron | ❌ | §6 |
| Quyền của role `Admin`/`Agent` | `schema.sql` ghi đè khi chạy lại | ❌ | `schema.sql:293-321` |

---

## 2. Bản đồ các nguồn quyết định (Sources of Truth)

| # | Nguồn | Nằm ở | Quyết định gì | Sửa qua đâu | Có audit log? |
|---|---|---|---|---|---|
| 1 | RBAC tables | `roles`, `role_permissions`, `user_roles` | Vào module, và một phần quyền trong module | Role Manager, Account Manager | Không |
| 2 | Danh mục permission | `src/lib/rbac/permissions.ts:1-23` **+** `permissions` table **+** danh sách cứng trong `schema.sql:163-248` | Permission nào tồn tại | Code + SQL (3 bản phải khớp tay) | — |
| 3 | Seed/rollout SQL | `schema.sql:283-321`; `rollouts/2026-09-01-lead-role-grants.sql`, `2026-09-21-task-import-permission.sql` | Chạy lại `schema.sql` **xoá và cấp lại** toàn bộ quyền của role `Admin` và `Agent`; rollout cấp quyền **theo tên role** | Chạy tay trong SQL editor | Không |
| 4 | Cột legacy | `portal_account.role` | "Admin" cho lead override, task-admin, người nhận thông báo admin, bảo vệ admin cuối | Account Manager (mirror tự động), sửa DB tay | Không |
| 5 | Tên role trong code | `"Admin"`, `"Super Admin"`, `"Admin Health Task"`, `"Task Admin"`, `"Agent"` | Task manager, lead manager, role được bảo vệ, role mặc định, loại khỏi pool workload | Đổi tên role trong Role Manager (!) hoặc deploy code | Không |
| 6 | JWT session | `src/auth.ts:34, 134-177` | Bản sao quyền, sống tới 5 phút sau khi đổi | Tự hết hạn | — |
| 7 | Agent roster | `task_agents` | Ai là "agent" → thu hẹp phạm vi task/enrollment, được làm agent của enrollment | **/config → Table Configuration** (`api/config/agents/route.ts`, gác `loadConfigAdmin`) | Không |
| 8 | Delegation | `agent_members.is_assistant` | Assistant có quyền chủ trên sổ khách của agent (task, enrollment, lead) | **/config** (`api/config/assistants/route.ts`) | Không |
| 9 | Quan hệ trên bản ghi | cột assignee/reporter/participant/caller/responsible/creator/assigned_to | Xem/sửa từng bản ghi | Thao tác nghiệp vụ; **@mention tự thêm participant** | Activity log của từng module |
| 10 | Tên hiển thị | `session.user.name` ↔ `selected_agent`, `*_mart.agent` | Phạm vi Registration, Agent Dashboard, AI chat | Settings (người dùng tự sửa), Account Manager, **hồ sơ Google** | Không |
| 11 | Code notification | từng route + 4 cron | Ai nhận gì; quyết định đội ngũ ghi trong comment (vd 16/09 "agent thôi nhận") | Deploy | Không |
| 12 | Env | `AUTH_GOOGLE_ALLOWED_DOMAIN` (`src/auth.ts:110`), `CRON_SECRET`, `REALTIME_TOPIC_SECRET` | Tự tạo account + gán role mặc định; gác cron; bí mật topic realtime | Vercel env | — |
| 13 | Hằng số nghiệp vụ | `KEY_STAGE_NOTIFICATIONS` theo **nhãn stage** (`api/enrollment/[id]/route.ts:86`), leo thang theo priority urgent/high (cron) | Ai nhận thông báo khi nào | Deploy | — |
| 14 | Persona suy ra ở client | `TaskBoardClient.tsx:211-215, 1116-1147, 2002-2005` | Nút Create, bộ lọc mặc định, xem activity | Deploy | — |

**Có nhiều nguồn cạnh tranh không? — Có, và chúng đang mâu thuẫn nhau ở ít nhất 5 khái niệm:**

1. **"Admin"** có 4 định nghĩa: cột legacy (`tasks/membership.ts:186-196` `fetchAdminEmails`); tên role `Admin`/`Super Admin` (`rbac/system-roles.ts`); chuỗi literal lặp lại trong `tasks/overview-data.ts:118`; "có mọi permission" (role Admin được `schema.sql:298-303` cấp chéo toàn bộ).
2. **"Task manager"** có 3 định nghĩa: `buildTaskActor` (permission VÀ tên role); `fetchTaskManagerEmails` (`tasks/membership.ts:204-254`, chỉ permission — dùng làm người nhận `task_created`); `api/tasks/overview/route.ts:13` (chỉ tên role, không cần permission).
3. **"Ai đang nắm permission X"** có 5 bản cài đặt với ngữ nghĩa `is_active` khác nhau: `fetchEmailsWithPermission` (`rbac/permission-holders.ts`) và `fetchTaskManagerEmails` lọc role inactive; `fetchTaskAssignees` (`tasks/assignees.ts:63-92`) và `fetchLeadAssignees` (`leads/assignees.ts:16-58`) **không** lọc; `overview-data.ts:106-126` tự viết với literal `"task.work"`.
4. **"Ai vào được /config"** có 3 định nghĩa (§4.2, F3).
5. **"Agent"** có 6 nghĩa (§7.1).

---

## 3. Kiểm kê phụ thuộc vào tên role / loại tài khoản

Phân loại: **Legit** = biết role thật sự là một phần nghiệp vụ; **Smell** = code thật ra muốn hỏi "người này được làm X không?" nhưng hỏi "người này có phải role Y không?".

### 3.1 Tên role và cột legacy

| # | File:dòng | Code | Role | Điều khiển | Rủi ro khi đổi/xoá role | Loại | Hướng xử lý |
|---|---|---|---|---|---|---|---|
| R1 | `src/lib/rbac/system-roles.ts:18-35` | `SYSTEM_ROLE_NAMES`, `LEGACY_SUPER_ADMIN_ROLE_NAME`, `getLegacyRoleFromRoleNames` | Admin, Super Admin, Agent | Cầu nối legacy ↔ RBAC | Đổi tên role Admin → mất cầu nối (bị chặn vì role bảo vệ) | Smell (shim) | `roles.system_key` bất biến; Phase C/H |
| R2 | `src/lib/rbac/access.ts:29, 43-46` | `legacyRole = row.role === "admin" ? … : getLegacyRoleFromRoleNames(roleNames)` | admin | `session.user.role` | Sửa DB tay cột `role` = thành admin ở mọi module đọc cờ này | Smell | Bỏ khỏi đường authz; Phase H |
| R3 | `src/auth.ts:113-128` | tạo account Google `role: "agent"` + `assignDefaultRoleToUser(…, "agent")` | Agent | Role mặc định khi tự tạo tài khoản | Đổi tên role "Agent" → account mới không có role (lỗi bị nuốt, `rbac/access.ts:83`) | Legit (khái niệm), Smell (tra theo tên) | Cấu hình "role mặc định" theo `system_key` |
| R4 | `src/lib/tasks/access.ts:16-19` | `TASK_ADMIN_ROLE_NAMES = {"Admin Health Task","Task Admin"}` | Admin Health Task, Task Admin | Ai là task manager | Đổi tên "Admin Health Task" → **5/8 manager mất quyền** *(snapshot 04/09)*; đặt tên role mới trùng chuỗi → cấp quyền | **Smell nặng** | Grant `task.*:all` cho chính role đó (luật tương thích 1); Phase D1 |
| R5 | `src/lib/tasks/access.ts:25-36` | `isTaskViewAdmin(user)` | Admin, Super Admin, 2 tên trên, legacy admin | Truyền vào `buildTaskActor` ở **~30 call site**: mọi `api/tasks/**`, `api/admin/task-sla-rules`, `api/admin/task-reminder-settings`, `enrollment/access.ts:119`, `tasks/reaction-access.ts:38`, `tasks/page.tsx:36,89`, `enrollment/page.tsx:51` | Như R4 | Smell | Phase C |
| R6 | `src/lib/tasks/access.ts:47` | `isManager: hasManage && Boolean(opts?.isAdmin)` | — | Manager = permission **VÀ** tên role | Toán tử `&&` hiện **không lọc ai** (8/8 người có `task.manage` đều là manager, *snapshot 04/09 §13.7*) | Smell | `isManager = can(task.manage)` sau khi xác minh Q1 |
| R7 | `src/app/api/tasks/overview/route.ts:13` | `if (!isTaskViewAdmin(session.user)) 403` | như R5 | Xem workload toàn công ty | Role tên "Task Admin" không có `task.manage` vẫn đọc được Overview | Smell | Gác bằng grant; Phase A3 |
| R8 | `src/lib/leads/access.ts:30-40, 50-51` | `isLeadViewAdmin`; `isManager = can(LEAD_MANAGE) \|\| isAdmin` | Admin, Super Admin, legacy admin | Lead manager | Chú thích dòng 47-49 nói "route gate vẫn đòi lead permission" — **sai**: `api/leads/**` không gọi `requireAnyPermission` (vd `api/leads/route.ts:15-28`). Admin theo tên/legacy vào API lead mà không cần permission lead | Smell | Bỏ override; Admin đã có `lead.*`; Phase D6 |
| R9 | `src/lib/leads/assign-target.ts:18-24` | `isLeadViewAdmin({role: legacyRole, roles})` | như R8 | Ai được nhận lead | — | Smell | Theo permission |
| R10 | `src/lib/table-config/access.ts:44-54`; `src/app/(authed)/config/page.tsx:73-79` | lead config gate dùng `isLeadViewAdmin` | như R8 | Sửa cấu hình bảng Lead | — | Smell | Phase C |
| R11 | `src/lib/tasks/membership.ts:186-196` | `fetchAdminEmails()` = `.eq("role","admin")` | legacy admin | Người nhận: backlog attention (`api/tasks/route.ts:401`), overdue unlock (`api/tasks/[id]/overdue-unlock/route.ts:159`), cron SLA & Due Date (`api/cron/check-overdue/route.ts:286, 488`), enrollment QC (`api/enrollment/route.ts:344`, `api/enrollment/[id]/route.ts:527`), enrollment due (`api/cron/check-enrollment-due/route.ts:171`) | Chỉ 3 người nhận; task admin (5 người) **không** nhận dù là người xử lý | Smell | Recipient policy; Phase F |
| R12 | `src/lib/tasks/overview-data.ts:41, 110, 114-120, 177` | literal `"task.work"`, `"task.manage"`, `role.name === "Admin" \|\| "Super Admin"`, `account.role === "admin"` | Admin | Loại admin khỏi pool workload CS (`tasks/overview.ts:465-471`), nhãn role | Bản sao thứ 5 của "ai là admin" | Smell | Dùng `task_assignment_queue_members` (đã có) làm nguồn "thuộc pool"; Phase D1 |
| R13 | `src/lib/tasks/assignees.ts:190-221` | `isAdminAccount`, nhãn "Admin/Agent/Assistant to X/Customer Service" | Admin | **Hiển thị** badge người | — | Legit (hiển thị) | Gom vào một hàm persona-label |
| R14 | `src/app/(authed)/tasks/page.tsx:88-92, 119-129` | `getTaskBoardTitle` | Admin | Tiêu đề board | — | Legit (hiển thị) | Giữ, dùng persona-label |
| R15 | `src/app/api/admin/users/[id]/route.ts:21, 244-251, 341-384` | `roles = ["admin","agent"]`; `targetHasSuperAdmin` theo tên; chặn tự hạ quyền | admin, Admin, Super Admin | Bảo vệ admin cuối cùng; mirror legacy | — | **Legit** (khái niệm "không được mất admin cuối"), Smell (theo tên) | `system_key` + bất biến theo permission |
| R16 | `src/app/api/admin/users/route.ts:91-99`; `src/lib/admin/user-input.ts:4, 23-26` | ghi `role` legacy khi tạo | admin/agent | Mirror | — | Smell | Phase H |
| R17 | `src/app/api/admin/roles/[id]/route.ts:37-42` | `isProtectedRole` theo tên | Admin, Super Admin | Không cho sửa/xoá | Tạo role mới tên "Super Admin" → role đó bị khoá vĩnh viễn trong UI (S3) | Legit khái niệm, Smell cài đặt | `system_key` |
| R18 | `src/lib/rbac/role-management.ts:143-160, 165-187, 256-307` | sắp xếp, đếm, `countActiveLegacyAdminUsers` theo tên/cột legacy | Admin, Super Admin | UI + bảo vệ admin cuối | — | Smell | `system_key` |
| R19 | `src/app/(authed)/account-manager/page.tsx:77-84`; `AccountManagerClient.tsx:51-56, 98-101, 908-913` | sort admin lên đầu; role mặc định form = tên "Agent"; fallback theo `user.role` | Admin, Agent | UI | Đổi tên "Agent" → form tạo account không có role mặc định | Legit (UI) | `system_key` |
| R20 | `src/app/(authed)/role-manager/RoleManagerClient.tsx:78-82` | khoá role theo tên | Admin, Super Admin | UI | — | Smell | `system_key` |
| R21 | `supabase/schema.sql:252-321` + rollouts | seed/grant theo `roles.name` | Admin, Agent, Super Admin | Quyền thực tế của 2 role | Xem S10 | Smell | Seed insert-only lần đầu; rollout theo `system_key` |
| R22 | `supabase/schema.sql:3679-3710` (`assign_unassigned_task`) | `account.role <> 'admin'`, `rp.permission_key = 'task.work'`, loại `r.name in ('Admin','Super Admin')` | legacy admin, Admin, Super Admin | Ai được nhận task từ Overview (claim nguyên tử) | Tên role/cột legacy nằm **trong SQL**, sửa TypeScript không đủ; role admin đổi tên sẽ lọt vào hàng đợi | Smell | Eligibility theo grant + `task_assignment_queue_members`; Phase G |
| R23 | `supabase/rollouts/2026-09-02-lead-auto-assign.sql:155-186` | seed trọng số lead cho `r.name = 'Health Agent'` | Health Agent | Ai nằm trong vòng chia lead tự động | Role mới có cùng chức năng không tự vào roster | Smell (dữ liệu một lần) | Giữ làm lịch sử; roster lead dựa trên grant/roster; Phase G |
| R24 | `supabase/rollouts/2026-09-02-time-off.sql:20-33`; `2026-08-09-task-export-permission.sql`; `2026-09-21-task-import-permission.sql` | cấp `timeoff.user` cho **mọi** role active; cấp permission mới theo tên `Admin` | Admin, mọi role | Backfill permission mới | Rollout chạy lại có thể ghi đè cấu hình Role Manager; snapshot 04/09 lệch với rollout (Q12) | Smell | Migration một lần, tham chiếu `system_key`; Phase C/H |

### 3.2 "Persona" suy ra ngầm (không phải tên role, nhưng đóng vai role)

| # | File:dòng | Suy ra | Điều khiển | Loại |
|---|---|---|---|---|
| P1 | `src/lib/tasks/membership.ts:98-116` | `seesAllTasks = !inTaskAgents && !isAssistant` ("plain CS") | CS thường **đọc toàn bộ task** | **Smell nặng** — quyền rộng nhất đến từ sự vắng mặt (S2) |
| P2 | `src/lib/enrollment/scope.ts:49-58` | cùng luật, trả `{seeAll: true}` | Đọc toàn bộ enrollment | Smell |
| P3 | `src/app/(authed)/tasks/_components/TaskBoardClient.tsx:211-215, 1116-1147, 2002-2005` | client tự tính plainCs / agent / assistant | Bộ lọc mặc định, nút Create, xem Activity | Smell — bản sao thứ 3 của luật persona |
| P4 | `src/lib/tasks/overview-data.ts:157-195`, `tasks/overview.ts:465-471` | isAdmin / isAgent / isAssistant để loại khỏi pool | Workload CS | Smell |
| P5 | `src/app/(authed)/dashboard/*/page.tsx`, `lib/agent-name.ts` | "agent" = tên hiển thị | Dữ liệu hoa hồng | Smell nặng về định danh (S1) |

### 3.3 Dùng role hợp lệ (nên giữ khái niệm, đổi cách cài đặt)

- **Bảo vệ admin cuối cùng** và **không tự hạ quyền mình** — hợp lệ, nhưng nên định nghĩa theo permission (`management.role_manager` ∧ `management.account_manager`) chứ không theo tên.
- **Role mặc định cho tài khoản mới** — hợp lệ, là cấu hình.
- **Nhãn hiển thị** (badge "Assistant to …", tiêu đề board) — hợp lệ, miễn là *chỉ* để hiển thị và đến từ một hàm duy nhất.

Mọi chỗ còn lại trong §3.1 là authorization smell.

---

## 4. Frontend vs Backend

### 4.1 Bảy cơ chế gác API **[code]**

`requirePermission`/`can()` trực tiếp · `buildTaskActor+isTaskViewAdmin` · `loadEnrollmentActor` · `buildLeadActor+isLeadViewAdmin` · `getTimeOffActor` · `loadConfigAdmin*` · `CRON_SECRET`. Đã rà 104 route: không route nào *hoàn toàn* không gác (khớp kết luận 04/09 §13.8), nhưng người thêm route mới phải tự đoán dùng cơ chế nào, và mã lỗi 401/403 lẫn lộn (vd `api/admin/roles/route.ts` trả 401 cho người đã đăng nhập nhưng thiếu quyền).

"Có gác" phải tách thành ba mức (C2): **xác thực** principal, **quyền thực hiện** action, và **scope của đúng object/response**. `/api/tasks/overview` (S8) và `PATCH /api/admin/roles/[id]` (S18) đều có một kiểm tra nào đó mà vẫn thủng; chuông chỉ kiểm email. Registry tĩnh (Task A9) chỉ phát hiện route thiếu khai báo, không thay được test gọi API trực tiếp.

### 4.2 Lệch nhau giữa UI và API

| # | UI | API | Hệ quả | Nguồn |
|---|---|---|---|---|
| F1 | Nút "New task" chỉ hiện cho manager hoặc agent/assistant (`TaskBoardClient.tsx:2005`) | `POST /api/tasks` coi `agent_email == actor` là "có agent scope" và **không** kiểm `agent_email ∈ task_agents` (`api/tasks/route.ts:147-164`) | CS thường tạo task, tự chọn assignee, thành agent-owner (S5). Enrollment thì có kiểm (`enrollment/ownership.ts:36-61`) — hai module lệch nhau | **UI ẩn, API cho** |
| F2 | Overview chỉ hiện khi `isManager` (permission VÀ tên role) | API chỉ đòi tên role (`api/tasks/overview/route.ts:13`) | Có tên role mà thiếu permission vẫn gọi API được | UI chặt hơn API |
| F3 | Sidebar hiện "Table Configuration" nếu `task.manage` HOẶC `lead.manage` (`Sidebar.tsx:149-151`) | Trang/API: task-admin HOẶC lead-manager HOẶC `automation.provider_finder` (`config/page.tsx:86-97`, `table-config/access.ts:83-101`); `getFirstAccessiblePath` chỉ biết `task.manage` (`rbac/routes.ts:62-64`) | Người chỉ có quyền Provider dùng được /config nhưng không thấy link; người có `task.manage` mà không có tên role thấy link rồi bị đá sang /unauthorized | 3 định nghĩa |
| F4 | Trang Leads đòi `lead.manage`/`lead.work` (`tasks/leads/page.tsx:29-32`) | API Leads chấp nhận admin theo tên/legacy không cần permission (R8) | Latent: role tên "Super Admin" không có quyền lead vẫn quản lead qua API | API rộng hơn trang |
| F5 | Client tự suy persona (P3) | Server dùng `resolveTaskQueueScope` | Hai bản luật; lệch là bộ lọc mặc định sai | Trùng lặp |
| F6 | Tab Activity: `isManager \|\| isAgentOwnerOrAssistantOf` (`TaskBoardClient.tsx:2002-2004`) | `api/tasks/[id]/activity/route.ts:59-62` viết inline | Luật "ai xem lịch sử" không nằm trong `tasks/access.ts` | Trùng lặp |
| F7 | — | Kiểm "xem được task" chép tay ở **6 route** (`comments`, `comments/[cid]`, `comments/[cid]/edits`, `attachments`, `attachments/[aid]`, `activity`) + `reaction-access.ts:48-88` + `[id]/route.ts:131-186` | Các bản đã từng lệch (chú thích `tasks/access.ts:1-5`: hai đường đọc quên `seesAllTasks`); bản ở `activity` vẫn không có `seesAllTasks` | Trùng lặp, rủi ro trôi |
| F8 | Avatar nằm trong trang Settings (gác `settings.access`) | `api/settings/avatar/route.ts` chỉ cần đăng nhập | Nhỏ; không lộ dữ liệu người khác | Lệch nhẹ |
| F9 | Link Settings luôn hiện trong menu TopBar (`TopBar.tsx:106`) | Trang đòi `settings.access` | Người không có quyền bấm vào thì bị đá đi | UI rộng hơn API (vô hại) |
| F10 | Chuông thông báo chỉ hiện khi có quyền task (`layout.tsx:43-46`, `TopBar.tsx:52-56`) | API chuông trả về cả thông báo Time Off (`api/tasks/notifications/route.ts:39-76`) | Người chỉ dùng Time Off không bao giờ thấy thông báo duyệt/từ chối đơn | UI hẹp hơn API |
| F11 | Editor "default month" hiện trong filter của Agent Dashboard cho mọi người (`AgentHealthReportMonthRangeFilter.tsx:200`) | API chỉ cho `company.view_all` hoặc `role_manager` (`api/dashboard-filter-defaults/route.ts:133-149`) | Agent bấm Save thì nhận 401 | UI rộng hơn API |
| F12 | /config ẩn tab không có quyền | Trang vẫn nạp cấu hình cột + option của **mọi** scope rồi serialize xuống client (`config/page.tsx:124-125`) | Người chỉ quản Lead/Provider nhận được metadata cột Health/ACA/Medicare | Payload rộng hơn UI (S24) |
| F13 | Picker người trên Task/Enrollment | Mọi worker nhận danh bạ **mọi** account active (`tasks/page.tsx:53-55`: `fetchTaskAssignees`, `fetchTaskAgentCandidates`) | Có thể là chủ ý, nhưng chưa có grant nào mô tả việc xem danh bạ | Cần quyết định trường tối thiểu (Q19) |

**Điểm tốt nên nhân rộng:** `resolveTaskCapabilities` (`tasks/access.ts:214-240`), `resolveLeadCapabilities` (`leads/capabilities.ts:24-35`), `resolveEnrollmentCapabilities` (`enrollment/access.ts:45-92`) được **cả server và client** gọi với cùng cờ → capability không trôi giữa hai lớp. Đây đúng là khuôn cần có cho toàn hệ; vấn đề là *đầu vào* của chúng (actor, cờ quan hệ) đang được dựng ở hàng chục chỗ.

### 4.3 Không có chỗ nào coi việc ẩn UI là bảo mật?

Không tìm thấy trường hợp API **hoàn toàn** dựa vào UI. Nhưng F1 là trường hợp API *rộng hơn* ý định mà UI thể hiện — về thực chất, luật "CS không được tạo task" chỉ được thi hành ở UI.

---

## 5. Phạm vi dữ liệu (Data Scope)

### 5.1 Hiện trạng **[code]**

| Tài nguyên | Thấy tất cả khi | Ngược lại thấy | Cơ chế | File |
|---|---|---|---|---|
| Health/P&C registration | `company.view_all` | `agent_email = email` **HOẶC** `selected_agent = TÊN hiển thị` | Query `.or()` | `api/entries/route.ts:20-33`, `lib/agent-name.ts:12-24`, `api/entries/[id]/route.ts:44-54`, `api/pc-entries/[id]/route.ts:54, 99, 158` |
| Agent dashboard Health/P&C | `company.view_all` | `mart.agent = TÊN hiển thị` | `.eq("agent", name)` | `dashboard/health/page.tsx:65-71, 138-139`, `dashboard/pc/page.tsx:55, 75-76` |
| AI dashboard chat | company perm + scope=company, hoặc `company.view_all` | TÊN hiển thị | | `api/ai/dashboard-chat/route.ts:137-146` |
| Task | manager, **hoặc CS không phải agent/assistant** | sổ khách (`agent_email` ∈ {mình nếu là agent} ∪ agent mình assist) ∪ được giao ∪ participant ∪ reporter | `.or()` + kiểm từng bản ghi | `tasks/membership.ts:98-116`, `tasks/queries.ts:140, 248`, `tasks/access.ts:91-114` |
| Enrollment | manager, **hoặc worker không phải agent/assistant** | sổ khách ∪ creator/caller/responsible | `.or()` | `enrollment/scope.ts:37-141` |
| Lead | `lead.manage` (hoặc admin override) | `assigned_to_email` ∈ {mình} ∪ agent mình assist | | `leads/membership.ts:22-29`, `leads/capabilities.ts:45-52` |
| Time off | `timeoff.admin` | của mình; lịch approved dùng chung | | `time-off/access.ts`, `api/time-off/**` |
| Provider | ai có `automation.provider_finder` | — (dữ liệu tham chiếu dùng chung) | | `api/automation/provider-list/**` |
| Notification | — | `recipient_email = mình` | | `api/tasks/notifications/route.ts` |

Ghi chú: quyết định ngày 02/08 (`docs/superpowers/plans/2026-08-02-view-model-and-batch-fixes.md`) là "Enrollment = shared, mọi worker thấy tất cả". Code hiện tại (`enrollment/scope.ts:58`) đã **thu hẹp** agent và assistant, chỉ worker không phải agent/assistant thấy tất cả — tức Enrollment nay theo đúng luật của Task. Cần xác nhận đây là ý định (Q3).

Thêm một đường mở rộng quyền xem nằm ngoài mọi màn hình quản trị: **@mention thêm người được nhắc vào `task_participants`**, và participant thì xem được task (`tasks/access.ts:106-113`). Tức là bất kỳ worker nào cũng chia sẻ được một task cho một agent/assistant ở đội khác bằng cách nhắc tên (Q14).

### 5.2 Đánh giá: RBAC đơn thuần có đủ không?

**Không.** Phạm vi thật sự được dùng là phạm vi theo quan hệ (assigned, participating, agent_owned, assistant_for_agent) cộng với hai phạm vi rộng (`shared_queue`, `all`). Không có team, department hay cây tổ chức, nên **đừng xây engine scope tổng quát** — không có dữ liệu nào nuôi nó.

Mô hình đề xuất (bản 2, theo Codex): scope trở thành **một phần của grant** (`task.read:assigned`, `task.read:shared_queue`…), nên hiện ra trong Role Manager. Quan hệ vẫn là dữ kiện mà policy tính cho từng bản ghi. Luật "vắng mặt thì thấy nhiều hơn" bị thay bằng grant `shared_queue` tường minh. Từ vựng và cách mã hoá ở §9.2.

### 5.3 Định danh cho dữ liệu hoa hồng

Registration và dashboard hiện dùng **tên hiển thị** làm khoá định danh agent. `portal_account` đã có `agent_id` duy nhất (`schema.sql:35-39`) nhưng chỉ dùng để hiển thị (`TopBar.tsx:49`). Dữ liệu mart lấy tên agent từ file carrier, nên không bỏ tên được hoàn toàn; cần một **bảng ánh xạ tường minh** `account → tên agent trong dữ liệu carrier` do admin quản, và tên hiển thị trở thành thuần trang trí (Phase A6 giảm nhẹ, D7 sửa gốc; Q4).

---

## 6. Định tuyến thông tin & thông báo

### 6.1 Hiện trạng **[code]**

| Sự kiện | Người nhận | Căn cứ | Nơi định nghĩa |
|---|---|---|---|
| `task_created` | mọi người có `task.manage` | permission (không xét tên role, **khác** định nghĩa manager) | `api/tasks/route.ts:413`, `fetchTaskManagerEmails` |
| `backlog_attention` (urgent/high chưa giao) | assistant của agent + **legacy admin** | quan hệ + cột legacy | `api/tasks/route.ts:393-402` |
| `assigned` / `unassigned` | người được giao/bỏ giao | quan hệ | `api/tasks/[id]/route.ts:503-518`, `assignees/**`, `assign` |
| `qc_needed` (task) | assistant của agent (agent thôi nhận từ 16/09) | quan hệ + quyết định đội ghi trong comment | `api/tasks/[id]/route.ts:520-538` |
| `qc_reviewed`, `cancelled` | assignee + reporter | quan hệ | `api/tasks/[id]/route.ts:539-552` |
| `commented` / `mentioned` | assignee + participant + reporter, lọc qua danh sách người có `task.work`/`task.manage` | quan hệ ∩ permission | `api/tasks/[id]/comments/route.ts:195-225`, `tasks/notifications.ts:52-87` |
| attachment | assignee + reporter + assistant | quan hệ | `api/tasks/[id]/attachments/route.ts:336-349` |
| SLA overdue (cron) | assignee; + assistant + **legacy admin** nếu urgent/high | quan hệ + cột legacy + priority | `api/cron/check-overdue/route.ts:279-290` |
| Due Date overdue (cron) | assignee + agent + assistant + **legacy admin** | quan hệ + cột legacy | `api/cron/check-overdue/route.ts:479-492` |
| overdue unlock | assistant + **legacy admin** | | `api/tasks/[id]/overdue-unlock/route.ts:158-159` |
| Enrollment `assigned`/`reopened`/`qc_reviewed`/`stage_changed` | caller + responsible | quan hệ; `stage_changed` chỉ khi **nhãn** stage thuộc `KEY_STAGE_NOTIFICATIONS` | `api/enrollment/[id]/route.ts:86, 510-590` |
| Enrollment `qc_needed` | caller + responsible + **legacy admin** | trong khi người *được* QC là manager hoặc agent-owner/assistant (`enrollment/access.ts:85`) | `api/enrollment/route.ts:340-365`, `[id]/route.ts:524-545` |
| Enrollment due (cron) | người phụ trách + **legacy admin** | | `api/cron/check-enrollment-due/route.ts:168-171` |
| Time off `submitted` | manager người nộp chọn + mọi người có `timeoff.admin` | permission — **sạch nhất hệ thống** | `time-off/notifications.ts:64-76` |
| Lead | không có thông báo (chỉ cảnh báo trong trang) | — | — |

### 6.2 Vấn đề

1. **Ba căn cứ cho "người giám sát":** cột legacy (3 người), `task.manage` (8 người), quan hệ assistant. Cùng một loại sự kiện "cần người có thẩm quyền xử lý" lại đi tới ba nhóm khác nhau tuỳ route.
2. **Người nhận ≠ người xử lý được.** Enrollment `qc_needed` đi tới legacy admin, nhưng 5 task admin — những người thật sự QC được — không nhận.
3. **Không lọc theo quyền xem tại lúc gửi.** Người nhận không được kiểm `canView(resource)`; thông báo cũ vẫn hiển thị tiêu đề task sau khi người đó mất quyền.
4. **Nội dung push chứa tên khách hàng.** `lib/notifications/push-dispatch.ts:145-201` đưa tiêu đề task / tên client enrollment vào payload Web Push → đi qua dịch vụ push của Google/Apple và hiện trên màn hình khoá (Q8).
5. Quyết định nghiệp vụ về người nhận (vd 16/09 "agent thôi nhận") chỉ sống trong comment code.

### 6.3 Mô hình thông báo đích (đã nhập khuyến nghị Codex)

Bản 1 đề xuất *không* có grant nhận thông báo. Codex đề xuất grant theo từng sự kiện (`task.created.receive`…) kèm một cổng cuối `canReceive`. Hợp nhất lại như sau:

1. **Ứng viên** lấy từ hai nguồn:
   - **Quan hệ**, cho sự kiện trên bản ghi: assignee, reporter, participant, owner, delegate, caller, responsible, người được @. Không cần grant.
   - **Grant nhận thông báo giám sát** — *chỉ* cho những nhóm hiện đang lệch nhau: `notify.task.created`, `notify.task.escalation` (backlog khẩn, SLA/Due Date leo thang, overdue unlock), `notify.enrollment.qc`, `notify.enrollment.escalation`, `notify.timeoff.submitted`. Đây là thứ thay cho `fetchAdminEmails` (legacy) và `fetchTaskManagerEmails`. Không tạo grant cho từng loại sự kiện quan hệ: làm vậy chỉ thêm cấu hình mà không thêm thông tin.
2. **Cổng cuối** `canReceive(principal, event, resource, payloadClass)`: account còn active **và** (xem được bản ghi **hoặc** có quyền "chỉ nhận tin" với payload rút gọn). Loại actor ra, khử trùng.
3. **Kiểm lại lúc đọc và lúc gửi:** API chuông kiểm lại active + quyền xem trước khi trả nội dung; push dispatcher kiểm lại trước khi gửi. Thông báo cũ sau khi mất quyền thì hiện dạng rút gọn hay ẩn đi — quyết định ở Q16.
4. **Payload class:** `full` (tiêu đề task, tên khách) hoặc `minimal` ("Bạn có một cập nhật"). Push nên mặc định `minimal` nếu nghiệp vụ không muốn tên khách hiện trên màn hình khoá (Q8).
5. Ghi **lý do nhận** cùng dòng thông báo, để audit được vì sao người này nhận.
6. **Outbox bền** (ghi sự kiện trong cùng transaction, gửi lại khi lỗi): Codex đề xuất vì thông báo hiện được ghi sau khi commit, lỗi là mất. Đây là việc về độ tin cậy, không phải phân quyền — để tuỳ chọn, không chặn lộ trình.
7. Tuỳ chọn tắt/bật của người dùng (`notification_preferences`) là **preference**, xét sau `canReceive`, không phải RBAC.
8. **Thứ tự thực thi cho push (C4):** chọn ứng viên → `canReceive` **cho từng người tại thời điểm gửi** → chọn `full`/`minimal` theo từng người → rồi mới nhóm theo *payload class + nội dung* và gọi `sendPushToEmails`. Hiện `push-dispatch.ts:107-125` nhóm nhiều email trước, rồi `push-server.ts:120-150` gửi **cùng một payload** cho cả nhóm. Chỉ chèn `canReceive` sau bước nhóm mà không tách payload thì người chỉ được tin rút gọn vẫn nhận tên khách. Chuông áp cùng luật lúc đọc; lưu reason/payload class trong dòng thông báo, hoặc tính lại một cách xác định.

---

## 7. Agent / Assistant

### 7.1 "Agent" đang mang 6 nghĩa **[code]**

| # | Nghĩa | Lưu ở | Dùng cho |
|---|---|---|---|
| 1 | "Không phải admin" | `portal_account.role = 'agent'` | Legacy, gần như vô nghĩa |
| 2 | Gói quyền mặc định | RBAC role tên **"Agent"** | Account mới; *(snapshot 04/09: 1 account)* |
| 3 | Chức danh sales | RBAC role **"Health Agent"**, "P&C Agent" | Gói quyền registration + dashboard + task.work |
| 4 | **Chủ sổ khách** trong CS | `task_agents` | Thu hẹp scope; được làm agent của task/enrollment/lead; quyền chủ. *Gồm cả admin* (bao.vo, nam, khang… *snapshot 04/09 §8.1*) |
| 5 | Định danh trong dữ liệu hoa hồng | tên hiển thị ↔ `selected_agent`, `mart.agent` | Scope dashboard/registration |
| 6 | Mã agent ngoài | `portal_account.agent_id` | Chỉ hiển thị |

Nghĩa 3 và 4 **không trùng**: admin cũng có thể là chủ sổ khách; một Health Agent chưa được khai trong `task_agents` sẽ bị coi là "CS thường" và thấy toàn bộ task (S2).

### 7.2 Assistant

`agent_members(agent_email, cs_email, is_assistant=true)` — cs_email được **uỷ quyền** hành động như agent trên sổ khách của agent đó (task: sửa nội dung, assign, xoá, QC, reopen; enrollment: như owner; lead: xem/sửa/log). Nguồn: `tasks/membership.ts:122-136`, `tasks/access.ts:125-190`, `enrollment/access.ts:76-91`, `leads/membership.ts:22-40`. RPC `create_agent_membership_atomic` (`schema.sql:3529-3625`) đã có kiểm hợp lệ tốt: agent phải trong roster, không tự uỷ quyền, chống vòng.

### 7.3 Phân loại

| Khái niệm | Là gì | Vì sao **không** là role | Nên sống ở đâu |
|---|---|---|---|
| Agent (chủ sổ khách) | **Thuộc tính / quan hệ sở hữu dữ liệu** | Trực giao với chức danh (admin cũng là agent); là sự thật về dữ liệu, không phải gói quyền | "Agent roster" gắn với account, quản ở **Account Manager** (chi tiết account), có audit log |
| Assistant | **Uỷ quyền có tham số** (assistant → *agent cụ thể*) | Role không mang tham số "của ai"; 1 người có thể assist nhiều agent | Bảng delegation, quản cùng chỗ với roster |
| CS thường | **Không phải khái niệm** — chỉ là "worker không có sổ khách" | — | Biến mất; ai thấy hàng đợi chung là do grant `task.read:shared_queue` |
| Agent định danh hoa hồng | **Ánh xạ định danh** | — | Bảng mapping account ↔ tên agent trong dữ liệu carrier |
| Chức danh (Health Agent…) | **Role** | Đây đúng là gói quyền | RBAC (giữ nguyên) |

**RBAC quyết định gì với owner/delegate?** (bản 2) `agent_owned` và `assistant_for_agent` là **scope của grant**: role quyết định quan hệ chủ/uỷ quyền mang lại những action nào, còn quan hệ quyết định áp lên bản ghi nào. Grant tương thích cấp những scope này cho mọi role đang có `task.work`/`lead.work`, nên hành vi không đổi.

**Vấn đề quản trị hiện tại:** roster và delegation đang sửa trong **Table Configuration** (`/config`, `api/config/agents`, `api/config/assistants`), gác bởi task-admin, **không có audit log** — trong khi đây là thay đổi quyền truy cập dữ liệu khách hàng. Khác với role (trễ tới 5 phút theo JWT), thay đổi quan hệ có hiệu lực **ngay** vì được đọc ở mỗi request — điểm tốt, nên giữ.

**Eligibility chỉ được lọc ở UI [code]** (từ Codex, đã xác minh). Picker Assistant chỉ đưa ra người có `task.work`/`task.manage` (`ConfigClient.tsx:2548-2560`). Nhưng RPC `create_agent_membership_atomic` chỉ kiểm account còn active (`schema.sql:3529-3625`), và `POST /api/config/agents` thêm được **bất kỳ** account active nào vào roster (`api/config/agents/route.ts:29-55`). Gọi thẳng API là tạo được assistant/agent không có quyền task. Người đó chưa làm gì được với task, nhưng quan hệ này đã ảnh hưởng tới người nhận thông báo và phạm vi lead. Luật eligibility phải đặt ở server/DB (Phase G, Q15).

Codex cũng chỉ ra: **roster lead** (`lead_assignment_weights`) và **hàng đợi giao task** (`task_assignment_queue_members`) là dữ liệu vận hành cùng loại. RBAC cấp *điều kiện được vào* roster và *quyền quản lý* roster; còn roster quyết định *việc cụ thể* ai nhận.

---

## 8. Độ phức tạp khi dựng một role mới

### 8.1 Hôm nay — ví dụ: thêm role "Senior CS" làm được việc task admin

1. Role Manager: tạo role, tick permission. `task.manage` **chưa đủ**.
2. Để thành task manager: đặt tên role **đúng chuỗi** "Task Admin"/"Admin Health Task", **hoặc** sửa `TASK_ADMIN_ROLE_NAMES` và deploy.
3. Muốn quản lead mà không có `lead.manage`: không được — trừ khi tên role là "Super Admin" (override).
4. Nếu người trong role là agent: vào `/config` → Agents thêm từng người.
5. Nếu là assistant: `/config` → Assistants, từng cặp.
6. Nếu là CS thường nên thấy hàng đợi chung: **không làm gì** — và nếu quên bước 4/5 cho một agent thì agent đó cũng thấy toàn bộ.
7. Muốn nằm trong pool workload Overview: phải có `task.work`, **không** được là admin (theo tên role), và bật trong queue members.
8. Muốn nhận thông báo giám sát (backlog attention, overdue unlock, QC enrollment, Due Date): phải là **legacy admin** — tức phải là role "Admin" đầy đủ. Không có cách cho role tuỳ chỉnh.
9. Muốn xem dashboard hoa hồng của chính mình: tên hiển thị phải khớp chính xác tên trong dữ liệu carrier.
10. Không thể gộp "Health Agent" + "Senior CS" cho một người (1 role/account) → phải tạo role tổ hợp mới → bùng nổ role.
11. Nếu ai đó chạy lại `schema.sql`: quyền của role `Admin` và `Agent` bị đặt lại.
12. Đợi tối đa 5 phút hoặc đăng nhập lại.

### 8.2 Đích

```
Tạo role → chọn grant action × scope → gán role cho account
→ (nếu là agent/assistant) bật trong chi tiết account → xong. Không deploy, không phụ thuộc tên.
```

Tạo một **loại** action, scope hay sự kiện **mới** vẫn cần code policy + deploy — Role Manager không phát minh logic (Codex). Những thứ **không nên** ép vào luồng role: ai assist ai (quan hệ), ai được giao bản ghi nào (nghiệp vụ), ánh xạ định danh hoa hồng (dữ liệu), tuỳ chọn nhận thông báo (preference), tài khoản break-glass (hệ thống).

---

## 9. Kiến trúc đích

> **Bản 3 (sau review `[sol5.5]`)** sửa ba lỗi của bản 2: gộp `reported` với `participating` (nới quyền sửa), giả định `can()` hiểu scope, và đổi khoá chính `role_permissions` tại chỗ. Xem §17.
>
> **Bản 2 đổi thiết kế so với bản 1.** Bản 1 đề xuất permission phẳng `<domain>.view_all` + phạm vi quan hệ nằm ngầm trong code. Bản 2 dùng mô hình **grant có kiểu `{action, scope}`** của Codex. Lý do: mục tiêu của đề bài là RBAC thành nguồn sự thật chính. Với grant có kiểu, Role Manager *nhìn thấy* được phạm vi dữ liệu của từng role; ở bản 1, phạm vi vẫn nằm ngầm trong code.

### 9.1 Thành phần

| Thành phần | Định nghĩa | Ghi chú |
|---|---|---|
| **Principal** | `{accountId, active, sessionVersion, grantVersion, roleIds, grants}`; email chỉ còn để tra dữ liệu cũ | Theo Codex. Khoá theo `portal_account.id` cho cả credentials lẫn Google — sửa S20 |
| **Action registry** | Danh mục action code biết (`src/lib/authz/catalog.ts`); mỗi action khai **các scope được phép** | Action mới cần policy + deploy. Role Manager chỉ *ghép* action có sẵn, không phát minh action |
| **Grant** | `{action, scope}` gắn vào role | Theo Codex. Thay cho permission phẳng |
| **Dữ kiện quan hệ** | roster agent, delegation assistant, cột quan hệ trên bản ghi, ánh xạ định danh hoa hồng | Đầu vào của policy, không phải grant |
| **Policy** | `authorize`, `scopeQuery`, `projectCapabilities`, `canReceive` — hàm thuần, trả quyết định có lý do | §9.4 |
| **Persona label** | Một hàm hiển thị duy nhất | Cấm dùng để phân quyền |

### 9.2 Từ vựng scope — lấy từ ngữ nghĩa đang có

Không tạo team/department vì không có dữ liệu nào nuôi. Không tạo `tenant` vì hệ đang single-tenant; chỉ thêm nếu có kế hoạch nhiều tổ chức (Q18).

Scope là **quan hệ logic**; mỗi resource ánh xạ sang cột của nó (C5 — Lead không có `agent_email`; C8 — người được @mention chỉ được xem, không được sửa):

| Scope logic | Task | Enrollment | Lead | Registration | Time off |
|---|---|---|---|---|---|
| `own` | — | — | — | `agent_email = tôi` hoặc `selected_agent` ∈ định danh hoa hồng của tôi | `requester_id = tôi` |
| `assigned` | tôi ∈ `task_assignees` / `assignee_email` | `caller_email` hoặc `responsible_enroll_email` = tôi | `assigned_to_email = tôi` | — | — |
| `reported` | `reporter_email = tôi` | `created_by_email = tôi` | — | — | — |
| `participating` | tôi ∈ `task_participants` (@mention) | — (mention không cấp quyền xem ở Enrollment) | — | — | — |
| `agent_owned` | `agent_email = tôi` và tôi ∈ `task_agents` | như Task | — (lead dùng `assigned`) | — | — |
| `assistant_for_agent` | `agent_email` ∈ agent tôi được uỷ quyền | như Task | `assigned_to_email` ∈ agent tôi được uỷ quyền (`leads/membership.ts:22-29`) | — | — |
| `shared_queue` | hàng đợi chung (compat, §9.3 luật 2) | như Task | — | — | — |
| `all` | tất cả | tất cả | tất cả | tất cả | tất cả |

`shared_queue` được giữ tách khỏi `all` để không vô tình mở các view chỉ dành cho manager (Backlog — `tasks/access.ts:57-60`; Overview).

**Mã hoá (bản 3, sửa theo C6/C7/C17):**
- Grant lưu ở **bảng mới** `role_grants(role_id, action, scope)`. **Không** đổi khoá chính `role_permissions`: `replace_role_permissions` xoá sạch hàng của role rồi chèn key phẳng (`schema.sql:111-128`), nên đổi PK tại chỗ thì một lần sửa qua UI cũ sẽ xoá luôn grant có scope.
- Dual-write có nguồn rõ ràng. Phase B–C: `role_permissions` là nguồn; trigger sinh lại `role_grants` tương thích cho đúng role vừa sửa, trong cùng transaction. Từ cuối Phase C: `role_grants` là nguồn, key phẳng thành bản chiếu tới Phase H. Rollback adapter không đụng `role_grants`.
- API mới `hasGrant(principal, action, scope?)`. `can()` **giữ nguyên** nghĩa so khớp chính xác (`src/lib/rbac/client.ts:1-14`), nên không tự hiểu `task.read:assigned` — bản 2 ghi sai điểm này.
- Grant chỉ vào JWT nếu cookie phiên ≤ 3.500 byte với role lớn nhất + role tổ hợp giả lập (đo ở A0/B). Vượt thì nạp grant ở server theo `(accountId, access_version)`.

### 9.3 Danh mục action ban đầu và grant tương thích

Nguyên tắc (Codex):
- **Quyền đọc không bao giờ ngầm kéo theo quyền ghi.**
- Chỉ tách action ở những chỗ luật *đang* khác nhau.
- Mỗi grant mới lúc đầu chỉ cấp cho đúng những người đang có hành vi đó (grant tương thích). Muốn sửa thì sửa sau, có chủ đích.

| Domain | Action (scope được phép) | Grant tương thích sinh từ key hiện tại |
|---|---|---|
| Task | `task.read` (assigned, reported, participating, agent_owned, assistant_for_agent, shared_queue, all) · `task.create` (agent_owned, assistant_for_agent, all) · `task.content.update` (reported, agent_owned, assistant_for_agent, all) — **không** có `participating` · `task.due_date.update` (như `task.read`) · `task.status.update` — gồm reopen, overdue unlock (assigned, agent_owned, assistant_for_agent, all) · `task.assign`, `task.delete`, `task.qc_review` (agent_owned, assistant_for_agent, all) · `task.activity.read` (agent_owned, assistant_for_agent, all) · `task.backlog.read`, `task.overview.read` (all) · `task.config.manage` · `task.export` | `task.work` → mọi action ở scope quan hệ, cộng `task.read:shared_queue` và `task.due_date.update:shared_queue` (kèm luật tương thích 2). `task.manage` **và** tên role task-admin → mọi action `:all`, cộng backlog, overview, config. `task.export` giữ. `task.import` **không** phải action của Task (không có route import task) — map sang `enrollment.import` + `provider.import` (C9) |
| Enrollment | `enrollment.read`, `.create`, `.content.update`, `.fields.update`, `.stage.update`, `.qc_review`, `.people.assign`, `.archive`, `.agent.transfer`, `.options.manage`, `.overview.read`, `.export`, `.import` | Cấp **đúng chỗ** đang có `task.*` — Enrollment hiện mượn quyền Task (Q3). `enrollment.import` chỉ được gọi là "tương thích" khi import đã áp scope + audit từng dòng; trước đó chỉ task admin (Phase A, A8) |
| Lead | `lead.read`, `lead.update`, `lead.interaction.log` (assigned, assistant_for_agent, all) · `lead.assign`, `lead.import`, `lead.distribute`, `lead.settings.manage`, `lead.config.manage`, `lead.overview.read` | `lead.work` → các scope quan hệ; `lead.manage` → `:all` cộng các quyền quản trị. Override admin theo tên được thay bằng grant tương thích cấp cho đúng những account đó (nếu còn) |
| Registration | `registration.health.read`, `registration.health.update` (own, all) · tương tự cho `.pc` | `customer_registration.*` → `:own`. `company.view_all` → `read:all` **và** `update:all` (giữ hành vi hiện tại; S16 quyết riêng) |
| Dashboard | `dashboard.health.agent.read` (own, all) · `dashboard.health.company.read` · tương tự cho `pc` · `dashboard.defaults.manage` (agent, company) | `agent_dashboard.*` → `:own`; `company.view_all` → `:all`. Quyền sửa default theo đúng luật `api/dashboard-filter-defaults/route.ts:133-149` |
| Automation / Provider | `automation.health_statement.run`, `automation.pc_statement.run` · `provider.read`, `provider.update`, `provider.export`, `provider.import` | Sinh từ `automation.*`, `task.export`, `task.import` (export/import provider hiện đang ăn theo quyền **task**) |
| Time off | `timeoff.request.create` (own) · `timeoff.read` (own, all) · `timeoff.review` · `timeoff.balance.manage` · `timeoff.holiday.manage` · `timeoff.accrual.manage` | `timeoff.user` → own; `timeoff.admin` → tất cả action quản trị |
| Org | `org.agent_roster.manage` · `org.assistant_delegation.manage` | Cấp cho những ai đang qua `loadConfigAdmin` |
| Management | `role.read` · `role.manage` · `role.grant` (có trần) · `account.manage` · `account.role.assign` (có trần) | Sinh từ `management.role_manager`, `management.account_manager` |
| Thông báo giám sát | `notify.task.created` · `notify.task.escalation` · `notify.enrollment.qc` · `notify.enrollment.escalation` · `notify.timeoff.submitted` | Người giữ `task.manage` → `notify.task.created`. **Legacy admin** → hai `escalation` và `notify.enrollment.qc`. `timeoff.admin` → `notify.timeoff.submitted` |
| Settings | `settings.access` | Giữ nguyên |

**Luật tương thích bắt buộc** (Codex: "encode existing cohorts first"). Những nhóm dưới đây được giữ nguyên bằng policy có *tên và có test* cho tới khi có quyết định sửa. Chúng không được biến mất như một tác dụng phụ của việc gỡ `if (role)`.
1. Task-admin theo tên role (`Admin Health Task`, `Task Admin`) → thay bằng grant `:all` cấp cho chính role đó.
2. `shared_queue` **không áp dụng** cho principal có mặt trong roster hoặc có delegation (đúng luật ở `tasks/membership.ts:113-114` và enrollment `scope.ts:58`). Luật này hơi ngược: assistant thấy *ít* hơn CS thường. Nhưng đó là quyết định ngày 02/08, nên giữ cho tới khi trả lời Q2. Đây là **compat tạm thời** (C3): A0 đo số account/bản ghi bị ảnh hưởng; điều kiện gỡ là câu trả lời Q2; đích là `shared_queue` hiệu lực độc lập, hoặc membership hàng đợi tường minh — không để phạm vi phụ thuộc vào *sự vắng mặt* của một quan hệ.
3. Legacy admin quản lead mà không cần `lead.manage`.
4. Registration/dashboard lọc theo tên hiển thị, cho tới khi có ánh xạ định danh (Phase D7).
5. Người nhận thông báo như hiện tại (§6.1).

### 9.4 API policy

```ts
authorize(principal, "task.assign", { task, facts })
// → { allowed, matchedGrant: "task.assign:assistant_for_agent", scope, reason, policyVersion }

scopeQuery(principal, "task.read")
// → predicate + join cần thiết; CÙNG ngữ nghĩa với authorize trên một bản ghi

projectModuleCapabilities(principal)
// → quyền mở module/page/nav; không chứa dữ liệu bản ghi

capabilitiesFor(principal, resource)
// → capability trên TỪNG bản ghi (như resolveTaskCapabilities hiện nay)

canReceive(principal, event, resource, payloadClass)
// → { allowed, payloadClass, reason }
```

- **Mặc định từ chối** khi: action lạ, thiếu grant, principal không active, không giải được quan hệ (giữ khuôn fail-closed ở `tasks/membership.ts:64-83`), hoặc policy lỗi.
- **Luật có tên** cho: trạng thái bản ghi (Done/Cancel, archived), tự hành động, role được bảo vệ, và admin khôi phục cuối cùng.
- `scopeQuery` sinh predicate **trước** khi phân trang, đếm, export, dựng ngữ cảnh AI hay tổng hợp dashboard. Lọc sau khi truy vấn chỉ là lớp phòng thủ bổ sung.
- Với ID trực tiếp: nạp dữ kiện tối thiểu, quyết định, rồi mới nạp payload. Ngoài scope thì trả 404, như `enrollment/scope.ts:149-172`.
- **Capability hai mức (C11):** một tài liệu toàn cục không trả lời được "assign được task A nhưng không được task B". Nav/page dùng `projectModuleCapabilities`; từng dòng dùng `capabilitiesFor`. API luôn kiểm lại khi người dùng bấm.
- **Điểm thi hành trong transaction (C10):** policy thì thuần, nhưng tải quan hệ và ghi là I/O. "Nạp dữ kiện → authorize → ghi bằng service role" có cửa sổ để assignee/agent/trạng thái/grant đổi giữa hai bước. Thao tác nhạy cảm (assign, xoá/archive, đổi `agent_email`, import, mutation role/account) phải kiểm lại trong RPC: `UPDATE … WHERE` kèm version/quan hệ, hoặc lock rồi kiểm lại. `patch_task_atomic` hiện có `for update` + `expected_updated_at` nhưng không kiểm lại quyền; route assign còn cố ý truyền `p_expected_updated_at = null`.

### 9.5 Ví dụ policy — Task

| Action | Luật đích | Khác hiện tại? |
|---|---|---|
| read | Có grant `task.read` ở scope khớp quan hệ của bản ghi | Không |
| content.update | `task.content.update` ở `reported`, `agent_owned`, `assistant_for_agent` hoặc `all` — người được @mention **không** sửa được | Không (bản 2 ghi `participating` là nới quyền — đã sửa) |
| due_date.update | Như read | Không |
| status.update / reopen / overdue_unlock | `task.status.update` ở `assigned`, `agent_owned`, `assistant_for_agent` hoặc `all` | Không |
| assign / delete / qc_review | Scope `agent_owned`, `assistant_for_agent` hoặc `all` | Không |
| activity.read | Như trên | Không (chỉ chuyển luật từ route vào policy — F6) |
| create | `task.create` ở scope khớp **và** `agent_email ∈ roster` | **Có** — sửa S5 |
| đổi `agent_email` | `content.update` **và** agent mới ∈ roster **và** agent mới thuộc scope `create` của mình | **Có** — chặn reporter tự đặt mình làm agent |
| backlog / overview / config | Có grant tương ứng | Overview: **có** — thêm yêu cầu grant (F2, S8) |

### 9.6 Bố cục module

```
src/lib/authz/
  catalog.ts        action + scope hợp lệ; sinh seed SQL insert-only
  principal.ts      loadPrincipal() theo accountId, cache theo request
  versions.ts       sessionVersion / grantVersion (§9.8)
  guards.ts         requirePage / withApiAuthz → 401 / 403 / 404 thống nhất
  holders.ts        "ai nắm grant X" — MỘT bản duy nhất, lọc account + role inactive
  relationships.ts  roster, delegation, ánh xạ định danh hoa hồng — fail-closed
  policies/         task, enrollment, lead, registration, dashboard, timeoff, provider, org, admin
  compat/           các luật tương thích ở §9.3 — mỗi luật một file, có test, có ngày dự kiến gỡ
  scope.ts          mọi predicate theo scope
  recipients.ts     ứng viên nhận thông báo + canReceive
  decision-log.ts   shadow log {action, resourceIdHash, decision, reason, policyVersion} — không chứa PII
  persona.ts        nhãn hiển thị
```

Các resolver hiện có (`resolveTaskCapabilities`, `resolveEnrollmentCapabilities`, `resolveLeadCapabilities`) được dời vào `policies/` gần như nguyên văn, vì chúng đã đúng hình dạng cần có.

### 9.7 Admin và chống leo quyền

- Role được bảo vệ và role mặc định: đánh dấu bằng metadata bất biến (`roles.system_key`) **cộng** ràng buộc DB; UI đọc cùng metadata đó.
- **Trần uỷ quyền** cho `role.grant` và `account.role.assign`:
  - chỉ cấp được grant mà chính mình đang có;
  - không sửa được role mình đang giữ;
  - chỉ gán được role có tập grant ⊆ grant của mình.

  Ba luật này chặn S4. Bản 3 (C12): so **grant hiệu lực trước/sau** — gồm scope, trạng thái role, role protected — trong cùng transaction với việc ghi, vì người thao tác có thể có quyền qua nhiều role/scope, hoặc đang sửa role gắn cho người khác. `system_key` chỉ đổi qua migration. Ai duyệt việc cấp `:all` và quyền quản trị nhạy cảm, và "break-glass" là gì: Q5.
- Chặn xoá role còn người dùng (S19).
- **RPC nguyên tử** cho các thao tác: tạo role kèm grant, gán role, đổi email, khoá account, và bất biến admin cuối. Mỗi RPC khoá bản ghi (`select … for update` hoặc advisory lock), tăng version, ghi `access_audit` và dùng optimistic versioning.
- Bất biến admin khôi phục: đếm account **active** + role **active** + grant hiệu lực, trong cùng transaction, có khoá. Không đồng nhất cặp permission này với tài khoản break-glass khi Q5 chưa chốt.

### 9.8 Cache và thu hồi quyền

Codex yêu cầu không để cửa sổ 5 phút cho việc khoá account và thay đổi quyền đặc quyền, và kiểm version ở mỗi request. Repo này có một ràng buộc riêng: middleware/auth từng là điểm nóng CPU — 31% Active CPU (`docs/2026-08-21-vercel-cpu-cost-report.md`) và 451 ms mỗi lần làm mới quyền trong middleware (`src/auth.config.ts:9-17`). Vì vậy đề xuất chia theo tầng:

| Tầng | Khi nào | Cách làm |
|---|---|---|
| 1 | Route đọc | JWT mang `accountId` + `accessVersion`. So với `portal_account.access_version` qua cache **chỉ chứa số version**, khoá accountId, TTL 30 s/instance. Đây là **SLA thu hồi ≤ 30 s** cho route đọc. Cache không chứa quyền nên không có chuyện quyền người này rò sang người khác (mối lo ở `src/auth.ts:29-33`). Test trên ≥ 2 cache độc lập |
| 2 | Route ghi, `/api/admin/*`, đọc chuông, gửi push | Đọc tươi `active` + version từ DB |
| 3 | Khi version đổi | Làm mới grant trong JWT ngay ở lần kế tiếp, thay cho TTL cố định 5 phút |

**Sửa grant của một role (C13):** tăng `access_version` của **mọi thành viên** role đó trong cùng transaction — tăng version của riêng người sửa không thu hồi được JWT của thành viên. Khi khoá account, đổi role hay đổi email: tăng version của account, đồng thời xoá `push_subscriptions` của account bị khoá. Chi phí thật phải đo trước khi chốt (Q10).

---

## 10. Nguồn sự thật duy nhất

```
catalog.ts (code: action + scope hợp lệ) ──sinh──► permissions (DB, chỉ là bản chiếu, insert-only)
                                   │
roles + role_permissions(action, scope) + user_roles      ← Role/Account Manager (RPC nguyên tử, audit, version)
                                   │
            loadPrincipal(accountId)  +  kiểm version (§9.8)
                                   │
roster + delegation + cột quan hệ + ánh xạ định danh      ← chi tiết account / thao tác nghiệp vụ (audit)
                                   │
                    relationships.ts  (mỗi request, fail-closed)
                                   │
            policies/* + compat/*  (thuần, có ma trận test, trả kèm lý do)
     ┌──────────────┬──────────┴──────────┬─────────────────┬────────────────┬──────────────┐
 API guards      scopeQuery          projectCapabilities   canReceive       decision-log
 (quyết định     (predicate trước     → UI chỉ render      (ứng viên ∩      (shadow, không PII)
  cuối cùng)      phân trang/đếm)                            active ∩ view)
```

| Câu hỏi | Nguồn duy nhất |
|---|---|
| Ai đang gọi? | `portal_account.id` + version (không phải email) |
| Được làm loại việc gì, ở phạm vi nào? | Grant `{action, scope}` qua role |
| Bản ghi này có nằm trong phạm vi đó không? | Policy tính từ quan hệ |
| X có phải agent / assistant của Y? | Roster / delegation |
| Ai nhận thông báo? | `recipients.ts` → `canReceive` |
| Dòng hoa hồng nào là của tôi? | Bảng ánh xạ định danh |
| Action nào tồn tại? | `catalog.ts` |

Sẽ bị loại bỏ:
- `portal_account.role` trong đường phân quyền;
- mọi phép so sánh tên role, cả trong TypeScript lẫn SQL;
- việc `schema.sql` đặt lại quyền;
- scope lọc theo tên hiển thị;
- persona tự suy ở client;
- email làm chủ thể phân quyền.

---

---

## 11. Lộ trình migration

**Nguồn duy nhất cho lộ trình: `docs/superpowers/plans/2026-09-26-authorization-final-plan.md`.** Bản 2 của mục này đã được thay thế. Plan final nhập đủ 22 comment `[sol5.5]`: giới hạn tải cho decision diff (C14), rollback bản vá bảo mật không mở lại lỗ (C15, C18), A6 cho JWT đang tồn tại (C16), dual-write khi Role Manager cũ còn ghi (C17), cổng persistence chạy ngay trên CI (C19), chặn S5/S6 ngay ở Phase A (C20).

| Phase | Mục tiêu | Exit gate (tóm tắt) |
|---|---|---|
| A | Bịt lỗ khẩn (S0, S18, S8, S17, S15/S27, giảm nhẹ S1, S5, S6) + baseline + cổng DB trên CI | RLS xác nhận khoá trên production; CI persistence xanh và đã chứng minh bắt lỗi |
| B | Principal theo id + `access_version`; lõi `src/lib/authz/`; `role_grants` + trigger tương thích; shadow thí điểm | Shadow 7 ngày không lệch; decision diff = 0; cookie trong budget |
| C | Quản trị role/account: `system_key`, RPC nguyên tử, trần uỷ quyền, audit; `schema.sql` thành full-state | Ma trận leo quyền + đồng thời admin cuối xanh trên CI DB |
| D | Data scope từng domain qua `scopeQuery`; PEP trong RPC; ánh xạ định danh hoa hồng | Tương đương list ⇔ authorize từng domain; flag 100% |
| E ∥ F | Capability hai mức cho UI; `canReceive` từng người, payload class, kiểm lại lúc đọc/gửi | Payload server-rendered đúng theo persona; replay 14 ngày không có người nhận ngoài scope |
| G | Roster/delegation/queue: quản lý + eligibility ở server/DB + audit | Gọi API trực tiếp không tạo được quan hệ sai |
| H | Gỡ legacy | CI chặn so tên role trong TS/SQL |

---

## 12. Chiến lược kiểm thử & cổng phát hành

Chi tiết ở plan final (D12, D14, D16 và các task A2–A10). Những thay đổi so với bản 2:
- **Cổng persistence không còn "bị chặn"** (C19): chạy trên Postgres dùng một lần trong GitHub Actions (Task A10). Việc này phát hiện luôn một lỗi migration: `schema.sql` chưa phải full-state — 8 bảng chỉ có trong rollout (S28).
- **Decision diff** (C14): chạy theo lô keyset, có `statement_timeout`, chỉ xuất ID đã băm + thống kê, kèm bộ ca biên cố định. Shadow runtime có sampling và budget truy vấn.
- **Registry gác route** (C2): ghi 3 mức — xác thực, quyền hành động, scope object. Chỉ phát hiện thiếu khai báo, không thay test gọi API trực tiếp (A2, A3 là ví dụ).
- Các cổng còn lại của bản 2 giữ nguyên: ma trận policy, tương đương truy vấn, biên API & payload, ma trận người nhận, vận hành.

---

## 13. Phát hiện bảo mật

| # | Mức | Phát hiện | Bằng chứng | Kịch bản | Khuyến nghị | Phase |
|---|---|---|---|---|---|---|
| **S0** | **Nghiêm trọng nếu mở** [code; prod?] | Bảng không bật RLS: `time_off_policies`, `time_off_balances`, `time_off_balance_adjustments`, `time_off_balance_adjustment_batches`, `time_off_holidays`, `time_off_requests`, `time_off_monthly_accrual_rules`, `time_off_notifications`, `push_subscriptions`, `notification_preferences`, `task_comment_edits` (và `zipcode_lookup` — dữ liệu tham chiếu, ít nhạy cảm). `enrollment_comment_edits` có trong danh sách bảo vệ nhưng `task_comment_edits` thì không | Danh sách `protected_tables` ở `schema.sql:6206-6260` không chứa chúng; không rollout nào bật RLS cho chúng (đã grep toàn bộ `supabase/`). Anon key: `src/lib/supabase-browser.ts:11` | Nếu `anon`/`authenticated` còn grant mặc định: dùng anon key gọi `GET /rest/v1/time_off_requests`, `push_subscriptions` (endpoint + khoá push), `task_comment_edits` (nội dung bình luận cũ — có thông tin khách hàng); có thể **ghi** số dư phép | Chạy truy vấn kiểm dưới bảng này; nếu mở: `alter table … enable row level security` + `revoke all … from anon, authenticated`, và thêm các bảng vào `protected_tables` | A1 |
| **S1** | **Cao** [code, chưa thử] | Scope Registration / Agent Dashboard / AI chat dựa vào **tên hiển thị** | `dashboard/health/page.tsx:65-71, 138-139`; `dashboard/pc/page.tsx:75-76`; `lib/agent-name.ts:12-24`; `api/entries/[id]/route.ts:44-54`; `api/pc-entries/[id]/route.ts:54, 99, 158`; `api/ai/dashboard-chat/route.ts:137-146`; `api/settings/profile/route.ts:10-43` | (a) Tài khoản credentials: vào Settings đổi tên thành tên một agent khác → đăng xuất/đăng nhập (JWT lấy `name` lúc đăng nhập) → thấy dashboard hoa hồng + **sửa/xoá** entry của agent đó. (b) Đăng nhập Google: tên trong session là tên hồ sơ Google (Auth.js mặc định, `jwt` callback không ghi đè) → tự đặt trong Google. (c) Tên hiển thị không có ràng buộc unique: ngày 31/07 từng có hai account active cùng tên "Ann Strambler" (`docs/superpowers/plans/2026-07-31-enrollment-ticket-ui-unification-plan.md:29`); snapshot 04/09 chỉ còn một [prod?]. Khi trùng tên, hai người thấy dữ liệu của nhau mà không ai làm gì sai | Bảng ánh xạ định danh; tên hiển thị thành trang trí | A6 giảm nhẹ; D7 sửa gốc |
| **S2** | Trung bình–Cao [code] | Phạm vi mặc định **mở** khi vắng mặt | `tasks/membership.ts:98-116`; `enrollment/scope.ts:58` | Tạo account Health Agent mới có `task.work`; trước khi ai đó nhớ thêm họ vào `/config → Agents`, họ đọc toàn bộ task + enrollment (dữ liệu khách hàng) | Grant `task.read:shared_queue` tường minh | D9 |
| **S3** | Trung bình [code] | Tên role là quyền | `tasks/access.ts:16-36`; `leads/access.ts:30-51`; `rbac/system-roles.ts`; `api/admin/roles/route.ts:58-107` (không kiểm tên) | Người có `role_manager` tạo role tên "Super Admin" (không trùng vì đã đổi thành "Admin" ở `schema.sql`) → thành viên được lead-manager override, bị tính là legacy admin, role bị khoá không sửa/xoá được. Đổi tên "Admin Health Task" → 5 manager mất quyền im lặng | `system_key` + permission | C, D1, D6 |
| **S4** | Trung bình [code] | Leo quyền qua Account/Role Manager | `api/admin/users/[id]/route.ts:365-384` (chỉ chặn tự **hạ**); `api/admin/roles/[id]/route.ts` (không chặn sửa role của chính mình) | Người chỉ có `account_manager` tự gán role Admin; người chỉ có `role_manager` thêm mọi permission vào role của mình | Luật tập con §9.5, hoặc ghi nhận chính thức "hai quyền này ≡ Admin" (Q5) | C |
| **S5** | Trung bình [code] | CS thường tạo task & tự làm agent-owner | `api/tasks/route.ts:147-164` (`isAgentOwnerOrAssistant(self, self)` = true; không kiểm roster); `api/tasks/[id]/route.ts:68-75` (reporter sửa được `agent_email`) | CS gọi thẳng API tạo task với `agent_email` = mình → assign/xoá/QC task đó; hoặc reporter đổi `agent_email` thành mình rồi tự QC. Đụng tới KPI overdue/QC mà đội dùng để đánh giá | Kiểm roster + books (§9.3) | D4 |
| **S6** | Trung bình (latent) [code] | Import enrollment bỏ qua scope, capability và audit | `api/enrollment/import/route.ts:99-108, 234-247` (`.update()` thẳng theo id, không qua `patch_enrollment_atomic`) | Ai được cấp `task.import` sửa được **mọi** bản ghi enrollment (kể cả `agent_email`, stage) không để lại activity/stage cycle. Hiện chỉ role Admin có quyền này (`rollouts/2026-09-21-task-import-permission.sql`) | Định nghĩa rõ `task.import` = quyền admin, hoặc áp scope + capability từng dòng (Q11) | D5 |
| **S7** | Trung bình (latent) [code] | API Lead chấp nhận admin theo tên/legacy không cần permission | `leads/access.ts:47-51` (chú thích sai); `api/leads/**` | Như S3 | Bỏ override | D6 |
| **S8** | Thấp–TB [code] | Overview workload gác bằng tên role, không permission | `api/tasks/overview/route.ts:13` | Như F2 | Gác bằng grant `task.overview.read` | A3 |
| **S9** | Thấp–TB [code] | Thu hồi quyền trễ tới 5 phút; không thu hồi phiên | `src/auth.ts:34, 157-173` | Khoá account/tước quyền: người đó còn dùng quyền cũ tới 5 phút | Đọc tươi cho khoá account + `/api/admin/*` (Q10) | B, §9.8 |
| **S10** | Thấp–TB [code] | `schema.sql` là nguồn cạnh tranh cho quyền của 2 role | `schema.sql:219-248, 293-321` | Chạy lại `schema.sql` (đúng quy trình đang dùng) → xoá mọi chỉnh sửa Role Manager trên role `Admin`/`Agent`; permission thêm qua rollout mà quên thêm vào danh sách cứng sẽ bị **xoá** kèm mọi grant (FK cascade) | Seed insert-only, sinh từ catalog | C |
| **S11** | Thấp [code] | Người nhận thông báo lệch người có quyền; không lọc canView; push chứa tên khách | §6.2 | Xem §6.2 | `recipients.ts` + `canReceive` (§6.3) | F |
| **S12** | Thấp [code] | Danh sách người nhận việc không lọc role đã tắt | `tasks/assignees.ts:63-92`; `leads/assignees.ts:16-58` | Người thuộc role bị tắt vẫn được giao task/lead nhưng không mở được | `holders.ts` | B (`holders.ts`) |
| **S13** | Thấp [prod?] | Tự tạo account Google + gán role "Agent" | `src/auth.ts:105-131` | Nếu `AUTH_GOOGLE_ALLOWED_DOMAIN` được đặt: mọi Google account thuộc domain tự có quyền registration, automation, dashboard, time off | Xác minh env; role mặc định tối thiểu (Q9) | C |
| **S14** | Thông tin [code] | @mention chia sẻ quyền xem | `tasks/access.ts:106-113` + participant | Worker cho agent đội khác xem task bằng cách nhắc tên | Ghi thành chính sách hoặc giới hạn (Q14) | D, Q21 |
| **S15** | Trung bình [code] | @mention trong Enrollment gửi thông báo tới **bất kỳ account active nào**, không kiểm quyền vào Enrollment hay scope bản ghi; người từng bình luận ("thread watchers") vẫn nhận dù đã ra khỏi scope | `api/enrollment/[id]/comments/route.ts:123-166` (chỉ lọc `is_active`) | Nhắc tên một người Accounting → họ nhận thông báo kèm tên khách hàng (chuông + push) trong khi mở bản ghi thì bị 404 | Người nhận ∩ canView; hoặc chặn mention ngoài scope | A4 |
| **S16** | Trung bình [code] | `company.view_all` ("xem dữ liệu mọi agent") đồng thời cho quyền **sửa và xoá** mọi entry Registration | `api/entries/[id]/route.ts:68-71` (`canManageAll = can(…COMPANY_VIEW_ALL)`), tương tự `api/pc-entries/[id]/route.ts` | Cấp "View All Agents" cho kế toán để xem → họ xoá được entry của bất kỳ agent nào | Tách `registration.*.read:all` và `registration.*.update:all` (§9.3) | D8 |
| **S17** | Thấp–TB [code] | Account đã khoá vẫn đọc chuông thông báo trong thời hạn JWT, và vẫn nhận **push** | Chuông chỉ kiểm email (`api/tasks/notifications/route.ts`); `push-server.ts:76-95` không lọc `is_active`; người nhận (vd assignee) không lọc account khoá | Khoá account một nhân viên nghỉ việc → điện thoại họ vẫn nhận push kèm tên khách tới khi subscription hết hạn | Lọc `is_active` ở `holders`/`recipients`; xoá `push_subscriptions` khi khoá account | A5 |
| **S18** | Thấp–TB [code] | `PATCH /api/admin/roles/[id]` với body rỗng không qua kiểm quyền nào mà vẫn trả **toàn bộ** danh mục role + permission + số người | `api/admin/roles/[id]/route.ts:44-135` — kiểm quyền chỉ nằm trong từng nhánh field | Người đã đăng nhập bất kỳ, biết một role UUID, đọc được cấu trúc phân quyền | Gác `management.role_manager` vô điều kiện đầu handler | A2 |
| **S19** | Thấp [code] | Ghi role/account không nguyên tử; xoá role **cascade** mất gán role của mọi người trong đó; `assignDefaultRoleToUser` nuốt lỗi | `api/admin/roles/[id]/route.ts` DELETE (không kiểm còn người dùng); `schema.sql:97-102` (`on delete cascade`); `rbac/access.ts:73-91` | Xoá nhầm một role → N người mất toàn bộ quyền, không cảnh báo | Chặn xoá role còn người; RPC nguyên tử | C |
| **S20** | Thấp (có điều kiện) [code] | JWT làm mới quyền theo **email**, không theo account id | `src/auth.ts:157-173`; `rbac/access.ts:56-71` | Đổi email account A rồi dùng lại email cũ cho account B trong lúc phiên của A còn hạn → phiên A nhận quyền của B | Gắn token với account id | B |
| **S21** | Thấp–TB [code] | Hàm SQL giao task lọc người theo tên role/cột legacy | `schema.sql:3679-3710` (`assign_unassigned_task`) | Có admin theo cột legacy mà không thuộc role Admin, hoặc role admin mang tên khác → lọt vào (hoặc bị loại khỏi) hàng đợi sai | Eligibility theo grant + queue members | G |
| **S22** | Thấp [code] | Người quản lý được chọn khi nộp đơn nghỉ nhận thông tin đơn dù không có quyền Time Off | `api/time-off/route.ts:245-266` (chỉ kiểm account active); `time-off/notifications.ts:64-76` | Có thể là chủ ý "báo tin", nhưng payload chưa được rút gọn | Quyết Q20; payload tối thiểu | F |
| **S23** | Thấp [code] | Topic realtime Lead công khai phát tới 25 UUID lead mỗi lần có thay đổi | `lib/leads/realtime.ts:30-49`; `LEADS_TOPIC = "leads-stream"` | Ai có anon key cũng nghe được nhịp thay đổi và ID lead (không kèm nội dung) | Chỉ phát ping, hoặc dùng topic riêng tư | F |
| **S24** | Thấp [code] | /config serialize cấu hình cột của mọi scope cho người chỉ quản Lead/Provider | `config/page.tsx:124-125` | Metadata cột Health/ACA/Medicare lộ cho người không quản các bảng đó | Chỉ nạp các scope được phép | E |
| **S25** | Thấp [code] | Eligibility agent/assistant chỉ lọc ở UI | §7.3 | Gọi thẳng API (cần quyền task-admin) để thêm người không có quyền task làm assistant/agent | Eligibility ở server/DB | G |
| **S26** | Thấp [code] | Chuông không kiểm lại quyền xem bản ghi khi đọc | `api/tasks/notifications/route.ts:19-23` (chỉ kiểm email) | Mất quyền rồi vẫn đọc được tiêu đề/tên khách trong thông báo cũ | Kiểm lại lúc đọc (§6.3) | F |
| **S27** | Thấp (có điều kiện) [code] | `task_created` gửi cho mọi người giữ `task.manage`, kể cả người không xem được task | `tasks/membership.ts:204-254`; `api/tasks/route.ts:413` | Agent/assistant được cấp `task.manage` qua role tuỳ chỉnh (không mang tên admin) nhận tiêu đề task ngoài scope. *Snapshot 04/09: chưa có ai như vậy* | Lọc ∩ canView | A4 |
| **S28** | Thấp–TB [code] | `schema.sql` chưa phải full-state: 8 bảng chỉ có trong rollout (`notification_preferences`, `provider_directory`, `push_subscriptions`, `sheet_sync_runs`, `sheet_sync_staging`, `time_off_balance_adjustment_batches`, `time_off_monthly_accrual_rules`, `time_off_notifications`). `datasync/schema.sql` là một nguồn DDL thứ hai cho `sheet_sync_*` | So `create table` giữa `supabase/schema.sql` và `supabase/rollouts/*.sql` (review C19) | DB dựng lại từ `schema.sql` thiếu bảng; vòng `protected_tables` bỏ qua chúng vì chưa tồn tại → dễ quên RLS (đúng nguyên nhân gốc của S0) | Gộp vào `schema.sql` trước vòng RLS | C (CI ở A10 áp tạm các rollout đó) |

Truy vấn kiểm S0 (read-only, chạy trong Supabase SQL editor):

```sql
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       g.role_name,
       has_table_privilege(g.role_name, c.oid, 'SELECT') as can_select,
       has_table_privilege(g.role_name, c.oid, 'INSERT') as can_insert,
       has_table_privilege(g.role_name, c.oid, 'UPDATE') as can_update,
       has_table_privilege(g.role_name, c.oid, 'DELETE') as can_delete
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('anon'), ('authenticated')) as g(role_name)
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relname in (
    'time_off_policies', 'time_off_balances', 'time_off_balance_adjustments',
    'time_off_balance_adjustment_batches', 'time_off_holidays', 'time_off_requests',
    'time_off_monthly_accrual_rules', 'time_off_notifications',
    'push_subscriptions', 'notification_preferences', 'task_comment_edits', 'zipcode_lookup'
  )
order by c.relname, g.role_name;
```

Dòng có `rls_enabled = false` **và** có quyền bảng chỉ chứng minh role DB *có thể* làm đúng loại thao tác được cấp (C21). Muốn kết luận "gọi được qua PostgREST" còn cần: `USAGE` trên schema `public`, schema được expose, và một request HEAD chỉ-đếm bằng anon key trả `200` (A0 Step 2). Báo cáo SELECT / INSERT / UPDATE / DELETE riêng — "có quyền" không có nghĩa là vừa đọc vừa ghi. S0 giữ ở mức **khẩn cấp xác minh** cho tới khi có kết quả trên DB live.

**Giới hạn điều tra (C22)** — đây không phải tuyên bố an toàn:
- **Cross-organization:** hệ single-tenant, không có tenant id; chưa từng được thiết kế cho nhiều tổ chức.
- **Cron:** gác bằng `checkCronAuthorization` (`src/lib/cron-auth.ts`), chạy service role là đúng vai; người nhận vẫn phải lọc (S11).
- **Realtime:** phần lớn chỉ là ping không nội dung, topic thông báo cá nhân băm HMAC (`tasks/realtime.ts:19-61`). **Ngoại lệ:** topic Lead công khai mang tới 25 UUID lead (S23).
- **SECURITY DEFINER:** sweep + assert ở cuối `schema.sql` chỉ đúng cho hàm có mặt khi `schema.sql` chạy; hàm tạo trong rollout sau đó phải kiểm `pg_proc`/`has_function_privilege` trên DB live (A0 Step 3; CI A10).
- **IDOR:** các đường đã đọc (time off kiểm `requester_id`; enrollment trả 404 qua `loadScopedEnrollmentRecord`, `enrollment/scope.ts:149-172`) đều có kiểm. Nhưng audit **chưa** chứng minh từng route trong 104 route đều loại trừ IDOR — việc đó là cổng test API ở plan final.
- **Account switching:** không có tính năng này.

---

## 14. Câu hỏi mở (không suy ra được từ code)

| # | Câu hỏi | Vì sao cần |
|---|---|---|
| Q1 | Production hiện có account nào có `task.manage` mà **không** thuộc role Admin/Admin Health Task/Task Admin không? Nếu có — họ có nên là task admin? | Luật tương thích 1 (§9.3) có cần giữ lâu không; D1 có đổi hành vi không |
| Q2 | Ai nên thấy **toàn bộ** hàng đợi task/enrollment? CS thường — có. Health Agent chưa khai roster — ? Assistant — hiện **không**, có đúng ý không? | Cấp `task.read:shared_queue` cho role nào (D9); có tách role Task CS không (G) |
| Q3 | Enrollment có cần permission riêng khỏi Task không? Và việc agent/assistant bị thu hẹp scope ở Enrollment (khác quyết định 02/08 "shared") có phải ý định? | §9.2 |
| Q4 | Khoá nào nối dòng hoa hồng (tên agent trong file carrier) với account? `agent_id` có xuất hiện trong dữ liệu carrier không? Ai duy trì bảng ánh xạ? | D7 / S1 |
| Q5 | Account Manager có được tạo Admin không? Người giữ `role_manager` có nên khác người giữ `account_manager`? | S4 |
| Q6 | Có cần nhiều role cho một account (vd Health Agent + Task Admin) không? | H |
| Q7 | Ai nên quản roster/delegation — task admin như hiện tại, hay chỉ Admin? | G |
| Q8 | Sự kiện giám sát (backlog khẩn, overdue unlock, QC enrollment, Due Date) nên tới ai — 3 Admin, 5 task admin, hay cả hai? Push có được chứa tên khách hàng không? | F |
| Q9 | Production có đặt `AUTH_GOOGLE_ALLOWED_DOMAIN` không? Role mặc định cho account tự tạo nên là gì? | S13 |
| Q10 | 5 phút trễ khi thu hồi quyền có chấp nhận được không? Nếu không: chấp nhận thêm chi phí CPU của kiểm version theo tầng (§9.8)? | S9, B |
| Q11 | `task.import` có phải quyền "admin nhập hàng loạt" (được bỏ qua scope) không? | S6 |
| Q12 | Rollout `lead-role-grants` (cấp `lead.work` cho mọi role) và time-off (cấp `timeoff.user`) đã chạy trên production chưa? Snapshot 04/09 cho thấy chưa. | Nền cho A0, D6 và mọi decision diff |
| Q13 | Lịch sử activity của task chỉ cho manager và agent-owner/assistant xem — đúng ý? | Đưa vào action `task.activity.read` |
| Q14 | @mention có được coi là cách chia sẻ quyền xem không? | S14 |
| Q15 | Agent trong roster có cần grant không? Account active bất kỳ có được làm agent/assistant không? Quan hệ assistant có hiệu lực như nhau ở Task, Enrollment và Lead không? | G, S25 |
| Q16 | Sau khi mất quyền hoặc bị khoá, người đó có được giữ nội dung thông báo cũ không? Đăng xuất có tự huỷ push subscription của thiết bị không? | F, S17, S26 |
| Q17 | Chia lead tự động có bắt buộc `lead.work` + roster không? Người đang có trọng số mà thiếu quyền thì xử lý thế nào? | G |
| Q18 | Có kế hoạch chạy nhiều tổ chức (multi-tenant) không? | Nếu có, phải thêm tenant id trước khi onboard tổ chức thứ hai |
| Q19 | Trường nào trong payload provider / config / danh bạ người là nhạy cảm? | E |
| Q20 | Người quản lý được chọn trong Time Off chỉ nhận tin hay có quyền duyệt? Được thấy những trường nào? | F, S22 |
| Q21 | @mention (Task và Enrollment): cấp quyền xem, từ chối khi người được nhắc không xem được, hay gửi bản rút gọn? (mở rộng Q14) | A4, S15 |
| Q22 | Có chấp nhận Role Manager dạng lưới action × scope (mô hình grant có kiểu) không? Được: role rõ ràng hơn. Mất: nhiều ô tick hơn | B, C |
| Q23 | `company.view_all` có được phép sửa/xoá mọi registration, hay chỉ được xem? | D8, S16 |

---

## 15. Bước tiếp theo đề xuất

Theo `docs/superpowers/plans/2026-09-26-authorization-final-plan.md`:

0. **Task A0:** chạy các truy vấn read-only (RLS/PostgREST, SECURITY DEFINER, ma trận role, các nhóm đặc biệt, cookie). Nếu có bảng lộ → **Task A1** trước mọi việc khác.
1. Duyệt Phase A: A2, A3, A4, A7, A8 là sửa lỗi rõ ràng; A5 (Q21) và A6 (khoá tự đổi tên) cần bạn đồng ý mặc định; A10 cần bạn cho phép dùng GitHub Actions.
2. Trả lời Q5, Q22 trước Phase B–C; Q1, Q2, Q3, Q4, Q23 trước Phase D.

---

## 16. Review audit của Codex

**Đối tượng:** `docs/2026-09-25-authorization-architecture-audit.md`.
**Cách review:** đọc toàn bộ, rồi tự kiểm lại trong code mọi khẳng định có ảnh hưởng tới plan.

### 16.1 Đánh giá chung

Bản Codex mạnh ở **thiết kế đích và kỷ luật triển khai**: principal khoá theo id, grant có kiểu, quyết định kèm lý do, test tương đương truy vấn, shadow evaluation, và thứ tự "bịt lỗ trước". Bản 1 mạnh ở các **phát hiện khai thác được cụ thể**: tên hiển thị, fail-open do vắng mặt, tạo task vòng qua UI, import bỏ qua scope. Hai bản bổ sung cho nhau. Bản 2 này giữ các phát hiện của bản 1 và lấy khung của Codex.

### 16.2 Đã nhập

| Khuyến nghị của Codex | Nhập vào | Điều chỉnh |
|---|---|---|
| Principal theo account id + active + version | §9.1, §9.8, Phase B | Thêm cách kiểm version rẻ vì ràng buộc CPU |
| Grant `{action, scope}`; từ vựng scope lấy từ ngữ nghĩa hiện có | §9.2–§9.3 | Mã hoá `action:scope` trong mảng chuỗi của JWT; bỏ `tenant` tới khi cần |
| Registry action tách chi tiết đúng những chỗ luật khác nhau | §9.3 | — |
| `authorize` trả quyết định kèm lý do; `scopeQuery` cùng ngữ nghĩa; `projectCapabilities` | §9.4 | Thêm `canReceive` vào cùng bộ API |
| "Encode existing cohorts first" | §9.3 (luật tương thích), thư mục `compat/` | Mỗi luật một file, có test, có hạn gỡ |
| Shadow evaluation + flag theo route/domain | §11 (nguyên tắc) | Chạy **song song** với decision diff offline của bản 1 |
| Phase A = baseline + bịt lỗ khẩn | §11 Phase A | Thêm A6 để giảm nhẹ S1 |
| Trần uỷ quyền, RPC nguyên tử, khoá admin cuối, chặn xoá role còn người | §9.7, Phase C | — |
| Event policy + kiểm lại lúc đọc chuông / gửi push + payload class + lý do nhận | §6.3, Phase F | Grant `notify.*` **chỉ** dành cho nhóm giám sát, không cấp cho mọi sự kiện |
| Test tương đương truy vấn, ma trận người nhận, cổng persistence, cổng vận hành | §12 | Ghi rõ cổng persistence đang bị chặn vì chưa có DB riêng |
| Roster, queue, lead weights là dữ liệu vận hành; RBAC chỉ cấp eligibility | §7.3, Phase G | — |
| Các phát hiện mới, đã tự xác minh: SQL `assign_unassigned_task` lọc theo tên; rollout seed theo tên `Health Agent`; link Settings; chuông bị ẩn với người chỉ dùng Time Off; editor default của dashboard; payload /config; danh bạ người; eligibility assistant chỉ lọc ở UI; realtime lead; chuông không kiểm lại quyền; `task_created` gửi ra ngoài scope; người quản lý Time Off | R22–R24, F9–F13, S21–S27 | — |

### 16.3 Nhập có điều chỉnh, hoặc không nhập

| Điểm | Codex nói | Vì sao điều chỉnh |
|---|---|---|
| Kiểm active/version **ở mọi request**, không chấp nhận cửa sổ 5 phút | §11, mục "Cache and revocation" | Middleware/auth từng chiếm 31% Active CPU; kiểm tươi ở mọi request là thêm một vòng DB. Bản 2 dùng 3 tầng (§9.8): kiểm tươi ở route ghi, admin, chuông và push; phần còn lại đi qua cache chỉ chứa version, TTL ngắn. Chốt sau khi đo (Q10) |
| Grant `*.receive` cho từng sự kiện (`task.created.receive`, `enrollment.mention.receive`…) | §8 | Sự kiện trên bản ghi đã có người nhận tự nhiên từ quan hệ; grant riêng chỉ thêm ô tick. Chỉ giữ grant cho nhóm giám sát — chỗ hiện đang lệch |
| Chuyển mọi quan hệ từ email sang account id | §7, §11 | Đúng về lâu dài nhưng rất lớn. Từ Phase B, chủ thể phân quyền đã là id; email trong dữ liệu đã chuẩn hoá và bị khoá đổi khi còn tham chiếu. Để ngoài lộ trình này |
| Tenant id trong principal và predicate | §1, §11 | Hệ single-tenant, không có kế hoạch nào trong repo. Chỉ ghi thành Q18 |
| Outbox bền cho thông báo | §8 | Đúng về độ tin cậy, nhưng không phải chuyện phân quyền — để tuỳ chọn trong Phase F |
| Service function nhận principal đã scope thay cho admin client | §11 | Hướng đúng. Nhưng không có Supabase Auth nên service role vẫn là cách truy cập duy nhất. Thực hiện bằng cách bắt buộc đi qua `scopeQuery`, không đổi client |

### 16.4 Codex bỏ sót (bản 1 có, giữ nguyên)

| Phát hiện | Vì sao quan trọng |
|---|---|
| **S1** — tên hiển thị (tự đổi được, hoặc lấy từ hồ sơ Google) quyết định phạm vi dữ liệu hoa hồng | Codex chỉ coi đây là "name matching" cần giữ tương thích và cần test trùng tên, không nhận ra đây là đường tự mở rộng phạm vi. Đây là phát hiện mức cao nhất mà một tài khoản bình thường khai thác được |
| **S2** — phạm vi mở toang khi vắng mặt khỏi roster | Codex xếp vào câu hỏi nghiệp vụ. Về bảo mật đây là fail-open: account mới đọc được toàn bộ task/enrollment cho tới khi được khai vào roster |
| **S5** — CS tạo task qua API; reporter tự đặt mình làm agent rồi tự QC | Không có trong bản Codex; ảnh hưởng tới KPI |
| **S6** — import enrollment bỏ qua scope, capability và activity log | Codex chỉ mô tả cổng `task.import`, không thấy đoạn ghi thẳng bằng `.update()` |
| **S3** (chi tiết) — tạo role tên "Super Admin" là tự cấp override và khoá luôn role đó | Codex nêu rủi ro đổi tên, không nêu đường *tạo mới* |
| Danh sách bảng thiếu RLS | Codex thiếu `task_comment_edits`, `time_off_balance_adjustment_batches`, `time_off_monthly_accrual_rules`. Truy vấn kiểm ở §13 đã có đủ |
| `schema.sql` xoá permission nằm ngoài danh sách cứng, kéo theo cascade xoá grant | Codex nêu việc xoá, nhưng không nêu hệ quả cascade khi một rollout quên cập nhật danh sách |

### 16.5 Sai lệch nhỏ trong bản Codex (không ảnh hưởng kết luận)

- Registration dùng cột `agent_email` (`schema.sql:363, 387`); không có cột `submitted_by_email`.
- Sidebar hiện `/config` khi có `task.manage` **hoặc** `lead.manage` (`Sidebar.tsx:149-151`), không chỉ khi có `task.manage`.
- Rollout `task.export` chỉ cấp cho role `Admin`; tên `Task Admin`/`Admin Health Task` chỉ xuất hiện trong câu kiểm (`rollouts/2026-08-09-task-export-permission.sql`). Rollout time-off cấp `timeoff.user` cho **mọi** role active, không phải cấp theo tên.
- "112 file dưới `src/app/api`" là đếm cả file không phải route; số route handler thực tế là 104.

---

## 17. Xử lý 22 comment `[sol5.5]` (bản 3)

Comment gốc được Codex chèn thẳng vào các mục của bản 2. Sau khi xử lý, comment được gỡ khỏi thân bài và ghi lại ở đây. Mọi comment đều đã được kiểm trong code trước khi chấp nhận.

| # | Comment (tóm tắt) | Kết luận | Bằng chứng đã kiểm | Xử lý ở đâu |
|---|---|---|---|---|
| C1 | "RLS bật trên mọi bảng nghiệp vụ" mâu thuẫn với S0; sweep ACL chỉ đúng nếu `schema.sql` chạy sau mọi function | **Đúng** | Danh sách `protected_tables` (`schema.sql:6206-6260`) không có các bảng S0 | §1.1 viết lại; plan A0 Step 1/3, A1, A10 |
| C2 | "Có gác" phải tách 3 mức; cổng tĩnh không thay test gọi API | **Đúng** | S8 và S18 "có gác" mà vẫn thủng | §4.1; plan D16, A9 |
| C3 | Luật `shared_queue` bị tắt khi có roster vẫn phụ thuộc vào sự vắng mặt | **Đúng** | `tasks/membership.ts:113-114`, `enrollment/scope.ts:58` | §9.3 luật 2 thành compat tạm thời có điều kiện gỡ; plan D7, A0 Step 5 |
| C4 | Push nhóm người nhận trước rồi mới gửi một payload chung | **Đúng** | `push-dispatch.ts:107-125` → `sendPushToEmails(group.emails, payload)` | §6.3 mục 8; plan D17, Phase F |
| C5 | `agent_owned` / `assistant_for_agent` không áp nguyên dạng cho Lead | **Đúng** | `leads` chỉ có `assigned_to_email` (`schema.sql:6339-6375`); `leads/membership.ts:22-29` | §9.2 bảng ánh xạ theo resource; plan §I.3 |
| C6 | Cần dual read/write; `can()` không hiểu `task.read:assigned`; `replace_role_permissions` xoá sạch | **Đúng — lỗi của bản 2** | `rbac/client.ts:1-14` (`includes`), `schema.sql:111-128` | §9.2 mã hoá: bảng `role_grants` riêng, `hasGrant`; plan D2–D4 |
| C7 | Ước lượng JWT "40–60 chuỗi" chưa đo | **Đúng** | Không có số đo nào | Plan D5, A0 Step 6 |
| C8 | Gộp reporter với người được @mention vào `participating` rồi cấp quyền sửa = nới quyền | **Đúng — lỗi của bản 2** | `canMutateTask` chỉ nhận `isReporter`/`isAgentOwner` (`tasks/access.ts:137-146`) | §9.2, §9.3, §9.5: tách `reported`; plan §I.3 |
| C9 | `task.import`/`task.export` là tên legacy dùng chéo domain | **Đúng** | Không có route import task; `enrollment/import` và `provider-list/import` tiêu thụ `task.import` | §9.3; plan D15, A8 |
| C10 | "Kiểm rồi ghi bằng service role" có cửa sổ TOCTOU; cần điểm thi hành trong RPC | **Đúng** | `patch_task_atomic` có `for update` + version nhưng không kiểm lại quyền; route assign truyền `p_expected_updated_at = null` | §9.4; plan D8, Phase D bước 4 |
| C11 | `projectCapabilities` cần hai mức (module và từng bản ghi) | **Đúng** | `resolveTaskCapabilities` tính theo từng task | §9.4; plan D9 |
| C12 | Trần uỷ quyền phải so grant hiệu lực trước/sau; bất biến admin cuối trong transaction | **Đúng** | — (thiết kế) | §9.7; plan D10, Phase C |
| C13 | Version theo account không thu hồi được khi sửa grant của role | **Đúng** | — (thiết kế) | §9.8; plan D11 |
| C14 | Decision diff trên production cần giới hạn tải và không kéo dữ liệu khách ra ngoài | **Đúng** | Snapshot 43 account đã cũ | §12; plan D12 |
| C15 | Rollback bản vá bảo mật không được mở lại RLS/grant | **Đúng** | Bản 2 ghi "file rollout có bản đảo ngược" | Plan D13; A1 ghi rõ không có file đảo ngược |
| C16 | A6 chưa đủ cho JWT đang tồn tại | **Đúng** | `jwt` callback không bao giờ làm mới `token.name` (`src/auth.ts`); `session.user.name = token.name` (`@auth/core/lib/actions/session.js`) | Plan A6: đọc tên tươi từ DB **và** khoá tự đổi tên |
| C17 | Phase B phải nói rõ UI Role Manager cũ ghi grant ra sao khi đã có hàng có scope | **Đúng** (cùng gốc C6) | `replace_role_permissions` | Plan D2–D3: trigger sinh lại `role_grants` trong cùng transaction |
| C18 | Lùi flag về mutation API cũ khôi phục S4/S19 | **Đúng** | — (thiết kế) | Plan D13, Phase C bước 3 |
| C19 | Cổng persistence không nên bị chặn vô thời hạn; dựng Postgres dùng một lần trên CI | **Đúng một phần** | Repo đã có GitHub Actions. Nhưng "áp schema + mọi rollout theo thứ tự" không dùng nguyên văn được: `schema.sql` là full-state dự định, còn rollout là delta cho DB cũ. Áp đúng là `schema.sql` + các rollout tạo bảng mà schema còn thiếu. So sánh cho thấy 8 bảng như vậy (S28) | Plan D14, A10; S28; Phase C bước 5 |
| C20 | Chặn S5, S6, S16 ngay ở Phase A | **Đúng, trừ S16** | S5, S6 vá được mà không đổi UI. S16 cần UI chặn theo từng dòng (`EntryGrid` chưa có) + permission mới, nên phải chờ Q23 | Plan A7 (S5), A8 (S6), A0 Step 5 đo S16 |
| C21 | Kết luận S0 cần thêm `USAGE`, schema được expose, request chỉ-đọc; báo từng loại quyền | **Đúng** | — | §13; plan D18, A0 Step 2 |
| C22 | "Không thấy vấn đề" phải viết thành giới hạn điều tra | **Đúng** | Realtime Lead mang UUID (S23) mâu thuẫn với câu "chỉ ping" | §13 viết lại; plan D20 |

**Phát hiện mới từ lượt review này:** S28 — `schema.sql` chưa phải full-state (xem C19). Đây cũng là nguyên nhân gốc của S0: bảng sinh ra ngoài `schema.sql` thì vòng RLS không bao giờ thấy.
