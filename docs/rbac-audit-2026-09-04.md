# RBAC & Phân quyền — Bản đồ hiện trạng

**Ngày:** 2026-09-04 · **Mục đích:** làm nền để dọn lại hệ thống phân quyền.
Mọi khẳng định trong file này đều đã đối chiếu source, có `file:dòng`.

---

## 0. Tóm tắt cho người đọc vội

Hệ thống hiện có **4 nguồn quyền lực chạy song song**, không phải một:

| # | Nguồn | Ở đâu | Ai sửa được |
|---|---|---|---|
| 1 | **RBAC permission** (20 khoá) | `role_permissions` → `user_roles` → `roles` | Role Manager (UI) |
| 2 | **Cột legacy `portal_account.role`** (`admin` \| `agent`) | Bảng `portal_account` | Account Manager (UI) |
| 3 | **TÊN role bị hard-code trong code** | `src/lib/tasks/access.ts:17-20` | **Chỉ sửa được bằng deploy** |
| 4 | **Bảng thành viên** `task_agents`, `agent_members` | 2 bảng riêng | Config (UI) |

Nguồn #3 là chỗ nguy hiểm nhất: **đổi tên một role trong Role Manager sẽ âm thầm hạ quyền toàn bộ người trong role đó**, không có cảnh báo nào.

Và cùng một dòng code trông giống hệt nhau lại có **nghĩa ngược nhau** giữa hai module (§5.1).

---

## 1. Danh mục permission (20 khoá)

Nguồn: `src/lib/rbac/permissions.ts`. Cả 20 đều có `PERMISSION_DEFINITIONS` nên đều hiện trong Role Manager.

| Khoá | Nhóm | Mở khoá cái gì |
|---|---|---|
| `customer_registration.health` | Customer Registration | Trang `/` (nhập liệu Health) + `/api/entries` |
| `customer_registration.pc` | Customer Registration | Trang `/customer-registration/pc` + `/api/pc-entries` |
| `automation.health_statement` | Automation | `/automation/health-statement` + 2 API |
| `automation.pc_statement` | Automation | `/automation/pc-statement` + 5 API |
| `automation.provider_finder` | Automation | `/automation/provider-finder` + 1 API |
| `agent_dashboard.health` | Dashboard | `/dashboard/health` — góc nhìn **một agent** |
| `agent_dashboard.pc` | Dashboard | `/dashboard/pc` — góc nhìn **một agent** |
| `company_dashboard.health` | Dashboard | `/dashboard/health?view=sales`, `/sales-dashboard/health` — góc nhìn **toàn công ty** |
| `company_dashboard.pc` | Dashboard | `/sales-dashboard/pc` — góc nhìn **toàn công ty** |
| **`company.view_all`** | Dashboard | **Không mở trang nào.** Đây là quyền **PHẠM VI DỮ LIỆU**: bỏ bộ lọc "chỉ dòng của tôi" ở `/api/entries`, `/api/pc-entries` và dashboard |
| `management.account_manager` | Management | `/account-manager` + `/api/admin/users*` |
| `management.role_manager` | Management | `/role-manager` + `/api/admin/roles*`, `/api/admin/permissions` |
| `timeoff.user` | Time Off | `/time-off` — phần của chính mình |
| `timeoff.admin` | Time Off | `/time-off` — tab quản trị, duyệt đơn, chỉnh quỹ |
| `settings.access` | Settings | `/settings` + đổi mật khẩu / hồ sơ |
| `task.manage` | Task | Điều kiện **cần** để thành Task manager; gác `/config`; gác Enrollment |
| `task.work` | Task | Vào được board `/tasks` và `/enrollment` |
| `task.export` | Task | Nút Export ở `/api/tasks/export` và `/api/enrollment/export` |
| `lead.manage` | Lead | Quản Event Leads: gán, import, chia pool, cấu hình bảng lead |
| `lead.work` | Lead | Xem + ghi tương tác trên lead **của mình** |

**Không tồn tại permission nào cho Enrollment.** Module Enrollment dùng nguyên `task.manage` / `task.work` (§5.3).

---

## 2. Cổng gác cấp TRANG

`src/lib/rbac/server.ts` cung cấp `requirePermission` / `requireAnyPermission`. Không đạt thì **redirect** về trang đầu tiên truy cập được (`getFirstAccessiblePath`, `src/lib/rbac/routes.ts`), không phải 403.

