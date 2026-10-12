# Gỡ hard code, logic lủng và quyền chéo — Plan (bản reconcile)

**Ngày:** 2026-10-09 · **Trạng thái:** ĐÃ CODE P0, P2–P11 (chưa commit). SQL P1 **ĐÃ CHẠY trên production 2026-10-10** (Bước 0 khớp hết; hàm assign khớp md5; anon vốn không gọi được hàm). Typecheck, lint, 1651 test, `next build` đều xanh · **Nguồn:** audit hard code + buổi bàn từng mục với user ngày 2026-10-09

> **Khác plan khi code:**
> - Rollout có thêm chốt md5: dừng nếu hàm `assign_unassigned_task` trên production khác `schema.sql` (thay cho bước dán tay bản live ở Bước 0.5).
> - Agent membership dùng helper mới `lib/admin/account-manager-access.ts`.
> - Thêm `fetchUserRoleId` / `userHoldsAdminRole` / `fetchAdminRoleId` trong `role-management.ts`.
> - Bước 0 chưa chạy.

> - Plan này chưa được commit (luật repo: plan vào git cùng lượt với code hiện thực nó).
> - `origin` đang **PUBLIC**, mà file này mô tả các đường leo quyền. Vì vậy nó chỉ được lên git sau khi bản vá đã deploy.
> - Không có giá trị secret nào trong file này.

---

## 0. Nguyên tắc (user chốt)

1. **Ô tick quyết định làm được gì.** Mỗi trang và mỗi API chỉ dùng quyền của **chính module đó**. **Không có quyền chéo**: quyền của module A không được mở việc gì ở module B.
2. **Không hard code tên role trong logic.** Ngoại lệ duy nhất là tên **"Admin"**:
   - chỉ có **một** role Admin cố định, và không role nào khác được đặt tên này;
   - tên chỉ dùng để: khoá role đó, hiện nhãn "Admin", và đảm bảo luôn còn ít nhất 1 Admin;
   - tên **không bao giờ** quyết định ai làm được gì.
3. **Manage bao gồm Work** (Task và Lead): role có Manage thì không giữ Work.
4. **Task CS và Enrollment là một module**, dùng chung `task.manage` / `task.work` / `task.export` / `task.import`.
5. Không ai mất quyền hay được thêm quyền, **ngoại trừ** các thay đổi ghi ở mục 9 "Ai thấy khác".

---

## 1. Sổ quyết định

| # | Quyết định | Ghi chú |
|---|---|---|
| D1 | Lead manager chỉ theo `lead.manage`; bỏ đường tắt "admin là manager" | |
| D2 | Task manager chỉ theo `task.manage`, không xét tên role. Bỏ `isTaskViewAdmin` và danh sách tên `Admin Health Task` / `Task Admin` | Linh Le và role Sub Admin trở thành manager đầy đủ |
| D3 | Bỏ hẳn tên "Super Admin" khỏi code | |
| D4 | **Không** có quyền/thẻ đặc biệt kiểu `management.admin` | User bỏ thẻ |
| D5 | Role "Admin" là role **cố định, toàn quyền** (mọi quyền, gồm mọi Manage). Tên dành riêng (không phân biệt hoa thường, bỏ khoảng trắng). Trong Role Manager **chỉ xem được**: không sửa quyền, không đổi tên, không xoá, không tắt. Quyền mới cấp cho Admin bằng SQL trong chính rollout thêm quyền đó. Có nhãn "Admin"; luôn còn ≥ 1 người active giữ role Admin | User xác nhận 2026-10-09 |
| D6 | Chia task CS chỉ theo `task.work`; bỏ điều kiện "trừ Admin" ở Overview và trong SQL | Admin không bị chia task vì không còn giữ `task.work` (D7) |
| D7 | Manage bao gồm Work: Role Manager tự bỏ ô Work khi tick Manage; API tự lọc; rollout bỏ Work ở role đang có Manage | Task: Admin, Linh Le, Sub Admin. Lead: Admin |
| D8 | Thông báo giám sát (task gấp chưa ai nhận, quá SLA, quá Due Date, giải trình quá hạn) gửi cho **người có `task.manage`** | Thay `fetchAdminEmails` (đang đọc cột cũ) |
| D9 | Bỏ quyền chéo `task.manage` → Lead | 2026-10-10: user chốt **cấp `lead.work`** cho role Linh Le và Admin Health Task (Linh Le có 9 lead mở; Kay Huynh là Assistant của Khang, 10 lead). Họ chỉ mất "xem mọi lead" + tab Overview Lead |
| D10 | Task CS và Enrollment chung quyền `task.*` | Không tách quyền Enrollment |
| D11 | Mỗi trang dùng quyền của nó. Sửa thêm 5 chỗ quyền chéo: X2–X6 | X6 user xác nhận riêng: Agent membership chỉ người có Account Manager làm được, không phải `task.manage` |
| D12 | Bảo vệ tài khoản và role theo **trần uỷ quyền** tính bằng tick; không ai tự đổi role của mình; bỏ đầu vào cũ `role` ở API | Không có luật nào kiểu "nếu là Admin thì…" |
| D13 | Cột `portal_account.role`: ngừng đọc và ngừng ghi. Xoá cột để dành cho một plan sau | Cột có default `'agent'` |
| D14 | Role mặc định cho user mới theo cột `roles.is_default`, không tìm theo tên "Agent" | |
| D15 | Apps Script: đổi secret, chuyển secret và ID Sheet sang Script Properties. Repo private do chủ repo quyết | |
| D16 | Bỏ email cá nhân làm giá trị dự phòng của `VAPID_SUBJECT`; script seed đọc email từ biến môi trường | |

---

## 2. Bối cảnh codebase (cho người chưa đọc code)

### 2.1 Mô hình quyền

**Bảng:**
- `roles(id, name unique, description, is_system, is_active)`
- `permissions(key PK, label, description, group_key, group_label, sort_order)`
- `role_permissions(role_id, permission_key → FK permissions.key, PK (role_id, permission_key))`
- `user_roles(user_id, role_id)`

Mỗi user có **một** role: RPC `replace_user_roles` chỉ lấy phần tử đầu. Song song còn cột cũ `portal_account.role` (`'admin' | 'agent'`, default `'agent'`).

**`src/lib/rbac/access.ts` hiện tại:** quyền thật lấy từ `role_permissions` của role đang bật. Nhãn admin thì đọc thêm cột cũ và tên role:

```ts
export function flattenAccess(row: AccessRow): UserAccess {
  const legacyRole: UserRole = row.role === "admin" ? "admin" : "agent";
  // ...
  return {
    userId: row.id,
    legacyRole:
      legacyRole === "admin" ? "admin" : getLegacyRoleFromRoleNames(roleNames),
    roles: roleNames,
    permissions,
    isActive: true,
    agentId: row.agent_id ?? null,
  };
}
```

**`src/auth.ts`:** JWT mang `role`, `roles` (tên role) và `permissions`, rồi tự nạp lại từ DB sau mỗi **5 phút** (`RBAC_REFRESH_TTL_MS = 5 * 60 * 1000`). Nghĩa là sau khi chạy SQL đổi quyền, phải **chờ ≥ 5 phút** để mọi phiên nhận quyền mới, rồi mới deploy code dựa vào quyền đó.

**Khảo sát (grep toàn `src/`):** `session.user.role` / `session.user.roles` chỉ được đọc trong `isTaskViewAdmin` và `isLeadViewAdmin`. `can(permissions, key)` ở `src/lib/rbac/client.ts` chỉ là `permissions.includes(key)`.

### 2.2 Hiện trạng production (đọc trực tiếp 2026-10-09, chỉ đọc)

| Role | Người active | Ghi chú quyền liên quan |
|---|---:|---|
| Admin | 3 | Mọi quyền; có cả `task.manage` + `task.work`, cả `lead.manage` + `lead.work` |
| Admin Health Task | 5 | Chỉ `settings.access`, `task.manage`. Hôm nay là manager nhờ **tên** |
| Linh Le | 1 (linh.le@…) | `task.manage` + `task.work`, `task.export`, `automation.provider_finder` + `provider_manage`, `company.view_all`, dashboard, registration. Nằm trong `task_agents` (là Agent). Hôm nay **không phải** manager vì tên không khớp |
| Sub Admin | 0 | Quyền y hệt Linh Le |
| Task CS | 22 | |
| Health Agent | 15 | |
| Accounting, Nhi Vu, Referrals | 1 mỗi role | |
| Agent, P&C Agent | 0 | "Agent" là role mặc định của user Google mới |

Không có role nào tên "Super Admin" hay "Task Admin". Theo user, chỉ Admin có Role Manager.

### 2.3 Thông lệ của repo

- **Rollout SQL:** chạy tay trên Supabase SQL Editor; file trong `supabase/rollouts/` **giữ local, không commit** trừ khi user bảo. Mẫu cấu trúc: `supabase/rollouts/2026-10-08-provider-manage-permission.sql` (`begin` → insert permission `on conflict (key) do update` → insert role_permissions `on conflict (role_id, permission_key) do nothing` → `commit` → các câu `select` kiểm chứng → `notify pgrst, 'reload schema'`).
- **Catalog quyền:** `PERMISSION_DEFINITIONS` trong `src/lib/rbac/permissions.ts` chỉ dùng trong code và test. DB (`permissions`) được nạp bằng SQL, nên **mỗi đổi tên hay mô tả quyền phải sửa cả hai chỗ**.
- **Test:** Vitest, file `*.test.ts` đặt cạnh nguồn. Lệnh: `npm run test:run`, `npm run typecheck`, `npm run lint`, `npm run build`. Đã có mẫu "test quét mã nguồn để chặn tái phát": `src/lib/leads/assign-target.test.ts`, khối `describe("no lead route rebuilds the assign-target rule")`.
- **Changelog:** mọi thay đổi logic ghi vào `changelog.md` (mới nhất ở trên, tiếng Việt).

### 2.4 Liên quan

- Nhánh `feat/authz` và plan authz cũ: user đã **bỏ hẳn** (2026-10-09). RBAC làm lại trên `main`, **từng chức năng một, user dẫn**. Không merge hay cherry-pick gì từ nhánh đó.
- Plan bảo mật 2026-10-05 (file đang ở `~/.Trash`): plan này **thay thế** T0.1/T0.2 (secret, repo) và T4.1/T4.2 (uỷ quyền).
- **Chạy SQL trên production:**
  - dùng Supabase CLI: `supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw -f <file> -o json` (cần cả `--linked` lẫn `--project-ref`);
  - Claude chạy, nhưng **phải hỏi user trước mỗi lần**, nêu rõ file và hệ quả. Áp dụng cho cả truy vấn chỉ đọc ở Bước 0.

---

## 3. Sổ vấn đề (reconcile)

### H. Hard code

| ID | Hard code | Ở đâu | Sửa ở |
|---|---|---|---|
| H1 | `"Super Admin"` coi như Admin | `rbac/system-roles.ts:22`, cùng mọi chỗ import `LEGACY_SUPER_ADMIN_ROLE_NAME`; SQL `assign_unassigned_task` | P5 |
| H2 | `TASK_ADMIN_ROLE_NAMES = ["Admin Health Task", "Task Admin"]` | `tasks/access.ts:16-19` | P3 |
| H3 | So tên `"Admin"` rải khoảng 12 chỗ, có chỗ là chuỗi trần (`overview-data.ts:118`) và trong SQL | xem P5 | P5 |
| H4 | Role mặc định tìm theo tên `"Agent"` | `system-roles.ts:24-28` (`getDefaultSystemRoleName`), `rbac/access.ts:72-91`, `auth.ts:127`, `AccountManagerClient.tsx:155-158`, `account-manager/page.tsx:180-182`, `AccountManagerClient.tsx:1153-1162` | P9 |
| H5 | `role === "admin"` (cột cũ) | `rbac/access.ts:29`, `leads/access.ts:39`, `tasks/access.ts:31`, `users/[id]/route.ts:238,348,408,526`, `assignees.ts:217`, `overview-data.ts:177`, `membership.ts:190`, `role-management.ts:284`, SQL | P5, P6 |
| H6 | Secret Apps Script và ID sheet Policy Tracker nằm thẳng trong file | `apps-script/Code.gs:8-9` | P0 |
| H7 | Email cá nhân làm giá trị dự phòng của `VAPID_SUBJECT` | `notifications/push-server.ts:51` | P10 |
| H8 | Email thật trong script seed | `scripts/seed-enrollment-samples.mjs` | P10 |

### L. Logic lủng

| ID | Lỗi | Ở đâu | Sửa ở |
|---|---|---|---|
| L1 | Admin là Lead manager dù không có `lead.manage`; bỏ tick trong Role Manager không có tác dụng | `leads/access.ts:45-65` | P4 |
| L2 | `task.manage` một mình không làm được việc của manager; mô tả quyền trong Role Manager sai; tên role mới quyết định | `tasks/access.ts:38-51` | P3 |
| L3 | CS Overview chỉ kiểm **tên** role, không kiểm quyền | `api/tasks/overview/route.ts:13` | P3 |
| L4 | Account Manager có thể (a) gán role Admin cho bất kỳ ai, kể cả chính mình; (b) đổi mật khẩu, email, trạng thái của Admin; (c) gửi `role:"admin"` để API tự gán role Admin | `api/admin/users/route.ts`, `users/[id]/route.ts` | P7 |
| L5 | Role Manager cấp được mọi quyền, kể cả quyền mình không có. Chưa ai lợi dụng được vì chỉ Admin có Role Manager | `api/admin/roles/*` | P7 |
| L6 | Luật "tự đổi role" kỳ quặc: chỉ chặn "tự bỏ admin", nên người không phải Admin vẫn tự đổi sang role Admin được | `users/[id]/route.ts:348-353, 378-383` | P7 |
| L7 | Role có cả Manage lẫn Work; hàm `normalizeExclusivePermissionKeys` có tên đúng mục đích nhưng chỉ lọc trùng | `rbac/permissions.ts:38-40` | P2 |
| L8 | Pool CS loại Admin theo tên và cột cũ, cả trong SQL; hàm SQL `assign_unassigned_task` (SECURITY DEFINER) **không có `revoke`**, nên có thể gọi được bằng anon key | `overview.ts:463-470`, `overview-data.ts`, `schema.sql:3685-3838` | P1, P5 |
| L9 | Thông báo giám sát đọc cột cũ `portal_account.role` | `membership.ts:184-196` | P6 |
| L10 | Hai nguồn cho câu hỏi "ai là admin" (cột cũ và role); sửa cột trong DB là thành admin | `rbac/access.ts` | P6 |
| L11 | Chặn "Admin cuối cùng" theo tên và cột cũ | `role-management.ts:247-308` | P5 |
| L12 | Tên dành riêng "Admin" chưa được chặn: DB chỉ chặn trùng chính xác, nên tạo được role "admin", " ADMIN " | `api/admin/roles/*` | P5 |
| L13 | `schema.sql` thiếu `management.notification_alerts` trong danh sách giữ lại, nên chạy lại `schema.sql` sẽ xoá quyền đó | `schema.sql:224-245` | P1 |

### X. Quyền chéo

| ID | Quyền chéo | Ở đâu | Sửa ở |
|---|---|---|---|
| X1 | `task.manage` → Lead: vào trang, mục menu, xem mọi lead, tab Overview, được tính là người làm lead, được nhận lead | `leads/access.ts:55,63`, `tasks/leads/page.tsx:29-33`, `Sidebar.tsx:138` | P4 |
| X2 | `task.export` / `task.import` → Export/Import của **Provider List** | `providers/access.ts:35-51` | P8 |
| X3 | `company.view_all` (nhóm Dashboard) → **Customer Registration** xem entry của mọi agent | `(authed)/page.tsx:16-19`, `customer-registration/pc/page.tsx:14-17`, `api/entries/route.ts:21`, `api/entries/[id]/route.ts`, `api/pc-entries/route.ts:33`, `api/pc-entries/[id]/route.ts` | P8 |
| X4 | `management.role_manager` → sửa bộ lọc mặc định của mọi Dashboard | `api/dashboard-filter-defaults/route.ts:137` | P8 |
| X5 | Quyền Task → **chuông thông báo**. Chuông gộp thông báo Task, Enrollment và **Time Off**, nhưng chỉ hiện cho người có quyền Task | `(authed)/layout.tsx:43-46`, `TopBar.tsx:52` | P8 |
| X6 | Phần **Agent membership** trong trang Account Manager (trang đòi `management.account_manager`) lại gác bằng **task manager**: `loadConfigAdmin` ở trang và ở `/api/config/agents`, `/api/config/assistants` | `account-manager/page.tsx:61`, `api/config/agents/route.ts`, `api/config/assistants/route.ts` | P8 |

---

## 4. Bước 0: truy vấn read-only trước khi chạy rollout

Chỉ có `select`. Claude chạy qua Supabase CLI sau khi user cho phép, hoặc user chạy tay trên SQL Editor.

```sql
-- 0.1 Toàn bộ role, số người active và quyền (một câu cho đủ mọi kiểm tra bên dưới)
select r.name, r.is_active, r.is_system,
       (select count(*) from user_roles ur join portal_account a on a.id = ur.user_id
         where ur.role_id = r.id and a.is_active) as active_users,
       string_agg(rp.permission_key, ', ' order by rp.permission_key) as permissions
from roles r left join role_permissions rp on rp.role_id = r.id
group by r.id order by r.name;
-- Đọc kết quả để xác nhận:
--   (a) Role có cả task.manage + task.work: mong đợi Admin, Linh Le, Sub Admin.
--   (b) Role có cả lead.manage + lead.work: mong đợi Admin.
--   (c) Role có provider_finder + (task.export | task.import) mà THIẾU provider_manage:
--       mong đợi KHÔNG CÓ. Nếu có, role đó mất Export/Import Provider ở X2; báo user trước.
--   (d) Role có company.view_all: sẽ được cấp customer_registration.view_all nếu có quyền Registration.
--   (e) Role có management.role_manager / account_manager: mong đợi chỉ Admin.

-- 0.2 Lệch giữa cột cũ và role Admin. MONG ĐỢI 0 DÒNG (rollout tự dừng nếu còn).
select a.email, a.role
from portal_account a
where a.is_active
  and (a.role = 'admin') <> exists (
    select 1 from user_roles ur join roles r on r.id = ur.role_id
    where ur.user_id = a.id and r.is_active and r.name = 'Admin');

-- 0.3 Tên dành riêng: chỉ được có đúng 1 dòng là 'Admin'
select id, name from roles where lower(trim(name)) = 'admin';

-- 0.4 Account active mà không có role nào (sau sửa sẽ hiện "No role")
select a.email, a.role from portal_account a
where a.is_active and not exists (select 1 from user_roles ur where ur.user_id = a.id);

-- 0.5 Định nghĩa ĐANG CHẠY của hàm giao task từ Overview
select pg_get_functiondef('public.assign_unassigned_task(uuid, text, timestamptz, text)'::regprocedure);

-- 0.6 Ai đang được gọi hàm này (thấy anon/PUBLIC là lỗ L8)
select grantee, privilege_type from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'assign_unassigned_task';
```

---

## 5. Catalog quyền sau khi sửa