| Trang | Cổng | Ghi chú |
|---|---|---|
| `/` | `customer_registration.health` | Dữ liệu lọc thêm bằng `company.view_all` |
| `/customer-registration/pc` | `customer_registration.pc` | như trên |
| `/automation/*` (3 trang) | permission tương ứng | |
| `/dashboard/health` | ANY(`agent_dashboard.health`, `company_dashboard.health`) | 2 quyền → 2 góc nhìn khác nhau trong cùng trang |
| `/dashboard/pc` | ANY(`agent_dashboard.pc`, `company_dashboard.pc`) | |
| `/sales-dashboard/health` | `company_dashboard.health` | |
| `/sales-dashboard/pc` | `company_dashboard.pc` | |
| `/tasks` | ANY(`task.manage`, `task.work`) | |
| `/tasks/leads` | ANY(`lead.manage`, `lead.work`) | + `redirect("/unauthorized")` cho tab Overview nếu không phải manager |
| `/enrollment` | ANY(**`task.manage`, `task.work`**) | ⚠ dùng quyền của module khác |
| `/config` | **KHÔNG có `requirePermission`** | Gác bằng `loadConfigAdmin()` + `configScopesFor()` — §4.3 |
| `/time-off` | **KHÔNG có `requirePermission`** | Gác bằng `getTimeOffActor()`, null → `/unauthorized` |
| `/account-manager` | `management.account_manager` | |
| `/role-manager` | `management.role_manager` | |
| `/settings` | `settings.access` | |

**Chỉ là redirect, không phải trang thật:** `/dashboard`, `/sales-dashboard`, `/dashboard/life`, `/sales-dashboard/life`, `/leads`, `/leads/config`. Không cần gác.

---

## 3. Cổng gác cấp API (104 route)

Đã rà **toàn bộ** `src/app/api/**/route.ts`. **Không có route nào hở** — nhưng chúng dùng **7 kiểu gác khác nhau**:

| Kiểu gác | Số route | Dùng ở đâu |
|---|---|---|
| `requirePermission` / `requireAnyPermission` | ~20 | automation, entries, pc-entries, admin/*, settings, dashboard-filter-defaults, ai/* |
| `isTaskViewAdmin` + `buildTaskActor` | ~25 | `/api/tasks/**`, `/api/admin/task-*` |
| `loadEnrollmentActor` | ~17 | `/api/enrollment/**` |
| `isLeadViewAdmin` + `buildLeadActor` | ~13 | `/api/leads/**` |
| `getTimeOffActor` | ~11 | `/api/time-off/**` |
| `loadConfigAdmin*` / `loadConfigActor*` | ~10 | `/api/config/**` |
| Chỉ session email | ~4 | `/api/tasks/notifications*` (tự lọc theo `recipient_email`) |
| `authorizeTaskReactionAccess` | 4 | reactions của task/enrollment |
| Cron secret | 4 | `/api/cron/**` |

---

## 4. Bốn luật "tôi có phải admin không" — KHÁC NHAU

Đây là phát hiện trung tâm của bản audit.

### 4.1 Task — `isTaskViewAdmin` (`src/lib/tasks/access.ts:17-36`)

```ts
const TASK_ADMIN_ROLE_NAMES = new Set([
  "Admin Health Task",
  "Task Admin",
]);

user.role === "admin"                       // cột legacy
  || roles.includes("Admin")                // SYSTEM_ROLE_NAMES.SUPER_ADMIN
  || roles.includes("Super Admin")           // LEGACY_SUPER_ADMIN_ROLE_NAME
  || roles.some(r => TASK_ADMIN_ROLE_NAMES.has(r))   // TÊN hard-code
```

⚠ **Bốn nguồn, trong đó hai là TÊN role viết cứng trong code.** Admin đổi tên role `"Task Admin"` → `"Quản trị Task"` trong Role Manager thì mọi người trong role đó **mất quyền manager ngay lập tức**, không lỗi, không cảnh báo.

### 4.2 Lead — `isLeadViewAdmin` (`src/lib/leads/access.ts:30-40`)

```ts
user.role === "admin" || roles.includes("Admin") || roles.includes("Super Admin")
```

Không có danh sách tên role riêng cho lead. **Khác luật task.**

### 4.3 Config — hai luật trong một màn hình (`src/lib/table-config/access.ts`)

| Bảng | Ai được ĐỌC | Ai được GHI |
|---|---|---|
| `cs`, `aca`, `medicare` | `loadConfigActor()` → `loadEnrollmentActor()` | `loadConfigAdmin()` → `task.manage` **VÀ** vai trò task-admin |
| `lead` | `canWorkLeads()` | `canManageLeads()` |

`configScopesFor()` (`scope-access.ts:24`) cắt danh sách bảng theo cờ đã tính. Lý do tách được ghi rõ trong code: 2 tài khoản production chỉ có `lead.manage`.

### 4.4 Time Off — `canManageTimeOff` (`src/lib/time-off/access.ts:14-18`)

```ts
can(user.permissions, PERMISSIONS.TIME_OFF_ADMIN)
```

**Thuần permission.** Không đụng cột legacy, không đụng tên role. Đây là mô hình **sạch nhất** trong hệ thống và là hình mẫu nên nhân rộng.

---

## 5. Actor model từng module

### 5.1 ⚠ Cùng hình dạng code, NGHĨA NGƯỢC NHAU

```ts
// src/lib/tasks/access.ts:44-50
isManager: hasManage && Boolean(opts?.isAdmin)      // VÀ

// src/lib/leads/access.ts:50-51
isManager: can(permissions, LEAD_MANAGE) || Boolean(opts?.isAdmin)   // HOẶC
```

**Hệ quả cụ thể:** một người được cấp `task.manage` **và** `lead.manage`, nhưng role không nằm trong `TASK_ADMIN_ROLE_NAMES`:

- Ở **Lead**: là manager đầy đủ — gán lead, import, chia pool, sửa cấu hình bảng lead.
- Ở **Task**: **không** phải manager — không tạo được task, không gán được, không thấy Backlog, không thấy Overview.

Cùng một người, cùng một buổi, hai màn hình cho hai quyền khác nhau. Không có gì trên giao diện giải thích vì sao.

### 5.2 `isWorker`

| Module | Luật |
|---|---|
| Task | `task.work` **hoặc** `task.manage` (`access.ts:49`) |
| Lead | `lead.work` **hoặc** `isManager` (`access.ts:55`) |

### 5.3 Enrollment không có model riêng

`src/lib/enrollment/access.ts:9` — `export type EnrollmentActor = TaskActor;`
`loadEnrollmentActor()` gọi thẳng `buildTaskActor`. `canManageEnrollmentOptions(actor) = actor.isManager`.

→ Enrollment **thừa hưởng toàn bộ** luật task, kể cả danh sách tên role hard-code ở §4.1.

---

## 6. Phạm vi DỮ LIỆU — ai thấy dòng nào

Quyền mở được trang **không** quyết định thấy dòng nào. Bốn module có bốn luật riêng.

### 6.1 Task — `resolveTaskQueueScope` (`src/lib/tasks/membership.ts:98-116`)

```
isManager                          → thấy TẤT CẢ
không phải worker                  → không thấy gì
worker KHÔNG có trong task_agents
        VÀ không assist agent nào   → thấy TẤT CẢ   ← "plain-CS", hàng đợi toàn công ty
worker LÀ agent hoặc assistant     → chỉ task của các agent mình phụ trách
                                     + task mình được gán / tham gia / báo cáo
```

⚠ **Một CS bình thường (không phải agent, không assist ai) thấy TOÀN BỘ task của công ty.** Đây là quyết định có chủ đích (chốt 2026-08-02), nhưng nó nghĩa là `task.work` một mình = quyền đọc toàn công ty.

Mở rộng **CHỈ quyền ĐỌC** — mọi hàm mutate vẫn đọc cờ riêng của chúng (`access.ts:89-93`).

### 6.2 Enrollment — `resolveEnrollmentScope` (`src/lib/enrollment/scope.ts:37-77`)

Cùng khuôn với task: manager thấy hết; worker không-agent-không-assistant thấy hết; agent/assistant bị thu hẹp về agent mình phụ trách **cộng** dòng mình là creator / caller / responsible.

### 6.3 Lead — `resolveLeadOwnerEmails` (`src/lib/leads/membership.ts:22-29`)

```
isManager  → null (không giới hạn)
còn lại    → [email của mình] + [các agent mình assist]
```

**Khác hẳn task/enrollment: KHÔNG có khái niệm "plain-CS thấy hết".** Worker lead chỉ thấy lead của chính mình.

### 6.4 Customer Registration — `company.view_all`

`/api/entries`, `/api/pc-entries`: có `company.view_all` → mọi dòng; không có → chỉ dòng của email mình. Đây là permission **duy nhất** thuần phạm vi dữ liệu.

### 6.5 Dashboard

`agent_dashboard.*` = góc nhìn một agent · `company_dashboard.*` = toàn công ty. Hai quyền, cùng một trang, hai bộ dữ liệu.

---

## 7. Bảng thành viên (không phải RBAC nhưng quyết định quyền)

| Bảng | Cột | Nghĩa |
|---|---|---|
| `task_agents` (`schema.sql:3451`) | `email` | Ai được coi là "agent". Có tên ở đây = **mất** quyền xem toàn công ty, bị thu hẹp về phạm vi agent |
| `agent_members` (`schema.sql:3459`) | `agent_email`, `cs_email` | CS nào assist agent nào. Assistant có quyền như agent owner trên task của agent đó |

⚠ Hai bảng này **không xuất hiện ở Role Manager**. Một người có thể bị đổi phạm vi dữ liệu mà không có thay đổi nào trong RBAC.

---

## 8. Danh sách vấn đề để dọn

Xếp theo mức độ, kèm bằng chứng.

| # | Vấn đề | Bằng chứng | Mức |
|---|---|---|---|
| 1 | **Tên role hard-code trong code.** Đổi tên role trong Role Manager = âm thầm hạ quyền | `tasks/access.ts:17-20` | 🔴 Cao |
| 2 | **`isManager` dùng toán tử ngược nhau** giữa task (VÀ) và lead (HOẶC) | `tasks/access.ts:47` vs `leads/access.ts:51` | 🔴 Cao |
| 3 | **Hai mô hình quyền chạy song song** — cột legacy `portal_account.role` chưa gỡ | `system-roles.ts:1-15` (đã tự ghi là nợ kỹ thuật) | 🟠 Vừa |
| 4 | **Enrollment không có permission riêng**, mượn `task.*` | `enrollment/access.ts:9` | 🟠 Vừa |
| 5 | **4 luật "admin" khác nhau** cho 4 module | §4 | 🟠 Vừa |
| 6 | **`task.work` một mình = đọc toàn công ty** cho plain-CS | `tasks/membership.ts:113` | 🟠 Vừa — có chủ đích, nhưng tên quyền không nói lên điều đó |
| 7 | **`task_agents` / `agent_members` đổi phạm vi dữ liệu nhưng không nằm trong RBAC UI** | §7 | 🟠 Vừa |
| 8 | **7 kiểu gác API khác nhau** — người thêm route mới phải đoán dùng kiểu nào | §3 | 🟡 Thấp |
| 9 | `/config` và `/time-off` không dùng `requirePermission` như 13 trang còn lại | §2 | 🟡 Thấp |
| 10 | `company.view_all` là quyền phạm-vi-dữ-liệu nằm lẫn trong nhóm "Dashboard" | `permissions.ts:10` | 🟡 Thấp |

---

## 9. Câu hỏi cần chốt trước khi dọn

1. **Bỏ hẳn cột legacy `portal_account.role` được không?** Nó đang là một trong 4 nguồn quyết định admin. Gỡ được thì #1, #3, #5 nhẹ đi rất nhiều.
2. **`TASK_ADMIN_ROLE_NAMES` nên thay bằng gì?** Đề xuất: một permission mới `task.admin` — quyền thì Role Manager quản được, tên role thì không.
3. **Task và Lead nên dùng chung một luật `isManager` không?** Nếu có thì chọn VÀ hay HOẶC — đây là quyết định nghiệp vụ, không phải kỹ thuật.
4. **Enrollment có nên có permission riêng** (`enrollment.manage` / `enrollment.work`) không, hay cố ý dùng chung với task?
5. **"Plain-CS thấy toàn bộ task công ty"** còn đúng ý không? Nếu có, nên đổi tên quyền cho đúng nghĩa.