| Key | Nhãn | Mở được gì (chỉ trong module của nó) | Thay đổi |
|---|---|---|---|
| `task.manage` | Tasks - Manage | **Health CS + Enrollment:** mọi task/record, backlog, tạo, giao, sửa, xoá, category, SLA, cài đặt nhắc việc, hàng đợi chia task, **CS Overview**, cấu hình bảng CS/ACA/Medicare/Medicaid, nhận thông báo giám sát. **Đã bao gồm Work** | Không còn cần tên role; sửa mô tả |
| `task.work` | Tasks - Work | Health CS + Enrollment: làm việc trên task/record mình liên quan; nằm trong nhóm được chia task CS | Mô tả nói rõ gồm Enrollment |
| `task.export` | Tasks - Export | Export bảng CS và Enrollment | **Bỏ Provider** khỏi mô tả và khỏi code (X2) |
| `task.import` | Tasks - Import | Import bảng Enrollment | **Bỏ Provider** (X2) |
| `lead.manage` | Manage Leads | Mọi lead, tab Overview, import, giao, chia tự động, cài đặt, Event, danh sách lựa chọn, cấu hình bảng Lead. **Đã bao gồm Work** | Không còn đường tắt admin |
| `lead.work` | Work Leads | Lead của mình / Agent mình phụ / mình là collaborator; thêm Personal lead | |
| `automation.provider_finder` | Provider Finder | Xem Provider List, chạy Finder, sửa ô | |
| `automation.provider_manage` | Provider List - Manage | Thêm/xoá address, cột bảng Provider, **Export/Import Provider** (chỉ qua quyền này) | Cần kèm Finder (2 tầng cùng module) |
| `customer_registration.health` / `.pc` | Health / P&C Registration | Entry của mình | |
| **`customer_registration.view_all`** (MỚI) | Registration - View All Agents | Xem entry của mọi agent ở Health và P&C Registration | Tách từ `company.view_all` (X3) |
| `company.view_all` | View All Agents | **Chỉ Dashboard:** xem dữ liệu mọi agent ở Agent Dashboard, AI chat dashboard, bộ lọc mặc định Agent Dashboard | Bỏ Registration (X3) |
| `company_dashboard.*`, `agent_dashboard.*` | | Dashboard; sửa bộ lọc mặc định của dashboard tương ứng | Bỏ đường `role_manager` (X4) |
| `management.account_manager` | Account Manager | Trang Account Manager **gồm cả Agent membership** (`task_agents`, `agent_members`) | Thêm Agent membership (X6) |
| `management.role_manager` | Role Manager | Trang Role Manager | Bỏ quyền sửa bộ lọc dashboard (X4) |
| Các quyền còn lại | | Không đổi | |

Chuông thông báo hiện cho **mọi người đã đăng nhập** (X5). Mỗi thông báo vốn đã chỉ gửi cho đúng người nhận.

---

## 6. Các phase

Mỗi task ghi: **Context** → **Hiện tại** → **Sửa** → **Test**. Thứ tự code: P2 → P10, rồi P11. P0 làm độc lập, càng sớm càng tốt. P1 là SQL chạy trước khi deploy.

### P0. Apps Script secret (khẩn, độc lập)

**Context:**
- `apps-script/Code.gs` là Web App ghi Health/P&C entry lên Google Sheet và đọc sheet Policy Tracker cho P&C Statement.
- Nó được gọi từ `src/lib/sheets.ts:90-110` và `src/lib/automation/pc-statement/policy-source.ts:173`, gửi `APPS_SCRIPT_SECRET` trong body.
- Dòng 8 có secret **thật**, dòng 9 có ID của sheet Policy Tracker. Repo đang public.
- Mẫu đúng có sẵn: `apps-script/ProviderFinderMapsProxy.gs:10, 297-310` dùng `PropertiesService.getScriptProperties()` và từ chối khi chưa cấu hình.
- Khi đồng bộ Sheet lỗi, entry **vẫn lưu vào DB** (`api/entries/route.ts:140-148` trả warning "Saved to database but Google Sheet sync failed").

**Sửa `apps-script/Code.gs`:**

```js
// Apps Script Web App — receives entry rows from the Next.js app and writes
// them to the bound Google Sheet. Deploy as: Execute as Me, Access Anyone.
//
// Before deploying, add Script Properties (Project Settings → Script properties):
//   ENTRIES_SHARED_SECRET           = the same value as APPS_SCRIPT_SECRET on Vercel
//   PC_POLICY_SOURCE_SPREADSHEET_ID = the Policy Tracker spreadsheet id
// Never put either value in this file: the repository is not private.

var ENTRIES_SECRET_PROPERTY = "ENTRIES_SHARED_SECRET";
var PC_POLICY_SOURCE_ID_PROPERTY = "PC_POLICY_SOURCE_SPREADSHEET_ID";
var PC_POLICY_SOURCE_SHEET = "Policy Tracker";
var PC_POLICY_SOURCE_COLUMN_COUNT = 11;

function getScriptProperty_(name) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  return value ? String(value).trim() : "";
}
```

Trong `doPost`, thay khối `if (data.secret !== SECRET_KEY)`:

```js
  var expectedSecret = getScriptProperty_(ENTRIES_SECRET_PROPERTY);
  if (!expectedSecret) {
    return jsonOutput({ ok: false, error: ENTRIES_SECRET_PROPERTY + " script property is not configured" });
  }
  if (!data || data.secret !== expectedSecret) {
    return jsonOutput({ ok: false, error: "unauthorized" });
  }
```

Trong `readPcPolicyTracker`, thay `SpreadsheetApp.openById(PC_POLICY_SOURCE_SPREADSHEET_ID)`:

```js
  var sourceId = getScriptProperty_(PC_POLICY_SOURCE_ID_PROPERTY);
  if (!sourceId) {
    throw new Error(PC_POLICY_SOURCE_ID_PROPERTY + " script property is not configured");
  }
  var sourceSS = SpreadsheetApp.openById(sourceId);
```

**2026-10-12: chủ repo quyết định KHÔNG đổi secret, dùng secret cũ.** Bản Apps Script đang chạy (secret viết cứng) để nguyên, vẫn khớp `APPS_SCRIPT_SECRET` trên Vercel, nên deploy web không cần đụng Apps Script. Lần tới dán `Code.gs` mới: đặt 2 Script Properties trước (`ENTRIES_SHARED_SECRET` = giá trị `APPS_SCRIPT_SECRET` hiện tại, `PC_POLICY_SOURCE_SPREADSHEET_ID` = ID dòng 9 `Code.gs` cũ), bỏ qua bước 1, 4, 6. Rủi ro chấp nhận: secret nằm trong lịch sử git của `origin` public, ai đọc được repo thì gọi được Web App.

**Runbook cho chủ repo** (code không tự làm được; làm ngoài giờ cao điểm):
1. Tạo secret mới: `openssl rand -hex 32`. Không dán vào chat, commit hay plan.
2. Mở Apps Script gắn với Sheet Entries → **Project Settings → Script properties**:
   - thêm `ENTRIES_SHARED_SECRET` = secret mới;
   - thêm `PC_POLICY_SOURCE_SPREADSHEET_ID` = ID đang ở dòng 9 của `Code.gs` cũ.
3. Dán `Code.gs` mới → **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. Sửa deployment cũ để **giữ nguyên URL**, nhờ đó `APPS_SCRIPT_URL` không đổi.
4. Ngay sau đó, trên Vercel: **Settings → Environment Variables** → đổi `APPS_SCRIPT_SECRET` (Production và Preview) → **Redeploy** production. Cập nhật `.env.local`.
5. Kiểm tra:
   - tạo một Health entry thử → dòng lên Sheet → xoá dòng thử;
   - chạy P&C Statement → đọc được Policy Tracker;
   - gọi Web App bằng secret **cũ** → phải nhận `unauthorized`.
6. Entry tạo trong khoảng giữa bước 3 và 4 mà có warning sync: mở và lưu lại để đẩy lên Sheet.
7. Secret cũ còn trong lịch sử git nhưng đã vô dụng, **không cần** viết lại lịch sử. Chuyển `origin` sang private là việc chủ repo làm trên GitHub; Vercel deploy từ remote `vercel` (private) nên không bị ảnh hưởng.

---

### P1. Rollout SQL `supabase/rollouts/2026-10-09-rbac-cleanup.sql` (giữ local)

Chạy **TRƯỚC** khi deploy, rồi chờ ≥ 5 phút. **Code cũ chạy bình thường với dữ liệu mới**, đã kiểm từng bước:
- Bỏ `task.work` khỏi role có `task.manage`: code cũ tính `isWorker = task.work || task.manage`.
- Bỏ `lead.work` khỏi role có `lead.manage`: code cũ tính `isWorker = isManager || …`.
- Quyền mới: code cũ bỏ qua.
- Cột `is_default`: code cũ không đọc.
- Hàm SQL mới tương đương hàm cũ: Admin vẫn bị loại khỏi pool vì không còn `task.work`.

```sql
-- =====================================================================
-- Dọn RBAC: bỏ phân quyền theo tên role, Manage bao gồm Work, tách quyền
-- xem-mọi-agent của Registration khỏi Dashboard, role mặc định theo cột,
-- vá hàm assign_unassigned_task. Plan: docs/superpowers/plans/2026-10-09-remove-hardcoded-values.md
-- Chạy TRƯỚC deploy, rồi chờ ≥ 5 phút. Idempotent.
-- =====================================================================
begin;

-- 1. Dừng nếu cột cũ và role Admin lệch nhau (Bước 0.2 phải rỗng).
do $$
declare mismatched integer;
begin
  select count(*) into mismatched
  from portal_account a
  where a.is_active
    and (a.role = 'admin') <> exists (
      select 1 from user_roles ur join roles r on r.id = ur.role_id
      where ur.user_id = a.id and r.is_active and r.name = 'Admin');
  if mismatched > 0 then
    raise exception 'ROLLOUT_ABORTED: % active account(s) disagree between portal_account.role and the Admin role (Step 0.2)', mismatched;
  end if;
end $$;

-- 2. Quyền mới cho Registration (X3).
insert into permissions (key, label, description, group_key, group_label, sort_order)
values ('customer_registration.view_all', 'Registration - View All Agents',
        'See every agent''s entries in Health and P&C Customer Registration.',
        'customer_registration', 'Customer Registration', 300)
on conflict (key) do update set
  label = excluded.label, description = excluded.description,
  group_key = excluded.group_key, group_label = excluded.group_label,
  sort_order = excluded.sort_order;

-- Ai hôm nay xem được mọi agent ở Registration (có company.view_all + một quyền Registration) thì giữ được.
insert into role_permissions (role_id, permission_key)
select distinct v.role_id, 'customer_registration.view_all'
from role_permissions v
where v.permission_key = 'company.view_all'
  and exists (select 1 from role_permissions x
              where x.role_id = v.role_id
                and x.permission_key in ('customer_registration.health', 'customer_registration.pc'))
on conflict (role_id, permission_key) do nothing;

-- 3. Manage bao gồm Work (D7).
delete from role_permissions w
where w.permission_key = 'task.work'
  and exists (select 1 from role_permissions m where m.role_id = w.role_id and m.permission_key = 'task.manage');
delete from role_permissions w
where w.permission_key = 'lead.work'
  and exists (select 1 from role_permissions m where m.role_id = w.role_id and m.permission_key = 'lead.manage');

-- 4. Admin giữ lead.manage (D1 bỏ đường tắt). Admin vốn có thì câu này không làm gì.
insert into role_permissions (role_id, permission_key)
select r.id, 'lead.manage' from roles r where r.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

-- 5. Mô tả quyền khớp thực tế (giữ đồng bộ với PERMISSION_DEFINITIONS ở P2).
update permissions set description = 'Full control of Health CS tasks and Enrollment: every record, the backlog, create, assign, delete, CS Overview, SLA and table configuration. Includes Tasks - Work.' where key = 'task.manage';
update permissions set description = 'Work on Health CS tasks and Enrollment records you are part of. Puts you in the CS assignment pool.' where key = 'task.work';
update permissions set description = 'Export the Health CS task and Enrollment tables to Excel.' where key = 'task.export';
update permissions set description = 'Import Enrollment tables from Excel. Separate from Export because it overwrites rows in bulk.' where key = 'task.import';
update permissions set description = 'Import, assign and manage every lead, Lead settings and the Lead table configuration. Includes Work Leads.' where key = 'lead.manage';
update permissions set description = 'See all agents'' data in the Agent Dashboard.' where key = 'company.view_all';
update permissions set description = 'Create accounts, assign roles, update status, reset passwords, and manage Agents and Assistants.' where key = 'management.account_manager';

-- 6. Role mặc định theo cột (P9).
alter table roles add column if not exists is_default boolean not null default false;
create unique index if not exists roles_single_default_idx on roles (is_default) where is_default;
update roles set is_default = true
where name = 'Agent' and not exists (select 1 from roles where is_default);

-- 7. assign_unassigned_task: DÁN BẢN LIVE từ Bước 0.5 rồi sửa đúng hai chỗ:
--    (a) xoá dòng          `and account.role <> 'admin'`
--    (b) xoá nguyên khối   `and not exists (select 1 from user_roles ur join roles r ... r.name in ('Admin', 'Super Admin'))`
--    Admin bị loại vì đã không còn task.work, mà hàm vốn đòi task.work.
--    Ngay sau `$$;` của hàm, thêm 2 dòng theo mẫu delete_task_agent_atomic
--    (schema.sql:3679-3680). App gọi hàm bằng service role nên không ảnh hưởng.
-- create or replace function assign_unassigned_task(...) ... $$;
revoke all on function assign_unassigned_task(uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function assign_unassigned_task(uuid, text, timestamptz, text) to service_role;

commit;

-- Kiểm chứng
select r.name, string_agg(rp.permission_key, ', ' order by rp.permission_key)
from roles r join role_permissions rp on rp.role_id = r.id
where rp.permission_key in ('task.manage','task.work','lead.manage','lead.work','customer_registration.view_all','company.view_all')
group by r.name order by r.name;
-- Mong đợi: không role nào có cả manage và work của cùng module.
select name, is_default from roles where is_default;          -- mong đợi: Agent
-- Admin toàn quyền (D5): quyền nào Admin còn THIẾU. Mong đợi 0 dòng.
-- task.work và lead.work bị loại vì đã gồm trong Manage.
select p.key as admin_missing
from permissions p
where p.key not in ('task.work', 'lead.work')
  and not exists (select 1 from role_permissions rp join roles r on r.id = rp.role_id
                  where r.name = 'Admin' and rp.permission_key = p.key);
select grantee from information_schema.routine_privileges
where routine_name = 'assign_unassigned_task';                -- mong đợi: chỉ service_role (và chủ hàm)

notify pgrst, 'reload schema';

-- ROLLBACK (chỉ khi cần): dán lại nguyên bản hàm live đã lưu ở Bước 0.5.
-- Các quyền và cột mới để lại cũng không hại gì code cũ.
```

**Sửa `supabase/schema.sql`** để DB dựng mới giống production:
- Thêm `customer_registration.view_all` vào khối `insert into permissions` (dòng 199–222) và vào danh sách giữ lại (dòng 224–245). Thêm luôn `management.notification_alerts` đang thiếu ở danh sách giữ lại (L13).
- Cập nhật các mô tả như bước 5.
- Thêm cột `is_default` vào `create table roles` (dòng 67–75) và index.
- Seed role Agent có `is_default = true`.
- Seed quyền của Admin: hiện là `cross join permissions` (dòng 301–306). Đổi thành "mọi quyền **trừ** `task.work`, `lead.work`".
- Thay hàm `assign_unassigned_task` bằng bản đã sửa, kèm `revoke`/`grant`.

---

### P2. Catalog quyền trong code + "Manage bao gồm Work"

**Context:**
- `src/lib/rbac/permissions.ts` có `normalizeExclusivePermissionKeys` (dòng 38–40) nhưng hàm này chỉ lọc trùng.
- Hàm được gọi ở `api/admin/roles/route.ts:29`, `roles/[id]/route.ts:32`, `role-management.ts:128` (khi hiển thị quyền của role) và `RoleManagerClient.tsx` (`toForm`).

**Sửa `src/lib/rbac/permissions.ts`:**

```ts
export const PERMISSIONS = {
  // ...giữ nguyên...
  CUSTOMER_REGISTRATION_VIEW_ALL: "customer_registration.view_all",
} as const;

/**
 * Manage bao gồm Work. Role có Manage thì không lưu Work: tick cả hai chỉ gây
 * hiểu nhầm. Hôm nay người có `task.manage` + `task.work` vẫn bị chia task CS
 * như CS thường.
 */
export const IMPLIED_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  [PERMISSIONS.TASK_MANAGE]: [PERMISSIONS.TASK_WORK],
  [PERMISSIONS.LEAD_MANAGE]: [PERMISSIONS.LEAD_WORK],
};

/** Bỏ các quyền đã được một quyền khác bao gồm. Dùng khi LƯU quyền của role. */
export function normalizeExclusivePermissionKeys(permissionKeys: string[]) {
  const keys = new Set(permissionKeys);
  for (const [manage, implied] of Object.entries(IMPLIED_PERMISSIONS)) {
    if (keys.has(manage)) for (const key of implied) keys.delete(key);
  }
  return [...keys];
}

/** Thêm các quyền được bao gồm. Dùng khi SO quyền (trần uỷ quyền ở P7). */
export function expandImpliedPermissions(permissionKeys: readonly string[]): string[] {
  const keys = new Set(permissionKeys);
  for (const [manage, implied] of Object.entries(IMPLIED_PERMISSIONS)) {
    if (keys.has(manage)) for (const key of implied) keys.add(key);
  }
  return [...keys];
}
```

**`PERMISSION_DEFINITIONS`:**
- Thêm `CUSTOMER_REGISTRATION_VIEW_ALL` (nhóm `customer_registration`, `sortOrder: 300`).
- Sửa mô tả `task.manage`, `task.work`, `task.export`, `task.import`, `lead.manage`, `company.view_all`, `management.account_manager` **đúng như bước 5 của P1**.

**Role Manager (`src/app/(authed)/role-manager/RoleManagerClient.tsx`):**
- Trong phần render các ô quyền: nếu ô là quyền được bao gồm bởi một Manage đang tick, hiện ô đó **đã tick, mờ, không bấm được**, kèm chữ nhỏ "Included in Tasks - Manage" (hoặc "Included in Manage Leads").
- Khi user tick một Manage, bỏ Work khỏi `form.permissionKeys`.
- API vẫn tự lọc bằng `normalizeExclusivePermissionKeys`, nên UI chỉ cần hiển thị cho khớp.

**Test (`src/lib/rbac/permissions.test.ts`):**
- `normalizeExclusivePermissionKeys(["task.manage", "task.work"])` → `["task.manage"]`.
- `["task.work"]` giữ nguyên.
- `["lead.manage", "lead.work", "x"]` → `["lead.manage", "x"]`.
- `expandImpliedPermissions(["task.manage"])` chứa `task.work`.
- Có definition cho `customer_registration.view_all`.

---

### P3. Task + Enrollment: manager chỉ theo `task.manage` (D2, L2, L3, H2)

**Context:**
- `buildTaskActor` quyết định `isManager` / `isWorker` cho cả Task CS lẫn Enrollment: `lib/enrollment/access.ts` có `EnrollmentActor = TaskActor` và `loadEnrollmentActor` gọi `buildTaskActor`.
- `/config` của bảng CS, ACA, Medicare, Medicaid đi qua `loadConfigAdmin` → `canManageEnrollmentOptions(actor)` → `actor.isManager`.

**Hiện tại, `src/lib/tasks/access.ts:16-51`:**

```ts
const TASK_ADMIN_ROLE_NAMES = new Set(["Admin Health Task", "Task Admin"]);
export function isTaskViewAdmin(user: { role?: string | null; roles?: readonly string[] }): boolean {
  const roles = user.roles ?? [];
  return user.role === "admin" || roles.includes(SYSTEM_ROLE_NAMES.SUPER_ADMIN) ||
    roles.includes(LEGACY_SUPER_ADMIN_ROLE_NAME) || roles.some((role) => TASK_ADMIN_ROLE_NAMES.has(role));
}
export function buildTaskActor(permissions, email, opts?: { isAdmin?: boolean }): TaskActor {
  const hasManage = can(permissions, PERMISSIONS.TASK_MANAGE);
  return { email, isManager: hasManage && Boolean(opts?.isAdmin),
           isWorker: can(permissions, PERMISSIONS.TASK_WORK) || hasManage };
}
```

**Sửa:** xoá `TASK_ADMIN_ROLE_NAMES`, xoá `isTaskViewAdmin`, xoá import `system-roles`.

```ts
// Task CS and Enrollment share one permission pair. task.manage is the whole
// manager role — every record, the backlog, assigning, Overview, config — and
// already includes task.work. Until 2026-10-09 it also required one of four
// hard-coded role names; it no longer looks at names at all.
export function buildTaskActor(
  permissions: readonly string[] | undefined,
  email: string
): TaskActor {
  const isManager = can(permissions, PERMISSIONS.TASK_MANAGE);
  return {
    email,
    isManager,
    isWorker: isManager || can(permissions, PERMISSIONS.TASK_WORK),
  };
}
```

**Bỏ tham số thứ ba `{ isAdmin: isTaskViewAdmin(...) }` ở mọi chỗ gọi.** Việc này máy móc: `buildTaskActor(perms, email, { isAdmin: … })` thành `buildTaskActor(perms, email)`, rồi xoá import thừa (lint báo). Danh sách:
- `src/app/(authed)/tasks/page.tsx:35-37`
- `src/app/(authed)/enrollment/page.tsx:50-52`
- `src/app/api/tasks/route.ts:76,130`, `search/route.ts:20`, `assignees/route.ts:13`, `members/route.ts:13`, `assignment-queue/route.ts:18`, `notifications/route.ts:430`, `categories/route.ts:20,43`, `categories/[id]/route.ts:18`
- `src/app/api/tasks/[id]/route.ts:196`, `detail/route.ts:71`, `assign/route.ts:40`, `assignees/route.ts:33`, `assignees/[email]/route.ts:31`, `activity/route.ts:43`, `comments/route.ts:38`, `comments/[cid]/route.ts:54`, `comments/[cid]/edits/route.ts:24`, `attachments/route.ts:74`, `attachments/[aid]/route.ts:50`, `reopen/route.ts:33`, `overdue-unlock/route.ts:45`
- `src/app/api/admin/task-sla-rules/route.ts:15,37,93`, `src/app/api/admin/task-reminder-settings/route.ts:61`
- `src/lib/tasks/reaction-access.ts:38`, `src/lib/enrollment/access.ts:129-131`
- `src/lib/enrollment/recipients.ts:52-56`: thành `buildTaskActor(access.permissions, email)`

**Hai chỗ đang gọi `isTaskViewAdmin` đứng riêng:**
- `src/app/api/tasks/overview/route.ts:13`: thành `if (!buildTaskActor(session.user.permissions, session.user.email).isManager) return 403`. Từ nay CS Overview cần `task.manage` (L3).
- `src/app/(authed)/tasks/page.tsx:88-92`: `getTaskBoardTitle({ isAdmin: actor.isManager, … })`. Đổi tên tham số thành `isManager` và **giữ chữ "Admin Task Board"**. Muốn đổi chữ thì user nói.

**`src/lib/enrollment/recipients.ts:115-129`** (`fetchEnrollmentManagerEmails`): bỏ dòng kiểm `TASK_MANAGE` trùng lặp, chỉ còn `actor.isManager`.

**Sửa comment** `src/app/api/tasks/[id]/assign/route.ts:33-38` (đang nói "isTaskViewAdmin alone is a ROLE test").

**Test (`src/lib/tasks/access.test.ts`):**
- Xoá khối `describe("isTaskViewAdmin")` (dòng 56–66).
- Khối `describe("isTaskViewAdmin is not an assignment check")` (dòng 420+) viết lại thành "task.manage là đủ để giao task".
- `buildTaskActor(["task.manage"])` → isManager true, isWorker true.
- `buildTaskActor(["task.work"])` → isManager false.
- `buildTaskActor([])` → cả hai false.
- Mọi test đang truyền `{ isAdmin: true }`: bỏ tham số, giữ `"task.manage"` trong permissions.

---

### P4. Lead: chỉ quyền Lead (D1, D9, L1, X1)

**Hiện tại, `src/lib/leads/access.ts:32-65`:** `isLeadViewAdmin` (cột cũ + tên), và trong `buildLeadActor`:

```ts
const isManager = can(permissions, PERMISSIONS.LEAD_MANAGE) || Boolean(opts?.isAdmin);
const canViewAll = isManager || can(permissions, PERMISSIONS.TASK_MANAGE);
// isWorker: isManager || LEAD_WORK || TASK_MANAGE
```

**Sửa:**
- Xoá `isLeadViewAdmin`, xoá import `system-roles`.
- Xoá trường `canViewAll` khỏi `LeadActor`: không còn ai "xem hết mà không phải manager".

```ts
export function buildLeadActor(
  permissions: readonly string[] | undefined,
  email: string
): LeadActor {
  const isManager = can(permissions, PERMISSIONS.LEAD_MANAGE);
  return {
    email,
    isManager,
    isWorker: isManager || can(permissions, PERMISSIONS.LEAD_WORK),
  };
}
```

- `canViewLead` (dòng 116): `if (actor.isManager) return true;`.
- Comment của `canViewLead` bỏ chữ "account admins".

**Bỏ `{ isAdmin: isLeadViewAdmin(...) }` ở:**
- `src/app/(authed)/tasks/leads/page.tsx:35-37`, `src/app/(authed)/config/page.tsx:69-73`
- `src/app/api/leads/route.ts:28,68`, `settings/route.ts:15,32`, `assignment-roster/route.ts:34`, `distribute/route.ts:36`, `assign/route.ts:26`, `assignment-weights/route.ts:42`, `events/route.ts:18,48`, `overview/route.ts:71`, `import/route.ts:119`, `vocabulary/route.ts:29,48,73`
- `src/app/api/leads/[id]/route.ts:55,312`, `[id]/comments/route.ts:33`, `[id]/interactions/route.ts:33,82`, `[id]/attachments/route.ts:51`
- `src/lib/table-config/access.ts:49-51`

**Chỗ dùng `canViewAll` đổi sang `isManager`:**
- `tasks/leads/page.tsx:39,70`; truyền `canViewAll={actor.isManager}` ở dòng 100 để giữ nguyên prop của client;
- `api/leads/overview/route.ts:73`.

**Quyền chéo X1, bỏ `TASK_MANAGE` ở:**
- `src/app/(authed)/tasks/leads/page.tsx:29-33` → `requireAnyPermission([PERMISSIONS.LEAD_MANAGE, PERMISSIONS.LEAD_WORK])`;
- `src/app/(authed)/_components/Sidebar.tsx:138` → `anyPermission: [PERMISSIONS.LEAD_MANAGE, PERMISSIONS.LEAD_WORK]`.

**`src/lib/leads/assign-target.ts`:**
- Bỏ `legacyRole` và `roles` khỏi `LeadAssignTarget`.
- Thân hàm thành `return target.isActive && buildLeadActor(target.permissions, "").isWorker;`.
- Sửa comment.

**Test:**
- `leads/access.test.ts`:
  - Xoá test `isLeadViewAdmin`.
  - Ca `taskManager` (dòng 15, 49–54) đổi ý: `["task.manage"]` → **không** xem lead nào, `isWorker` false.
  - Thêm ca `["lead.manage"]` → manager, worker.
- `leads/assign-target.test.ts`:
  - Bỏ hai ca admin (dòng 13–21).
  - Thêm `["lead.manage"]` → true, `["task.manage"]` → false.
  - Bỏ `legacyRole` và `roles` khỏi `base`. Khối quét route giữ nguyên.

---

### P5. Role Admin: một hằng số tên, chỉ để nhận diện (D5, H1, H3, L11, L12)

**File mới `src/lib/rbac/admin-role.ts`:**

```ts
/**
 * The one role the code knows by name. The name is used ONLY to identify that
 * role for three things: it is locked, it shows the "Admin" label, and at least
 * one active account must hold it. It NEVER decides what anyone may do —
 * permissions (role_permissions ticks) do that.
 */
export const ADMIN_ROLE_NAME = "Admin";

export function isAdminRoleName(name: string | null | undefined): boolean {
  return (name ?? "").trim().toLowerCase() === ADMIN_ROLE_NAME.toLowerCase();
}
```

**Xoá `src/lib/rbac/system-roles.ts`.** Typecheck sẽ chỉ ra chỗ còn sót. Thay ở từng chỗ:

| Chỗ | Hiện tại | Sửa |
|---|---|---|
| `api/admin/roles/route.ts` (POST) | Không chặn tên | `if (isAdminRoleName(payload.name)) return 400 "Admin is a reserved role name."` |
| `api/admin/roles/[id]/route.ts:37-42, 104-110, 146-153` | `isProtectedRole` so 2 tên | `isProtectedRole(role) = isAdminRoleName(role.name)`. Giữ khoá: không sửa tên, mô tả, trạng thái, quyền; không xoá. Đổi tên role khác thành "admin" → 400 như trên |
| `role-management.ts:140-180` | Sort / ưu tiên theo 2 tên | `isAdminRoleName(role.name)` |
| `role-management.ts:247-308` | Đếm Admin theo tên + cột cũ | Xoá `countActiveUsersForRoleName`, `countActiveLegacyAdminUsers`. `hasActiveAdminOtherThan(userId)`: lấy role Admin (`roles` mà `isAdminRoleName`), đếm `user_roles` của role đó join `portal_account.is_active = true`, trừ `userId` |
| `users/[id]/route.ts:228-243, 513-533` | `targetHasSuperAdmin` = cột cũ hoặc 2 tên | `targetIsAdmin` = target có `user_roles` trỏ tới role Admin (đang bật) |
| `RoleManagerClient.tsx:78-83` | `isProtectedRole` so 2 tên | `isAdminRoleName(role.name)` |
| `AccountManagerClient.tsx:66-71` | `isAdminRole` so 2 tên | `isAdminRoleName(role.name)` (sort, màu badge) |
| `account-manager/page.tsx:174-175` | Sort theo `SYSTEM_ROLE_NAMES.SUPER_ADMIN` | `isAdminRoleName` |
| `tasks/assignees.ts:209-221` | `isAdminAccount` = cột cũ hoặc 2 tên | Chỉ `activeRoleNames.some(isAdminRoleName)`; bỏ cột `role` ở 3 câu select (dòng 86, 128, 139) |
| `tasks/overview-data.ts:113-120, 177` | `role.name === "Admin" \|\| "Super Admin"`, `account.role === "admin"` | `isAdminRoleName(role.name)`; `isAdmin = adminUserIds.has(account.id)`; bỏ `role` khỏi select dòng 36. `isAdmin` **chỉ còn dùng cho nhãn** |
| `tasks/overview.ts:463-470` | Pool CS lọc `!account.isAdmin` | **Bỏ điều kiện này** (D6). Pool = `isActive && canWork && !isAssistant && !taskAgent`. Admin tự ra khỏi pool vì không còn `task.work` (P1) |

**Test:**
- `admin-role.test.ts`:
  - `isAdminRoleName("Admin")`, `(" admin ")`, `("ADMIN")` → true;
  - `("Admin Health Task")`, `("Super Admin")`, `(null)` → false.
- `overview.test.ts`: account `isAdmin: true` mà `canWork: true` **có** nằm trong pool. Tên không quyết định; quyền quyết định.

---

### P6. Cột cũ và phiên đăng nhập (D13, D8, L9, L10, H5)

- **`src/lib/rbac/access.ts`:**
  - `UserAccess` bỏ `legacyRole` và `roles`.
  - `flattenAccess` bỏ đọc `row.role`, bỏ `getLegacyRoleFromRoleNames`.
  - `AccessRow` bỏ `role` và `name`.
  - Select của `getUserAccessByEmail`: `"id,is_active,agent_id,user_roles(roles(id,is_active,role_permissions(permission_key)))"`.
- **`src/auth.ts`:**
  - `authorize()` không trả `role` / `roles`; bỏ cột `role` ở select dòng 58.
  - Callback `jwt`: xoá mọi dòng `token.role` / `token.roles`. Trong nhánh refresh thêm `delete token.role; delete token.roles;` để thu nhỏ cookie của phiên cũ.
  - `accessProvidedAtSignIn = Boolean(user && Array.isArray(user.permissions))`.
  - Callback `session` bỏ 2 dòng `role` / `roles`.
  - Google signup (dòng 112–128): bỏ `role: "agent"` khỏi insert (cột có default); `assignDefaultRoleToUser(createdUser.id)` (P9).
- **`src/types/next-auth.d.ts`:** bỏ `role`, `roles` khỏi `Session.user`, `User`, `JWT`.
- **`src/lib/enrollment/recipients.ts`:** select `loadActiveAccounts` bỏ `role` và `name`.
- **Ngừng ghi cột `role`:**
  - `api/admin/users/route.ts:97-116` bỏ `legacyRole` và trường `role` trong insert;
  - `users/[id]/route.ts` bỏ `updates.role`;
  - select trả về bỏ `role`;
  - `AccountUser` (`domain/account.types.ts`) bỏ `role`;
  - `account-manager/page.tsx:114` bỏ `role` khỏi select, bỏ `fallbackRole` (dòng 180–188);
  - `AccountManagerClient.tsx` bỏ `user.role` trong ô tìm kiếm (dòng 191) và trong `RoleBadges` (dòng 1153–1162). Account không có role thì hiện badge "No role" (Bước 0.4 cho biết ai).
  - Kiểu `UserRole` chỉ còn dùng cho seed / script thì xoá.
- **Thông báo giám sát (D8):** xoá `fetchAdminEmails` (`tasks/membership.ts:184-196`). Thêm:

  ```ts
  /**
   * Oversight notifications (urgent backlog nobody picked up, SLA and Due Date
   * overdue, overdue resolved with a reason) go to everyone who manages tasks.
   * Never throws: callers run after the user's write has committed.
   */
  export async function fetchSupervisionRecipientEmails(): Promise<string[]> {
    try {
      return await fetchTaskManagerEmails();
    } catch {
      return [];
    }
  }
  ```

  Đổi 4 chỗ gọi:
  - `api/tasks/route.ts:409`
  - `api/tasks/[id]/overdue-unlock/route.ts:159`
  - `api/cron/check-overdue/route.ts:286`
  - `api/cron/check-overdue/route.ts:488`

  `api/tasks/route.ts` đã có luật "một người chỉ nhận MỘT dòng" (dòng 421–425), nên manager không bị trùng giữa `backlog_attention` và `task_created`.

**Test (`src/lib/rbac/access.test.ts`):**
- Xoá khối `describe("flattenAccess legacy admin")`.
- Ca đầu bỏ `expect(a.roles)`.
- Thêm ca: row `role: "admin"` mà role không có quyền nào → `permissions` rỗng (cột cũ không còn tác dụng).

---

### P7. Trần uỷ quyền, tự đổi role, bỏ đầu vào cũ (D12, L4, L5, L6)

**Context:**
- **Hôm nay:** `api/admin/users/route.ts` (POST) và `users/[id]/route.ts` (PATCH, DELETE) chỉ kiểm `management.account_manager`. `api/admin/roles/*` chỉ kiểm `management.role_manager`.
- Nên một người có Account Manager mà không phải Admin có thể:
  - gán role Admin cho bất kỳ ai, kể cả chính mình;
  - đổi mật khẩu Admin rồi đăng nhập thay;
  - gửi `role:"admin"`.
- Hiện chưa ai lợi dụng được vì chỉ Admin có hai quyền này, nhưng **luật phải theo tick** để không lệ thuộc vào hiện trạng đó.

**File mới `src/lib/rbac/delegation.ts`** (hàm thuần):

```ts
import { expandImpliedPermissions } from "@/lib/rbac/permissions";

export type DelegationResult =
  | { ok: true }
  | { ok: false; status: 400 | 403; error: string };

const OK: DelegationResult = { ok: true };

/** Keys the actor does not hold. Manage counts as holding the Work it includes. */
export function permissionsNotHeld(
  actorPermissions: readonly string[],
  keys: readonly string[]
): string[] {
  const held = new Set(expandImpliedPermissions(actorPermissions));
  return [...new Set(expandImpliedPermissions(keys))].filter((key) => !held.has(key));
}

/** Role Manager: you can only ADD permissions you hold. Removing is always allowed. */
export function checkRolePermissionChange(input: {
  actorPermissions: readonly string[];
  currentKeys: readonly string[];
  nextKeys: readonly string[];
}): DelegationResult {
  const current = new Set(input.currentKeys);
  const added = input.nextKeys.filter((key) => !current.has(key));
  const notHeld = permissionsNotHeld(input.actorPermissions, added);
  return notHeld.length === 0
    ? OK
    : { ok: false, status: 403, error: `You cannot grant permissions you do not have: ${notHeld.join(", ")}` };
}

/**
 * Account Manager: you may only touch an account whose permissions fit inside
 * your own, and only hand out a role that fits inside your own. Nobody changes
 * their own role. The Admin role holds every permission, so this alone keeps
 * Admin accounts safe — there is no "if Admin" rule anywhere.
 */
export function checkAccountChange(input: {
  actorPermissions: readonly string[];
  isSelf: boolean;
  targetPermissionKeys: readonly string[];
  /** Only when the role actually changes. */
  nextRolePermissionKeys?: readonly string[];
}): DelegationResult {
  if (!input.isSelf && permissionsNotHeld(input.actorPermissions, input.targetPermissionKeys).length > 0) {
    return { ok: false, status: 403, error: "This account has permissions you do not have." };
  }
  if (input.nextRolePermissionKeys) {
    if (input.isSelf) return { ok: false, status: 400, error: "You cannot change your own role." };
    const notHeld = permissionsNotHeld(input.actorPermissions, input.nextRolePermissionKeys);
    if (notHeld.length > 0) {
      return { ok: false, status: 403, error: `This role has permissions you do not have: ${notHeld.join(", ")}` };
    }
  }
  return OK;
}
```

**`src/lib/rbac/role-management.ts`**, thêm:
- `fetchRolePermissionKeys(roleId): Promise<string[]>`;
- `fetchUserPermissionKeys(userId): Promise<string[]>`: quyền từ các role **đang bật** của user, **không xét** `portal_account.is_active`. Lý do: tài khoản đang tắt vẫn phải được bảo vệ, kẻo bị bật lại rồi đổi mật khẩu.

**`api/admin/roles/route.ts` (POST)** và **`roles/[id]/route.ts` (PATCH có `permissionKeys`):** gọi `checkRolePermissionChange` với `actorPermissions = session.user.permissions ?? []`. `currentKeys` là `[]` khi tạo mới, là `fetchRolePermissionKeys(id)` khi sửa.

**`api/admin/users/route.ts` (POST) + `src/lib/admin/user-input.ts`:**
- Bỏ đầu vào `role` và `legacyRoleFallback`. **Bắt buộc đúng 1 `roleIds`**: đổi điều kiện `selectedRoleIds.length > 1` thành `!== 1`, thông báo "Select exactly one role for this account.". UI vốn luôn gửi `roleIds` (`AccountManagerClient.tsx:265`).
- Gọi `checkAccountChange({ actorPermissions, isSelf: false, targetPermissionKeys: [], nextRolePermissionKeys: await fetchRolePermissionKeys(roleIds[0]) })`.
- Bỏ nhánh `assignDefaultRoleToUser(data.id, selectedRole)`.

**`api/admin/users/[id]/route.ts` (PATCH):**
- Gửi `role` → 400 "Use roleIds to change the role.". Xoá khối dòng 343–356 và nhánh dòng 461–464.
- Role coi là "đổi" chỉ khi `roleIds[0]` khác role hiện tại của target (đọc `user_roles.role_id`). Khi đó `nextRolePermissionKeys = await fetchRolePermissionKeys(roleIds[0])`. Làm vậy để sửa tên chính mình mà form gửi kèm `roleIds` cũ thì không bị chặn.
- Ngay sau khi đọc target, gọi `checkAccountChange({ actorPermissions, isSelf, targetPermissionKeys: await fetchUserPermissionKeys(id), nextRolePermissionKeys })`.
- Xoá hai khối "You cannot remove your own admin role." (dòng 348–353, 378–383).
- Chặn Admin cuối cùng (P5): `targetIsAdmin && ((role đổi sang role không phải Admin) || updates.is_active === false) && !(await hasActiveAdminOtherThan(id))` → 400 "At least one active Admin account is required.".

**DELETE:** gọi `checkAccountChange` (không có `nextRolePermissionKeys`) trước luật "Admin cuối cùng".

**UI:** API là chốt chặn. Nếu dễ làm thì trong picker role của Account Manager, disable những role vượt quyền người đang dùng (client có `currentUserPermissions` hoặc truyền thêm).

**Test (`src/lib/rbac/delegation.test.ts`):**
- **`checkRolePermissionChange`:**
  - thêm quyền mình có → ok;
  - thêm quyền mình không có → 403, thông báo nêu tên key;
  - bỏ quyền mình không có → ok;
  - actor `["task.manage"]` thêm `task.work` → ok (bao gồm).
- **`checkAccountChange`:**
  - actor thiếu quyền mà target có → 403;
  - tự đổi role → 400;
  - gán role vượt quyền → 403;
  - actor đủ mọi quyền sửa account Admin → ok;
  - không đổi role mà sửa tên chính mình → ok;
  - actor `["task.manage", "management.account_manager"]` gán role `["task.work", "settings.access"]` → 403 vì thiếu `settings.access`. Với role chỉ `["task.work"]` → ok.
- `src/lib/admin/user-input.test.ts`: thiếu `roleIds` → 400; 2 `roleIds` → 400.

---

### P8. Quyền chéo X2–X6

**X2: Provider Export/Import chỉ theo quyền Provider.** `src/lib/providers/access.ts:35-51`:

```ts
/** Export / Import of the Provider List belong to the Manage tier only. */
export function canExportProviders(permissions: readonly string[] | undefined): boolean {
  return canManageProviders(permissions);
}
export function canImportProviders(permissions: readonly string[] | undefined): boolean {
  return canManageProviders(permissions);
}
```

Sửa comment đầu file (dòng 14–16 đang nói "vốn đòi task.export"). Bước 0.1(c) phải xác nhận không role nào chỉ có Finder + Export mà thiếu Manage.

**X3: Registration dùng quyền riêng.** Đổi `PERMISSIONS.COMPANY_VIEW_ALL` thành `PERMISSIONS.CUSTOMER_REGISTRATION_VIEW_ALL` ở:
- `src/app/(authed)/page.tsx:16-19`
- `src/app/(authed)/customer-registration/pc/page.tsx:14-17`
- `src/app/api/entries/route.ts:21-24`, `src/app/api/entries/[id]/route.ts`
- `src/app/api/pc-entries/route.ts:33-36`, `src/app/api/pc-entries/[id]/route.ts`

Dashboard (`dashboard/*`, `ai/dashboard-chat`, `dashboard-filter-defaults`) **giữ** `company.view_all`.

**X4:** `src/app/api/dashboard-filter-defaults/route.ts:137`: xoá dòng `if (can(permissions, PERMISSIONS.ROLE_MANAGER)) return true;`.

**X5: Chuông cho mọi người đã đăng nhập.**
- `src/app/(authed)/layout.tsx:43-46`: bỏ prop `canUseTasks`.
- `TopBar.tsx:14,17,52`: luôn render `<NotificationBell />`.
- Đã kiểm: chuông chỉ gọi `/api/tasks/notifications`, `?mode=summary`, `/read`, và các route này chỉ đòi đăng nhập. Nội dung Enrollment đã được che theo `canAccessEnrollment` (`notifications/route.ts:430-440`).
- Khi code: thử bằng một tài khoản không có quyền Task (role Accounting) để chắc chuông không gọi API nào trả 403.

**X6: Agent membership theo quyền của trang Account Manager.**
- `account-manager/page.tsx:61`: bỏ `loadConfigAdmin()`. Trang đã `requirePermission(ACCOUNT_MANAGER)` ở dòng 94, nên `loadAgentMembership` luôn nạp.
- `api/config/agents/route.ts` và `api/config/assistants/route.ts` (GET, POST, DELETE): thay `loadConfigAdmin()` bằng kiểm `can(session.user.permissions, PERMISSIONS.ACCOUNT_MANAGER)`, trả 401/403 như cũ. Các handler đang dùng `admin.actor.email` thì lấy `session.user.email`.
- Sửa comment ở `AgentMembershipSection.tsx:33-34` và `account-manager/page.tsx:53-56`.
- **Ai thấy khác:** 5 người Admin Health Task và Linh Le mất quyền gọi thẳng 2 API này. Họ vốn không vào được trang Account Manager nên không thấy khác.

**Đồng bộ trang đích:** `src/lib/rbac/routes.ts:63-66` (`/config`) đổi `permission: TASK_MANAGE` thành `anyPermission: [TASK_MANAGE, LEAD_MANAGE, AUTOMATION_PROVIDER_MANAGE]`, khớp với mục menu ở `Sidebar.tsx:157-161`.

---

### P9. Role mặc định theo cột `is_default` (D14, H4)

Cột đã tạo ở P1.

- **`src/lib/rbac/access.ts:72-91`:** `assignDefaultRoleToUser(userId)` bỏ tham số `legacyRole`. Select thành `.from("roles").select("id").eq("is_default", true).eq("is_active", true).maybeSingle()`. Không tìm thấy thì `console.error("[rbac] no active default role")` thay vì im lặng.
- **`src/auth.ts:127`:** `assignDefaultRoleToUser(createdUser.id)`.
- **`role-management.ts`:** `RoleRecord` và `RoleOption` thêm `is_default`. Các select role (`fetchRolesWithPermissions`, `fetchRoleById`, `fetchActiveRolesByIds`) thêm cột này.
- **`AccountManagerClient.tsx:155-158`:** `defaultRoleIds` lấy `availableRoles.find((role) => role.is_default)`.
- **Role Manager:**
  - hiện badge "Default" (chỉ hiển thị);
  - API `roles/[id]` không cho xoá hoặc tắt role mặc định: 400 "Choose another default role first.";
  - đổi role mặc định làm bằng SQL, ghi vào changelog.
- `getDefaultSystemRoleName` đã xoá cùng `system-roles.ts` (P5).

---

### P10. Giá trị lặt vặt (D16, H7, H8)

**`src/lib/notifications/push-server.ts:51`:**
- Đổi thành `const subject = process.env.VAPID_SUBJECT?.trim();`.
- Điều kiện thành `if (!publicKey || !privateKey || !subject) { vapidConfigured = false; return false; }`.
- Sửa comment phía trên hàm.
- **⚠ Trước khi deploy:** xác nhận Vercel Production **đã có** `VAPID_SUBJECT` (`vercel env ls production | grep VAPID` hoặc xem dashboard). Nếu chưa có thì thêm, ví dụ `mailto:` hộp thư chung. Nếu không, push ngừng.

**`scripts/seed-enrollment-samples.mjs`:**
- Thay email thật (khoảng 10 chỗ) và `SEED_ACTOR` bằng hằng số đọc từ `process.env.SEED_PRIMARY_EMAIL`, `SEED_SECONDARY_EMAIL`, `SEED_ACTOR_EMAIL`. Script đã nạp `.env.local` ở dòng 12.
- Thiếu biến thì in hướng dẫn rồi `process.exit(1)`.
- Thêm 3 key (để trống) vào `.env.local.example`.

---

### P11. Test chặn tái phát

**`src/lib/rbac/no-role-name-authz.test.ts`.** Quét `src/**/*.{ts,tsx}` trừ `*.test.*` và fail nếu gặp:
- chuỗi `"Super Admin"`, `"Admin Health Task"`, `"Task Admin"`;
- regex `/\.role\s*[!=]==?\s*["']admin["']/`;
- regex `/name\s*[!=]==?\s*["'][A-Z]/` (so tên với chuỗi trần);
- `ADMIN_ROLE_NAME` / `isAdminRoleName` được import ngoài danh sách cho phép: `api/admin/roles/*`, `api/admin/users/*`, `role-management.ts`, `tasks/assignees.ts`, `tasks/overview-data.ts`, `account-manager/*`, `role-manager/*`.

**`src/lib/rbac/module-boundaries.test.ts`.** Mỗi thư mục chỉ được dùng quyền của module nó. Quét `PERMISSIONS\.([A-Z_]+)` theo đường dẫn:

| Đường dẫn | Chỉ được dùng |
|---|---|
| `src/lib/leads/`, `src/app/api/leads/`, `src/app/(authed)/tasks/leads/` | `LEAD_*` |
| `src/lib/providers/`, `src/app/api/automation/provider-*`, `src/app/(authed)/tasks/providers/` | `AUTOMATION_PROVIDER_*` |
| `src/app/api/entries/`, `src/app/api/pc-entries/`, `src/app/(authed)/page.tsx`, `src/app/(authed)/customer-registration/` | `CUSTOMER_REGISTRATION_*` |
| `src/lib/tasks/`, `src/lib/enrollment/`, `src/app/api/tasks/`, `src/app/api/enrollment/`, `src/app/(authed)/tasks/page.tsx`, `src/app/(authed)/enrollment/` | `TASK_*` |
| `src/app/(authed)/dashboard/`, `sales-dashboard/`, `src/app/api/ai/dashboard-chat/`, `src/app/api/dashboard-filter-defaults/` | `AGENT_DASHBOARD_*`, `COMPANY_DASHBOARD_*`, `COMPANY_VIEW_ALL` |

Miễn trừ: `Sidebar.tsx`, `lib/rbac/routes.ts`, `(authed)/layout.tsx` (sổ điều hướng liệt kê mọi module). Thông báo lỗi: "Quyền chéo: <file> dùng <key> của module khác. Xem plan 2026-10-09."

---

## 7. Thứ tự triển khai và rollback

**Làm từng phase một:** xong phase nào thì báo kết quả rồi **dừng chờ user** trước khi sang phase sau, theo cách user muốn làm lại RBAC.

1. **P0 ngay**, độc lập: sửa `Code.gs`, rồi chủ repo làm runbook.
2. **Bước 0** (mục 4): hỏi user rồi chạy, đọc kết quả, xác nhận (a)–(e).
3. **Code P2 → P11** trên `main` (hoặc nhánh ngắn nếu user muốn), mỗi phase một lượt. Cổng kiểm sau mỗi phase: `npm run typecheck && npm run lint && npm run test:run && npm run build`. Ghi `changelog.md`. Không commit / push khi user chưa bảo.
4. **Hỏi user rồi** chạy **`2026-10-09-rbac-cleanup.sql`** (P1) qua CLI, đọc các câu kiểm chứng.
5. **Chờ ≥ 5 phút** để JWT nạp lại quyền.

   **Nếu deploy từng phase**, SQL P1 phải chạy **trước** khi deploy ba phase sau:
   - **P5**: nếu chưa chạy, Admin còn `task.work` nên sẽ lọt vào nhóm chia task CS;
   - **P8-X3**: nếu chưa chạy, người đang xem mọi agent ở Registration sẽ mất quyền đó;
   - **P9**: cần cột `is_default`.

   Các phase P2, P3, P4, P6, P7, P10, P11 không phụ thuộc SQL.
6. Xác nhận `VAPID_SUBJECT` có trên Vercel. **Deploy chỉ khi user bảo push.**
7. Kiểm tay theo mục 8.

**Rollback:** revert deploy là đủ. Code cũ vẫn chạy với dữ liệu mới:
- tên role không đổi;
- `company.view_all` vẫn còn trên role;
- `task.manage` / `lead.manage` vẫn được code cũ coi là worker;
- cột `portal_account.role` có default `'agent'`, và code cũ cũng nhận Admin qua tên role.

Riêng hàm SQL thì chạy khối ROLLBACK của rollout.

---

## 8. Kiểm thử

**Tự động:** test ở từng phase, cộng 4 lệnh ở bước 7.3.

**Kiểm tay trên production sau deploy:**

| Tài khoản | Phải thấy |
|---|---|
| **Admin** | Mọi thứ như cũ: "Admin Task Board", backlog, Overview, config, Lead đầy đủ, Account/Role Manager. Role Admin vẫn khoá. **Không** nằm trong nhóm CS ở Overview |
| **Admin Health Task** | Board manager và Overview như cũ. Mục Lead vẫn có nhưng chỉ thấy lead của mình / Agent mình phụ (Kay: 10 lead của Khang), không còn tab Overview Lead. Bắt đầu nhận thông báo giám sát (D8) |
| **Linh Le** | **Thành manager Task / Enrollment** (D2): backlog, Overview, giao task cho mọi agent. Lead: chỉ thấy 9 lead của mình, không còn tab Overview Lead. Registration vẫn xem mọi agent (X3). Provider Export/Import vẫn có (có Manage) |
| **Task CS** | Không đổi gì |
| **Health Agent** | Không đổi gì |
| **Accounting** (không có quyền Task) | **Thấy chuông**, nhận thông báo Time Off của mình (X5) |
| **Role Manager** | Tick "Tasks - Manage" thì ô "Tasks - Work" tự mờ. Có ô mới "Registration - View All Agents". Role Admin khoá. Tạo role tên "admin" → bị từ chối. Badge "Default" ở role Agent |
| **Account Manager** | Tạo user phải chọn role. Phần Agent membership vẫn sửa được (Admin) |
| **Overview → Assign** | Giao cho CS chạy bình thường; picker không có Admin hay manager |
| **Gọi `assign_unassigned_task` bằng anon key** (curl tới PostgREST) | Bị từ chối |
| **Web push** | Vẫn tới (P10) |

---

## 9. Ai thấy khác (tổng hợp)

| Người / nhóm | Thay đổi |
|---|---|
| Linh Le | **Thêm**: manager Task + Enrollment, CS Overview, cấu hình bảng Health, thông báo giám sát + manager Enrollment. **Mất**: xem mọi lead + tab Overview Lead (vẫn làm 9 lead của mình nhờ `lead.work`) |
| Admin Health Task (5: Admin QA, Bao Vo Test, Charlotte To, Dung Ha, Kay Huynh) | **Mất**: xem mọi lead + tab Overview Lead; quyền ẩn gọi API Agent membership. **Thêm**: thông báo giám sát. Vẫn làm lead của mình / Agent mình phụ nhờ `lead.work` (Kay: 10 lead của Khang) |
| Ha Nguyen (Accounting), Jackie (Referrals) | **Thêm**: chuông thông báo |
| Role Sub Admin (0 người) | Ai được gán sau này sẽ là manager Task |
| Người không có quyền Task | **Thêm**: chuông thông báo |
| Admin, Task CS, Health Agent, còn lại | Không đổi |
| Người quản trị role | Ô Work tự bỏ khi có Manage; ô mới "Registration - View All Agents"; "View All Agents" chỉ còn Dashboard; tên "Admin" dành riêng; badge "Default" |

---

## 10. Không sửa (cố ý)

| Thứ | Lý do |
|---|---|
| Múi giờ `America/Chicago` | Luật nghiệp vụ, đã gom một chỗ |
| SLA dự phòng 60/240/480/1440 phút trong SQL; `OVERVIEW_THRESHOLDS` | Chỉ dùng khi chưa có `task_sla_rules`; đã cấu hình được |
| URL Google Maps / ArcGIS / Follow Up Boss | Endpoint công khai |
| Nhãn UI "Agent", "CS", "Assistant" | Chữ hiển thị |
| Tên role trong các file rollout cũ | Lịch sử đã chạy |
| Lead và Enrollment dùng chung danh sách Agent / Assistant (`task_agents`, `agent_members`) | Dữ liệu dùng chung, không phải quyền |
| Menu nhóm "Task Management" chứa Lead và Provider | Chỗ đặt menu; mỗi mục theo quyền riêng |
| Provider Manage cần kèm Finder | Hai tầng trong cùng module |
| Notification Alerts chỉ thao tác được trong trang Account Manager | Cùng nhóm Management; chỉ Admin có cả hai quyền |
| Xoá cột `portal_account.role` | Plan sau, khi chắc không còn script nào đọc |
| Dashboard lọc theo tên hiển thị | Không phải hard code; nằm trong audit RBAC (S1) |

---

## 11. Changelog (nháp, ghi vào `changelog.md` lúc code)

```md
## 2026-10-XX — Phân quyền chỉ theo ô tick: bỏ tên role, bỏ quyền chéo

- **Task + Enrollment:** `task.manage` là manager đầy đủ, không còn cần role tên "Admin" / "Admin Health Task" / "Task Admin". CS Overview đòi `task.manage`. Linh Le (role "Linh Le") thành manager.
- **Lead:** manager chỉ theo `lead.manage`; bỏ đường tắt "admin là manager". `task.manage` không còn cho xem Lead.
- **Manage bao gồm Work** (Task, Lead): Role Manager tự bỏ ô Work khi tick Manage. Rollout bỏ Work ở Admin, Linh Le, Sub Admin. Chia task CS chỉ theo `task.work`, bỏ luật "trừ Admin".
- **Role Admin:** tên dành riêng, khoá, nhãn "Admin", luôn còn ≥ 1 Admin. Tên không quyết định quyền. Bỏ "Super Admin".
- **Uỷ quyền:** chỉ gán role / sửa tài khoản khi quyền của nó nằm trong quyền của mình; không tự đổi role; API tạo / sửa user bỏ trường `role` cũ, bắt buộc chọn 1 role.
- **Cột `portal_account.role`:** ngừng đọc, ngừng ghi.
- **Thông báo giám sát:** gửi cho người có `task.manage` (trước: cột cũ = 3 Admin).
- **Quyền chéo đã bỏ:**
  - `task.export` / `task.import` → Provider (giờ chỉ Provider Manage);
  - `company.view_all` → Registration (quyền mới `customer_registration.view_all`);
  - `role_manager` → bộ lọc Dashboard;
  - quyền Task → chuông (giờ ai cũng thấy);
  - task manager → Agent membership (giờ theo Account Manager).
- **RPC `assign_unassigned_task`:** bỏ so tên / cột cũ; thu quyền gọi của anon / authenticated.
- **Role mặc định:** cột `roles.is_default` (Agent).
- **SQL rollout (chạy TRƯỚC deploy, rồi chờ 5 phút):** `supabase/rollouts/2026-10-09-rbac-cleanup.sql`.
- **Apps Script:** secret và ID Sheet sang Script Properties; secret đã đổi. `VAPID_SUBJECT` bắt buộc.
```
