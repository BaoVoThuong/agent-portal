# Authz — sửa theo review toàn nhánh `feat/authz` (Codex A–H + review độc lập)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Đưa toàn bộ dữ liệu **phân quyền + account + roster** của hệ authz mới vào bảng riêng `authz_*`, để khi bản `feat/authz` THAY `main` cho mọi người dùng mà có lỗi thì chỉ cần deploy lại `main` — bảng phân quyền production còn nguyên, DB không phải làm gì. Nếu bản authz chạy ổn, bảng `authz_*` trở thành bảng chính thức và bảng phân quyền cũ bị gỡ ở một giai đoạn sau (plan riêng — xem "Giai đoạn chốt" cuối file). (2) Đóng mọi lỗi còn mở mà 8 bản review Codex theo phase, bản review Codex tổng hợp, một lượt review độc lập và review Codex của chính plan này tìm thấy.

**Architecture:** Phân quyền dùng grant `action:scope` (xem "Bối cảnh"). Nhóm 0 dựng bảng `authz_accounts`, `authz_roles`, `authz_user_roles`, `authz_role_grants`, `authz_audit`, `authz_commission_names`, `authz_commission_name_history`, `authz_task_agents`, `authz_agent_members` với cột khai báo tường minh (thiết kế như bảng lâu dài, không phải bản sao `LIKE`), cùng các hàm `authz_*`. Dữ liệu ban đầu được nạp bằng MỘT hàm SQL chạy trong một transaction (`authz_sync_from_production`): chỉ SELECT bảng production, ghi `authz_*`, tự kiểm trước khi ghi. Code mới đọc/ghi phân quyền chỉ qua `authz_*`; dữ liệu nghiệp vụ (task, hồ sơ, đơn nghỉ, push, hàng đợi…) vẫn ghi vào bảng hiện hữu **y như `main` ghi** (cùng schema, cùng ý nghĩa) nên `main` đọc lại bình thường sau rollback. Toàn bộ SQL mới nằm trong `supabase/rollouts/2026-10-03-authz-isolated.sql` — đây là file DUY NHẤT chạy trên DB thật (cùng `2026-09-26-rls-lockdown.sql`); `supabase/schema.sql` chỉ dùng cài DB mới/DB tạm. Các rollout authz cũ B/C/D/G/H/review-fixes bị gỡ khỏi nhánh (chưa từng chạy trên production).

> **QUYẾT ĐỊNH CỦA CHỦ REPO — đã chốt, KHÔNG phải lỗi để review bắt lại** (hỏi 2026-09-26, xác nhận lại 2026-09-27 sau review Codex lần 2: "vẫn giữ phương án 1… plan giữ nguyên hướng hiện tại"):
> 1. **Phạm vi "không đụng production"** = không ghi **7 bảng phân quyền** (`portal_account`, `roles`, `user_roles`, `role_permissions`, `permissions`, `task_agents`, `agent_members`) + không đổi **cấu trúc** bất kỳ bảng/hàm hiện hữu nào. KHÔNG phải "mọi bảng hiện hữu chỉ đọc". Chủ repo đã được trình bày hai phương án: (1) bản authz THAY `main` cho mọi người, bảng nghiệp vụ ghi như `main`; (2) data plane tách biệt (DB riêng) — dữ liệu nghiệp vụ phát sinh lúc chạy bản authz sẽ không có trên `main` khi rollback. Chủ repo chọn **(1)**, cả hai lần.
> 2. **Ý nghĩa rollback:** không đóng băng ghi nghiệp vụ, không replay; sau rollback `main` thấy mọi dữ liệu nghiệp vụ đã phát sinh. Cái mất và cái không đảo liệt kê ở "Lời hứa rollback" (Global Constraints) và runbook bước 0.
> 3. **Rollout RLS lockdown** (`2026-09-26-rls-lockdown.sql`) là ngoại lệ đổi cấu trúc được chủ repo duyệt (2026-09-26) và giữ trong đợt deploy này. Nó vá lỗ hổng của chính `main` (bảng mở cho anon), `main` chạy bình thường với nó; dấu vân tay chụp SAU nó là cố ý. Tách thành đợt deploy riêng trước là tuỳ chọn, không bắt buộc.
>
> Review tiếp theo: đánh giá plan theo đúng phạm vi này — bảng phân quyền không bị ghi (kể cả ghi-rồi-trả-lại), không DDL ngoài `authz_*`, rollback đúng như đã liệt kê. Comment đòi "mọi bảng chỉ đọc", "data plane riêng", "bỏ RLS" sẽ được ghi "không đổi — quyết định chủ repo".

**Tech Stack:** Next.js 16 (App Router), NextAuth v5 (JWT), Supabase (service-role client), Postgres PL/pgSQL (SECURITY DEFINER), vitest, PGlite (Postgres WASM, chỉ để kiểm SQL tại máy).

## Global Constraints

- Nhánh: `feat/authz` (47 commit trên `main`). Commit từng task, **KHÔNG push**.
- Mọi thay đổi logic ghi `changelog.md` (entry mới nhất trên cùng, dạng `## YYYY-MM-DD — Tiêu đề`) — gom một entry cho cả plan ở Task 21.
- SQL production: chỉ viết file rollout; **không** chạy trên production — chủ repo tự chạy. Từ Phase A tới nay CHƯA chạy gì trên production (không truy vấn A0, không rollout nào — chủ repo xác nhận 2026-09-26).
- **Phạm vi cô lập (chủ repo chọn 2026-09-26, xác nhận lại 2026-09-27 — xem khối "Quyết định của chủ repo" ở trên):**
  - **Bảng phân quyền production — CẤM GHI:** `portal_account`, `roles`, `user_roles`, `role_permissions`, `permissions`, `task_agents`, `agent_members`. Code nhánh không `.from()` tới chúng (trừ SELECT trong hàm/script đồng bộ và decision diff); không RPC nào của nhánh ghi chúng.
  - **Mọi bảng và hàm hiện hữu — CẤM ĐỔI CẤU TRÚC:** không `alter table`, không thêm/bỏ cột, trigger, khoá ngoại, index, không `create or replace`/`alter function`/đổi ACL hàm của `main`. Ngoại lệ DUY NHẤT: `2026-09-26-rls-lockdown.sql` (bật RLS + thu quyền anon/authenticated trên 15 bảng — `main` chạy được với nó; rollback code KHÔNG đảo nó, và không cần đảo).

  - **Bảng nghiệp vụ — ĐƯỢC GHI, đã duyệt tường minh:** mọi bảng hiện hữu còn lại (task*, enrollment*, lead*, `time_off_*`, `notifications`/`enrollment_notifications`, `push_subscriptions`, `notification_preferences`, `login_attempts`, `task_assignment_queue_members`, `enrollment_queue_members`, `task_assignment_rotation`, bảng cấu hình bảng, storage `avatars`). Điều kiện: bản authz ghi cùng schema, cùng ý nghĩa như `main` — dữ liệu phát sinh khi chạy bản authz là dữ liệu thật, `main` đọc được sau rollback. Ngoại lệ phải chặn: không xoá file/dữ liệu mà `main` còn tham chiếu qua bảng phân quyền (vd ảnh avatar cũ mà `portal_account.avatar_url` đang trỏ — Task 0.4).
  - Mọi bảng/hàm mới có tiền tố `authz_`. Bảng `authz_*` không có khoá ngoại trỏ sang bảng production.
- **Quyết định phân quyền chỉ đọc `authz_*`** (account active, role, grant, access_version, roster, uỷ quyền, tên hoa hồng). Chỗ duy nhất còn điều kiện production: RPC Time Off của `main` kiểm `portal_account.is_active` bên trong — route chặn trước theo ma trận ở Nhóm 0 (không mô tả luồng này là "một nguồn").
- **Lời hứa rollback (chính xác):** deploy lại `main` → `main` chạy trên bảng phân quyền production nguyên vẹn + dữ liệu nghiệp vụ đã phát sinh. MẤT khi rollback: mọi thay đổi account/role/roster/mật khẩu/avatar/tên hoa hồng làm trên bản authz; account tạo mới trên bản authz không tồn tại với `main`. KHÔNG đảo: dữ liệu nghiệp vụ, push đã gửi, `login_attempts`, rollout RLS. Bảng `authz_*` để nguyên hoặc drop (`supabase/checks/authz-drop.sql`).

- Không so tên role, không đọc cột `portal_account.role` trong code chạy thật hay thân hàm SQL (cổng CI `src/lib/authz/no-role-name-checks.test.ts`). Role hệ thống nhận diện bằng `authz_roles.system_key` (`super_admin`, `default_new_account`).
- Mọi hàm `SECURITY DEFINER` mới: `set search_path = public, pg_temp`, `revoke all ... from public, anon, authenticated`, `grant execute ... to service_role`.
- UI hiện tên người, không hiện email thô.
- Toolchain: mọi lệnh node chạy sau `export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"`.
- Kiểm SQL tại máy bằng PGlite: `cd /private/tmp/claude-501/-Users-vothuongbao-Project-Web/a4a9805c-e38c-4b52-82e3-b7869d2319d4/scratchpad/pg && node run.mjs <file .sql theo đường dẫn tương đối repo, theo thứ tự>` (chuỗi đầy đủ của cổng CI nằm trong `.github/workflows/db-persistence-gate.yml`; lệnh mẫu ở "Kiểm tra chung" cuối file).
- Không chạy `next build` song song với người khác trong cùng thư mục (`.next` dùng chung).

---

## Bối cảnh (đọc trước khi làm bất kỳ task nào)

**Grant.** Quyền là chuỗi `action:scope`. Scope: `own`, `assigned`, `reported`, `participating`, `agent_owned` (tôi là agent của bản ghi), `assistant_for_agent` (tôi là assistant của agent của bản ghi), `shared_queue`, `all`, hoặc `*` cho action bật/tắt. Danh mục: `src/lib/authz/catalog.ts`. Kiểm: `hasGrant(grants, action, scope?)` và `scopeMatches(grants, action, facts)` trong `src/lib/authz/grants.ts` — `scopeMatches` đúng khi có `action:all`/`action:*`, hoặc có `action:<scope>` mà `facts[scope] === true`.

**Principal.** `src/lib/authz/principal.ts`: grant chỉ đến từ định nghĩa role — role `system_key = 'super_admin'` mang `SUPER_ADMIN_GRANTS` (hằng trong code), role khác mang các dòng `role_grants` khi `roles.grants_managed = true`, role chưa chuyển thì không có grant (fail-closed + log). **Sau Nhóm 0** các bảng này đổi thành `authz_roles` / `authz_role_grants` / `authz_user_roles` / `authz_accounts`; các task 1–21 bên dưới đôi chỗ còn gọi tên bảng cũ (`roles`, `role_grants`, `user_roles`, `portal_account`, `task_agents`, `agent_members`) — khi làm, luôn dịch theo bảng đối chiếu ở đầu Nhóm 0. JWT mang `accountId`, `roleIds`, `accessVersion`; grant suy mỗi request qua cache định nghĩa role 30 giây. `src/auth.ts` (jwt callback) + `src/lib/auth/token-access.ts` + `src/lib/authz/versions.ts` lo làm mới / thu hồi.

**Policy theo domain.**
- Task: `src/lib/tasks/access.ts` (`taskActorFromGrants`, `canViewTask`, `resolveTaskCapabilities`, …), dựng actor ở route bằng `taskActorForUser(session.user, email)` (`src/lib/tasks/actor.ts`), danh sách: `fetchTasksForActor` (`src/lib/tasks/queries.ts`).
- Enrollment: thuần ở `src/lib/enrollment/policy.ts`, phạm vi ở `src/lib/enrollment/scope.ts` (`resolveEnrollmentScope`, `isRecordInScope`, `loadScopedEnrollmentRecord`), actor ở `src/lib/enrollment/access.ts` (`loadEnrollmentActor`).
- Lead: `src/lib/leads/access.ts`.
- Người nhận thông báo: `src/lib/notifications/audience.ts` (lọc lúc ghi ở `insertNotifications` / `insertEnrollmentNotifications`), kiểm lúc đọc ở `src/lib/notifications/read-access.ts`.

**Luật tương thích.** `src/lib/authz/compat.ts` (`deriveCompatGrants`) suy grant từ permission phẳng + tên role cũ. Sau Nhóm 0 chỉ dùng cho script đồng bộ (Task 0.3, tính grant của role cũ trước khi nạp) và test đối chiếu; bản chiếu `role_permissions` (`projectLegacyPermissions`) bị xoá vì không còn ghi `role_permissions`. `src/lib/authz/legacy/*` là bản đóng băng quyết định trước Phase D (chỉ test dùng).

**Tài liệu gốc.** Audit `docs/2026-09-25-rbac-authorization-architecture-audit.md`; plan `docs/superpowers/plans/2026-09-26-authorization-final-plan.md` (Phần III = ghi chú thực thi + bảng "Xử lý 3 bản review Codex"); review Codex theo phase `docs/2026-09-26-authz-phase-{a..h}-code-review.md` và review Codex tổng hợp cả nhánh `docs/2026-09-26-authz-branch-code-review.md` (mục ký hiệu **BR** trong bảng dưới) — đều untracked. Nguồn thứ ba: một lượt review độc lập (mục ký hiệu **N-x**).

**Thứ tự deploy (runbook đầy đủ ở Task 8):** fingerprint chỉ đọc (trước) → `2026-09-26-rls-lockdown.sql` → `2026-10-03-authz-isolated.sql` (chỉ tạo bảng/hàm `authz_*`) → `scripts/authz-sync-from-production.ts` (dry-run, rồi `--apply` gọi hàm `authz_sync_from_production` trong một transaction) → fingerprint (sau, phải khớp trước) → preflight → deploy `feat/authz` cho mọi người → import account phát sinh trong khe (chế độ `missing_only`). KHÔNG BAO GIỜ chạy `supabase/schema.sql` trên DB thật. Rollback: deploy lại `main` (xem "Lời hứa rollback").

---

## Nhóm 0 — Cô lập dữ liệu phân quyền khỏi bảng production (làm TRƯỚC mọi task khác)

**Vì sao.** Bản `feat/authz` sẽ THAY `main` cho mọi người dùng; lỗi thì deploy lại `main`. Để rollback không phải làm gì với DB, bản authz không được ghi bảng phân quyền mà `main` dựa vào, và không được đổi cấu trúc bảng/hàm nào của `main`. Hiện nhánh vi phạm cả hai:
- thêm cột vào bảng production: `portal_account.access_version` (rollout B), `roles.system_key` / `roles.grants_managed` (rollout C);
- ghi bảng phân quyền production: `user_roles`, `role_permissions`, `portal_account` (tạo/sửa/xoá account, cột `role`, `access_version`), `task_agents` / `agent_members`, `permissions` (đổi nhãn), `push_subscriptions` (xoá khi khoá account);
- **ghi đè hàm production**: `assign_unassigned_task` (rollout G bỏ kiểm role — `main` đang dựa vào kiểm đó), `table_config_write_context` (plan cũ Task 12);
- sửa `supabase/schema.sql` ở các khối production (seed role S10…).

Nguồn kiểm kê: `grep -rn 'from("portal_account")\|PORTAL_ACCOUNT_TABLE\|from("roles")\|from("user_roles")\|from("task_agents")\|from("agent_members")' src` (23 + 41 + 5 + 4 + 7 + 12 chỗ) và các hàm SQL chạm bảng account/role (liệt kê ở Task 0.2).

**Đích — bảng authz là bảng LÂU DÀI** (nếu bản authz ổn, chúng thay hẳn bảng cũ ở "Giai đoạn chốt"):

| Production | authz | Ghi chú |
|---|---|---|
| `portal_account` | `authz_accounts` | cột khai báo tường minh (không `LIKE`); bỏ cột legacy `role`; thêm `access_version`; id giữ nguyên khi đồng bộ để khoá ngoại Time Off vẫn khớp |
| `roles` | `authz_roles` | + `system_key`, `grants_managed` |
| `user_roles` | `authz_user_roles` | FK → `authz_accounts`, `authz_roles`; một role mỗi account |
| `role_permissions`, `permissions` | *(bỏ)* | grant ở `authz_role_grants`; danh sách quyền lấy từ `catalog.ts` |
| — | `authz_role_grants`, `authz_audit`, `authz_commission_names`, `authz_commission_name_history` | mới |
| `task_agents` | `authz_task_agents` | email chữ thường (ràng buộc `check`) |
| `agent_members` | `authz_agent_members` | email chữ thường |
| bảng nghiệp vụ (task*, enrollment*, lead*, `time_off_*`, thông báo, `push_subscriptions`, `notification_preferences`, `login_attempts`, `task_assignment_queue_members`, `enrollment_queue_members`, `task_assignment_rotation`, cấu hình bảng) | *(giữ nguyên, ghi như `main`)* | đã duyệt tường minh (Global Constraints). Hàng đợi: cùng schema, cùng ý nghĩa (bật/tắt theo email, bộ đếm xoay vòng) — `main` đọc lại được; chỉ luật "ai đủ điều kiện" khác, và luật đó nằm trong code/hàm `authz_*`, không trong bảng |

**Quy tắc đọc/ghi:**
- **Ghi phân quyền** chỉ vào `authz_*`. **Ghi nghiệp vụ** như `main`. **Không DDL** trên bảng/hàm hiện hữu (trừ rollout RLS).
- **Đọc bảng phân quyền production** (SELECT) chỉ ở: hàm/script đồng bộ (Task 0.3), decision diff (Task 7), và module duy nhất `src/lib/authz/production-read.ts` (Task 0.4 — kiểm avatar cũ, ma trận Time Off). Cổng Task 0.5 chặn mọi chỗ khác.
- Bảng `authz_*` KHÔNG có khoá ngoại trỏ sang bảng production (khoá ngoại tạo trigger nội bộ trên bảng được trỏ tới = đổi cấu trúc bảng production, và `on delete` lan sang thao tác của `main`).

**Ma trận hai nguồn trạng thái account (Time Off).** RPC Time Off của `main` vẫn tự kiểm `portal_account` bên trong: `adjust_time_off_balance` / `bulk_adjust_time_off_balances` (account + actor active), `configure_time_off_monthly_accrual` (actor active), `apply_time_off_monthly_accruals` (cộng phép cho MỌI account active trong `portal_account`); các bảng `time_off_*` có khoá ngoại tới `portal_account(id)` (`time_off_balances.account_id`, `time_off_balance_adjustments.account_id`/`created_by_id`, `time_off_holidays.created_by_id`, `time_off_requests.requester_id`/`reviewer_id`/`manager_id`). Luật trên bản authz:

| `authz_accounts` | `portal_account` | Đăng nhập bản authz | Ghi Time Off theo MỘT account (tạo đơn, duyệt, chỉnh số dư một người, ngày lễ, cấu hình) | Ghi Time Off theo TẬP (chỉnh số dư cả nhóm, cộng phép tháng — bản `authz_*`) |
|---|---|---|---|---|
| active | active | được | được | được |
| khoá | active | không | route chặn 409 "This account is deactivated." | KHÔNG (tập = active trên authz) |
| active | khoá (mở lại trên bản authz) | được | route chặn 409 "…reactivated after the access-control update" | KHÔNG (tập đòi thêm active trên production) |
| active | không có (tạo mới trên bản authz) | được | route chặn 409 "…created after the access-control update" | KHÔNG (khoá ngoại cần id trong `portal_account`) |

Ghi theo một account: route kiểm bằng `timeOffAccountGate(ids)` (Task 0.4 Step 3) TRƯỚC khi gọi RPC của `main` — lỗi rõ ràng thay vì lỗi khoá ngoại/`ACCOUNT_INACTIVE`. Ghi theo tập (review Codex lần 2: route không biết trước tập account nên cổng theo id không bao được): `bulk_adjust_time_off_balances` và `apply_time_off_monthly_accruals` của `main` tự duyệt mọi account active trong `portal_account` → thay bằng bản sao `authz_bulk_adjust_time_off_balances` / `authz_apply_time_off_monthly_accruals` (Task 0.2 Step 3) mà tập account = `authz_accounts.is_active` VÀ có dòng active trong `portal_account`. Hai bản sao ghi bảng `time_off_*` (nghiệp vụ được duyệt) y như bản gốc. Cộng phép tháng idempotent theo (chính sách, tháng): tháng đã cộng trên bản authz thì `main` sau rollback không cộng lại — account bị loại ở tháng đó (khoá trên authz) không được cộng bù (ghi ở runbook). Hết mọi giới hạn ở "Giai đoạn chốt".

**Giới hạn khác (ghi vào runbook, Task 8):**
- Sau khi đồng bộ, thay đổi account/role/roster làm trên `main` KHÔNG tự sang authz → runbook đóng băng sửa account/role/roster trên `main` từ lúc đồng bộ tới lúc deploy; account Google tự tạo trong khe đó được nhập bằng chế độ `missing_only` sau deploy.
- Dữ liệu nghiệp vụ tham chiếu account chỉ có trên authz (vd task giao cho email account mới) vẫn còn sau rollback, nhưng `main` không biết account đó.

---

### Task 0.1: Bản đồ bảng authz + hằng số dùng chung

**Files:**
- Create: `src/lib/authz/tables.ts`
- Modify: `src/lib/config.ts:3` (`PORTAL_ACCOUNT_TABLE`)

**Interfaces:**
- Produces: `AUTHZ_TABLES` (tên bảng authz), `PRODUCTION_AUTH_TABLES` (bảng phân quyền production cấm ghi), `AUTHZ_ACCOUNT_COLUMNS` (cột của `authz_accounts`) — Task 0.3, 0.4, 0.5, 7, 11, 21 dùng.

- [ ] **Step 1:** `src/lib/authz/tables.ts`:

```ts
/**
 * Bảng của hệ phân quyền MỚI (plan 2026-10-03 Nhóm 0).
 *
 * Code nhánh authz CHỈ đọc/ghi account, role, quyền, roster qua các bảng này —
 * KHÔNG BAO GIỜ ghi bảng phân quyền production. Lỗi thì deploy lại `main`:
 * bảng production còn nguyên. Nếu bản authz ổn, các bảng này thành bảng chính
 * thức ("Giai đoạn chốt").
 */
export const AUTHZ_TABLES = {
  accounts: "authz_accounts",
  roles: "authz_roles",
  userRoles: "authz_user_roles",
  roleGrants: "authz_role_grants",
  audit: "authz_audit",
  commissionNames: "authz_commission_names",
  commissionNameHistory: "authz_commission_name_history",
  taskAgents: "authz_task_agents",
  agentMembers: "authz_agent_members",
} as const;

/** Bảng phân quyền production: code không `.from()` tới, trừ `production-read.ts` (cổng Task 0.5). */
export const PRODUCTION_AUTH_TABLES = [
  "portal_account",
  "roles",
  "user_roles",
  "role_permissions",
  "permissions",
  "task_agents",
  "agent_members",
] as const;

/**
 * Cột của `authz_accounts` — danh sách TƯỜNG MINH, không chép mọi cột của
 * `portal_account`: cột production thêm sau này không tự chảy sang bảng authz.
 * `password_hash` có mặt vì đăng nhập email + mật khẩu (`src/auth.ts`,
 * provider Credentials) cần nó; chỉ service_role đọc được bảng (RLS bật, không policy).
 */
export const AUTHZ_ACCOUNT_COLUMNS = [
  "id",
  "email",
  "name",
  "password_hash",
  "is_active",
  "agent_id",
  "avatar_url",
  "access_version",
  "created_at",
] as const;
```

- [ ] **Step 2:** `src/lib/config.ts`: `export const PORTAL_ACCOUNT_TABLE = AUTHZ_TABLES.accounts;` (import từ `@/lib/authz/tables`) kèm chú thích: mọi đọc/ghi account của nhánh này đi vào `authz_accounts`. Không đổi tên hằng (41 chỗ dùng) — chỉ đổi giá trị.
- [ ] **Step 3: Commit** `feat(authz): bản đồ bảng authz tách khỏi bảng phân quyền production (0.1)`.

---

### Task 0.2: SQL cô lập — một rollout `authz_*`; gỡ rollout cũ; `schema.sql` chỉ để cài DB mới

**Files:**
- Delete: `supabase/rollouts/2026-09-27-authz-phase-b.sql`, `2026-09-28-authz-phase-c.sql`, `2026-09-29-authz-phase-d.sql`, `2026-09-30-authz-phase-g.sql`, `2026-10-01-authz-phase-h.sql`, `2026-10-02-authz-review-fixes.sql` (chủ repo xác nhận 2026-09-26: CHƯA rollout nào của nhánh chạy trên production; xoá an toàn).
- Keep: `supabase/rollouts/2026-09-26-rls-lockdown.sql` (ngoại lệ được duyệt).
- Create: `supabase/rollouts/2026-10-03-authz-isolated.sql`
- Modify: `supabase/schema.sql`, `supabase/checks/ci-authz-rpc.sql`, `src/lib/authz/no-role-name-checks.test.ts`

**Interfaces:**
- Produces: 9 bảng `authz_*` (DDL dưới), 20 hàm `authz_*` (18 ở bảng port Step 3 + `authz_production_auth_fingerprint`, `authz_sync_from_production` ở Task 0.3 Step 1). Chữ ký hàm là hợp đồng với Task 0.4 (tên RPC), Task 8 (preflight) và Task 0.5 (cổng).

- [ ] **Step 1: `schema.sql` = bản `main` + RLS + khối authz — CHỈ để cài DB mới / DB tạm.** `git checkout main -- supabase/schema.sql`, rồi áp lại ĐÚNG phần khoá RLS của commit `5265f40` (`git show 5265f40 -- supabase/schema.sql` — thêm 12 bảng vào mảng `protected_tables` và khối RLS cho `time_off_*` ở cuối file). Khối production của file là code `main` (có `insert … on conflict do update` vào `permissions`/`roles`, `delete from role_permissions`, `create or replace` hàm production) — nên thêm chú thích đầu file:

```sql
-- KHÔNG chạy file này trên DB production đang có dữ liệu để cài authz: khối
-- production bên dưới seed/sửa bảng phân quyền và thay hàm của `main`.
-- DB thật chỉ chạy các file trong supabase/rollouts/ theo runbook
-- docs/2026-10-03-authz-deploy-runbook.md.
```

- [ ] **Step 2: Bảng** (đầu `2026-10-03-authz-isolated.sql`; cùng khối nối vào `schema.sql` NGAY TRƯỚC khối quét ACL cuối file — khối bắt đầu bằng chú thích `-- This sweep is positional`). Cột khai báo tường minh, KHÔNG `like portal_account` (cột production thêm sau này không tự chảy sang):

```sql
begin;

create table if not exists authz_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique constraint authz_accounts_email_lower check (email = lower(btrim(email))),
  name text,
  -- Đăng nhập email + mật khẩu (src/auth.ts, Credentials) cần hash. Chỉ service_role đọc.
  password_hash text,
  is_active boolean not null default true,
  agent_id text,
  avatar_url text,
  access_version integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists authz_accounts_agent_id_key on authz_accounts (agent_id) where agent_id is not null;
create index if not exists authz_accounts_active_idx on authz_accounts (is_active);

create table if not exists authz_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  system_key text constraint authz_roles_system_key_check check (system_key in ('super_admin', 'default_new_account')),
  grants_managed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists authz_roles_system_key_key on authz_roles (system_key) where system_key is not null;

create table if not exists authz_user_roles (
  user_id uuid not null references authz_accounts(id) on delete cascade,
  role_id uuid not null references authz_roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create unique index if not exists authz_user_roles_one_role_idx on authz_user_roles (user_id);

create table if not exists authz_role_grants (
  role_id uuid not null references authz_roles(id) on delete cascade,
  action text not null,
  scope text not null,
  created_at timestamptz not null default now(),
  primary key (role_id, action, scope)
);

create table if not exists authz_audit (
  id uuid primary key default gen_random_uuid(),
  actor_account_id uuid,
  actor_email text,
  event text not null,
  target_type text not null,
  target_id text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists authz_audit_target_idx on authz_audit (target_type, target_id, created_at desc);

create table if not exists authz_commission_names (
  account_id uuid primary key references authz_accounts(id) on delete cascade,
  agent_name text not null,
  updated_at timestamptz not null default now(),
  updated_by_email text,
  constraint authz_commission_names_normalized check (
    agent_name <> '' and agent_name = upper(regexp_replace(btrim(agent_name), '\s+', ' ', 'g'))
  )
);
create unique index if not exists authz_commission_names_name_idx on authz_commission_names (agent_name);

-- Sổ tên hoa hồng từng dùng: bằng chứng BỀN để cấm dùng lại tên (Task 4). KHÔNG khoá
-- ngoại / cascade (xoá account không được xoá bằng chứng), KHÔNG xoá khi đồng bộ reset.
create table if not exists authz_commission_name_history (
  agent_name text not null,
  account_id uuid not null,
  account_email text,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  primary key (agent_name, account_id, assigned_at)
);
create index if not exists authz_commission_name_history_name_idx on authz_commission_name_history (agent_name);

create table if not exists authz_task_agents (
  email text primary key constraint authz_task_agents_email_lower check (email = lower(btrim(email))),
  created_at timestamptz not null default now()
);

create table if not exists authz_agent_members (
  agent_email text not null constraint authz_agent_members_agent_lower check (agent_email = lower(btrim(agent_email))),
  cs_email text not null constraint authz_agent_members_cs_lower check (cs_email = lower(btrim(cs_email))),
  is_assistant boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (agent_email, cs_email)
);
create index if not exists authz_agent_members_cs_idx on authz_agent_members (cs_email, agent_email);

do $$
declare t text;
begin
  foreach t in array array['authz_accounts','authz_roles','authz_user_roles','authz_role_grants','authz_audit',
    'authz_commission_names','authz_commission_name_history','authz_task_agents','authz_agent_members'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
  end loop;
end $$;
```

Không có cột `role` legacy (`portal_account.role`) — mọi chỗ còn select cột này được sửa ở Task 0.4.

- [ ] **Step 3: Hàm** — port từ các rollout vừa gỡ (lấy thân hàm bằng `git show 6bbeb69:supabase/rollouts/<file>`), đổi tên và bảng theo bản đồ, cộng các sửa của plan này. Mỗi hàm: `security definer`, `set search_path = public, pg_temp`, `revoke all … from public, anon, authenticated`, `grant execute … to service_role`.

| Hàm mới | Port từ (file tại `6bbeb69`) | Thay đổi bắt buộc |
|---|---|---|
| `authz_bump_account_access_version(uuid[])`, `authz_bump_role_members_access_version(uuid)` | `2026-09-27-authz-phase-b.sql` | `portal_account` → `authz_accounts`, `user_roles` → `authz_user_roles` |
| `authz_assert_recovery_admin_exists()` | `2026-09-28-authz-phase-c.sql` | bảng authz |
| `authz_upsert_role(p_role_id, p_name, p_description, p_is_active, p_grants jsonb, p_actor_account_id, p_actor_email)` | C `upsert_role_atomic` + khối mới ở `2026-10-02-authz-review-fixes.sql` | BỎ tham số `p_legacy_keys` và mọi ghi `role_permissions`; `roles` → `authz_roles`; audit → `authz_audit`; giữ chặn tắt role hệ thống |
| `authz_delete_role(uuid, uuid, text)` | C `delete_role_atomic` | bảng authz |
| `authz_assign_account_access(uuid, uuid, boolean, uuid, text)` | C `assign_account_access_atomic` | bảng authz; BỎ ghi cột `role` mirror |
| `authz_delete_account(uuid, uuid, text)` | C `delete_account_atomic` | bảng authz; trước khi xoá: `update authz_commission_name_history set released_at = now() where account_id = … and released_at is null` — sổ tên giữ nguyên (không khoá ngoại/cascade), là bằng chứng cấm dùng lại tên (Task 4) |
| `authz_set_commission_name(uuid, text, uuid, text)` | D + Task 4 | bảng authz; cấm tái dùng tên đã có lịch sử — xem Task 4 |
| `authz_create_account(...)`, `authz_update_account(uuid, jsonb, uuid, text)` | `2026-10-02-authz-review-fixes.sql` | bảng authz; gọi các hàm `authz_*`; BỎ ghi cột `role` (không còn trong `authz_accounts`); chỉ ghi các cột của `AUTHZ_ACCOUNT_COLUMNS`; + Task 17 |
| `authz_add_task_agent`, `authz_remove_task_agent`, `authz_add_assistant_delegation`, `authz_remove_assistant_delegation` | `2026-09-30-authz-phase-g.sql` | tự làm việc trên `authz_task_agents` / `authz_agent_members` (KHÔNG gọi `create_agent_membership_atomic` / `delete_task_agent_atomic` production — chép logic kiểm trùng/vòng/eligibility của `create_agent_membership_atomic` từ `supabase/schema.sql` bản `main`, thay bảng); + Task 16 |
| `authz_assign_unassigned_task(uuid, text, timestamptz, text)` | thân `assign_unassigned_task` của `main` (`git show main:supabase/schema.sql`, tìm tên hàm) | khối kiểm người nhận thay bằng quan hệ trên bảng authz (active trong `authz_accounts`, không trong `authz_task_agents`, không là assistant trong `authz_agent_members`, không bị tắt trong `task_assignment_queue_members`); phần cập nhật `tasks`/cycles/activity và lời gọi `bump_task_assignment_rotation` giữ nguyên (ghi nghiệp vụ được duyệt) |
| `authz_table_config_write_context(...)` | thân `table_config_write_context` của `main` | khối Person nhánh `cs` kiểm theo `authz_accounts` + `authz_user_roles` + `authz_roles` (+ `system_key = 'super_admin'` hoặc có `authz_role_grants.action = 'task.read'`) — xem Task 12 |
| `authz_bulk_adjust_time_off_balances(...)`, `authz_apply_time_off_monthly_accruals(date, uuid)` | thân `bulk_adjust_time_off_balances` / `apply_time_off_monthly_accruals` trong `supabase/rollouts/2026-09-04-time-off-monthly-accruals.sql` (dòng 168 / 92; cùng tham số) | tập account `from public.portal_account account where account.is_active` → `from public.authz_accounts account where account.is_active and exists (select 1 from public.portal_account p where p.id = account.id and p.is_active)`; kiểm actor `portal_account … is_active` → `authz_accounts` active VÀ có dòng active trong `portal_account` (khoá ngoại `created_by_id`); phần ghi `time_off_*` giữ nguyên (nghiệp vụ được duyệt); `set search_path = public, pg_temp`. Gọi từ `src/app/api/time-off/balances/bulk/route.ts:44`, `src/app/api/time-off/accruals/apply/route.ts:23`, `src/app/api/cron/time-off-monthly-accrual/route.ts:27` |

**Hàng đợi (quyết định cho review Codex của plan, P0 "thiếu trạng thái hàng đợi"):** `task_assignment_queue_members`, `enrollment_queue_members`, `task_assignment_rotation` là dữ liệu nghiệp vụ được duyệt ghi (Global Constraints): bảng giữ nguyên schema và ý nghĩa (bật/tắt nhận việc theo email, bộ đếm xoay vòng), nên `main` đọc lại đúng sau rollback. Không sao sang authz. Luật "ai đủ điều kiện nhận việc" — phần khác giữa hai bản — nằm trong `authz_assign_unassigned_task` + `isQueueEligible` (Task 16), không trong bảng. `authz_assign_unassigned_task` được gọi `bump_task_assignment_rotation` của `main` (hàm chỉ ghi `task_assignment_rotation`) — nằm trong danh sách lời gọi hàm production được phép của cổng Task 0.5 Step 2.

`convert_role_to_grants_atomic` KHÔNG port (không còn cần: hàm đồng bộ `authz_sync_from_production` ghi thẳng grant — Task 0.3).

- [ ] **Step 4: Cuối rollout** — quét ACL chỉ cho hàm `authz_%` (KHÔNG đụng ACL hàm production), rồi `commit;` và truy vấn kiểm chứng:

```sql
do $$
declare routine record;
begin
  for routine in
    select p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname like 'authz\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', routine.signature);
    execute format('grant execute on function %s to service_role', routine.signature);
  end loop;
end $$;

commit;

select count(*) filter (where c.relname like 'authz\_%') as authz_tables  -- phải = 9
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';
```

- [ ] **Step 5: Kịch bản CI.** `supabase/checks/ci-authz-rpc.sql`: đổi mọi lời gọi sang tên `authz_*`, mọi bảng sang `authz_*`; đầu kịch bản tự nạp dữ liệu thử vào `authz_accounts` / `authz_roles` (không dùng seed production). Khối gọi hàm có ghi bảng nghiệp vụ (`authz_assign_unassigned_task`, `authz_table_config_write_context`) bọc trong `begin; … rollback;` — xem Task 0.5 Step 2 vì sao. Workflow cổng viết lại ở Task 0.5.
- [ ] **Step 5b: Cổng tên role chỉ quét hàm authz.** `src/lib/authz/no-role-name-checks.test.ts:72-87` quét MỌI `create or replace function` trong `schema.sql`; sau Step 1, file có lại hàm production của `main` còn so tên role (`r.name in ('Admin', 'Super Admin')`, khoảng dòng 3709 bản `main`) → test đỏ, mà nhánh không được sửa hàm đó. Đổi vòng lặp: chỉ xét hàm tên bắt đầu bằng `authz_`, và quét cả `supabase/rollouts/2026-10-03-authz-isolated.sql`:

```ts
    const authzBodies = bodies.filter(([, name]) => name.startsWith("authz_"));
    // Hàm production là code của `main` — nhánh cô lập không sửa (plan 2026-10-03 Nhóm 0).
    expect(authzBodies.length).toBeGreaterThanOrEqual(20);
    for (const [, name, body] of authzBodies) {
```
- [ ] **Step 6:** Chạy cổng cô lập ở máy (lệnh ở "Kiểm tra chung") → mọi bước `ok`; job cài mới: `schema.sql` chạy 2 lần vẫn `ok`.
- [ ] **Step 7: Commit** `refactor(db): dữ liệu phân quyền sang bảng authz_*; gỡ rollout đụng bảng production (0.2)`.

---

### Task 0.3: Đồng bộ production → authz: một hàm SQL một transaction + script điều khiển (thay `authz-migrate-role-grants.ts`)

**Vì sao là hàm SQL (review Codex của plan, P0 "không chạy `--apply` nhiều request REST"):** chép qua nhiều request PostgREST không cùng transaction — lỗi giữa chừng để lại `authz_*` nửa vời và lần chạy sau bị chặn vì bảng không rỗng; đọc bằng phân trang offset có thể lọt/lặp dòng khi production đổi trong lúc đọc. Hàm `authz_sync_from_production` đọc thẳng bảng production (SELECT) và ghi `authz_*` trong MỘT transaction: kiểm trước khi ghi, hậu kiểm trước khi commit — lỗi ở đâu cũng rollback sạch. Phần TS chỉ làm việc SQL không làm được: suy grant từ role cũ (`compatGrantsForRole`) và decision diff.

**Files:**
- Modify: `supabase/rollouts/2026-10-03-authz-isolated.sql` + khối authz của `supabase/schema.sql` (2 hàm dưới)
- Create: `src/lib/supabase-paging.ts`, `src/lib/authz/sync-plan.ts`, `scripts/authz-sync-from-production.ts`, `docs/authz-approved-diffs.json` (mảng rỗng `[]` lúc đầu)
- Delete: `scripts/authz-migrate-role-grants.ts`, `src/lib/authz/role-migration.test.ts` (test của script cũ — `grep -rn "role-migration\|authz-migrate-role-grants" src scripts docs` sau khi xoá chỉ còn tài liệu lịch sử)
- Test: `src/lib/supabase-paging.test.ts`, `src/lib/authz/sync-plan.test.ts`, khối đồng bộ trong `supabase/checks/ci-authz-sync.sql` (Task 0.5)

**Interfaces:**
- Produces:
  - SQL `authz_production_auth_fingerprint() returns text` — md5 nội dung 6 bảng phân quyền production (chỉ đọc).
  - SQL `authz_sync_from_production(p_mode text, p_super_admin_role_id uuid, p_default_role_id uuid, p_role_grants jsonb, p_expected_fingerprint text, p_actor_email text, p_dry_run boolean, p_confirm text default null, p_skip_account_ids uuid[] default '{}') returns jsonb`.
  - TS `fetchAllRows<T>(build, pageSize?)` (`src/lib/supabase-paging.ts`) — Task 7, 11 dùng.
  - TS `computeRoleGrants`, `diffAllAccounts`, `checkApprovedDiffs`, type `ApprovedDiff` (`src/lib/authz/sync-plan.ts`) — Task 7 dùng lại.

- [ ] **Step 0: Helper phân trang có đối chiếu số dòng** (review Codex của plan: trang ngắn hơn `pageSize` vì PostgREST giới hạn thấp hơn không được hiểu là hết; số dòng phải khớp `count: exact`). `src/lib/supabase-paging.ts`:

```ts
type Page<T> = { data: T[] | null; error: { message: string } | null; count?: number | null };

/**
 * Đọc HẾT các dòng của một truy vấn PostgREST. PostgREST cắt ở giới hạn trả về
 * (max-rows) mà không báo lỗi; mọi chỗ cần "đủ tập" dùng hàm này (BR P1-01).
 *
 * - `build(from, to)` dựng truy vấn MỚI mỗi lần, có `{ count: "exact" }` và
 *   `.order()` theo khoá BẤT BIẾN (id / khoá chính) để trang không chồng/lọt.
 * - Tiến theo số dòng THỰC nhận (không theo pageSize): max-rows của server nhỏ
 *   hơn pageSize thì vẫn đọc đủ.
 * - Số dòng đọc được phải đúng `count`; `count` đổi giữa các trang → ném (dữ
 *   liệu đang bị sửa, đọc lại). Thiếu dòng = lỗi, không bao giờ trả tập thiếu.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize = 500
): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  while (expected === null || rows.length < expected) {
    const { data, error, count } = await build(rows.length, rows.length + pageSize - 1);
    if (error) throw new Error(error.message);
    if (typeof count !== "number") throw new Error('fetchAllRows: query must use { count: "exact" }.');
    if (expected === null) expected = count;
    else if (count !== expected) throw new Error(`fetchAllRows: row count changed while paging (${expected} → ${count}).`);
    const page = data ?? [];
    if (page.length === 0) break;
    rows.push(...page);
  }
  if (rows.length !== expected) throw new Error(`fetchAllRows: read ${rows.length}/${expected} rows.`);
  return rows;
}
```

Test (`src/lib/supabase-paging.test.ts`), builder giả theo `from`:
  - server max-rows 100, 250 dòng, `pageSize` 500 → đọc đủ 250 (3 lần gọi: from 0, 100, 200);
  - 1000 + 3 dòng → 1003;
  - `count` đổi ở trang 2 → ném;
  - trang rỗng trước khi đủ `count` → ném `read x/y`;
  - thiếu `count` → ném.

- [ ] **Step 1: Hai hàm SQL** (rollout cô lập, sau các hàm của Task 0.2 Step 3):

```sql
-- Dấu vân tay nội dung 6 bảng phân quyền production. Chỉ đọc.
create or replace function authz_production_auth_fingerprint()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select md5(concat_ws('|',
    (select coalesce(md5(string_agg(md5(t::text), '' order by t.id)), '') from portal_account t),
    (select coalesce(md5(string_agg(md5(t::text), '' order by t.id)), '') from roles t),
    (select coalesce(md5(string_agg(md5(t::text), '' order by t.user_id, t.role_id)), '') from user_roles t),
    (select coalesce(md5(string_agg(md5(t::text), '' order by t.role_id, t.permission_key)), '') from role_permissions t),
    (select coalesce(md5(string_agg(md5(t::text), '' order by t.email)), '') from task_agents t),
    (select coalesce(md5(string_agg(md5(t::text), '' order by t.agent_email, t.cs_email)), '') from agent_members t)
  ));
$$;

-- Chép phân quyền production → authz trong MỘT transaction. Chỉ SELECT bảng
-- production, KHÔNG khoá chúng (nhất quán bằng dấu vân tay đầu + cuối).

--   p_mode: 'initial' (authz rỗng) | 'missing_only' (chỉ THÊM account production
--           chưa có trong authz — account Google tự tạo trong khe đồng bộ→deploy)
--           | 'reset' (xoá sạch authz rồi chép lại; p_confirm = 'RESET AUTHZ').
--   p_role_grants: {"<role id>": [{"action": "...", "scope": "..."}], ...} cho
--           MỌI role production trừ role super admin (TS suy bằng compat).
--   p_expected_fingerprint: authz_production_auth_fingerprint() lúc script đọc
--           dữ liệu để tính grant/diff — production đổi sau đó thì dừng.
--   p_dry_run: chạy ĐÚNG đường ghi + hậu kiểm rồi raise AUTHZ_SYNC_DRY_RUN
--           (detail = báo cáo jsonb) để rollback — dry-run chứng minh apply sẽ qua.
create or replace function authz_sync_from_production(
  p_mode text,
  p_super_admin_role_id uuid,
  p_default_role_id uuid,
  p_role_grants jsonb,
  p_expected_fingerprint text,
  p_actor_email text,
  p_dry_run boolean,
  p_confirm text default null,
  -- chỉ missing_only: account production CỐ Ý không nhập (runbook Task 8 bước 10)
  p_skip_account_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_list text;
  v_warnings jsonb := '[]'::jsonb;
  v_report jsonb;
begin
  if p_mode not in ('initial', 'missing_only', 'reset') then
    raise exception using message = 'AUTHZ_SYNC_BAD_MODE';
  end if;
  if p_mode = 'reset' and p_confirm is distinct from 'RESET AUTHZ' then
    raise exception using message = 'AUTHZ_SYNC_RESET_NOT_CONFIRMED';
  end if;

  -- KHÔNG khoá bảng production: khoá SHARE chặn ghi của `main` suốt thời gian chép
  -- (lock_timeout chỉ giới hạn lúc CHỜ khoá, không giới hạn lúc GIỮ). Nhất quán kiểu
  -- lạc quan thay thế: dấu vân tay production phải khớp p_expected_fingerprint ở ĐẦU
  -- và ở CUỐI hàm (READ COMMITTED: mỗi câu thấy dữ liệu mới nhất, nên thay đổi nào
  -- commit giữa chừng đều làm dấu vân tay cuối lệch) → raise → rollback toàn bộ.
  perform pg_advisory_xact_lock(hashtextextended('authz_sync_from_production', 0));  -- chỉ chặn lượt đồng bộ khác
  if p_mode in ('initial', 'reset') then
    -- Khoá này chặn MỌI truy cập authz: initial/reset chỉ chạy khi bản authz KHÔNG phục
    -- vụ (runbook). missing_only chạy khi bản authz đang phục vụ nên không khoá bảng.
    perform set_config('lock_timeout', '5s', true);
    lock table authz_accounts, authz_roles, authz_user_roles, authz_role_grants, authz_audit,
      authz_commission_names, authz_commission_name_history, authz_task_agents, authz_agent_members
      in access exclusive mode;
  end if;

  if authz_production_auth_fingerprint() is distinct from p_expected_fingerprint then
    raise exception using message = 'AUTHZ_SYNC_PRODUCTION_CHANGED',
      hint = 'Production đổi sau lúc script đọc dữ liệu. Chạy lại dry-run.';
  end if;

  -- ---------- Kiểm TRƯỚC khi ghi (mọi lỗi dừng tại đây) ----------
  if p_mode = 'initial' and (exists (select 1 from authz_accounts) or exists (select 1 from authz_roles)) then
    raise exception using message = 'AUTHZ_SYNC_NOT_EMPTY', hint = 'Dùng missing_only hoặc reset.';
  end if;
  if p_mode = 'missing_only' and not exists (select 1 from authz_roles) then
    raise exception using message = 'AUTHZ_SYNC_NOT_INITIALIZED';
  end if;
  if p_mode <> 'missing_only' then
    if not exists (select 1 from roles where id = p_super_admin_role_id and is_active) then
      raise exception using message = 'AUTHZ_SYNC_SUPER_ADMIN_ROLE_INVALID';
    end if;
    if p_default_role_id = p_super_admin_role_id
      or not exists (select 1 from roles where id = p_default_role_id and is_active) then
      raise exception using message = 'AUTHZ_SYNC_DEFAULT_ROLE_INVALID';
    end if;
    select string_agg(r.name, ', ') into v_list
    from roles r where r.id <> p_super_admin_role_id and not (p_role_grants ? r.id::text);
    if v_list is not null then
      raise exception using message = 'AUTHZ_SYNC_ROLE_GRANTS_MISSING', detail = v_list;
    end if;
    select string_agg(e, ', ') into v_list
    from (select lower(btrim(email)) as e from portal_account group by 1 having count(*) > 1) d;
    if v_list is not null then
      raise exception using message = 'AUTHZ_SYNC_DUPLICATE_EMAIL', detail = v_list,
        hint = 'Gộp/xoá account trùng trên main rồi chạy lại.';
    end if;
    -- Account ĐANG HOẠT ĐỘNG phải có đúng một role đang hoạt động (review Codex của plan:
    -- dừng TRƯỚC khi ghi, không phát hiện sau). Account khoá không role: chỉ cảnh báo.
    select string_agg(a.email, ', ') into v_list
    from portal_account a
    where a.is_active and not exists (
      select 1 from user_roles ur join roles r on r.id = ur.role_id and r.is_active where ur.user_id = a.id);
    if v_list is not null then
      raise exception using message = 'AUTHZ_SYNC_ACTIVE_WITHOUT_ROLE', detail = v_list,
        hint = 'Gán role cho các account này trong Account Manager của main rồi chạy lại.';
    end if;
    select string_agg(a.email, ', ') into v_list
    from portal_account a where (select count(*) from user_roles ur where ur.user_id = a.id) > 1;
    if v_list is not null then
      raise exception using message = 'AUTHZ_SYNC_MULTIPLE_ROLES', detail = v_list,
        hint = 'Hệ authz giữ một role mỗi account. Bỏ role thừa trên main rồi chạy lại.';
    end if;
    if not exists (
      select 1 from portal_account a join user_roles ur on ur.user_id = a.id
      where a.is_active and ur.role_id = p_super_admin_role_id
    ) then
      raise exception using message = 'AUTHZ_SYNC_NO_RECOVERY_ADMIN';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('warning', 'inactive_without_role', 'email', a.email)), '[]'::jsonb)
      into v_warnings
    from portal_account a
    where not a.is_active and not exists (select 1 from user_roles ur where ur.user_id = a.id);
  end if;

  -- ---------- Ghi ----------
  if p_mode = 'reset' then
    -- Sổ tên KHÔNG bị xoá (bằng chứng bền, Task 4): chỉ đóng các lượt đang giữ.
    update authz_commission_name_history set released_at = now() where released_at is null;
    delete from authz_commission_names;
    delete from authz_agent_members;
    delete from authz_task_agents;
    delete from authz_user_roles;
    delete from authz_role_grants;
    delete from authz_roles;
    delete from authz_accounts;
  end if;

  if p_mode in ('initial', 'reset') then
    insert into authz_accounts (id, email, name, password_hash, is_active, agent_id, avatar_url, access_version, created_at)
    select id, lower(btrim(email)), name, password_hash, is_active, agent_id, avatar_url, 0, created_at
    from portal_account;

    insert into authz_roles (id, name, description, is_system, is_active, system_key, grants_managed, created_at, updated_at)
    select id, name, description, is_system, is_active,
      case when id = p_super_admin_role_id then 'super_admin'
           when id = p_default_role_id then 'default_new_account' end,
      true, created_at, updated_at
    from roles;

    insert into authz_role_grants (role_id, action, scope)
    select distinct (e.key)::uuid, g ->> 'action', g ->> 'scope'
    from jsonb_each(p_role_grants) e
    cross join lateral jsonb_array_elements(e.value) g
    where (e.key)::uuid <> p_super_admin_role_id;

    insert into authz_user_roles (user_id, role_id, created_at)
    select user_id, role_id, created_at from user_roles;

    insert into authz_task_agents (email, created_at)
    select lower(btrim(email)), min(created_at) from task_agents group by 1;

    insert into authz_agent_members (agent_email, cs_email, is_assistant, created_at)
    select lower(btrim(agent_email)), lower(btrim(cs_email)), bool_or(is_assistant), min(created_at)
    from agent_members group by 1, 2;

    -- `main` lọc hoa hồng theo portal_account.name: tên chuẩn hoá DUY NHẤT được gán;
    -- tên trùng không gán (cảnh báo) — account đó chỉ thấy bản ghi chính mình nộp.
    with normalized as (
      select id, nullif(upper(regexp_replace(btrim(coalesce(name, '')), '\s+', ' ', 'g')), '') as agent_name
      from portal_account
    ), unique_names as (
      select agent_name from normalized where agent_name is not null group by agent_name having count(*) = 1
    )
    insert into authz_commission_names (account_id, agent_name, updated_by_email)
    select n.id, n.agent_name, p_actor_email from normalized n join unique_names u using (agent_name)
    -- sau reset: tên từng thuộc account KHÁC trong sổ thì không gán lại (Task 4)
    where not exists (
      select 1 from authz_commission_name_history h where h.agent_name = n.agent_name and h.account_id <> n.id);

    insert into authz_commission_name_history (agent_name, account_id, account_email)
    select c.agent_name, c.account_id, a.email
    from authz_commission_names c join authz_accounts a on a.id = c.account_id;

    select v_warnings || coalesce(jsonb_agg(jsonb_build_object('warning', 'duplicate_commission_name', 'name', d.agent_name)), '[]'::jsonb)
      into v_warnings
    from (
      select upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) as agent_name
      from portal_account where nullif(btrim(coalesce(name, '')), '') is not null
      group by 1 having count(*) > 1
    ) d;
  else
    -- missing_only: chỉ THÊM account production có id chưa có trong authz; không sửa
    -- dòng đã có; không khoá bảng. Mọi xung đột → DỪNG và liệt kê, không đoán
    -- (không tự thay role, không bỏ qua email trùng).
    create temp table authz_sync_new on commit drop as
    select p.* from portal_account p
    where not exists (select 1 from authz_accounts a where a.id = p.id)
      and not (p.id = any(coalesce(p_skip_account_ids, '{}')));

    select string_agg(n.email, ', ') into v_list from authz_sync_new n
    where exists (select 1 from authz_accounts a where a.email = lower(btrim(n.email)));
    if v_list is not null then
      raise exception using message = 'AUTHZ_SYNC_EMAIL_TAKEN_OTHER_ID', detail = v_list,
        hint = 'Email đã có account authz khác id (thường do đăng nhập bản authz trước lúc nhập). Xử lý theo runbook Task 8 bước 10.';
    end if;
    select string_agg(n.email, ', ') into v_list from authz_sync_new n
    where (select count(*) from user_roles ur where ur.user_id = n.id) > 1;
    if v_list is not null then
      raise exception using message = 'AUTHZ_SYNC_MULTIPLE_ROLES', detail = v_list;
    end if;
    select string_agg(n.email, ', ') into v_list from authz_sync_new n
    join user_roles ur on ur.user_id = n.id
    where not exists (select 1 from authz_roles ar where ar.id = ur.role_id);
    if v_list is not null then
      raise exception using message = 'AUTHZ_SYNC_ROLE_NOT_IN_AUTHZ', detail = v_list,
        hint = 'Role được tạo trên main sau lần đồng bộ — trái đóng băng. Báo chủ repo.';
    end if;
    select string_agg(n.email, ', ') into v_list from authz_sync_new n
    where n.is_active and not exists (
      select 1 from user_roles ur join authz_roles ar on ar.id = ur.role_id and ar.is_active where ur.user_id = n.id);
    if v_list is not null then
      raise exception using message = 'AUTHZ_SYNC_ACTIVE_WITHOUT_ROLE', detail = v_list;
    end if;
    select string_agg(e, ', ') into v_list
    from (select lower(btrim(email)) as e from authz_sync_new group by 1 having count(*) > 1) d;
    if v_list is not null then
      raise exception using message = 'AUTHZ_SYNC_DUPLICATE_EMAIL', detail = v_list;
    end if;

    insert into authz_accounts (id, email, name, password_hash, is_active, agent_id, avatar_url, access_version, created_at)
    select id, lower(btrim(email)), name, password_hash, is_active, agent_id, avatar_url, 0, created_at
    from authz_sync_new;

    insert into authz_user_roles (user_id, role_id, created_at)
    select ur.user_id, ur.role_id, ur.created_at from user_roles ur join authz_sync_new n on n.id = ur.user_id;

    -- Roster + uỷ quyền của account mới: chỉ dòng mà CẢ HAI đầu đã có account authz.
    insert into authz_task_agents (email, created_at)
    select lower(btrim(t.email)), min(t.created_at)
    from task_agents t join authz_sync_new n on lower(btrim(n.email)) = lower(btrim(t.email))
    group by 1
    on conflict (email) do nothing;

    insert into authz_agent_members (agent_email, cs_email, is_assistant, created_at)
    select lower(btrim(m.agent_email)), lower(btrim(m.cs_email)), bool_or(m.is_assistant), min(m.created_at)
    from agent_members m
    where exists (select 1 from authz_sync_new n
                  where lower(btrim(n.email)) in (lower(btrim(m.agent_email)), lower(btrim(m.cs_email))))
      and exists (select 1 from authz_accounts a where a.email = lower(btrim(m.agent_email)))
      and exists (select 1 from authz_accounts a where a.email = lower(btrim(m.cs_email)))
    group by 1, 2
    on conflict (agent_email, cs_email) do nothing;

    -- Tên hoa hồng của account mới: tên chuẩn hoá, chưa ai giữ, không có trong sổ
    -- của account khác, không trùng giữa các account mới. Không gán được → cảnh báo.
    with normalized as (
      select n.id, n.email, nullif(upper(regexp_replace(btrim(coalesce(n.name, '')), '\s+', ' ', 'g')), '') as agent_name
      from authz_sync_new n
    ), assignable as (
      select x.* from normalized x
      where x.agent_name is not null
        and not exists (select 1 from authz_commission_names c where c.agent_name = x.agent_name)
        and not exists (select 1 from authz_commission_name_history h where h.agent_name = x.agent_name and h.account_id <> x.id)
        and (select count(*) from normalized y where y.agent_name = x.agent_name) = 1
    ), inserted as (
      insert into authz_commission_names (account_id, agent_name, updated_by_email)
      select id, agent_name, p_actor_email from assignable
      returning account_id, agent_name
    )
    insert into authz_commission_name_history (agent_name, account_id, account_email)
    select i.agent_name, i.account_id, n.email from inserted i join authz_sync_new n on n.id = i.account_id;

    select v_warnings || coalesce(jsonb_agg(jsonb_build_object('warning', 'commission_name_not_assigned', 'email', n.email)), '[]'::jsonb)
      into v_warnings
    from authz_sync_new n
    where nullif(btrim(coalesce(n.name, '')), '') is not null
      and not exists (select 1 from authz_commission_names c where c.account_id = n.id);
  end if;

  -- ---------- Hậu kiểm (trước commit) ----------
  if authz_production_auth_fingerprint() is distinct from p_expected_fingerprint then
    raise exception using message = 'AUTHZ_SYNC_PRODUCTION_CHANGED',
      hint = 'Production đổi trong lúc chép. Chạy lại.';
  end if;
  if not exists (
    select 1 from authz_accounts a join authz_user_roles ur on ur.user_id = a.id
    join authz_roles r on r.id = ur.role_id
    where a.is_active and r.is_active and r.system_key = 'super_admin'
  ) then
    raise exception using message = 'AUTHZ_SYNC_POSTCHECK_NO_RECOVERY_ADMIN';
  end if;
  select string_agg(a.email, ', ') into v_list
  from authz_accounts a
  where a.is_active and not exists (
    select 1 from authz_user_roles ur join authz_roles r on r.id = ur.role_id and r.is_active where ur.user_id = a.id);
  if v_list is not null then
    raise exception using message = 'AUTHZ_SYNC_POSTCHECK_ACTIVE_WITHOUT_ROLE', detail = v_list;
  end if;
  if exists (select 1 from authz_roles where coalesce(system_key, '') <> 'super_admin' and not grants_managed) then
    raise exception using message = 'AUTHZ_SYNC_POSTCHECK_UNMANAGED_ROLE';
  end if;
  if p_mode in ('initial', 'reset') and (
    (select count(*) from authz_accounts) <> (select count(*) from portal_account)
    or (select count(*) from authz_roles) <> (select count(*) from roles)
    or (select count(*) from authz_user_roles) <> (select count(*) from user_roles)
  ) then
    raise exception using message = 'AUTHZ_SYNC_POSTCHECK_COUNT_MISMATCH';
  end if;

  v_report := jsonb_build_object(
    'mode', p_mode,
    'accounts', (select count(*) from authz_accounts),
    'roles', (select count(*) from authz_roles),
    'user_roles', (select count(*) from authz_user_roles),
    'role_grants', (select count(*) from authz_role_grants),
    'task_agents', (select count(*) from authz_task_agents),
    'agent_members', (select count(*) from authz_agent_members),
    'commission_names', (select count(*) from authz_commission_names),
    'skipped_accounts', to_jsonb(coalesce(p_skip_account_ids, '{}')),
    'warnings', v_warnings
  );

  if p_dry_run then
    raise exception using message = 'AUTHZ_SYNC_DRY_RUN', detail = v_report::text;
  end if;

  insert into authz_audit (actor_email, event, target_type, target_id, after)
  values (p_actor_email, 'authz.sync.' || p_mode, 'authz', 'sync', v_report);
  return v_report;
end;
$$;
```

Kịch bản CI (`supabase/checks/ci-authz-sync.sql`, Task 0.5): nạp fixture production; (a) dry-run → bắt `AUTHZ_SYNC_DRY_RUN`, `authz_accounts` vẫn rỗng; (b) fingerprint sai → `AUTHZ_SYNC_PRODUCTION_CHANGED`; (c) account active không role → `AUTHZ_SYNC_ACTIVE_WITHOUT_ROLE`, authz vẫn rỗng; (d) `initial` thật → số dòng khớp, email chữ thường, tên hoa hồng trùng không gán; (e) `initial` lần 2 → `AUTHZ_SYNC_NOT_EMPTY`; (f) thêm account production mới (có role, 1 dòng roster, 1 uỷ quyền tới account cũ, tên duy nhất) → `missing_only` thêm đúng account đó + role + roster + uỷ quyền + tên, không sửa account cũ; (f2) account mới có email trùng account authz khác id → `AUTHZ_SYNC_EMAIL_TAKEN_OTHER_ID`, không ghi gì; (f3) account mới giữ role không có trong authz → `AUTHZ_SYNC_ROLE_NOT_IN_AUTHZ`; (f4) trong cùng transaction sau `missing_only`: `select count(*) from pg_locks l join pg_class c on c.oid = l.relation where l.pid = pg_backend_pid() and l.mode not in ('AccessShareLock','RowShareLock','RowExclusiveLock')` = 0 (không khoá bảng authz lẫn production), rồi `rollback`; (f5) `initial` cũng không giữ khoá nào mạnh hơn `AccessShareLock` trên 6 bảng production; (g) `reset` thiếu `p_confirm` → lỗi; (g2) A giữ "JANE DOE", `reset` (production lúc này A đã đổi tên) → sổ vẫn còn dòng của A, B có tên hiển thị "Jane Doe" không được gán; (h) sau mọi bước `ci-production-unchanged.sql`. Đo thời gian: mỗi lời gọi in `clock_timestamp()` trước/sau — số đo thật lấy ở buổi tổng duyệt trên bản sao (Task 8 bước 2b).

- [ ] **Step 2: Phần thuần + test** — `src/lib/authz/sync-plan.ts`:

```ts
import type { DecisionMismatch } from "./decision-diff";
import { diffDecisions } from "./decision-diff";
import { compatGrantsForRole, type LegacyAccess } from "./compat";
import { decodeGrant } from "./grants";
import { SUPER_ADMIN_GRANTS } from "./principal";

export type ProductionRole = { id: string; name: string; isActive: boolean; permissions: string[] };
export type ProductionAccount = { id: string; email: string; isActive: boolean; legacyRole: string | null; roleIds: string[] };
export type AccountDiff = { accountId: string; email: string; isActive: boolean; mismatches: DecisionMismatch[] };
/** Một dòng đã duyệt: đúng account, đúng quyết định, đúng chiều cũ → mới (review Codex của plan). */
export type ApprovedDiff = { accountId: string; decision: string; legacy: boolean; next: boolean; reason: string };

/** Grant cho mọi role trừ super admin — đúng tham số p_role_grants của authz_sync_from_production. */
export function computeRoleGrants(
  roles: readonly ProductionRole[],
  superAdminRoleId: string
): Record<string, { action: string; scope: string }[]> {
  const out: Record<string, { action: string; scope: string }[]> = {};
  for (const role of roles) {
    if (role.id === superAdminRoleId) continue;
    out[role.id] = compatGrantsForRole({ name: role.name, permissions: role.permissions })
      .map((grant) => decodeGrant(grant))
      .filter((grant): grant is NonNullable<typeof grant> => grant !== null)
      .map((grant) => ({ action: grant.action, scope: grant.scope }));
  }
  return out;
}

/** Quyết định CŨ (như getUserAccess của main) so với grant MỚI sẽ nạp — cho MỌI account, kể cả khoá. */
export function diffAllAccounts(
  accounts: readonly ProductionAccount[],
  roles: readonly ProductionRole[],
  roleGrants: Record<string, { action: string; scope: string }[]>,
  superAdminRoleId: string
): AccountDiff[] {
  const byId = new Map(roles.map((role) => [role.id, role]));
  return accounts.map((account) => {
    const activeRoles = account.roleIds.map((id) => byId.get(id)).filter((role) => role?.isActive) as ProductionRole[];
    const legacy: LegacyAccess = {
      permissions: [...new Set(activeRoles.flatMap((role) => role.permissions))],
      roles: activeRoles.map((role) => role.name),
      legacyRole: account.legacyRole,
    };
    const grants = activeRoles.flatMap((role) =>
      role.id === superAdminRoleId
        ? [...SUPER_ADMIN_GRANTS]
        : (roleGrants[role.id] ?? []).map((grant) => `${grant.action}:${grant.scope}`)
    );
    return { accountId: account.id, email: account.email, isActive: account.isActive, mismatches: diffDecisions(legacy, grants) };
  });
}

/**
 * Mọi lệch của MỌI account — kể cả account đang khoá (mở lại trên authz là có ngay
 * quyền mới, review Codex lần 2) — phải khớp một dòng duyệt; dòng duyệt không dùng tới = cũ, báo lại.
 */
export function checkApprovedDiffs(diffs: readonly AccountDiff[], approved: readonly ApprovedDiff[]) {
  const key = (a: { accountId: string; decision: string; legacy: boolean; next: boolean }) =>
    `${a.accountId}|${a.decision}|${a.legacy}|${a.next}`;
  const approvedKeys = new Set(approved.map(key));
  const used = new Set<string>();
  const unapproved: { email: string; mismatch: DecisionMismatch }[] = [];
  for (const diff of diffs) {
    for (const mismatch of diff.mismatches) {
      const k = key({ accountId: diff.accountId, ...mismatch });
      if (approvedKeys.has(k)) used.add(k);
      else unapproved.push({ email: diff.email, mismatch });
    }
  }
  return { unapproved, unused: approved.filter((a) => !used.has(key(a))) };
}
```

(Kiểm tên thật trước khi dùng: `compatGrantsForRole` và `LegacyAccess` trong `src/lib/authz/compat.ts`, `SUPER_ADMIN_GRANTS` trong `src/lib/authz/principal.ts` — nếu `principal.ts` kéo `next-auth` vào script thì chuyển hằng sang `src/lib/authz/super-admin.ts` và re-export.) Test: persona Admin/Task CS/Agent/Assistant không lệch; role có permission lạ → có lệch; `checkApprovedDiffs`: lệch khớp dòng duyệt → không còn `unapproved`; cùng account nhưng khác `decision` hoặc khác chiều → vẫn `unapproved`; account KHOÁ có lệch chưa duyệt → vẫn `unapproved` (mở lại trên authz là có ngay quyền mới); dòng duyệt thừa → `unused`.

- [ ] **Step 3: Script** `scripts/authz-sync-from-production.ts` — luồng (đọc production CHỈ SELECT, qua `fetchAllRows` với `{ count: "exact" }`, `.order()` theo khoá chính):
  1. `fp1 = rpc("authz_production_auth_fingerprint")`.
  2. Đọc `roles` (+ `role_permissions`), `portal_account` (`id,email,role,is_active`), `user_roles`. (Cột `portal_account.role` chỉ đọc ở đây để dựng quyết định CŨ cho diff — script nằm ngoài `src/` chạy thật, cổng tên role không áp.)
  3. `fp2 = rpc("authz_production_auth_fingerprint")`; `fp1 !== fp2` → exit 1 "production đổi trong lúc đọc, chạy lại".
  4. Chọn role: `--super-admin-role <id>` và `--default-role <id>` BẮT BUỘC (không đoán theo tên); in tên role đã chọn.
  5. `roleGrants = computeRoleGrants(...)`; `diffs = diffAllAccounts(...)`; `checkApprovedDiffs(diffs, readJson("docs/authz-approved-diffs.json"))` — in từng lệch chưa duyệt (email, quyết định, cũ → mới) và mọi dòng duyệt thừa; account khoá được so và phải duyệt như account active (ghi chú "đang khoá" cạnh email). Chế độ `missing_only`: chỉ so các account production có id chưa có trong authz (sắp được nhập), cùng file duyệt.
  6. Gọi `authz_sync_from_production(mode, …, fp1, actorEmail, p_dry_run: true)` — phải lỗi đúng `AUTHZ_SYNC_DRY_RUN`; in báo cáo từ `details` (số dòng, cảnh báo). Lỗi khác → in mã + detail + hint, exit 1.
  7. Không có `--apply`: exit 0 nếu bước 5 không còn `unapproved`, ngược lại exit 1.
  8. `--apply` (chỉ khi bước 5 sạch và bước 6 qua): gọi lại với `p_dry_run: false` (cùng `fp1`). Rồi đọc lại `authz_*` bằng `fetchAllRows`, dựng grant hiệu lực từ DB và so với `roleGrants` đã gửi (mọi role, mọi dòng) → khác thì exit 1 và in lệnh `--mode reset` để làm lại.
  Cờ: `--mode initial|missing_only|reset` (mặc định `initial`), `--confirm "RESET AUTHZ"` cho reset, `--actor <email>`, `--skip-account <production id>` (lặp được; chỉ `missing_only` — truyền vào `p_skip_account_ids`, in lại trong báo cáo). Khi hàm dừng với `AUTHZ_SYNC_EMAIL_TAKEN_OTHER_ID`, script in sẵn lệnh chạy lại kèm `--skip-account` cho từng account xung đột (người vận hành quyết định có dùng không).
- [ ] **Step 4:** `npx vitest run src/lib/supabase-paging.test.ts src/lib/authz/sync-plan.test.ts`; chạy thử `SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=x npx vite-node -c vitest.config.ts scripts/authz-sync-from-production.ts --super-admin-role x --default-role y` → lỗi mạng (không lỗi import). PGlite: `ci-authz-sync.sql` qua.
- [ ] **Step 5: Commit** `feat(authz): đồng bộ production → authz trong một transaction, dry-run chạy thật rồi rollback, diff duyệt theo từng quyết định (0.3)`.

---

### Task 0.4: Code đọc/ghi phân quyền qua bảng authz; chặn các đường còn chạm dữ liệu `main` dựa vào

**Files (theo kiểm kê):**
- `.from("roles")` / `.from("user_roles")` / `.from("permissions")`: `src/lib/authz/principal.ts` (`fetchRoleRows`: `authz_roles` + `authz_role_grants`; bỏ embed `role_permissions`), `src/lib/rbac/role-management.ts` (`ROLE_SELECT` dòng 80-82 bỏ `role_permissions(permission_key)`, `role_grants` → `authz_role_grants`; dòng 103 embed `portal_account!inner(is_active)` → `authz_accounts!inner(is_active)`), `src/lib/rbac/access.ts` (`ACCESS_SELECT` → `"id,email,is_active,agent_id,authz_user_roles(authz_roles(id,name,is_active,system_key))"`, `flattenAccess` đọc cấu trúc mới; `permissions` trả `[]`), `src/app/(authed)/account-manager/page.tsx`, `src/app/api/admin/permissions/route.ts` (trả danh sách từ `ACTIONS` của catalog, không đọc bảng).
- `.from("task_agents")` (7) / `.from("agent_members")` (12): `src/lib/tasks/assignees.ts`, `src/lib/tasks/membership.ts`, `src/lib/enrollment/scope.ts` (qua membership), `src/lib/leads/membership.ts`, `src/lib/notifications/audience.ts`, `src/lib/tasks/overview-data.ts`, `src/app/api/config/agents/route.ts`, `src/app/api/config/assistants/route.ts`, `src/app/api/admin/users/[id]/route.ts` (`findEmailReference`), … — thay bằng `AUTHZ_TABLES.taskAgents` / `.agentMembers`.
- `.from("portal_account")` trực tiếp (23): thay bằng `PORTAL_ACCOUNT_TABLE` (đã trỏ `authz_accounts`) hoặc `AUTHZ_TABLES.accounts`.
- Cột `role` legacy không có trong `authz_accounts` — bỏ khỏi chuỗi select: `src/auth.ts:65`, `src/app/(authed)/account-manager/page.tsx:40`, `src/app/api/admin/users/route.ts:135`, `src/app/api/admin/users/[id]/route.ts:210`, `src/lib/tasks/overview-data.ts:38`; bỏ trường `role` của kiểu account ở `src/lib/domain/account.types.ts:16`. `session.user.role` vẫn suy từ `access.legacyRole` (theo `system_key`, `src/lib/rbac/access.ts:67`) như hiện tại. `legacyRoleFallback` ở `src/app/api/admin/users/route.ts:91` chỉ chọn `system_key` — giữ.
- `.from("agent_commission_names")`: `src/lib/agent-identity.ts`, `src/app/(authed)/account-manager/page.tsx` → `AUTHZ_TABLES.commissionNames`.
- RPC: `upsert_role_atomic` → `authz_upsert_role` (bỏ `p_legacy_keys` — xoá `projectLegacyPermissions` khỏi route và cả hàm trong `delegation.ts` cùng test), `delete_role_atomic` → `authz_delete_role`, `create_account_atomic` → `authz_create_account`, `update_account_atomic` → `authz_update_account`, `delete_account_atomic` → `authz_delete_account`, `bump_*` → `authz_bump_*`, `add/remove_*` → `authz_*`, `assign_unassigned_task` → `authz_assign_unassigned_task` (`src/app/api/tasks/[id]/assign/route.ts:72,104`), `table_config_write_context` → `authz_table_config_write_context` (`src/lib/table-config/write-context.ts:52,79-81`).
- `src/lib/authz/versions.ts`: `access_version` đọc/ghi `authz_accounts`.
- **Web Push** (review Codex của plan, P0): `push_subscriptions` / `notification_preferences` là dữ liệu nghiệp vụ được duyệt ghi — bản authz đăng ký/huỷ thiết bị (`src/app/api/notifications/push/subscribe/route.ts:48,78`) và dọn endpoint chết (`src/lib/notifications/push-server.ts:109`) y như `main`. Hai bản không chạy song song (bản authz THAY `main`), nên không có chuyện hai bản cùng gửi. BỎ lời gọi `revokePushSubscriptions` khi khoá account ở `src/app/api/admin/users/[id]/route.ts`: khoá chỉ xảy ra trên authz; xoá thiết bị thì sau rollback account (vẫn active trên `main`) mất push không lý do. Người bị khoá không nhận push vì `filterActiveAccounts` đọc `authz_accounts`.
- `login_attempts` (`src/lib/auth/rate-limit.ts:34`): dữ liệu nghiệp vụ, giữ nguyên.
- Đã kiểm: không có embed FK nào từ bảng nghiệp vụ sang `portal_account` trong `src/` (`grep -rnE 'portal_account!|portal_account\(' src` chỉ ra `role-management.ts:103`, đã xử lý ở trên).

- [ ] **Step 1: Module đọc production duy nhất** — `src/lib/authz/production-read.ts`:

```ts
/**
 * NƠI DUY NHẤT trong src/ được đọc bảng phân quyền production (chỉ SELECT).
 * Cổng `src/lib/authz/isolation.test.ts` cho phép file này và chặn mọi chỗ
 * khác. Không hàm nào ở đây ghi. Không dùng cho quyết định phân quyền — chỉ để
 * không phá dữ liệu mà `main` còn dựa vào (avatar) và báo lỗi rõ ở Time Off
 * (ma trận ở đầu Nhóm 0).
 */
import { getSupabaseAdmin } from "@/lib/supabase";

/** avatar_url mà `main` đang trỏ cho account này (null nếu không có). */
export async function productionAvatarUrl(accountId: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("portal_account")
    .select("avatar_url")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.avatar_url as string | null | undefined) ?? null;
}

export type ProductionAccountState = "active" | "inactive" | "missing";

/** Trạng thái các account (theo id) trong `portal_account`. */
export async function productionAccountStates(
  ids: readonly string[]
): Promise<Map<string, ProductionAccountState>> {
  const unique = [...new Set(ids)];
  const found = new Map<string, boolean>();
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await getSupabaseAdmin()
      .from("portal_account")
      .select("id,is_active")
      .in("id", unique.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const row of data ?? []) found.set(row.id as string, row.is_active as boolean);
  }
  return new Map(
    unique.map((id) => [id, !found.has(id) ? "missing" : found.get(id) ? "active" : "inactive"] as const)
  );
}
```

- [ ] **Step 2: Avatar không xoá ảnh `main` còn trỏ tới.** `src/app/api/settings/avatar/route.ts`, thay hai chỗ `after(() => deleteAvatarByUrl(previousUrl))` (POST sau khi ghi cột thành công, và DELETE) bằng `after(() => deleteAvatarUnlessProductionUses(previousUrl, account.id))`:

```ts
/**
 * Ảnh cũ mà `main` còn trỏ (portal_account.avatar_url) phải còn nguyên: rollback
 * về `main` mà file đã xoá là mất ảnh (plan 2026-10-03, Global Constraints).
 * Chỉ xoá ảnh sinh ra trong giai đoạn chạy bản authz.
 */
async function deleteAvatarUnlessProductionUses(url: string | null, accountId: string): Promise<void> {
  if (!url) return;
  if ((await productionAvatarUrl(accountId)) === url) return;
  await deleteAvatarByUrl(url);
}
```

Nhánh lỗi (xoá ảnh VỪA tải lên khi ghi cột hỏng) giữ nguyên — ảnh đó `main` chưa từng trỏ tới. Test (`route.test.ts`): `previousUrl` bằng `portal_account.avatar_url` → `deleteAvatarByUrl` không được gọi; khác → được gọi.

- [ ] **Step 3: Cổng Time Off theo ma trận.** `src/lib/time-off/account-gate.ts`:

```ts
import { NextResponse } from "next/server";
import { AUTHZ_TABLES } from "@/lib/authz/tables";
import { productionAccountStates } from "@/lib/authz/production-read";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Trước mọi GHI Time Off: các account liên quan (người nộp, người duyệt, account
 * được chỉnh số dư, actor) phải active trên authz VÀ tồn tại + active trong
 * `portal_account` — bảng `time_off_*` có khoá ngoại tới đó và RPC của `main`
 * kiểm `portal_account.is_active` (ma trận ở đầu Nhóm 0). Trả response lỗi rõ
 * ràng thay cho lỗi khoá ngoại / ACCOUNT_INACTIVE; null = cho qua.
 */
export async function timeOffAccountGate(ids: readonly (string | null | undefined)[]): Promise<NextResponse | null> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return null;
  const { data, error } = await getSupabaseAdmin().from(AUTHZ_TABLES.accounts).select("id,is_active").in("id", wanted);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if ((data ?? []).some((row) => !row.is_active) || (data ?? []).length !== wanted.length) {
    return NextResponse.json({ error: "This account is deactivated." }, { status: 409 });
  }
  const states = await productionAccountStates(wanted);
  if ([...states.values()].includes("missing")) {
    return NextResponse.json(
      { error: "Time Off isn't available yet for accounts created after the access-control update." },
      { status: 409 }
    );
  }
  if ([...states.values()].includes("inactive")) {
    return NextResponse.json(
      { error: "Time Off isn't available yet for accounts reactivated after the access-control update." },
      { status: 409 }
    );
  }
  return null;
}
```

Gọi ngay trước lệnh ghi ở: `src/app/api/time-off/route.ts:265` (người nộp + manager được chọn), `holidays/route.ts:23` (actor), `requests/[id]/route.ts:67,82,104` (người nộp + actor), `accruals/route.ts:40` (actor), `balances/route.ts:46` (account + actor), `accruals/apply/route.ts:23` và `balances/bulk/route.ts:44` (actor; hai route này đổi sang RPC `authz_apply_time_off_monthly_accruals` / `authz_bulk_adjust_time_off_balances` — tập account do hàm tự lọc theo ma trận), `src/app/api/cron/time-off-monthly-accrual/route.ts:27` (không actor; đổi sang `authz_apply_time_off_monthly_accruals`). Test cho từng nhánh của ma trận (mock `productionAccountStates`); kịch bản CI cho hai hàm tập: account khoá trên authz, account khoá trên production, account chỉ có trên authz → không được cộng/chỉnh.

- [ ] **Step 4:** Sửa phần còn lại theo danh sách; `npx tsc --noEmit` để bắt chỗ sót kiểu embed.
- [ ] **Step 5:** Cập nhật mock trong test (tên bảng/RPC mới). `npx vitest run` xanh.
- [ ] **Step 6: Commit** `refactor(authz): code đọc/ghi phân quyền qua bảng authz_*; avatar và Time Off không phá dữ liệu main dựa vào (0.4)`.

---

### Task 0.5: Cổng chứng minh nhánh không đổi dữ liệu phân quyền và cấu trúc production

**Vì sao (review Codex của plan, P0 + P1):** (1) workflow hiện tại chạy mỗi file bằng một `psql -f` riêng — bảng TEMP biến mất giữa các bước; (2) nếu chụp mốc SAU khi đã chạy `schema.sql` của nhánh (đã có khối authz) thì lần cài authz đầu tiên nằm trước mốc — không chứng minh được gì; (3) regex `.from()`/`.rpc()` chỉ bắt đường cú pháp đã biết — cần thêm đồ thị gọi SQL và dấu vân tay chỉ đọc trên DB thật.

**Files:**
- Create: `src/lib/authz/isolation.test.ts`, `src/lib/authz/sql-call-graph.test.ts`
- Create: `supabase/checks/ci-production-fixture.sql`, `ci-production-snapshot.sql`, `ci-production-unchanged.sql`, `ci-authz-sync.sql`, `supabase/checks/prod-fingerprint.sql`
- Modify: `.github/workflows/db-persistence-gate.yml`

- [ ] **Step 1: Cổng TS** (`isolation.test.ts`), quét `src/**/*.ts(x)` và `scripts/**/*.ts` (trừ test):
  - `.from("<tên>")` với tên thuộc `PRODUCTION_AUTH_TABLES`: trong `src/` chỉ được ở `src/lib/authz/production-read.ts`; trong `scripts/` được. Ở mọi chỗ được phép, chuỗi method theo sau trong cùng biểu thức không được chứa `.insert(`, `.update(`, `.upsert(`, `.delete(`.
  - `.rpc("<tên>")`: tên phải bắt đầu bằng `authz_` HOẶC nằm trong `BUSINESS_RPCS` khai báo trong test — danh sách hiện tại (lấy bằng `grep -rhoE '\.rpc\(\s*"[a-z_0-9]+' src scripts | sort -u`, trừ các RPC phân quyền đổi tên ở Task 0.4): `adjust_time_off_balance`, `approve_time_off_request`, `archive_enrollment_atomic`, `assign_leads_manual`, `assign_leads_round_robin`, `bump_task_assignment_rotation`, `configure_time_off_monthly_accrual`, `create_enrollment_atomic`, `create_enrollment_comment_idempotent`, `create_lead_comment_atomic`, `create_table_column_option`, `create_task_atomic`, `create_task_attachment_atomic`, `create_task_comment_atomic`, `delete_enrollment_comment_atomic`, `delete_task_attachment_atomic`, `delete_task_comment_atomic`, `delete_task_sla_rule_atomic`, `edit_enrollment_comment_atomic`, `edit_task_comment_atomic`, `enrollment_comment_reactions_for_record`, `enrollment_option_usage_count`, `enrollment_touch_activity`, `log_lead_interaction_atomic`, `patch_enrollment_atomic`, `patch_task_atomic`, `reorder_table_columns_atomic`, `save_lead_assignment_weights`, `save_task_sla_rule_atomic`, `table_column_option_usage_count`, `task_comment_reactions_for_task`, `task_list_metadata`, `update_task_reminder_setting_atomic`. RPC mới không có trong danh sách → test đỏ (buộc người thêm phải xét).
  - `createClient(` chỉ ở `src/lib/supabase.ts` và `src/lib/supabase-browser.ts` (không có client service-role thứ hai lách cổng).
  - Fixture âm trong chính test: chuỗi mẫu `.from("roles").update(`, `.rpc("upsert_role_atomic"`, `.from("portal_account")` ngoài `production-read.ts` phải bị bắt.
- [ ] **Step 2: Đồ thị gọi SQL** (`sql-call-graph.test.ts`, đọc file SQL, không cần Postgres):
  - Tập hàm production = mọi `create or replace function <tên>` trong `supabase/schema.sql` và `supabase/rollouts/*.sql` có tên KHÔNG bắt đầu bằng `authz_`.
  - Với mỗi thân hàm trong `2026-10-03-authz-isolated.sql`: (a) không có `insert into` / `update` / `delete from` / `truncate` / `alter` / `drop` / `create or replace function` nhắm bảng/hàm không có tiền tố `authz_`, trừ danh sách cho phép theo hàm — `authz_assign_unassigned_task`: các bảng nghiệp vụ mà thân `assign_unassigned_task` của `main` ghi (liệt kê đúng tên khi port); `authz_sync_from_production`: `create temp table authz_sync_new`; `authz_bulk_adjust_time_off_balances` / `authz_apply_time_off_monthly_accruals`: đúng các bảng `time_off_*` mà bản gốc ghi; (b) không nhắc tên hàm production nào (`\b<tên>\s*\(`), trừ `bump_task_assignment_rotation` trong `authz_assign_unassigned_task`; (c) không có `execute` (SQL động) — vòng quét ACL là khối `do $$` ngoài hàm, được phép.
  - Với mỗi tên trong `BUSINESS_RPCS` (Step 1): thân hàm (bản `main`/rollout) không được GHI bảng thuộc `PRODUCTION_AUTH_TABLES` (quét 2026-09-26: không hàm nào ghi; `adjust_time_off_balance`, `configure_time_off_monthly_accrual` chỉ ĐỌC `portal_account` — đã có ma trận; hai hàm Time Off theo tập đã thay bằng bản `authz_*`).
  - Fixture âm: thân hàm giả `update roles set …`, `perform replace_user_roles(…)`, `execute format(…)` phải bị bắt.
- [ ] **Step 3: Cổng DB — job `authz-isolation`** (workflow; mọi bước `psql -v ON_ERROR_STOP=1 -f`; mốc lưu trong BẢNG THƯỜNG `ci_gate.snapshot`, không phải TEMP):
  1. `actions/checkout` với `fetch-depth: 0`; `git show origin/main:supabase/schema.sql > /tmp/main-schema.sql`.
  2. `ci-bootstrap.sql` → `/tmp/main-schema.sql` → 5 rollout tạo bảng (`2026-08-18-install-sheet-sync-staging`, `2026-09-04-time-off-monthly-accruals`, `2026-09-10-web-push`, `2026-09-12-time-off-manager-notifications`, `2026-09-17-provider-directory-temp`) → `2026-09-13-user-avatar` → `2026-09-26-rls-lockdown`.
  3. `ci-production-fixture.sql`: vài dòng vào `portal_account` (có 1 email chữ hoa, 2 account trùng tên hiển thị, 1 account khoá không role), `roles` (Admin, Agent, 1 role tuỳ chỉnh), `user_roles`, `role_permissions`, `task_agents`, `agent_members` (1 assistant), và 1–2 dòng mỗi bảng nghiệp vụ chính (`tasks`, `time_off_requests`, …).
  3b. `ci-production-write-guard.sql` (review Codex lần 2 — so trạng thái cuối không chứng minh "không hề ghi": ghi rồi trả lại giá trị cũ vẫn khớp hash). CHỈ trên DB CI:
     - trigger `before insert or update or delete or truncate … for each statement` trên MỌI bảng `public` không tiền tố `authz_`, gọi `ci_gate.block_write()` → `raise exception 'CI_WRITE_GUARD: % on %', tg_op, tg_table_name` — mọi lệnh ghi (kể cả `update … set x = x`) nổ ngay, kể cả trong transaction sẽ rollback;
     - event trigger `ci_block_ddl` trên `ddl_command_end`: với mỗi dòng của `pg_event_trigger_ddl_commands()`, `object_identity` phải bắt đầu bằng `public.authz_`, `ci_gate.` hoặc là đối tượng tạm (`schema_name like 'pg_temp%'`); khác → raise. GRANT/REVOKE (không có `object_identity`) do phần `functions`/`rls` của snapshot bắt (ACL nằm trong hash);
     - Postgres thật của CI hỗ trợ event trigger; PGlite ở máy nếu không hỗ trợ thì bỏ file này khi chạy cục bộ (CI vẫn chạy).
  4. `ci-production-snapshot.sql` → tạo `schema ci_gate` + `ci_gate.snapshot(kind text, name text, hash text, primary key (kind, name))`, ghi:
     - `data`: mỗi bảng `public` không tiền tố `authz_` → `md5(string_agg(md5(t::text), '' order by md5(t::text)))` (SQL động trong khối `do`, chỉ ở file CI);
     - `columns`, `constraints` (`pg_get_constraintdef`), `triggers` (kể cả `tgisinternal` — khoá ngoại từ bảng authz sang production sẽ sinh trigger nội bộ ở đây), `indexes` (`pg_indexes.indexdef`), `rls` (`relrowsecurity`, `relacl`) của các bảng đó;
     - `functions`: mọi hàm `public` không tiền tố `authz_` → `md5(pg_get_functiondef(oid) || coalesce(proacl::text, ''))`.
  5. `2026-10-03-authz-isolated.sql` (LẦN CÀI ĐẦU) → `ci-production-unchanged.sql` (tính lại như bước 4, `raise exception` liệt kê mọi (kind, name) khác).
  6. `2026-10-03-authz-isolated.sql` lần 2 (idempotent) → `ci-production-unchanged.sql`.
  7. `ci-authz-sync.sql` (kịch bản Task 0.3 Step 1) → `ci-production-unchanged.sql`.
  8. `ci-production-write-guard-relax.sql`: gỡ guard ghi trên bảng NGHIỆP VỤ (kịch bản RPC ghi chúng hợp lệ — nghiệp vụ được duyệt), GIỮ guard trên 7 bảng phân quyền production và event trigger DDL → `ci-authz-rpc.sql` (khối ghi nghiệp vụ trong `begin; … rollback;`) → `ci-production-unchanged.sql`.
  9. `prod-fingerprint.sql` chạy được (không lỗi) — cùng file chủ repo chạy trên DB thật.
- [ ] **Step 4: Job `fresh-install`** (job cũ, sửa): `ci-bootstrap.sql` → `supabase/schema.sql` của nhánh → rollout tạo bảng → `ci-rls-assert.sql` → `ci-authz-rpc.sql` → `supabase/schema.sql` lần 2. Thêm bước đồng thời (review Codex lần 2 — `missing_only` chạy khi bản authz đang phục vụ): sau khi nạp fixture + `initial`, chạy nền phiên A `psql -c "begin; select authz_sync_from_production('missing_only', …, false); select pg_sleep(5); commit;"`, trong lúc đó phiên B (timeout 1 giây) đọc principal như lúc đăng nhập (`select … from authz_accounts a join authz_user_roles ur … join authz_role_grants …`) và ghi một bảng phân quyền production như `main` vẫn làm (`update portal_account set name = name where id = …`) → cả hai phải xong trong 1 giây (hàm không khoá bảng authz lẫn production). Hai job độc lập, mỗi job một Postgres.
- [ ] **Step 5: Dấu vân tay cho DB thật** — `supabase/checks/prod-fingerprint.sql`, CHỈ `select` (không `do`, không bảng tạm), trả các dòng `kind | name | hash`:
  - `data` cho 7 bảng phân quyền production (`portal_account`, `roles`, `user_roles`, `role_permissions`, `permissions`, `task_agents`, `agent_members`) — KHÔNG băm dữ liệu bảng nghiệp vụ (`main` đang chạy, dữ liệu đó đổi hợp lệ);
  - `columns`, `constraints`, `triggers`, `indexes`, `rls` cho MỌI bảng `public` không tiền tố `authz_`;
  - `functions` cho MỌI hàm `public` không tiền tố `authz_` (`md5(pg_get_functiondef(oid) || coalesce(proacl::text, ''))`).
  Runbook (Task 8): chạy trước rollout authz và sau đồng bộ, lưu hai bản CSV, `diff` phải rỗng. Bảng phân quyền có thể đổi hợp lệ nếu có người sửa account/role trên `main` giữa hai lần → runbook đóng băng việc đó trong khe này.

- [ ] **Step 6: Chứng minh cổng có răng** — tạm thêm vào cuối rollout authz lần lượt: `update roles set description = description;` (ghi rồi giữ nguyên giá trị — guard ghi phải bắt) / `update roles set description = 'x';` / `alter table authz_user_roles add foreign key (user_id) references portal_account(id);` / `create or replace function assign_unassigned_task(...)` (chép thân `main`) → CI phải đỏ ở bước 5 (guard ghi / event trigger / snapshot); bỏ ra.
- [ ] **Step 7: Commit** `test(authz): cổng TS + đồ thị gọi SQL + mốc DB dựng từ main chứng minh nhánh không đổi phân quyền/cấu trúc production (0.5)`.

---

## Xử lý review Codex của plan (16 comment, 2026-09-26)

| # | Mức | Comment (tóm tắt) | Xử lý ở |
|---|---|---|---|
| 1 | P0 | "Production chỉ đọc" không đúng: bản authz còn ghi task/hồ sơ/Time Off/push/`login_attempts` | Chủ repo chọn: bản authz THAY `main`; phạm vi cô lập = bảng phân quyền + cấu trúc; bảng nghiệp vụ được duyệt ghi, liệt kê tường minh; "Lời hứa rollback" viết lại chính xác (Global Constraints) |
| 2 | P1 | Hai nguồn trạng thái account (RPC Time Off kiểm `portal_account`) | Ma trận ở đầu Nhóm 0 + `timeOffAccountGate` (Task 0.4 Step 3); hết hẳn ở "Giai đoạn chốt" |
| 3 | P0 | Không chạy lại `schema.sql` trên production | Architecture; chú thích đầu `schema.sql` (Task 0.2 Step 1); runbook bước 0 (Task 8) — DB thật chỉ chạy rollout |
| 4 | P1 | `LIKE … INCLUDING ALL` chép mọi cột kể cả hash | DDL cột tường minh (Task 0.2 Step 2), `AUTHZ_ACCOUNT_COLUMNS` (Task 0.1), hàm đồng bộ chép đúng danh sách cột; hash có mặt có lý do (đăng nhập mật khẩu) |
| 5 | P0 | Thiếu bảng hàng đợi (`task_assignment_queue_members`, `enrollment_queue_members`, `task_assignment_rotation`) | Quyết định: dữ liệu nghiệp vụ được duyệt ghi (cùng schema/ý nghĩa với `main`); luật đủ điều kiện nằm ở `authz_assign_unassigned_task` + `isQueueEligible` (Task 0.2 Step 3, Task 16); cổng `BUSINESS_RPCS` + đồ thị gọi SQL bắt đường mới (Task 0.5) |
| 6 | P1 | `fetchAllRows` có thể đọc thiếu | Tiến theo dòng thực nhận + đối chiếu `count: exact` + ném khi đổi (Task 0.3 Step 0); đồng bộ không còn phân trang REST (hàm SQL) |
| 7 | P1 | Account không role: báo ở dry-run nhưng chặn sau apply | Hàm đồng bộ dừng TRƯỚC khi ghi với account active; account khoá chỉ cảnh báo (Task 0.3 Step 1) |
| 8 | P0 | `--apply` nhiều request REST không cùng transaction; `--reset` đè thay đổi | Một hàm SQL một transaction, dry-run chạy thật rồi rollback, fingerprint chặn production đổi giữa chừng, `reset` cần `RESET AUTHZ` + chỉ khi `main` đang phục vụ (Task 0.3, runbook bước 13) |
| 9 | P0 | Web Push chưa cô lập; `login_attempts` | Nghiệp vụ được duyệt ghi (hai bản không chạy song song); bỏ `revokePushSubscriptions`; người bị khoá không nhận push nhờ `filterActiveAccounts` đọc authz (Task 0.4) |
| 10 | P0 | Cổng CI: TEMP mất giữa các `psql -f`; mốc chụp sau khi đã cài authz | Bảng thường `ci_gate.snapshot`; mốc dựng từ schema `main` rồi mới cài authz lần đầu; kịch bản ghi nghiệp vụ trong `begin … rollback`; job cài mới tách riêng (Task 0.5 Step 3–4) |
| 11 | P1 | Regex `.from/.rpc` không chứng minh DB thật không đổi | `BUSINESS_RPCS` + chặn `createClient` lạ (Step 1), đồ thị gọi SQL (Step 2), `prod-fingerprint.sql` trước/sau trên DB thật (Step 5, runbook bước 3/8) |
| 12 | P1 | Xác nhận chuyển tên hoa hồng vẫn lộ lịch sử | Cấm hẳn dùng lại tên từng thuộc account khác, bỏ `p_allow_reassign`; giới hạn ghi rõ (Task 4) |
| 13 | P1 | `--allow <email>` quá rộng | Duyệt theo `(accountId, decision, legacy, next, reason)` trong `docs/authz-approved-diffs.json`; cùng bộ so dùng TRƯỚC khi ghi (Task 0.3 Step 2–3, Task 7 Step 3) |
| 14 | P1 | Preflight đếm theo `proname`; thiếu kiểm chứng rollback trên DB thật | Kiểm theo chữ ký (`to_regprocedure`) + md5 `prosrc` + `prosecdef`/`search_path`/ACL, khối lock sinh và kiểm bằng test; dấu vân tay trước/sau; RLS và dữ liệu nghiệp vụ ghi rõ là không đảo (Task 8) |
| 15 | P1 | Lô 100 email vẫn có thể quá 1.000 dòng | Mỗi lô đọc qua `fetchAllRows`, thiếu → fail closed, fixture 1.200 dòng (Task 11 Step 3) |
| 16 | P1 | Push `unassigned` còn ID/actor/URL/tag | `GENERIC_UNASSIGNED_PUSH`; kiểm lại quyền sau khi dựng payload, trước `sendPushToEmails`; test đủ `title/body/url/tag`; runbook: push đã giao không thu hồi (Task 15 Step 1–2) |

---

## Xử lý review Codex lần 2 (11 comment, 2026-09-27)

| # | Mức | Comment (tóm tắt) | Xử lý |
|---|---|---|---|
| 1 | P0 | Plan trái yêu cầu "mọi bảng hiện hữu chỉ đọc" — bản authz còn ghi bảng nghiệp vụ | **Không đổi — quyết định chủ repo** (2026-09-27 xác nhận lại phương án 1). Yêu cầu không phải "mọi bảng chỉ đọc"; ghi rõ trong khối "Quyết định của chủ repo" đầu file |
| 2 | P0 | Rollout RLS là ngoại lệ đổi bảng hiện hữu | **Không đổi — quyết định chủ repo:** ngoại lệ được duyệt 2026-09-26, giữ trong đợt deploy (2026-09-27). Ghi ở khối quyết định đầu file; tách đợt riêng là tuỳ chọn |
| 3 | P0 | Ý nghĩa rollback dữ liệu khi thay toàn bộ người dùng | **Đã chốt** theo phương án 1: không đóng băng ghi nghiệp vụ, không replay; `main` thấy mọi dữ liệu nghiệp vụ phát sinh; cái mất khi rollback liệt kê ở "Lời hứa rollback" + runbook bước 0 (thêm: cộng phép tháng không cộng bù) |
| 4 | P1 | Sổ tên hoa hồng mất khi xoá account (cascade) và khi reset | Sổ không khoá ngoại/cascade, có `account_email`; xoá account chỉ đóng lượt giữ; reset không xoá sổ, không gán lại tên từng thuộc account khác; test "xoá A / reset rồi B xin tên cũ" (Task 0.2 Step 2–3, Task 0.3, Task 4 Step 2) |
| 5 | P1 | `LOCK … IN SHARE MODE` chặn ghi của `main` | Bỏ mọi khoá trên bảng production; nhất quán bằng dấu vân tay ở đầu VÀ cuối hàm; advisory lock chỉ chặn lượt đồng bộ khác; kiểm `pg_locks` trong CI; đo thời gian thật ở buổi tổng duyệt trên bản sao (Task 0.3 Step 1, Task 8 bước 1b) |
| 6 | P1 | `ACCESS EXCLUSIVE` trên authz chặn đăng nhập khi `missing_only` chạy sau deploy | Khoá bảng authz chỉ ở `initial`/`reset` (chỉ chạy khi bản authz không phục vụ); `missing_only` không khoá bảng; CI: test `pg_locks` + test đồng thời hai phiên (đăng nhập + ghi `main` phải xong trong 1 giây) (Task 0.3, Task 0.5 Step 4) |
| 7 | P1 | `missing_only` tự gán role mặc định, bỏ qua email trùng, không nhập roster/uỷ quyền/tên | Fail closed: `EMAIL_TAKEN_OTHER_ID`, `ROLE_NOT_IN_AUTHZ`, `MULTIPLE_ROLES`, `ACTIVE_WITHOUT_ROLE`, `DUPLICATE_EMAIL`; nhập roster + uỷ quyền (khi cả hai đầu có account) + tên hoa hồng; diff account mới phải duyệt; cách xử lý từng lỗi + `--skip-account` tường minh ở runbook bước 10 |
| 8 | P1 | Bỏ qua diff của account đang khoá | `checkApprovedDiffs` so MỌI account; account khoá phải duyệt như account active; test "khoá có lệch chưa duyệt → chặn" (Task 0.3 Step 2, Task 7 Step 3) |
| 9 | P1 | Cổng Time Off không bao được RPC ghi theo tập | Hai hàm tập thay bằng `authz_bulk_adjust_time_off_balances` / `authz_apply_time_off_monthly_accruals` (tập = active trên authz VÀ active trên production), gọi từ 2 route + cron; ma trận viết lại; kịch bản CI cho 3 trường hợp bị loại (Nhóm 0, Task 0.2 Step 3, Task 0.4 Step 3) |
| 10 | P0 | Cổng chỉ chứng minh trạng thái cuối, không chứng minh "không hề ghi" | Thêm guard ghi (trigger mức câu lệnh nổ với MỌI DML, kể cả ghi-rồi-trả-lại) trên mọi bảng không `authz_` suốt lúc cài rollout + đồng bộ, và trên 7 bảng phân quyền suốt kịch bản RPC; event trigger chặn DDL ngoài `authz_*` (Task 0.5 Step 3). Phần "mọi bảng hiện hữu chỉ đọc / credential chỉ SELECT / data plane riêng": không đổi — quyết định chủ repo (#1); với phương án (1) app cần ghi bảng nghiệp vụ nên credential chỉ-SELECT không áp dụng; tạo role/GRANT mới trên DB thật cũng là đổi ACL bảng production |
| 11 | P2 | Câu push `unassigned` sai sự kiện | `GENERIC_UNASSIGNED_PUSH`: "Your task assignment changed.", tag `task-assignment`, dẫn chiếu đúng 3 nơi phát (Task 15 Step 1) |

---

## Bảng đối chiếu: mục review → task

| Mục | Mức | Nội dung ngắn | Task |
|---|---|---|---|
| Yêu cầu chủ repo (cô lập) | Chặn | Nhánh authz ghi/đổi bảng và hàm production | 0.1–0.5 |
| N-1, D P2-02, BR P2-03 | P1 | Task export dựng actor Enrollment → lộ mọi task (và 403 với role chỉ có Task) | 1 |
| D P1-01, BR P1-02 | P1 | `agent_owned` / `assistant_for_agent` bị gộp | 2 |
| D P1-02, A P2-03, BR P1-03 | P1 | Import Enrollment ghi theo ID, bỏ scope/capability/activity | 3 |
| D P1-03, BR P1-04 | P1 | Tên hoa hồng tái dùng mở dữ liệu cũ; tự đặt cho mình | 4 |
| G P1-01, BR P1-06, N-10a | P1 | `assign_unassigned_task` giữ ACL cũ khi `CREATE OR REPLACE`; thiếu `pg_temp` | 0.2 (không còn `create or replace` hàm production; hàm `authz_*` mới tạo đủ ACL + `pg_temp`) — Task 5 chỉ còn bước kiểm |
| N-2 | P1 | Role Manager chỉ xét trần trạng thái SAU; account có role tắt | 6 |
| H P1-01, H P1-02, H P2-01, H P2-02, B P2-03, D P2-06, BR P1-07, BR P2-09 | P1 | Script chuyển role / decision diff chưa là gate chắc | 0.3 (script đồng bộ thay script chuyển role) + 7 |
| N-5 | P1 (vận hành) | Runbook thiếu rollout, không preflight, khe giữa apply và deploy | 8 |
| N-7 | P2 | Email Google có chữ hoa bị khoá vĩnh viễn | 9 |
| N-9 | P2 | Chạy lại `schema.sql` seed/gán role theo tên | 10 (hết áp dụng: `schema.sql` giữ khối production của `main`, không seed bảng authz; `system_key` do script đồng bộ gán) |
| **BR P1-01**, D P2-03, F P2-02, A P2-02 (phần còn), BR P2-01 | **P1** | Roster đọc không phân trang → Agent bị coi là CS thấy mọi task; holders / audience / push / Account Manager không phân trang | 11 |
| N-3 (mới), C P1-01..03 (phần còn) | P2 | `table_config_write_context` còn đọc `role_permissions` | 12 |
| N-4 (mới) | P2 | Grant Overview lộ dữ liệu toàn công ty | 13 |
| A P1-01 (phần còn) | P2 | Chưa có kiểm tươi version cho thao tác quản trị | 14 |
| F P1-01, BR P1-05, F P2-01, F P2-03, F P2-04, BR P2-05, E P2-05 | P1/P2 | Thông báo: push `unassigned`, kiểm lại trước khi push, metadata dòng rút gọn, lỗi một domain, Time Off, chuông | 15 |
| G P2-01, BR P2-02, G P2-03, G P2-04, BR P2-07, N-6 | P2 | Hàng đợi CS / roster: một luật eligibility, audit đủ, RPC cũ, tự uỷ quyền | 16 |
| N-10b, N-10c | P3 | Lỗi unique trả 500; đổi mật khẩu không tăng version | 17 |
| E P2-01, BR P2-04 (config) | P2 | Menu `/config` lệch page guard; nhãn `task.config.manage` sai | 18 |
| E P2-02, BR P2-04 (lead drawer), E P2-03, E P2-04, E P2-06 | P2/P3 | UI còn suy quyền từ persona / từ scope đọc | 19 |
| N-8, H P2-03, A P2-05 (phần còn), BR P2-08 | P2/P3 | Test không thể fail / điểm mù cổng CI / CI không chạy test TS | 20 |
| D P2-04 (phần fallback), bảng review nói quá, dòng trống thừa `src/lib/rbac/access.ts:135` | P3 | Bỏ fallback tên hiển thị; sửa tài liệu | 21 |

**Không làm trong plan này — cần chủ repo quyết định:**
- **D P2-05, BR P2-06** — (a) `task.read` / `enrollment.read` đủ để POST comment; (b) @mention thêm người vào `task_participants` và qua đó cấp `task.read:participating`. Là hành vi sản phẩm: đọc có bao gồm bình luận không (nếu không → cần action `*.comment` riêng); mention có cấp quyền xem không?
- **Q8** — push có được hiện tên khách trên màn hình khoá không (payload rút gọn cho mọi push).
- **A P1-04** — bằng chứng production (truy vấn A0, chạy rollout RLS): việc vận hành của chủ repo; Task 8 cung cấp preflight SQL.
- **D P2-04 (onboarding)** — account mới (đặc biệt Google) chưa có tên hoa hồng thì Registration/Dashboard trống cho tới khi admin đặt; có cần nhắc admin ở Account Manager không.

---

## Nhóm 1 — P1 bảo mật

### Task 1: Task export dùng actor Task, phạm vi theo `task.read` (N-1, D P2-02)

**Vấn đề.** `src/app/api/tasks/export/route.ts:49-64` dựng actor bằng `loadEnrollmentActor()` rồi truyền thẳng vào `fetchTasksForActor`:

```ts
  const actorResult = await loadEnrollmentActor();
  ...
  if (!canActorExport(actorResult.actor.grants, "task")) { ... 403 }
  ...
      fetchTasksForActor(actorResult.actor),
```

Trong `src/lib/tasks/queries.ts:140` có `let seeAll = actor.isManager;`. Với `EnrollmentActor`, `isManager` = `enrollment.read:all` (`src/lib/enrollment/policy.ts:20`) — nên người có `enrollment.read:all` + `task.export:*` (và KHÔNG có `task.read:all`, thậm chí không có `task.read` nào) tải về mọi task. Grant tương thích luôn cấp hai quyền "all" cùng nhau nên test hiện có không bắt được.

**Files:**
- Modify: `src/app/api/tasks/export/route.ts:49-64`
- Modify: `src/lib/tasks/queries.ts:138-141` (tính `seeAll` từ grant, không từ cờ)
- Test: `src/app/api/tasks/export/route.test.ts` (mới), `src/lib/tasks/queries.test.ts` (thêm ca)

- [ ] **Step 1: Test hỏng trước.** Tạo `src/app/api/tasks/export/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchTasksMock, sessionUser } = vi.hoisted(() => ({
  fetchTasksMock: vi.fn(),
  sessionUser: { value: { email: "x@x.com" } as Record<string, unknown> },
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: sessionUser.value })) }));
vi.mock("@/lib/tasks/actor", async () => {
  const { taskActorFromGrants } = await import("@/lib/tasks/access");
  return {
    taskActorForUser: async (user: { grants?: string[] }, email: string) =>
      taskActorFromGrants(email, user.grants ?? []),
  };
});
vi.mock("@/lib/tasks/queries", () => ({
  fetchTasksForActor: fetchTasksMock,
  TASK_COLUMNS: "id",
}));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
  }),
}));
vi.mock("@/lib/table-config/queries", () => ({
  fetchTableColumns: vi.fn(async () => []),
  fetchTableColumnOptions: vi.fn(async () => []),
}));
vi.mock("@/lib/tasks/assignees", () => ({
  fetchTaskAgents: vi.fn(async () => []),
  fetchTaskAssignees: vi.fn(async () => []),
}));

const { POST } = await import("./route");

describe("POST /api/tasks/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchTasksMock.mockResolvedValue({ tasks: [], total: 0, truncated: false });
  });

  it("enrollment.read:all + task.export mà không có task.read: 403, không đọc task", async () => {
    sessionUser.value = { email: "x@x.com", grants: ["enrollment.read:all", "task.export:*"] };
    const response = await POST(new Request("http://localhost/api/tasks/export", { method: "POST", body: "{}" }));
    expect(response.status).toBe(403);
    expect(fetchTasksMock).not.toHaveBeenCalled();
  });

  it("dùng actor TASK: isManager = task.read:all, không phải enrollment.read:all", async () => {
    sessionUser.value = {
      email: "x@x.com",
      grants: ["enrollment.read:all", "task.read:assigned", "task.export:*"],
    };
    await POST(new Request("http://localhost/api/tasks/export", { method: "POST", body: "{}" }));
    expect(fetchTasksMock).toHaveBeenCalledWith(expect.objectContaining({ isManager: false }));
  });
});
```

Kiểm chỗ import thật của route trước khi chạy (đường dẫn `fetchTableColumns`, `fetchTableColumnOptions` có thể ở module khác — sửa `vi.mock` cho đúng module route đang import; mục tiêu chỉ là route không chạm DB thật).

Chạy: `npx vitest run src/app/api/tasks/export/route.test.ts` → FAIL (route vẫn dùng `loadEnrollmentActor`).

- [ ] **Step 2: Sửa route.** Thay khối dựng actor trong `exportTasksResponse`:

```ts
import { auth } from "@/auth";
import { canAccessBoard } from "@/lib/tasks/access";
import { taskActorForUser } from "@/lib/tasks/actor";
...
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Export Task đi theo quyền TASK: phải vào được board (`task.read` bất kỳ) và
  // giữ `task.export`. Trước đây route dựng actor Enrollment nên `isManager`
  // mang nghĩa `enrollment.read:all` (N-1).
  const actor = await taskActorForUser(session.user, email);
  if (!canAccessBoard(actor) || !canActorExport(actor.grants, "task")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  ...
      fetchTasksForActor(actor),
```

Xoá import `loadEnrollmentActor` nếu không còn dùng.

- [ ] **Step 3: Phòng thủ trong `fetchTasksForActor`.** `src/lib/tasks/queries.ts:138-141`:

```ts
  // Phạm vi đọc lấy từ GRANT, không từ cờ `isManager`: cờ đó mang nghĩa khác
  // trên actor của domain khác (N-1). `task.read:all` hoặc hàng đợi chung.
  const readsAll = hasGrant(actor.grants, "task.read", "all");
  let seeAll = readsAll;
  if (!readsAll) {
```

(thêm `hasGrant` vào import từ `@/lib/authz/grants`). Thêm ca test vào `src/lib/tasks/queries.test.ts`: actor `{ email, grants: ["task.read:assigned"], isManager: true, isWorker: true }` (cờ sai cố ý) → `orCalls` phải khác rỗng (vẫn bị giới hạn phạm vi).

- [ ] **Step 4:** `npx vitest run src/app/api/tasks/export src/lib/tasks/queries.test.ts` → PASS; `npx tsc --noEmit` sạch.
- [ ] **Step 5: Commit** `fix(tasks): export Task dùng actor Task và phạm vi theo task.read (N-1)`.

---

### Task 2: Tách `agent_owned` / `assistant_for_agent` ở mọi capability (D P1-01)

**Vấn đề.** `src/lib/tasks/access.ts:103-105`:

```ts
function ownerFacts(isAgentOwner: boolean): RelationFacts {
  return { agent_owned: isAgentOwner, assistant_for_agent: isAgentOwner };
}
```

được dùng cho `canCreateTaskWithScope`, `canReviewDoneTask`, `canAssignToTask`, `canDeleteTask`, `canReadTaskActivity`. Và `taskRelationFacts` coi "không biết `agent_email`" là CẢ HAI quan hệ. Hệ quả: role chỉ cấp `task.delete:agent_owned` (agent xoá task của chính mình) thì Assistant của agent đó cũng xoá được. Enrollment tương tự ở `src/lib/enrollment/policy.ts:70-78` (`enrollmentFacts`) và `canCreateEnrollmentWithScope` (`:107-115`).

Nguyên tắc sửa: **luôn biết `agent_email` của bản ghi**, suy hai quan hệ từ nó:
`agent_owned = isAgentOwner && agent_email == actor.email`; `assistant_for_agent = isAgentOwner && agent_email != actor.email`. Không còn nhánh "không biết thì cho cả hai".

**Files:**
- Modify: `src/lib/tasks/access.ts` (TaskRef bắt buộc `agent_email`; `ownerFacts`; chữ ký 5 hàm; `resolveCreateAssignment`)
- Modify call site Task: `src/app/api/tasks/route.ts:150-200`, `src/app/api/tasks/[id]/route.ts:692-698`, `src/app/api/tasks/[id]/assignees/route.ts:44-47`, `src/app/api/tasks/[id]/assignees/[email]/route.ts:42-45`, `src/app/api/tasks/[id]/activity/route.ts:57-63`, `src/app/api/tasks/[id]/detail/route.ts:163`, và mọi chỗ gọi `canViewTask`/`resolveTaskCapabilities` với object thiếu `agent_email` (tsc sẽ chỉ ra sau Step 2).
- Modify: `src/lib/enrollment/policy.ts` (flags thêm `agentEmail`), call site: `src/app/api/enrollment/[id]/route.ts:139-152, 662-669`, `src/app/api/enrollment/[id]/attachments/route.ts:122-133`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:722-745`, `src/app/api/enrollment/route.ts:212-225`.
- Test: `src/lib/authz/equivalence.test.ts` (truyền `agent_email`), `src/lib/tasks/access.test.ts`, `src/lib/enrollment/capabilities.test.ts` (ca mới).

- [ ] **Step 1: Test hỏng trước** — thêm vào `src/lib/tasks/access.test.ts`:

```ts
import { taskActorFromGrants, canDeleteTask, canAssignToTask, canReadTaskActivity, canReviewDoneTask, canCreateTaskWithScope } from "@/lib/tasks/access";

describe("agent_owned KHÔNG bao assistant_for_agent (D P1-01)", () => {
  const grants = ["task.read:agent_owned", "task.delete:agent_owned", "task.assign:agent_owned",
    "task.activity.read:agent_owned", "task.qc_review:agent_owned", "task.create:agent_owned"];
  const agent = taskActorFromGrants("agent@x.com", grants);
  const assistant = taskActorFromGrants("assistant@x.com", grants);
  const task = { assignee_email: null, agent_email: "agent@x.com" };

  it("chính agent: được", () => {
    expect(canDeleteTask(agent, task, true)).toBe(true);
    expect(canAssignToTask(agent, task, true)).toBe(true);
    expect(canReadTaskActivity(agent, task, true)).toBe(true);
    expect(canReviewDoneTask(agent, task, { isAgentOwner: true })).toBe(true);
    expect(canCreateTaskWithScope(agent, { agentEmail: "agent@x.com", hasAgentScope: true })).toBe(true);
  });

  it("assistant của agent: KHÔNG được khi role chỉ cấp agent_owned", () => {
    expect(canDeleteTask(assistant, task, true)).toBe(false);
    expect(canAssignToTask(assistant, task, true)).toBe(false);
    expect(canReadTaskActivity(assistant, task, true)).toBe(false);
    expect(canReviewDoneTask(assistant, task, { isAgentOwner: true })).toBe(false);
    expect(canCreateTaskWithScope(assistant, { agentEmail: "agent@x.com", hasAgentScope: true })).toBe(false);
  });
});
```

Chạy → FAIL (chữ ký chưa đổi / assistant vẫn được).

- [ ] **Step 2: Sửa `src/lib/tasks/access.ts`.**

```ts
/** Bản ghi task tối thiểu cho quyết định. `agent_email` BẮT BUỘC (D P1-01). */
export type TaskRef = Pick<TaskRow, "assignee_email" | "agent_email">;

export function taskRelationFacts(actor: TaskActor, task: TaskRef, flags: TaskMembershipFlags = {}): RelationFacts {
  const owner = Boolean(flags.isAgentOwner);
  const isAgentSelf = sameEmail(task.agent_email, actor.email);
  return {
    assigned: Boolean(flags.isAssignee),
    reported: Boolean(flags.isReporter),
    participating: Boolean(flags.isParticipant),
    agent_owned: owner && isAgentSelf,
    assistant_for_agent: (owner && !isAgentSelf) || Boolean(flags.isAgentMember),
    shared_queue: Boolean(flags.seesAllTasks),
  };
}

function ownerFacts(actor: TaskActor, agentEmail: string | null, isAgentOwner: boolean): RelationFacts {
  if (!isAgentOwner || !agentEmail) return {};
  const self = sameEmail(agentEmail, actor.email);
  return { agent_owned: self, assistant_for_agent: !self };
}

export function canCreateTaskWithScope(
  actor: TaskActor,
  target: { agentEmail: string | null; hasAgentScope: boolean }
): boolean {
  return scopeMatches(actor.grants, "task.create", ownerFacts(actor, target.agentEmail, target.hasAgentScope));
}
export function canReviewDoneTask(actor: TaskActor, task: TaskRef, flags: { isAgentOwner?: boolean } = {}): boolean {
  return scopeMatches(actor.grants, "task.qc_review", ownerFacts(actor, task.agent_email, Boolean(flags.isAgentOwner)));
}
export function canAssignToTask(actor: TaskActor, task: TaskRef, isAgentOwner: boolean): boolean {
  return scopeMatches(actor.grants, "task.assign", ownerFacts(actor, task.agent_email, isAgentOwner));
}
export function canDeleteTask(actor: TaskActor, task: TaskRef, isAgentOwner = false): boolean {
  return scopeMatches(actor.grants, "task.delete", ownerFacts(actor, task.agent_email, isAgentOwner));
}
export function canReadTaskActivity(actor: TaskActor, task: TaskRef, isAgentOwner: boolean): boolean {
  return scopeMatches(actor.grants, "task.activity.read", ownerFacts(actor, task.agent_email, isAgentOwner));
}
```

Trong `resolveTaskCapabilities`: `canAssign: canAssignToTask(actor, task, Boolean(flags.isAgentOwner))`, `canDelete: canDeleteTask(actor, task, Boolean(flags.isAgentOwner))`, `canReviewQC: canReviewDoneTask(actor, task, { isAgentOwner: flags.isAgentOwner })`.
`resolveCreateAssignment(actor, input, opts?: { agentEmail: string | null; hasAgentScope?: boolean })` gọi `canCreateTaskWithScope(actor, { agentEmail: opts?.agentEmail ?? null, hasAgentScope: Boolean(opts?.hasAgentScope) })`.

- [ ] **Step 3: Sửa call site Task** (chạy `npx tsc --noEmit` để có danh sách đầy đủ; mọi chỗ đều đã có sẵn `task.agent_email` hoặc `agentEmail` trong scope):
  - `api/tasks/route.ts`: `canCreateTaskWithScope(actor, { agentEmail, hasAgentScope })`; `resolveCreateAssignment(actor, {...}, { agentEmail, hasAgentScope })`.
  - `api/tasks/[id]/route.ts:698`: `canDeleteTask(r.actor, r.task, isAgentOwner)`.
  - `assignees/route.ts:47`, `assignees/[email]/route.ts:45`: `canAssignToTask(actor, task, isAgentOwner)`.
  - `activity/route.ts:59`: `canReadTaskActivity(actor, taskScope, …)`; `detail/route.ts:163`: `canReadTaskActivity(actor, taskScope, isAgentOwner)`.
  - Chỗ gọi `canViewTask(actor, { assignee_email: … }, …)` thiếu `agent_email`: thêm `agent_email` từ bản ghi đang có (`src/lib/tasks/queries.ts`, `search.ts`, `TaskBoardClient.tsx`, `TaskListView.tsx` đã có; kiểm các route comment/attachment/reaction).
  - `src/lib/authz/equivalence.test.ts` và `src/lib/authz/decision-diff.ts`: ca `agentEmail === undefined` bỏ (không còn hợp lệ); dùng `ME` / `OTHER_AGENT`.

- [ ] **Step 4: Enrollment.** `src/lib/enrollment/policy.ts`:

```ts
export type EnrollmentMembershipFlags = {
  /** Agent của hồ sơ HOẶC assistant của agent đó (isAgentOwnerOrAssistant). */
  isAgentOwner?: boolean;
  /** `agent_email` của hồ sơ — tách agent_owned / assistant_for_agent (D P1-01). */
  agentEmail: string | null;
  isCaller?: boolean;
  isResponsible?: boolean;
  isCreator?: boolean;
};

function enrollmentFacts(actor: EnrollmentActor, flags: EnrollmentMembershipFlags): RelationFacts {
  const owner = Boolean(flags.isAgentOwner) && Boolean(flags.agentEmail);
  const self = owner && normalizeEnrollmentActorEmail(flags.agentEmail) === normalizeEnrollmentActorEmail(actor.email);
  return {
    assigned: Boolean(flags.isCaller) || Boolean(flags.isResponsible),
    reported: Boolean(flags.isCreator),
    agent_owned: self,
    assistant_for_agent: owner && !self,
  };
}
```

`resolveEnrollmentCapabilities(actor, flags)` gọi `enrollmentFacts(actor, flags)`. `canCreateEnrollmentWithScope(actor, target: { agentEmail: string | null; hasAgentScope: boolean })` tách tương tự. Call site: thêm `agentEmail: current.agent_email` / `currentData.agent_email` / `context.record.agent_email` / `record.agent_email` (EnrollmentClient) / `requestedAgentEmail` (POST).

- [ ] **Step 5: Test Enrollment** — `src/lib/enrollment/capabilities.test.ts` thêm: actor assistant với grant `enrollment.archive:agent_owned`, flags `{ isAgentOwner: true, agentEmail: "agent@x.com" }` → `canArchive` false; actor chính agent → true.
- [ ] **Step 6:** `npx vitest run` (toàn bộ) + `npx tsc --noEmit` → sạch. Test tương đương (`equivalence.test.ts`) phải vẫn xanh: grant tương thích cấp CẢ HAI scope nên persona cũ không đổi quyết định.
- [ ] **Step 7: Commit** `fix(authz): tách agent_owned / assistant_for_agent ở mọi capability Task và Enrollment (D P1-01)`.

---

### Task 3: Import Enrollment theo scope + capability từng dòng + activity (D P1-02, A P2-03)

**Vấn đề.** `src/app/api/enrollment/import/route.ts:234-256` cập nhật hồ sơ có sẵn bằng `.update()` theo ID, chỉ lọc `program`:

```ts
      if (recordId) {
        const { data, error } = await supabase
          .from("enrollment_records")
          .update({ ...sanitized, updated_at: nowIso, updated_by_email: actorResult.actor.email })
          .eq("id", recordId)
          .eq("program", program)
          .select("id")
          .maybeSingle();
```

Không kiểm hồ sơ có trong phạm vi người nhập, không kiểm capability từng trường (đổi stage, đổi agent, đổi người phụ trách), không ghi activity/stage cycle. Đường tạo mới thì đúng (`create_enrollment_atomic` có activity).

**Hướng sửa (không đổi sản phẩm: import vẫn là quyền riêng `enrollment.import`):** mỗi dòng cập nhật phải (1) nằm trong phạm vi đọc của người nhập, (2) mọi trường đổi phải được capability cho phép như khi sửa tay, (3) ghi qua `patch_enrollment_atomic` với activity `source: "import"`.

**Files:**
- Modify: `src/app/api/enrollment/import/route.ts` (vòng lặp dòng, khoảng `:120-280`)
- Create: `src/lib/enrollment/import-guard.ts` (hàm thuần quyết định dòng được phép)
- Test: `src/lib/enrollment/import-guard.test.ts`, `src/app/api/enrollment/import/route.test.ts` (ca phạm vi)

- [ ] **Step 1: Hàm thuần + test.** `src/lib/enrollment/import-guard.ts`:

```ts
import { resolveEnrollmentCapabilities, type EnrollmentActor } from "./policy";
import type { EnrollmentRecordWithStats } from "./types";

type ImportTarget = Pick<
  EnrollmentRecordWithStats,
  "agent_email" | "caller_email" | "responsible_enroll_email" | "created_by_email" | "stage_id"
>;

/**
 * Một dòng import CẬP NHẬT hồ sơ có sẵn được phép không — đúng luật như người đó
 * sửa tay trên drawer (D P1-02). Trả về lý do từ chối, hoặc null nếu được.
 */
export function importUpdateRejection(
  actor: EnrollmentActor,
  current: ImportTarget,
  patch: Record<string, unknown>,
  isAgentOwner: boolean
): string | null {
  const me = actor.email.trim().toLowerCase();
  const same = (value: string | null | undefined) => (value ?? "").trim().toLowerCase() === me;
  const caps = resolveEnrollmentCapabilities(actor, {
    isAgentOwner,
    agentEmail: current.agent_email,
    isCaller: same(current.caller_email),
    isResponsible: same(current.responsible_enroll_email),
    isCreator: same(current.created_by_email),
  });
  const touches = (key: string) => key in patch;
  if ((touches("agent_email") && patch.agent_email !== current.agent_email) && !caps.canTransferAgent) {
    return "You cannot move this record to another agent.";
  }
  if ((touches("stage_id") && patch.stage_id !== current.stage_id) && !caps.canChangeStage) {
    return "You cannot change the stage of this record.";
  }
  if ((touches("caller_email") || touches("responsible_enroll_email")) && !caps.canAssignPeople) {
    return "You cannot change who works on this record.";
  }
  const other = Object.keys(patch).filter(
    (key) => !["agent_email", "stage_id", "caller_email", "responsible_enroll_email"].includes(key)
  );
  if (other.length > 0 && !caps.canEditFields) return "You cannot edit this record.";
  return null;
}
```

Test (`import-guard.test.ts`): actor chỉ có `enrollment.fields.update:assigned` + là caller → đổi trường thường: null; đổi `stage_id` khi không có `enrollment.stage.update`: trả lý do; actor không liên quan tới hồ sơ và không có `:all` → `canEditFields` false → trả lý do.

- [ ] **Step 2: Dùng trong route.** Ngay đầu `POST`, sau khi có actor: `const scope = await resolveEnrollmentScope(actorResult.actor);` (import từ `@/lib/enrollment/scope`). Trong vòng lặp, thay khối `if (recordId) { … .update(…) … }` bằng:

```ts
      if (recordId) {
        const current = await fetchEnrollmentRecordById(recordId); // từ @/lib/enrollment/queries
        if (!current || current.program !== program || !isRecordInScope(scope, current)) {
          failed.push({ row: excelRow, error: "No record found with this ID." }); // không xác nhận ID ngoài phạm vi
          continue;
        }
        const isAgentOwner = await isAgentOwnerOrAssistant(current.agent_email, actorResult.actor.email);
        const rejection = importUpdateRejection(actorResult.actor, current, sanitized, isAgentOwner);
        if (rejection) {
          failed.push({ row: excelRow, error: rejection });
          continue;
        }
        const { error } = await supabase.rpc("patch_enrollment_atomic", {
          p_record_id: recordId,
          p_expected_updated_at: current.updated_at,
          p_patch: sanitized,
          p_actor_email: actorResult.actor.email,
          p_activity: [{ type: "field_changed", meta: { fields: Object.keys(sanitized), source: "import" } }],
          p_now: nowIso,
        });
        if (error) {
          failed.push({ row: excelRow, error: error.message.includes("ENROLLMENT_CONFLICT")
            ? "Record changed while importing. Re-export and try again."
            : error.message });
          continue;
        }
        updated += 1;
        continue;
      }
```

Ghi chú: `patch_enrollment_atomic` tự ghi stage cycle khi `stage_id` đổi (xem thân hàm trong `supabase/schema.sql`, tìm `create or replace function patch_enrollment_atomic`). Nếu hàm từ chối khoá lạ trong `p_patch` (biến `unknown_keys`), lọc `sanitized` theo đúng danh sách khoá hàm nhận.

- [ ] **Step 3: Test route** `src/app/api/enrollment/import/route.test.ts`: mock `loadEnrollmentActor` (actor có `enrollment.import:*` + `enrollment.fields.update:assigned`), `resolveEnrollmentScope` trả `{ seeAll: false, agentEmails: [], viewerEmail: me, viewerColumns: ["caller_email"] }`, `fetchEnrollmentRecordById` trả hồ sơ KHÔNG có mình → dòng đó vào `failed`, `rpc` không được gọi; hồ sơ có mình là caller → `rpc("patch_enrollment_atomic", …)` được gọi với `p_activity[0].meta.source === "import"`.
- [ ] **Step 4:** `npx vitest run src/lib/enrollment src/app/api/enrollment/import` + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `fix(enrollment): import cập nhật hồ sơ theo scope, capability từng dòng và ghi activity (D P1-02, A P2-03)`.

---

### Task 4: Tên hoa hồng — cấm dùng lại tên đã có chủ, cấm tự đặt cho mình (D P1-03)

**Vấn đề.** `set_commission_name_atomic` (bản Phase D, `git show 6bbeb69:supabase/rollouts/2026-09-29-authz-phase-d.sql`, dòng 42-89) chỉ chặn trùng TẠI THỜI ĐIỂM đó. Account A bỏ tên "ANN LEE" → account B nhận "ANN LEE" → B thấy toàn bộ dữ liệu hoa hồng lịch sử của A. Và `src/app/api/admin/users/[id]/route.ts` (khoảng `:218-224`) bỏ qua trần uỷ quyền khi `isSelf` → người giữ `account.manage` tự đặt tên hoa hồng của agent khác cho chính mình.

**Quyết định (review Codex của plan, P1):** bộ lọc hoa hồng (`src/lib/agent-identity.ts` → Registration / Agent Dashboard / AI chat) tìm dữ liệu theo **chuỗi tên**, không theo account ID hay khoảng hiệu lực — hộp "xác nhận chuyển giao" không ngăn B thấy dữ liệu cũ của A, audit chỉ ghi lại việc đã lộ. Khoá theo account ID cần đổi dữ liệu hoa hồng (Sheet/bảng nghiệp vụ) — ngoài phạm vi. Nên: **cấm hẳn** gán một tên từng thuộc account khác; không có cờ vượt. Giới hạn còn lại (ghi vào runbook + changelog): (a) tên từng dùng TRƯỚC lần đồng bộ không có trong lịch sử (`main` không lưu lịch sử đổi tên) — lịch sử chỉ bắt đầu từ lúc đồng bộ; (b) người mới trùng tên thật với agent cũ phải dùng tên hoa hồng khác (vd thêm chữ đệm) cho tới khi dữ liệu hoa hồng khoá theo account ID.

Sau Nhóm 0: bảng `authz_commission_names` + `authz_commission_name_history` (Task 0.2 Step 2), hàm `authz_set_commission_name`; dữ liệu ban đầu và một dòng history `released_at is null` cho mỗi tên đã gán do `authz_sync_from_production` nạp (Task 0.3 Step 1) — SQL dưới KHÔNG backfill.

**Files:**
- Modify: `supabase/rollouts/2026-10-03-authz-isolated.sql` + khối authz cuối `supabase/schema.sql` (hàm `authz_set_commission_name`), `src/app/api/admin/users/[id]/route.ts`, `src/lib/rbac/role-management.ts` (`mapAuthzRpcError`)
- Test: `supabase/checks/ci-authz-rpc.sql` (kịch bản), `src/app/api/admin/users/[id]/route.test.ts`

- [ ] **Step 1: SQL** (trong rollout cô lập, sau khối bảng):

```sql
create or replace function authz_set_commission_name(
  p_account_id uuid,
  p_agent_name text,
  p_actor_account_id uuid,
  p_actor_email text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := nullif(upper(regexp_replace(btrim(coalesce(p_agent_name, '')), '\s+', ' ', 'g')), '');
  v_before text;
begin
  perform 1 from authz_accounts where id = p_account_id for update;
  if not found then raise exception using message = 'ACCOUNT_NOT_FOUND'; end if;
  -- Khoá theo TÊN để hai lượt đặt cùng tên chạy tuần tự (thay cho check-then-insert).
  if v_name is not null then
    perform pg_advisory_xact_lock(hashtextextended('authz-commission-name|' || v_name, 0));
  end if;

  select agent_name into v_before from authz_commission_names where account_id = p_account_id;
  if v_before is not distinct from v_name then return v_name; end if;

  if v_name is not null then
    if exists (select 1 from authz_commission_names where agent_name = v_name and account_id <> p_account_id) then
      raise exception using message = 'COMMISSION_NAME_TAKEN';
    end if;
    -- Dữ liệu hoa hồng lọc theo CHUỖI TÊN: nhận tên từng thuộc account khác là thấy
    -- dữ liệu lịch sử của người đó. Cấm hẳn, không có cờ vượt (D P1-03).
    if exists (
      select 1 from authz_commission_name_history
      where agent_name = v_name and account_id <> p_account_id
    ) then
      raise exception using message = 'COMMISSION_NAME_PREVIOUSLY_USED';
    end if;
  end if;

  update authz_commission_name_history set released_at = now()
  where account_id = p_account_id and released_at is null;

  if v_name is null then
    delete from authz_commission_names where account_id = p_account_id;
  else
    insert into authz_commission_names (account_id, agent_name, updated_at, updated_by_email)
    values (p_account_id, v_name, now(), p_actor_email)
    on conflict (account_id) do update
      set agent_name = excluded.agent_name, updated_at = excluded.updated_at, updated_by_email = excluded.updated_by_email;
    insert into authz_commission_name_history (agent_name, account_id, account_email)
    select v_name, p_account_id, email from authz_accounts where id = p_account_id;
  end if;

  insert into authz_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
  values (p_actor_account_id, p_actor_email, 'account.commission_name', 'account', p_account_id::text,
          jsonb_build_object('agent_name', v_before), jsonb_build_object('agent_name', v_name));
  return v_name;
end;
$$;
revoke all on function authz_set_commission_name(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function authz_set_commission_name(uuid, text, uuid, text) to service_role;
```

`authz_create_account` và `authz_update_account` gọi `authz_set_commission_name(p_account_id, p_patch ->> 'commission_name', p_actor_account_id, p_actor_email)`.

- [ ] **Step 2: Kịch bản CI** — `ci-authz-rpc.sql`, khối tên hoa hồng: đặt "JANE DOE" cho `c1`, xoá (null), đặt "Jane Doe" cho `a1` → phải `COMMISSION_NAME_PREVIOUSLY_USED`; đặt lại "JANE DOE" cho chính `c1` → được (lịch sử của chính mình); `authz_audit` có dòng `account.commission_name` cho mỗi lần đổi thành công.
  Thêm (review Codex lần 2): (a) A giữ "ANN LEE" → `authz_delete_account(A)` → sổ vẫn còn dòng của A (`released_at` có giá trị) → B xin "Ann Lee" → `COMMISSION_NAME_PREVIOUSLY_USED`; (b) sau `authz_sync_from_production('reset', …)` sổ không mất dòng nào đã có trước reset, B xin tên cũ của A → vẫn `COMMISSION_NAME_PREVIOUSLY_USED`.
- [ ] **Step 3: Route.** `src/app/api/admin/users/[id]/route.ts`: nếu `isSelf && commissionName !== undefined` → 403 `"You cannot change your own commission name."`. `mapAuthzRpcError` thêm: `case "COMMISSION_NAME_PREVIOUSLY_USED": return { status: 409, error: "This commission name was used by another account. Choose a different name." };`
- [ ] **Step 4: Test route** (`users/[id]/route.test.ts`): tự sửa tên hoa hồng của mình → 403, RPC không được gọi; RPC trả `COMMISSION_NAME_PREVIOUSLY_USED` → 409 đúng thông điệp.
- [ ] **Step 5:** Cổng DB (Kiểm tra chung) + `npx vitest run src/app/api/admin src/lib/authz`.
- [ ] **Step 6: Commit** `fix(identity): cấm dùng lại tên hoa hồng đã có chủ và tự đặt cho mình (D P1-03)`.

---

### Task 5: ACL và `search_path` của hàm SECURITY DEFINER — chỉ còn bước kiểm (G P1-01, N-10a)

**Vấn đề gốc.** `2026-09-30-authz-phase-g.sql:15-25` `create or replace function assign_unassigned_task(...)` — `CREATE OR REPLACE` **giữ nguyên ACL cũ** trên production; hàm cũng thiếu `pg_temp` trong `search_path`.

**Sau Nhóm 0 lỗi này mất gốc:** rollout G bị gỡ; nhánh không `create or replace` hàm production nào; `authz_assign_unassigned_task` là hàm MỚI, tạo với `set search_path = public, pg_temp` và vòng quét ACL `authz\_%` ở cuối rollout cô lập (Task 0.2 Step 4). ACL hàm production KHÔNG được sửa (kể cả để "làm chặt") — đó là việc của nhánh khác nếu chủ repo muốn.

**Files:**
- Modify: `supabase/checks/ci-authz-rpc.sql` (khối kiểm ACL)

- [ ] **Step 1: Kiểm ACL trong kịch bản CI** — thêm cuối `ci-authz-rpc.sql`:

```sql
do $$
declare v_exposed text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_exposed
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'authz\_%'
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute')
      or not p.prosecdef
      or not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp'));
  if v_exposed is not null then
    raise exception 'authz functions exposed or missing search_path: %', v_exposed;
  end if;
end $$;
```

(Nếu hàm `authz_*` nào cố ý là `security invoker` — hiện không có — thì loại khỏi điều kiện `not p.prosecdef` kèm chú thích.)

- [ ] **Step 2: Kịch bản PGlite âm** (file tạm ngoài repo): sau rollout cô lập, `grant execute on function authz_assign_unassigned_task(uuid, text, timestamptz, text) to anon;` → khối kiểm trên phải `raise`. Chạy lại rollout cô lập (idempotent) → vòng quét ACL thu lại → khối kiểm qua.
- [ ] **Step 3:** Trước khi chốt: `grep -rn "\.rpc(" src/app --include='*.tsx'` và `src/lib/supabase-browser.ts` — xác nhận trình duyệt KHÔNG gọi RPC bằng anon key (hiện chỉ dùng Realtime).
- [ ] **Step 4: Commit** `test(db): kiểm ACL và search_path của mọi hàm authz_* (G P1-01)`.

---

### Task 6: Trần uỷ quyền xét cả trạng thái TRƯỚC khi sửa (N-2)

**Vấn đề.** `src/app/api/admin/roles/[id]/route.ts:87-96` chỉ so trần với grant SAU khi sửa:

```ts
    const effectiveAfter = grants ?? effectiveRoleGrants(current);
    const beyond = grantsBeyondCeiling(principal.grants, effectiveAfter);
```

→ người chỉ có `role.manage` + `task.read:assigned` gửi `PATCH { is_active: false, grants: [] }` lên role "Task Admin" → 200, mọi Task Admin mất quyền. `DELETE` không kiểm trần. `fetchAccountAccess` (`src/lib/rbac/role-management.ts`) bỏ qua role đang tắt → account giữ role mạnh-đang-tắt bị coi là không có grant → người quyền thấp đổi email/mật khẩu của nó.

**Files:**
- Modify: `src/app/api/admin/roles/[id]/route.ts` (PATCH + DELETE), `src/lib/rbac/role-management.ts` (`fetchAccountAccess`)
- Test: `src/app/api/admin/roles/[id]/route.test.ts`, `src/app/api/admin/users/[id]/route.test.ts`

- [ ] **Step 1: Test hỏng trước** (roles route test): role hiện có grant `["task.read:all"]`, actor có `role.manage:*` + `task.read:assigned` → `PATCH {is_active:false}` phải 403, RPC không được gọi; `DELETE` role đó phải 403.
- [ ] **Step 2: PATCH** — trước khi tính `effectiveAfter`:

```ts
    // Không sửa (kể cả tắt / xoá grant) một role đang mang quyền mình không có:
    // hạ quyền cả nhóm người cũng là thao tác vượt trần (N-2, D10).
    const beyondBefore = grantsBeyondCeiling(principal.grants, effectiveRoleGrants(current));
    if (beyondBefore.length > 0) {
      return NextResponse.json(
        { error: "You cannot edit a role with permissions you do not hold.", grants: beyondBefore },
        { status: 403 }
      );
    }
```

- [ ] **Step 3: DELETE** — đọc `fetchRoleDefinition(id)` trước RPC; 404 nếu không có; cùng kiểm `beyondBefore` như trên; cấm xoá role mình đang giữ (`principal.roleIds.includes(id)` → 403).
- [ ] **Step 4: `fetchAccountAccess`** — grant dùng cho TRẦN tính trên mọi role của account, kể cả role đang tắt:

```ts
  const roles = [...(await fetchRoleDefinitions(roleIds)).values()];
  return {
    roleIds,
    // Trần uỷ quyền xét CẢ role đang tắt: bật lại là có quyền ngay (N-2).
    grants: normalizeGrants(roles.flatMap((role) => effectiveRoleGrants(role))),
    holdsSuperAdmin: roles.some((role) => role.isActive && isSuperAdminRole({ system_key: role.systemKey })),
  };
```

(import `normalizeGrants` từ `@/lib/authz/grants`, `effectiveRoleGrants` đã có.)
- [ ] **Step 5:** Test users route: account đích giữ role `super_admin` đang TẮT → actor chỉ có `account.manage:*` sửa email → 403.
- [ ] **Step 6:** `npx vitest run src/app/api/admin` + tsc. **Commit** `fix(rbac): Role/Account Manager không hạ quyền được role/account vượt trần (N-2)`.

### Task 7: Decision diff thành cổng chắc; principal đọc role đủ trang (H P1-01, H P1-02, H P2-01, H P2-02, B P2-03, D P2-06, BR P1-07, BR P2-09)

**Vấn đề.**
- `scripts/authz-migrate-role-grants.ts:42-55` đọc role và account bằng `.select()` không phân trang, không preflight admin khôi phục, không so account khoá, không hậu kiểm sau `--apply` (H P1-01, H P1-02, BR P1-07). **→ Đã giải ở Task 0.3:** script này bị xoá; hàm `authz_sync_from_production` chép trong một transaction với kiểm trước/hậu kiểm, script điều khiển so decision diff cho mọi account TRƯỚC khi ghi.
- `fetchRoleRows` (`src/lib/authz/principal.ts`) khi không lọc id cũng là một `.select()` không phân trang.
- `src/lib/authz/decision-diff.ts:193-219` thiếu `notify.enrollment.escalation`; không có gì bắt được action mới bị quên so.
- `scripts/authz-decision-diff.ts:70-86`: nhánh `--json` `return` trước khi đặt `process.exitCode`; và "role đã chuyển" thì lệch không làm exit ≠ 0.

**Interfaces:**
- Consumes: `fetchAllRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>, pageSize?: number): Promise<T[]>` từ `src/lib/supabase-paging.ts` (Task 0.3 Step 0 — truy vấn phải có `{ count: "exact" }`); `AUTHZ_TABLES` (Task 0.1); `diffAllAccounts`, `checkApprovedDiffs`, `ApprovedDiff` từ `src/lib/authz/sync-plan.ts` (Task 0.3 Step 2).

**Files:**
- Modify: `scripts/authz-decision-diff.ts`, `src/lib/authz/decision-diff.ts`, `src/lib/authz/principal.ts` (`fetchRoleRows`)
- Test: `src/lib/authz/decision-diff.test.ts`, `src/lib/authz/principal.test.ts`

- [ ] **Step 1: `fetchRoleRows`** — khi không có `filter.ids`: `fetchAllRows((from, to) => getSupabaseAdmin().from(AUTHZ_TABLES.roles).select(ROLE_SELECT, { count: "exact" }).order("id").range(from, to))`; có `ids` thì chia lô 100 id mỗi `.in()`. Test: mock trả 1000 + 5 role theo `range`, `count = 1005` → nhận 1005.
- [ ] **Step 2: `decision-diff.ts`** — thêm dòng `["notify.enrollment_escalation", access.legacyRole === "admin", hasGrant(grants, "notify.enrollment.escalation")]`. Thêm test "phủ mọi action": với persona Admin, mọi action trong `ACTIONS` phải xuất hiện ít nhất một lần trong tên quyết định HOẶC nằm trong mảng `NOT_COMPARED` khai báo ngay trong test, mỗi phần tử kèm lý do — action mới thêm sau này mà quên so sẽ làm test fail.
- [ ] **Step 3: `scripts/authz-decision-diff.ts`** — dùng CHUNG bộ so với script đồng bộ (review Codex của plan, P1): quyết định CŨ đọc bảng production (chỉ SELECT: `portal_account` gồm cột `role`, `user_roles`, `roles`, `role_permissions`), grant MỚI đọc từ `authz_*` (đúng như phiên đăng nhập suy ra); mọi truy vấn qua `fetchAllRows` với `{ count: "exact" }`; `diffAllAccounts` + `checkApprovedDiffs(diffs, readJson("docs/authz-approved-diffs.json"))`.
  - Danh sách duyệt là file `docs/authz-approved-diffs.json`, mỗi dòng `{ "accountId", "decision", "legacy", "next", "reason" }` — duyệt đúng account, đúng quyết định, đúng chiều cũ → mới; lệch khác của cùng account vẫn chặn. BỎ ý tưởng `--allow <email>` (duyệt cả account là quá rộng).
  - In: mọi lệch chưa duyệt (email, quyết định, cũ → mới), mọi lệch đã duyệt (kèm `reason`), mọi dòng duyệt không dùng tới (cũ — nên xoá).
  - Account khoá: so và phải duyệt như account active (mở lại trên authz là có ngay quyền mới). Account chỉ có ở `authz_accounts` (tạo sau đồng bộ): nhóm "chỉ có trên authz", không so.
  - `process.exitCode = unapproved.length > 0 ? 1 : 0` đặt TRƯỚC nhánh `--json`; bỏ ngoại lệ "role đã chuyển".
  - Test (`sync-plan.test.ts` đã có ở Task 0.3): thêm ca "đã duyệt `task.read_all` false→true cho account X, phát sinh thêm `lead.update` cho X" → vẫn exit 1.
- [ ] **Step 4:** `npx vitest run src/lib/authz`; chạy thử script với `SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=x npx vite-node -c vitest.config.ts scripts/authz-decision-diff.ts` → phải lỗi mạng (không lỗi import).
- [ ] **Step 5: Commit** `fix(authz): decision diff so đủ action, exit code đúng; principal đọc role đủ trang (H P2-01, BR P1-07)`.

---

## Nhóm 2 — An toàn triển khai

### Task 8: Runbook đánh số + preflight SQL chỉ đọc + dấu vân tay trước/sau (N-5)

**Vấn đề.** Thứ tự deploy nằm rải ở changelog / Phần III; không có kiểm tự động ngay trước deploy. Sau Nhóm 0 luồng deploy đổi hẳn. Review Codex của plan (P1): preflight cũ đếm hàm theo `proname` (không lọc schema/chữ ký, không chứng minh thân hàm đúng); lời hứa rollback chưa có bước kiểm chứng trên DB thật; RLS lockdown và dữ liệu nghiệp vụ phát sinh không được nói rõ là rollback KHÔNG đảo.

**Files:**
- Create: `supabase/checks/prod-preflight-authz.sql` (CHỈ `select`)
- Create: `src/lib/authz/function-lock.test.ts` (giữ danh sách hàm trong preflight khớp rollout)
- Create: `supabase/checks/authz-drop.sql` (tuỳ chọn dọn — chỉ `drop` đối tượng `authz_*`)
- Create: `docs/2026-10-03-authz-deploy-runbook.md`

- [ ] **Step 1: Preflight SQL** — mỗi dòng `check | ok | detail`; hàm kiểm theo CHỮ KÝ + md5 thân hàm (`pg_proc.prosrc` = đúng đoạn giữa hai `$$` trong file rollout):

```sql
-- Chạy NGAY TRƯỚC deploy feat/authz. Chỉ đọc. Mọi dòng phải ok = true.
with expected(signature, body_md5) as (
  values
    -- BEGIN authz-function-lock (sinh + kiểm bởi src/lib/authz/function-lock.test.ts; không sửa tay)
    ('authz_production_auth_fingerprint()', '00000000000000000000000000000000')
    -- … một dòng cho mỗi hàm authz_* của 2026-10-03-authz-isolated.sql
    -- END authz-function-lock
), resolved as (
  select e.signature, e.body_md5, to_regprocedure('public.' || e.signature) as fn from expected e
)
select 'fn:' || r.signature as check,
       coalesce(
         md5(p.prosrc) = r.body_md5
         and p.prosecdef
         and 'search_path=public, pg_temp' = any(p.proconfig)
         and not has_function_privilege('anon', p.oid, 'execute')
         and not has_function_privilege('authenticated', p.oid, 'execute'),
         false) as ok,
       case when p.oid is null then 'missing'
            when md5(p.prosrc) <> r.body_md5 then 'body differs from repo'
            else null end as detail
from resolved r left join pg_proc p on p.oid = r.fn
union all
select 'fn_extra', count(*) = 0, string_agg(p.oid::regprocedure::text, ', ')
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'authz\_%'
  and p.oid not in (select fn from resolved where fn is not null)
union all
select 'synced', (select count(*) from authz_accounts) > 0, (select count(*) from authz_accounts)::text
union all
select 'roles_converted', count(*) = 0, string_agg(name, ', ')
from authz_roles where coalesce(system_key, '') <> 'super_admin' and not grants_managed
union all
select 'recovery_admin', count(*) >= 1, count(*)::text
from authz_accounts a join authz_user_roles ur on ur.user_id = a.id join authz_roles r on r.id = ur.role_id
where a.is_active and r.is_active and r.system_key = 'super_admin'
union all
select 'default_role_active', count(*) = 1, count(*)::text
from authz_roles where system_key = 'default_new_account' and is_active
union all
select 'accounts_without_role', count(*) = 0, string_agg(a.email, ', ')
from authz_accounts a
where a.is_active and not exists (
  select 1 from authz_user_roles ur join authz_roles r on r.id = ur.role_id where ur.user_id = a.id and r.is_active)
union all
select 'no_open_tables', count(*) = 0, string_agg(c.relname, ', ')
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity
  and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'))
union all
-- Rollout authz CŨ (B/C/D/G/H) đã gỡ khỏi nhánh và chưa từng chạy; thấy dấu vết = dừng, báo chủ repo.
select 'old_rollouts_not_applied', count(*) = 0, string_agg(obj, ', ')
from (
  select 'portal_account.access_version' as obj from information_schema.columns
   where table_schema = 'public' and table_name = 'portal_account' and column_name = 'access_version'
  union all
  select 'roles.system_key' from information_schema.columns
   where table_schema = 'public' and table_name = 'roles' and column_name = 'system_key'
  union all
  select table_name from information_schema.tables
   where table_schema = 'public' and table_name in ('role_grants','access_audit','agent_commission_names')
) old;
```

- [ ] **Step 2: Giữ danh sách hàm khớp repo** — `src/lib/authz/function-lock.test.ts` (không cần Postgres): đọc `supabase/rollouts/2026-10-03-authz-isolated.sql`, với mỗi `create or replace function (authz_\w+)\s*\((…)\)` lấy chữ ký = tên + kiểu tham số theo thứ tự (bỏ tên tham số và `default …`; giữ nguyên cách viết kiểu, vd `timestamptz` — `to_regprocedure` hiểu bí danh), thân = đoạn giữa cặp `$$` ngay sau, `body_md5 = createHash("md5").update(body, "utf8").digest("hex")`. So với các dòng giữa `BEGIN/END authz-function-lock` của preflight → khác thì fail và in khối đúng để dán vào (hoặc chạy `UPDATE_AUTHZ_LOCK=1 npx vitest run src/lib/authz/function-lock.test.ts` để test tự ghi lại khối). Cổng DB (Task 0.5 Step 3) chạy preflight sau đồng bộ: mọi dòng `fn:` phải `ok` — chứng minh md5 tính ở TS khớp md5 Postgres.
- [ ] **Step 3: SQL dọn tuỳ chọn** `supabase/checks/authz-drop.sql` — CHỈ dùng khi bỏ hẳn authz; KHÔNG cần cho rollback:

```sql
-- Xoá thế giới authz. KHÔNG đụng bảng/hàm production.
begin;
do $$
declare r record;
begin
  for r in select p.oid::regprocedure::text as signature
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'authz\_%' loop
    execute format('drop function %s', r.signature);
  end loop;
end $$;
drop table if exists authz_commission_name_history, authz_commission_names, authz_agent_members,
  authz_task_agents, authz_audit, authz_role_grants, authz_user_roles, authz_roles, authz_accounts;
commit;
```

Cổng DB: chuỗi đầy đủ → `authz-drop.sql` → `ci-production-unchanged.sql` vẫn qua.

- [ ] **Step 4: Runbook** `docs/2026-10-03-authz-deploy-runbook.md` — bước đánh số, mỗi bước có lệnh chính xác và "kết quả phải thấy":
  0. **Hiểu trước khi làm** (chép nguyên "Lời hứa rollback" + ma trận Time Off + "Giới hạn khác" của Nhóm 0): bản authz THAY `main` cho mọi người; phân quyền đọc/ghi ở `authz_*`; dữ liệu nghiệp vụ vẫn ghi bảng thật. Rollback KHÔNG đảo: dữ liệu nghiệp vụ, push đã gửi (không thu hồi được), `login_attempts`, rollout RLS. Rollback LÀM MẤT: thay đổi account/role/roster/mật khẩu/avatar/tên hoa hồng trên bản authz; account tạo mới trên bản authz. Cộng phép tháng: tháng đã cộng trên bản authz thì `main` không cộng lại (idempotent theo chính sách + tháng) — account bị loại tháng đó (khoá trên authz, chỉ có trên authz) không được cộng bù tự động. Báo cả công ty: lúc deploy (và lúc rollback) mọi người đăng nhập lại một lần (B P1-01). KHÔNG BAO GIỜ chạy `supabase/schema.sql` trên DB thật.
  1. Chạy các truy vấn A0 của plan final (Task A0) — lưu kết quả.
  1b. **Tổng duyệt trên bản sao** (khuyến nghị mạnh; review Codex lần 2 — không đoán thời gian khoá/chép): tạo bản sao DB bằng Supabase "Restore to a new project" (Database → Backups; cần gói trả phí + physical backups) hoặc `supabase db dump` rồi restore vào project mới. Trên bản sao, TRƯỚC mọi việc: tắt cron của Vercel/Supabase, webhook, đồng bộ Google Sheet, Web Push (VAPID key khác hoặc để trống) để bản sao không ghi/gửi ra hệ thống thật. Chạy bước 2–9 trên bản sao; ghi lại thời gian từng lời gọi `authz_sync_from_production` (dry-run, apply) và `missing_only`; deploy một bản preview Vercel trỏ vào bản sao để vài người bấm thử (đăng nhập, Task, Enrollment, Time Off, Account/Role Manager). Chỉ làm thật khi mọi bước qua trên bản sao.
  2. `2026-09-26-rls-lockdown.sql`. Kết quả: truy vấn kiểm chứng cuối file 0 dòng. Đây là thay đổi DB duy nhất ngoài `authz_*`; `main` chạy bình thường với nó; rollback code không đảo và không cần đảo.
  3. `supabase/checks/prod-fingerprint.sql` → lưu kết quả thành `fingerprint-before.csv`.
  4. **Đóng băng** từ bước này tới hết bước 10: không sửa account/role/roster trên `main` (account Google tự tạo khi đăng nhập lần đầu thì không chặn được — bước 10 nhập bù).
  5. `2026-10-03-authz-isolated.sql`. Kết quả: `authz_tables = 9`.
  6. `npx vite-node -c vitest.config.ts scripts/authz-sync-from-production.ts --super-admin-role <id> --default-role <id> --actor <email>` (dry-run). Kết quả: dry-run báo `AUTHZ_SYNC_DRY_RUN` với số dòng; 0 lệch chưa duyệt. Lệch cố ý → thêm dòng vào `docs/authz-approved-diffs.json` (có `reason`) rồi chạy lại. Lỗi `AUTHZ_SYNC_ACTIVE_WITHOUT_ROLE` / `MULTIPLE_ROLES` / `DUPLICATE_EMAIL` → sửa trên `main` (Account Manager), quay lại bước 3.
  7. Cùng lệnh thêm `--apply`. Kết quả: báo cáo số dòng + "đọc lại khớp".
  8. `prod-fingerprint.sql` → `fingerprint-after.csv`; `diff fingerprint-before.csv fingerprint-after.csv` phải RỖNG. Khác → dừng, không deploy, báo lại.
  9. `supabase/checks/prod-preflight-authz.sql`. Kết quả: mọi dòng `ok = true`.
  10. Deploy `feat/authz` cho mọi người. Ngay sau đó: `scripts/authz-sync-from-production.ts --mode missing_only …` (dry-run rồi `--apply` nếu báo có account mới; chế độ này không khoá bảng, chạy được khi bản authz đang phục vụ); `scripts/authz-decision-diff.ts` → exit 0. Hết đóng băng. Nếu `missing_only` dừng:
      - `AUTHZ_SYNC_EMAIL_TAKEN_OTHER_ID`: người đó đã đăng nhập bản authz trước lúc nhập nên có account authz id mới. Nếu account authz đó chưa có hoạt động (không task/đơn nghỉ/comment) → xoá nó trong Account Manager bản authz rồi chạy lại; nếu đã có hoạt động → giữ, ghi tên vào danh sách "Time Off chưa dùng được" (ma trận), chạy lại với account đó được bỏ qua bằng cờ `--skip-account <production id>` (script in lệnh sẵn).
      - `AUTHZ_SYNC_ROLE_NOT_IN_AUTHZ` / `MULTIPLE_ROLES` / `ACTIVE_WITHOUT_ROLE`: đóng băng đã bị vi phạm hoặc dữ liệu `main` lệch — dừng, báo chủ repo; không tự gán role.
  11. Đặt tên hoa hồng cho account trong cảnh báo `duplicate_commission_name` (Account Manager bản authz).
  12. **Rollback:** deploy lại `main`. DB không phải làm gì (xem bước 0 để biết mất gì).
  13. **Thử lại sau rollback** (bỏ mọi thay đổi còn trong `authz_*`, lấy dữ liệu mới từ production): CHỈ khi `main` đang phục vụ (reset khoá toàn bộ bảng authz) — `--mode reset --confirm "RESET AUTHZ" --apply`, rồi làm lại từ bước 3. Sổ tên hoa hồng không bị xoá khi reset.
  14. Bỏ hẳn authz (tuỳ chọn): `supabase/checks/authz-drop.sql`.
- [ ] **Step 5: Commit** `docs(authz): runbook deploy cô lập, preflight theo chữ ký + md5 thân hàm, dấu vân tay trước/sau (N-5)`.

---

### Task 9: Email đăng nhập chuẩn hoá chữ thường (N-7)

**Vấn đề.** `create_account_atomic` hạ chữ thường email, nhưng `src/auth.ts:110-114` tra account bằng email Google nguyên dạng (`.eq("email", user.email)`), và `getUserAccess` (`src/lib/rbac/access.ts:92`) cũng so chính xác. Email Google có chữ hoa: lần đầu tạo account (thường) rồi phiên bị huỷ; lần sau `.eq` không thấy → gọi tạo lại → `ACCOUNT_EMAIL_TAKEN` → khoá vĩnh viễn.

Sau Nhóm 0: dữ liệu `authz_accounts` đã chữ thường do `authz_sync_from_production` hạ (Task 0.3); KHÔNG chuẩn hoá `portal_account` (bảng production). Email trùng khi hạ chữ thường → hàm đồng bộ dừng với `AUTHZ_SYNC_DUPLICATE_EMAIL`.

**Files:** `src/auth.ts`, `src/lib/rbac/access.ts`, test `src/lib/rbac/access.test.ts`, `supabase/checks/ci-authz-rpc.sql`.

- [ ] **Step 1:** Trong `signIn` và `jwt`: `const email = user.email.trim().toLowerCase();` dùng cho mọi tra cứu; trong `jwt` khi `user` có mặt: `token.email = user.email.trim().toLowerCase()`. `getUserAccess`: `base.eq("email", identity.email.trim().toLowerCase())`; `getUserAccessByEmails` đã hạ chữ thường.
- [ ] **Step 2: Ràng buộc** — đã có trong DDL của Task 0.2 Step 2 (`constraint authz_accounts_email_lower check (email = lower(btrim(email)))`); không thêm SQL.
- [ ] **Step 3:** Test: `getUserAccess({ email: "Ann@X.com" })` gọi `.eq("email", "ann@x.com")` (mock supabase ghi lại tham số). Kịch bản CI: `insert into authz_accounts (email) values ('Ann@X.com')` phải lỗi `check_violation`.
- [ ] **Step 4: Commit** `fix(auth): email đăng nhập và account authz chuẩn hoá chữ thường (N-7)`.

---

### Task 10: `schema.sql` seed và gán role theo `system_key` (N-9) — HẾT ÁP DỤNG

**Vấn đề gốc.** `supabase/schema.sql:316-360` seed role theo TÊN và gán role theo cột legacy `portal_account.role`; chạy lại `schema.sql` sau khi đổi tên role mặc định sẽ tạo role "Agent" chưa chuyển sang grant.

**Vì sao không còn làm:** sau Task 0.2 Step 1, khối production của `schema.sql` là nguyên bản `main` (seed đó là hành vi của `main`, không thuộc nhánh này, và nhánh không được sửa bảng production). Khối authz cuối file KHÔNG seed dữ liệu; `system_key` do script đồng bộ gán (Task 0.3 Step 1, có cờ chọn role tường minh). Không có bước nào — chỉ ghi dòng này vào bảng review ở Task 21 ("N-9: hết áp dụng sau cô lập").

---

### Task 11: Roster và các tập "đủ" đọc chính xác, có phân trang (BR P1-01, D P2-03, F P2-02, A P2-02, BR P2-01)

**Vấn đề (nặng nhất: BR P1-01).** `src/lib/tasks/assignees.ts:42-48`:

```ts
export const fetchSelectedAgentEmails = cache(async (): Promise<Set<string>> => {
  const { data, error } = await getSupabaseAdmin()
    .from("task_agents")
    .select("email");
```

đọc TOÀN BỘ roster bằng một `.select()` không phân trang. `resolveTaskQueueScope` (`src/lib/tasks/membership.ts:~103-123`) và `resolveEnrollmentScope` (`src/lib/enrollment/scope.ts`) suy "không phải Agent" từ việc email VẮNG MẶT trong tập này → cấp hàng đợi chung (`seesAllTasks`) → `fetchTasksForActor` bỏ bộ lọc phạm vi. Roster vượt giới hạn trả về → Agent ở trang sau thấy toàn bộ task/hồ sơ công ty. `loadViewers` (`src/lib/notifications/audience.ts:~71-85`) lặp lại lỗi. Ngoài ra `fetchGrantHolders` (`src/lib/authz/holders.ts:32-37`), `filterActiveAccounts` (`src/lib/notifications/push-server.ts:121-132`, quét mọi account active cho MỖI nhóm push), và trang Account Manager (`src/app/(authed)/account-manager/page.tsx:36-45`) đều không phân trang.

**Nguyên tắc:** quyết định "người X có phải Agent / assistant không" phải là truy vấn **theo đúng email X** (không suy từ vắng mặt trong một tập có thể bị cắt). Tập "mọi người" chỉ dùng cho hiển thị và phải đọc bằng `fetchAllRows`.

Sau Nhóm 0: bảng là `authz_task_agents` / `authz_agent_members` — email đã chữ thường (ràng buộc `check` ở Task 0.2 + script đồng bộ hạ chữ thường), nên `.eq` / `.in` so chính xác. KHÔNG có SQL chuẩn hoá `task_agents` / `agent_members` production.

**Interfaces:**
- Consumes: `fetchAllRows` (`src/lib/supabase-paging.ts`, Task 0.3), `AUTHZ_TABLES` (Task 0.1).
- Produces: `isRosterAgentEmail(email: string): Promise<boolean>` trong `src/lib/tasks/membership.ts`.

**Files:** `src/lib/tasks/membership.ts`, `src/lib/tasks/assignees.ts`, `src/lib/enrollment/scope.ts`, `src/lib/notifications/audience.ts`, `src/lib/authz/holders.ts`, `src/lib/notifications/push-server.ts`, `src/app/(authed)/account-manager/page.tsx`, tests.

- [ ] **Step 1: Test hỏng trước** (`src/lib/tasks/membership.test.ts`): mock `authz_task_agents` trả **1000 dòng không gồm** `agent.late@x.com` cho `.select("email")` (truy vấn cũ) nhưng `count = 1` cho `.eq("email","agent.late@x.com")` → `resolveTaskQueueScope(actor agent.late có task.read:shared_queue)` phải `seesAllTasks: false`. Tương tự cho `resolveEnrollmentScope` và `taskViewersAmong`. Chạy → FAIL.
- [ ] **Step 2: Kiểm theo email.** `src/lib/tasks/membership.ts`:

```ts
/** Người này có trong roster Agent không — truy vấn ĐÚNG email, không suy từ tập (BR P1-01). */
export async function isRosterAgentEmail(email: string): Promise<boolean> {
  const { count, error } = await getSupabaseAdmin()
    .from(AUTHZ_TABLES.taskAgents)
    .select("email", { count: "exact", head: true })
    .eq("email", email.trim().toLowerCase());
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}
```

`resolveTaskQueueScope`: thay `fetchSelectedAgentEmails()` + `selectedAgentEmails.has(actor.email)` bằng `isRosterAgentEmail(actor.email)`. `resolveEnrollmentScope` tương tự. `fetchAssistantAgentsForCs(email)`: `.eq("cs_email", email.trim().toLowerCase())` trên `AUTHZ_TABLES.agentMembers`.

- [ ] **Step 3: Audience đọc đủ, thiếu là fail closed.** `loadViewers` (`src/lib/notifications/audience.ts`): thay đọc cả bảng roster bằng truy vấn theo đúng người nhận, chia lô 100 email (đã chuẩn hoá chữ thường), MỖI lô đọc qua `fetchAllRows` (review Codex của plan: một `cs_email` có thể có hơn 1.000 dòng `authz_agent_members`, `.in()` một lần vẫn bị cắt):

```ts
async function membershipsFor(csEmails: readonly string[]) {
  const rows: { agent_email: string; cs_email: string; is_assistant: boolean }[] = [];
  for (let i = 0; i < csEmails.length; i += 100) {
    const chunk = csEmails.slice(i, i + 100);
    rows.push(
      ...(await fetchAllRows((from, to) =>
        getSupabaseAdmin()
          .from(AUTHZ_TABLES.agentMembers)
          .select("agent_email,cs_email,is_assistant", { count: "exact" })
          .in("cs_email", chunk)
          .order("cs_email")
          .order("agent_email")
          .range(from, to)
      ))
    );
  }
  return rows;
}
```

Tương tự `AUTHZ_TABLES.taskAgents` với `.in("email", chunk).order("email")`. `fetchAllRows` ném khi đọc thiếu → `loadViewers` để lỗi nổi lên → `insertNotifications` KHÔNG gửi cho ai trong lô đó (fail closed; đã là hành vi khi truy vấn lỗi — kiểm lại và thêm test nếu chưa có). Test: fixture một CS có 1.200 dòng uỷ quyền (mock trả theo `range`, `count = 1200`) → đủ 1.200; mock trả thiếu (count 1200 nhưng trang rỗng ở 1.000) → không insert thông báo nào.
- [ ] **Step 4: Tập hiển thị đủ trang.** `fetchSelectedAgentEmails`, `fetchGrantHolders` (`AUTHZ_TABLES.accounts … order("id")`), Account Manager (`AUTHZ_TABLES.accounts` + `AUTHZ_TABLES.userRoles`) dùng `fetchAllRows` (truy vấn có `{ count: "exact" }`). `filterActiveAccounts(emails)`: `.in("email", chunk)` theo lô 100 trên `AUTHZ_TABLES.accounts` — mỗi email tối đa một dòng (email unique) nên một lô ≤ 100 dòng, không cần phân trang.
- [ ] **Step 5:** `npx vitest run src/lib` + tsc → test Step 1 PASS. **Commit** `fix(authz): xác định Agent/assistant theo đúng email, đọc tập hiển thị đủ trang (BR P1-01)`.

---

## Nhóm 3 — P2 đúng đắn

### Task 12: Cột Person của bảng CS kiểm theo grant — trong `authz_table_config_write_context` (N-3)

**Vấn đề.** Hàm production `table_config_write_context` (`git show main:supabase/schema.sql`, tìm tên hàm; khối nhánh `p_scope = 'cs'`) quyết định ai được chọn vào cột Person bằng bảng quyền CŨ:

```sql
        and exists (
          select 1
          from user_roles user_role
          join role_permissions permission on permission.role_id = user_role.role_id
          where user_role.user_id = account.id
            and permission.permission_key in ('task.work', 'task.manage')
        );
```

Code authz liệt kê người trong picker theo grant `task.read` (`fetchTaskAssignees`) → người có `task.read:assigned` hiện trong picker nhưng lưu thì `invalid-person`. Nhánh KHÔNG được sửa hàm production → dùng bản sao `authz_table_config_write_context` (tạo ở Task 0.2 Step 3), và Task này định nghĩa khối Person của bản sao.

**Files:** `supabase/rollouts/2026-10-03-authz-isolated.sql` + khối authz cuối `supabase/schema.sql` (hàm `authz_table_config_write_context`), `src/lib/table-config/write-context.ts:52,79-81` (tên RPC và chuỗi nhận diện lỗi "hàm chưa có"), `supabase/checks/ci-authz-rpc.sql`.

- [ ] **Step 1:** Copy NGUYÊN thân `table_config_write_context` của `main` sang `authz_table_config_write_context` (cùng tham số, cùng kiểu trả về), rồi đổi mọi tham chiếu bảng account/role theo bản đồ Nhóm 0 (`portal_account` → `authz_accounts`); khối Person thay bằng:

```sql
        and exists (
          select 1
          from authz_user_roles user_role
          join authz_roles role on role.id = user_role.role_id and role.is_active
          where user_role.user_id = account.id
            and (
              role.system_key = 'super_admin'
              or exists (select 1 from authz_role_grants g where g.role_id = role.id and g.action = 'task.read')
            )
        );
```

(Cùng luật với `fetchTaskAssignees` = người nắm `task.read` bất kỳ scope.) Các bảng cấu hình bảng (`table_config_*` hay tên thực tế trong thân hàm) là dữ liệu nghiệp vụ — giữ nguyên tên, hàm vẫn đọc/ghi chúng như bản `main`.
- [ ] **Step 2:** `write-context.ts`: `supabase.rpc("authz_table_config_write_context", …)`; chuỗi so lỗi ở dòng 79-81 đổi sang `"authz_table_config_write_context"`.
- [ ] **Step 3:** Kịch bản CI (`ci-authz-rpc.sql`): role mới chỉ có grant `task.read:assigned` (tạo qua `authz_upsert_role`), account giữ role đó → gọi `authz_table_config_write_context('cs', …)` với cột Person chứa email đó → có trong `matched_person_emails`; account không có `task.read` → không có.
- [ ] **Step 4: Commit** `fix(db): cột Person bảng CS kiểm theo grant task.read trên bản authz (N-3)`.

---

### Task 13: Grant Overview đòi thêm quyền đọc toàn bộ (N-4)

**Vấn đề.** `task.overview.read`, `enrollment.overview.read`, `lead.overview.read` (scope `*`, không `sensitive`) trả tiêu đề mọi task / tên khách mọi hồ sơ / dữ liệu lead — cấp riêng được cho người chỉ đọc bản ghi của mình.

**Files:** `src/lib/authz/catalog.ts`, `src/lib/tasks/access.ts` (`canReadTaskOverview`), `src/lib/enrollment/policy.ts` (`canReadEnrollmentOverview`), `src/lib/leads/access.ts` (`canReadLeadOverview`), tests.

- [ ] **Step 1:** Ba hàm đòi thêm `:all` của action đọc tương ứng:

```ts
export function canReadTaskOverview(actor: TaskActor): boolean {
  // Overview liệt kê tiêu đề MỌI task: chỉ cho người vốn đọc được mọi task (N-4).
  return hasGrant(actor.grants, "task.overview.read") && hasGrant(actor.grants, "task.read", "all");
}
```

(tương tự `enrollment.read:all`, `lead.read:all`). Đánh dấu ba action `sensitive: true` trong catalog.
- [ ] **Step 2:** Test: grant `task.overview.read:*` + `task.read:assigned` → false; thêm `task.read:all` → true. `equivalence.test.ts` phải vẫn xanh (task admin có cả hai).
- [ ] **Step 3: Commit** `fix(authz): Overview đòi thêm quyền đọc toàn bộ domain (N-4)`.

---

### Task 14: Kiểm tươi `access_version` cho thao tác quản trị (A P1-01 phần còn)

**Vấn đề.** Plan final D11 hứa `requireFreshPrincipal()` cho route quản trị; hàm không tồn tại. Thu hồi quyền có hiệu lực tới 30 giây (cache version), và giữ TTL 5 phút khi đọc version lỗi. Với thao tác quản trị (đổi role/account, roster, uỷ quyền), người vừa bị hạ quyền vẫn thao tác được trong khoảng đó.

**Files:** `src/types/next-auth.d.ts` (session.user.accessVersion), `src/auth.ts` (session callback copy `accessVersion`), `src/lib/authz/principal.ts` (Principal có `accessVersion`), `src/lib/authz/guards.ts` (`requireFreshApiGrant`), route: `src/app/api/admin/**` (POST/PATCH/DELETE), `src/app/api/config/agents/route.ts`, `src/app/api/config/assistants/route.ts` (qua `loadOrgManager`).

- [ ] **Step 1:** `guards.ts`:

```ts
/**
 * Như requireApiGrant, cộng kiểm `access_version` TƯƠI (bỏ qua cache 30 s):
 * dùng cho thao tác quản trị — người vừa bị hạ quyền không thao tác thêm được
 * lần nào (A P1-01, plan D11). Version đổi hoặc không đọc được → 401 để phiên
 * làm mới / đăng nhập lại.
 */
export async function requireFreshApiGrant(action: Action, scope?: GrantScope): Promise<ApiGuardResult> {
  const result = await requireApiGrant(action, scope);
  if (!result.ok) return result;
  const { accountId, accessVersion } = result.principal;
  if (!accountId) return { ok: false, response: unauthorized() };
  const lookup = await fetchAccessVersion(accountId); // src/lib/authz/versions.ts, không qua cache
  if (lookup.status !== "ok" || lookup.version !== accessVersion) {
    return { ok: false, response: NextResponse.json({ error: "Session expired. Reload the page." }, { status: 401 }) };
  }
  return result;
}
```

`Principal.accessVersion: number | null` lấy từ `session.user.accessVersion`.
- [ ] **Step 2:** Đổi `requireApiGrant` → `requireFreshApiGrant` ở mọi handler GHI trong `src/app/api/admin/**`; `loadOrgManager` gọi kiểm tươi cho POST/DELETE (thêm tham số `{ fresh: true }`).
- [ ] **Step 3:** Test guard: version DB ≠ token → 401; bằng → ok. Cập nhật mock `getPrincipal` trong test admin (thêm `accountId`, `accessVersion`, mock `fetchAccessVersion`).
- [ ] **Step 4: Commit** `feat(authz): thao tác quản trị kiểm access_version tươi (A P1-01)`.

---

### Task 15: Thông báo — push `unassigned`, kiểm lại trước push, DTO rút gọn, lỗi từng domain, Time Off, chuông (F P1-01, BR P1-05, F P2-01, F P2-03, F P2-04, BR P2-05, E P2-05)

**Files:** `src/lib/tasks/notifications.ts`, `src/lib/enrollment/notifications.ts`, `src/lib/notifications/push-dispatch.ts`, `src/app/api/tasks/notifications/route.ts`, `src/lib/notifications/read-access.ts`, `src/lib/authz/navigation.ts`, tests.

- [ ] **Step 1: Push `unassigned` không mang gì về bản ghi (F P1-01; review Codex của plan, P1 + lần 2, P2 — câu chữ theo đúng nơi phát).** Bỏ tiêu đề thôi chưa đủ: `buildPushPayload` (`src/lib/notifications/push-server.ts:214-229`) còn đưa `body` = `notificationSentence()` (có tên actor), `url` = `notificationHref()` (có task ID), `tag` = `notificationAlertTag()` (theo bản ghi). Thêm vào `push-server.ts`:

```ts
/**
 * Push cho thông báo `unassigned` — phát khi một người bị GỠ khỏi task
 * (`src/app/api/tasks/[id]/assignees/[email]/route.ts:110,141`,
 * `src/app/api/tasks/[id]/route.ts:577`). Người nhận vừa mất liên quan tới bản ghi,
 * có thể không còn quyền xem — payload không được chứa ID, tên actor, URL tới bản
 * ghi hay tag theo bản ghi (F P1-01). Câu chữ đúng sự kiện, không gợi ý phải nhận việc.
 */
export const GENERIC_UNASSIGNED_PUSH: PushPayload = {
  title: "Agent Portal",
  body: "Your task assignment changed.",
  url: "/tasks",
  tag: "task-assignment",
  renotify: false,
};
```

Trong `dispatch` (`push-dispatch.ts:107-125`): nhóm có `group.source.type === "unassigned"` dùng `GENERIC_UNASSIGNED_PUSH` thay cho `buildPushPayload(...)`; `pushForTaskNotifications` không nạp tiêu đề cho dòng `unassigned`. Test (`push-dispatch.test.ts`): một dòng `unassigned` → payload gửi đi bằng đúng `GENERIC_UNASSIGNED_PUSH` — kiểm cả `title`, `body`, `url`, `tag` (không chứa task ID, display number, tên/email actor).

- [ ] **Step 2: Kiểm lại quyền SAU khi dựng payload, NGAY TRƯỚC `sendPushToEmails` (BR P1-05).** Push chạy trong `after()` sau response — quyền có thể đã đổi. Trong `dispatch`, với mỗi nhóm (trừ `unassigned`): lọc `group.emails` bằng `taskViewersAmong` / `enrollmentViewersAmong` cho đúng bản ghi rồi mới gọi `sendPushToEmails`; lỗi khi kiểm → bỏ nhóm đó (fail closed). Test: người nhận mất quyền giữa lúc insert và lúc push → không nhận push; kiểm lỗi → không ai nhận. Ghi vào runbook (Task 8 bước 0): push đã giao cho dịch vụ push ngoài thì không thu hồi được.
- [ ] **Step 3: DTO rút gọn thật sự (F P2-01, BR P2-05).** `route.ts:414-428` — dòng mất quyền trả:

```ts
    return {
      id: n.id,
      type: n.type,
      is_read: n.is_read,
      created_at: n.created_at,
      entity_type: n.entity_type,
      entity_id: "",
      task_id: "",
      comment_id: null,
      actor_email: "",
      actor_name: null,
      detail: null,
      task_title: null,
      comment_body: null,
      entity_display_number: null,
      entity_program: undefined,
      redacted: true as const,
    };
```

Client (`NotificationBell.tsx`) đã không điều hướng khi `redacted`; kiểm `actorName(n)` / `entityKey(n)` chịu được chuỗi rỗng (hiện chữ chung, không lỗi). `unreadAssignedTaskIds` (danh sách ID task "assigned" chưa đọc) chỉ giữ ID thuộc tập `visible`.
- [ ] **Step 4: Lỗi từng domain riêng (F P2-03).** `read-access.ts:35-53` đổi `Promise.all` → `Promise.allSettled`; domain lỗi thì chỉ rút gọn domain đó (log từng domain).
- [ ] **Step 5: Time Off (F P2-04).** Người được requester CHỌN để duyệt (manager) nhận thông báo nhưng đọc lại bị rút gọn. Luật mới trong `visibleTimeOffRequests`: đơn hiện đủ nếu viewer giữ `timeoff.manage`, là requester (`time_off_requests.requester_id = principal.accountId`), HOẶC là manager được chọn của đơn (`time_off_requests.manager_id = principal.accountId` — cột thêm ở rollout `2026-09-12-time-off-manager-notifications.sql`). Chỉ ĐỌC bảng nghiệp vụ `time_off_requests`; id account trong `authz_accounts` trùng id production (script đồng bộ giữ nguyên id) nên so trực tiếp được. Test: viewer là `manager_id`, không có `timeoff.manage` → thấy đủ; viewer không liên quan → rút gọn.
- [ ] **Step 6: Chuông (E P2-05).** `canUseNotifications` (`navigation.ts:96-103`) thêm mọi grant `notify.*` (`notify.timeoff.submitted`, `notify.task.escalation`, …) — người chỉ nhận thông báo duyệt/giám sát cũng thấy chuông.
- [ ] **Step 7:** `npx vitest run src/lib/notifications src/lib/authz src/app/api/tasks/notifications`. **Commit** `fix(notifications): push không mang nội dung khi đã mất quyền, kiểm lại trước push, DTO rút gọn, lỗi từng domain (F P1-01, BR P1-05)`.

---

### Task 16: Hàng đợi CS và roster — một luật eligibility, audit đủ, không tự uỷ quyền (G P2-01, BR P2-02, G P2-03, G P2-04, BR P2-07, N-6)

- [ ] **Step 1: Một luật eligibility (G P2-01, BR P2-02).** Tạo trong `src/lib/tasks/access.ts`:

```ts
/** Nhận việc từ hàng đợi CS: giữ task.queue.member VÀ vào được board. Workload, picker, route dùng chung. */
export function isQueueEligible(grants: readonly string[]): boolean {
  return hasGrant(grants, "task.queue.member") && hasGrant(grants, "task.read");
}
```

Dùng ở `src/lib/tasks/overview-data.ts` (`canWork: isQueueEligible(grants)`) và `src/app/api/tasks/[id]/assign/route.ts` (thay kiểm `task.queue.member` đơn lẻ). Test queue-only (không có `task.read`) → không ở workload, route 409.
- [ ] **Step 2: Audit gỡ roster đủ (G P2-03, BR P2-07).** `authz_remove_task_agent` (rollout cô lập + khối authz của `schema.sql`) làm việc TRỰC TIẾP trên bảng authz (không gọi `delete_task_agent_atomic` production — Task 0.2): chụp MỌI dòng `authz_agent_members` của agent (kể cả `is_assistant = false`), xoá, và ghi audit khi có gì bị xoá:

```sql
  select coalesce(jsonb_agg(jsonb_build_object('cs_email', cs_email, 'is_assistant', is_assistant)
           order by cs_email), '[]'::jsonb)
    into memberships
  from authz_agent_members where agent_email = normalized_email;
  delete from authz_agent_members where agent_email = normalized_email;
  delete from authz_task_agents where email = normalized_email;
  removed := found;
  if removed or jsonb_array_length(memberships) > 0 then
    insert into authz_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
    values (p_actor_account_id, p_actor_email, 'task.agent.remove', 'task_agent', normalized_email,
            jsonb_build_object('email', normalized_email, 'memberships', memberships), null);
  end if;
```

(`normalized_email := lower(btrim(p_email))`; email trong bảng authz đã chữ thường theo ràng buộc `check` nên so bằng `=`.) Kịch bản CI: agent có 1 membership thường + 1 assistant → gỡ → `authz_audit.before->'memberships'` có 2 phần tử.
- [ ] **Step 3: RPC production không audit (G P2-04) — không sửa ACL.** Bản gốc đề xuất `revoke` `create_agent_membership_atomic` / `delete_task_agent_atomic` khỏi `service_role`; nhánh cô lập KHÔNG đổi ACL hàm production. Thay vào đó: cổng TS ở Task 0.5 Step 1 cấm code gọi hai RPC này (và mọi RPC production chạm account/role/roster). Bước này chỉ xác nhận: `grep -rn "create_agent_membership_atomic\|delete_task_agent_atomic" src scripts` → 0 lời gọi.
- [ ] **Step 4: Không tự uỷ quyền (N-6).** `src/app/api/config/assistants/route.ts` POST: `cs_email === admin.principal.email` → 403 "You cannot make yourself an assistant."; `src/app/api/config/agents/route.ts` POST: `email === admin.principal.email` → 403. Test cả hai.
- [ ] **Step 5:** PGlite chuỗi đầy đủ + `npx vitest run src/app/api/config src/lib/tasks`. **Commit** `fix(tasks): một luật eligibility hàng đợi, audit gỡ roster đủ, không tự uỷ quyền (G P2-01/03, N-6)`.

---

### Task 17: Lỗi unique → mã nghiệp vụ; đổi mật khẩu tăng version (N-10b, N-10c)

- [ ] **Step 1:** Trong `authz_create_account`, `authz_update_account`, `authz_set_commission_name` (rollout cô lập + khối authz của `schema.sql`): bọc câu insert/update gây unique bằng `begin … exception when unique_violation then … end;` — phân biệt bằng `get stacked diagnostics v_constraint = constraint_name`:

```sql
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    raise exception using message = case
      when v_constraint like '%email%' then 'ACCOUNT_EMAIL_TAKEN'
      when v_constraint like '%agent_id%' then 'AGENT_ID_TAKEN'
      when v_constraint like '%commission_names_name%' then 'COMMISSION_NAME_TAKEN'
      else 'UNIQUE_VIOLATION' end;
```

(Tên ràng buộc cố định theo DDL Task 0.2 Step 2: `authz_accounts_email_key` — tên Postgres tự đặt cho `unique` cột `email`; `authz_accounts_agent_id_key`; `authz_commission_names_name_idx`. Kịch bản CI Step 3 xác nhận từng mã.)
- [ ] **Step 2:** `authz_update_account`: khi `p_patch ? 'password_hash'` → `update authz_accounts set access_version = access_version + 1 where id = p_account_id` (phiên đang mở của người đó phải làm mới). Route đổi mật khẩu của chính mình (`src/app/api/settings/password/route.ts`) ghi `authz_accounts` (Task 0.4) và cũng tăng `access_version` qua `authz_bump_account_access_version`.
- [ ] **Step 3:** Kịch bản CI: gọi `authz_update_account` đổi email account 2 thành email account 1 → `ACCOUNT_EMAIL_TAKEN`; đổi mật khẩu → `access_version` +1.
- [ ] **Step 4: Commit** `fix(db): lỗi unique trả mã nghiệp vụ, đổi mật khẩu tăng access_version (N-10)`.

---

## Nhóm 4 — UI, test, tài liệu

### Task 18: Menu `/config` khớp page guard; nhãn `task.config.manage` (E P2-01, BR P2-04)

**Vấn đề.** `src/lib/authz/navigation.ts:63-67` hiện menu cho `["enrollment.options.manage", "task.config.manage", "lead.config.manage"]`, còn trang `src/app/(authed)/config/page.tsx:68-89` cho vào khi `loadConfigAdmin()` (= `enrollment.options.manage`), `canConfigureLeadColumns` (`lead.config.manage`) hoặc `provider.update`. → người chỉ có `task.config.manage` thấy menu rồi bị đẩy về `/unauthorized`; người chỉ có `provider.update` vào được trang nhưng không có menu. Nhãn catalog `task.config.manage` ghi "…columns" nhưng cột bảng CS do `enrollment.options.manage` gác.

- [ ] **Step 1:** `navigation.ts`: `anyOf: ["enrollment.options.manage", "lead.config.manage", "provider.update"]`. Tách luật trang ra hàm dùng chung `canOpenTableConfig(grants)` trong `navigation.ts` và gọi ở `config/page.tsx` để hai nơi không lệch nữa.
- [ ] **Step 2:** `catalog.ts`: nhãn `task.config.manage` → `"Configure task categories, SLA, reminders and CS queue"`; nhãn `enrollment.options.manage` → `"Manage enrollment option lists and CS/Enrollment table columns"`.
- [ ] **Step 3:** `navigation.test.ts`: bỏ ngoại lệ `config`, thêm test "menu config ⇔ trang config cho vào" với các bộ grant: chỉ `task.config.manage` (cả hai false), chỉ `provider.update` (cả hai true).
- [ ] **Step 4: Commit** `fix(nav): menu Table Configuration khớp cổng trang; sửa nhãn quyền (E P2-01)`.

---

### Task 19: UI còn suy quyền từ persona / scope đọc (E P2-02, BR P2-04, E P2-03, E P2-04, E P2-06)

- [ ] **Step 1: Lead drawer.** `LeadDetailDrawer.tsx:333-357` đang `const canEdit = leadIsInScope(currentLead, editableOwnerEmails); const canLog = canEdit;` (scope ĐỌC). Server (`src/app/(authed)/tasks/leads/page.tsx`) truyền thêm hai tập owner riêng cho `lead.update` và `lead.interaction.log` (thêm `resolveLeadOwnerEmailsFor(actor, action)` trong `src/lib/leads/membership.ts`, cùng logic `resolveLeadOwnerEmails` nhưng theo action), client tính `canEdit`/`canLog` từ đúng tập.
- [ ] **Step 2: Nút tạo.** `TaskBoardClient.tsx:2018` `canCreateTasks = access.createsAny || canManageOwnAgentGroup` và `EnrollmentClient.tsx:1161` suy từ persona. Server truyền `access.createsForOwnAgent = hasGrant(grants, "task.create", "agent_owned")`, `access.createsForAssisted = hasGrant(grants, "task.create", "assistant_for_agent")`; client: `createsAny || (isAgent && createsForOwnAgent) || (myAssistantAgents.length > 0 && createsForAssisted)`. Enrollment tương tự.
- [ ] **Step 3: Tab Activity.** `TaskBoardClient.tsx:2015-2017` dùng `access.activityAll || isAgentOwnerOrAssistantOf(...)` → thay bằng `canReadTaskActivity(viewer, openTask, isAgentOwnerOrAssistantOf(openTask.agent_email))` (hàm thuần, client import được) sau khi Task 2 đổi chữ ký.
- [ ] **Step 4: Lưới Registration.** Trang `src/app/(authed)/page.tsx` và `customer-registration/pc/page.tsx` truyền `canEditAll = hasGrant(grants, "registration.<domain>.update", "all")` và `canEditOwn = hasGrant(grants, "registration.<domain>.update")` xuống grid; grid chỉ hiện nút sửa/xoá dòng khi `canEditAll || (canEditOwn && dòng là của mình)` (cùng luật `canManageEntry` phía server).
- [ ] **Step 5:** Lint + tsc + test liên quan. **Commit** `fix(ui): capability Lead/Task/Enrollment/Registration lấy từ đúng action (E P2-02..06)`.

---

### Task 20: Test gây hiểu nhầm, điểm mù cổng CI, CI chạy test TS (N-8, H P2-03, A P2-05, BR P2-08)

- [ ] **Step 1: Test rollback thật** (`supabase/checks/ci-authz-rpc.sql:119-143`). Khối hiện tại gói HAI lệnh trong một `begin … exception` nên savepoint rollback cả hai — không chứng minh gì về hàm. Thay bằng MỘT lệnh gọi mà lỗi xảy ra ở BƯỚC SAU bên trong hàm: `authz_create_account('new2@x.com', …, 'jane doe' /* tên hoa hồng đã có */ …)` → bắt lỗi → khẳng định `new2@x.com` không có trong `authz_accounts` (insert account ở bước đầu của chính hàm đã bị rollback). Với `authz_update_account`: một lệnh `{"name":"Nope","role_id":"<id không tồn tại>"}` → tên vẫn là tên cũ.
- [ ] **Step 2: Cổng tên role (H P2-03).** `no-role-name-checks.test.ts` thêm mẫu: `\.eq\(\s*["']name["']\s*,\s*["'](Admin|Super Admin|Agent|…)`, `\.name\.toLowerCase\(\)\s*===`, `case\s+["'](Admin|Super Admin)["']`, và import `@/lib/authz/compat` từ file chạy thật (chỉ cho phép `delegation.ts`, `scripts/**`, test). Thêm fixture âm trong chính test (chuỗi mẫu phải bị bắt).
- [ ] **Step 3: Marker registry (N-8).** `src/app/api/route-guards.test.ts`: `"can("` khớp mọi tên hàm tận cùng bằng `can(` — đổi phát hiện sang regex `\bcan\(`, `\bcanAny\(` (sửa hàm `detect` dùng `RegExp`); cập nhật snapshot và đọc diff.
- [ ] **Step 4: Manifest (A P2-05).** `src/lib/db-gate-manifest.test.ts` thêm: mọi `create or replace function <tên>` trong rollout không nằm trong workflow phải có trong `schema.sql`; thêm fixture âm (chuỗi SQL giả có bảng lạ → phải bị báo).
- [ ] **Step 5: CI chạy test TS (BR P2-08).** Tạo `.github/workflows/ci.yml`: trên `pull_request` (mọi path) và `workflow_dispatch`: checkout → setup-node 22 → `npm ci` → `npm run typecheck` → `npm run test:run` → `npm run lint`.
- [ ] **Step 6: Commit** `test(authz): test rollback thật, cổng tên role/registry/manifest chặt hơn, CI chạy test TS (N-8, H P2-03, BR P2-08)`.

---

### Task 21: Bỏ fallback tên hiển thị; sửa tài liệu cho đúng (D P2-04, bảng review, changelog)

- [ ] **Step 1:** `src/lib/agent-identity.ts`: bỏ nhánh `isMissingCommissionSchema` → fallback `portal_account.name`; đọc `AUTHZ_TABLES.commissionNames`, lỗi (kể cả bảng chưa có — rollout cô lập là bắt buộc trước deploy, runbook Task 8) thì ném. Cập nhật `src/lib/agent-identity.test.ts` (ca "bảng chưa có" giờ phải ném).
- [ ] **Step 2:** `docs/superpowers/plans/2026-09-26-authorization-final-plan.md`, bảng "Xử lý 3 bản review Codex": sửa các dòng nói quá — A P1-01 (chỉ đạt SLA 30 s; kiểm tươi ở Task 14 của plan này), A P2-02 (còn push quét toàn bộ → Task 11), A P2-05 (chỉ kiểm bảng → Task 20), C P1-01..03 ("không còn ai đọc" sai: `table_config_write_context` → Task 12), N-9 (hết áp dụng sau cô lập — Task 10). Phần III: thêm mục "Cô lập authz" đầu phần — mọi rollout B/C/D/G/H/review-fixes đã thay bằng `2026-10-03-authz-isolated.sql` + hàm/script đồng bộ; bản authz THAY `main`, bảng `authz_*` sẽ là bảng chính thức nếu ổn ("Giai đoạn chốt"); bảng `role_grants` / `access_audit` / `agent_commission_names` / cột `access_version`, `system_key` nhắc trong các phase giờ là `authz_role_grants` / `authz_audit` / `authz_commission_names` / cột của `authz_accounts`, `authz_roles`. Thêm mục "Review fixes 2" trỏ tới plan này.
- [ ] **Step 3:** `changelog.md`: một entry `## 2026-10-03 — Authz cô lập khỏi dữ liệu production + sửa theo review toàn nhánh` liệt kê: dữ liệu account/role/roster của bản authz nằm ở bảng `authz_*` (rollback = deploy lại `main`, DB không phải làm gì); thay đổi người dùng thấy được (export Task, assistant không còn quyền agent_owned, import theo scope, không dùng lại được tên hoa hồng từng thuộc người khác, Overview, email chữ thường, Time Off chưa dùng được cho account tạo/mở lại trên bản authz); "Cần chạy tay theo `docs/2026-10-03-authz-deploy-runbook.md`: `2026-09-26-rls-lockdown.sql`, `prod-fingerprint.sql` (trước), `2026-10-03-authz-isolated.sql`, `scripts/authz-sync-from-production.ts` (dry-run → `--apply`), `prod-fingerprint.sql` (sau, phải khớp), `prod-preflight-authz.sql`".
- [ ] **Step 4:** Xoá dòng trống thừa cuối `src/lib/rbac/access.ts` (`git diff --check main...feat/authz` sạch).
- [ ] **Step 5: Commit** `docs(authz): bỏ fallback tên hiển thị; tài liệu và changelog theo hướng cô lập`.

---

## Kiểm tra chung (sau mỗi task SQL và trước khi báo xong)

```bash
export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"
cd /Users/vothuongbao/Project/Web/agent-portal
npx tsc --noEmit
npx vitest run
npx eslint src
git diff --check main...feat/authz
git diff main...feat/authz --stat -- supabase/schema.sql   # chỉ thêm: chú thích đầu file, RLS lockdown, khối authz cuối file

SCRATCH=/private/tmp/claude-501/-Users-vothuongbao-Project-Web/a4a9805c-e38c-4b52-82e3-b7869d2319d4/scratchpad
git show main:supabase/schema.sql > $SCRATCH/pg/main-schema.sql
cd $SCRATCH/pg

# (1) Cổng cô lập — giống job authz-isolation (Task 0.5 Step 3): mốc dựng từ schema `main`
node run.mjs supabase/checks/ci-bootstrap.sql $SCRATCH/pg/main-schema.sql \
  supabase/rollouts/2026-08-18-install-sheet-sync-staging.sql \
  supabase/rollouts/2026-09-04-time-off-monthly-accruals.sql \
  supabase/rollouts/2026-09-10-web-push.sql \
  supabase/rollouts/2026-09-12-time-off-manager-notifications.sql \
  supabase/rollouts/2026-09-13-user-avatar.sql \
  supabase/rollouts/2026-09-17-provider-directory-temp.sql \
  supabase/rollouts/2026-09-26-rls-lockdown.sql \
  supabase/checks/ci-production-fixture.sql supabase/checks/ci-production-write-guard.sql \
  supabase/checks/ci-production-snapshot.sql \
  supabase/rollouts/2026-10-03-authz-isolated.sql supabase/checks/ci-production-unchanged.sql \
  supabase/rollouts/2026-10-03-authz-isolated.sql supabase/checks/ci-production-unchanged.sql \
  supabase/checks/ci-authz-sync.sql supabase/checks/ci-production-unchanged.sql \
  supabase/checks/ci-production-write-guard-relax.sql \
  supabase/checks/ci-authz-rpc.sql supabase/checks/ci-production-unchanged.sql \
  supabase/checks/prod-fingerprint.sql \
  supabase/checks/authz-drop.sql supabase/checks/ci-production-unchanged.sql

# (2) Preflight phải ok hết sau đồng bộ — runner cần cờ ASSERT_OK (thêm vào run.mjs:
#     sau file cuối, có dòng nào `ok === false` thì in dòng đó và exit 1)
ASSERT_OK=1 node run.mjs <chuỗi (1) tới hết ci-authz-rpc.sql> supabase/checks/prod-preflight-authz.sql

# (3) Cài DB mới — giống job fresh-install (Task 0.5 Step 4)
node run.mjs supabase/checks/ci-bootstrap.sql supabase/schema.sql \
  <6 rollout tạo bảng như (1), gồm 2026-09-13-user-avatar.sql> \
  supabase/rollouts/2026-09-26-rls-lockdown.sql supabase/rollouts/2026-10-03-authz-isolated.sql \
  supabase/checks/ci-rls-assert.sql supabase/checks/ci-authz-rpc.sql supabase/schema.sql
```

PGlite không hỗ trợ event trigger thì tách phần event trigger của `ci-production-write-guard.sql` ra file `ci-production-ddl-guard.sql` và bỏ file đó khi chạy ở máy (CI Postgres vẫn chạy). Bước đồng thời hai phiên (Task 0.5 Step 4) chỉ chạy được trên CI.

Kỳ vọng: typecheck 0 lỗi; toàn bộ test xanh (gồm `isolation.test.ts`, `sql-call-graph.test.ts`, `function-lock.test.ts`, `no-role-name-checks.test.ts`); lint 0 lỗi; mọi file SQL `ok`; mọi lần `ci-production-unchanged.sql` không raise; preflight mọi dòng `ok`. `next build` chạy một lần ở cuối (không song song). CI (`.github/workflows/db-persistence-gate.yml`) chạy (1)–(3) bằng `psql` trên Postgres thật.

## Thứ tự làm

0.1 → 0.2 → 0.3 → 0.4 → 0.5 (cô lập, bắt buộc trước) → 1 → 2 → 11 (P1 lộ dữ liệu) → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 12–17 → 18–21 (Task 10 hết áp dụng). Phụ thuộc: Task 0.3 tạo `fetchAllRows` (Task 7, 11 dùng) và `sync-plan.ts` (Task 7 dùng); Task 0.2 tạo rollout cô lập mà Task 4/12/16/17 thêm phần vào — mỗi lần đổi hàm `authz_*` phải cập nhật khối lock của preflight (Task 8 Step 2, test tự báo); Task 2 đổi chữ ký hàm mà Task 19 dùng; cổng Task 0.5 phải xanh sau MỌI task có SQL.

## Giai đoạn chốt — SAU khi bản authz chạy ổn (plan riêng, KHÔNG làm trong plan này)

Chủ repo (2026-09-26): nếu bản authz ổn thì dùng luôn bảng authz, bỏ bảng production cũ. Việc đó chấm dứt lời hứa "rollback chỉ bằng code", nên là một plan riêng, viết khi chủ repo tuyên bố giai đoạn thử kết thúc. Phạm vi dự kiến:
1. Backup toàn bộ DB (`pg_dump`) trước khi chốt — từ đây rollback cần DB.
2. Khoá ngoại `time_off_*` (7 cột liệt kê ở ma trận Nhóm 0) chuyển sang `authz_accounts(id)` → account tạo trên bản authz dùng được Time Off.
3. Hàm Time Off của `main` theo một account (`adjust_time_off_balance`, `configure_time_off_monthly_accrual`) đọc `authz_accounts`; hai bản `authz_*` theo tập bỏ điều kiện `portal_account`; gỡ bản gốc; bỏ `timeOffAccountGate` và `production-read.ts`.
4. Gỡ hàm production đã có bản authz hoặc chỉ bảng cũ dùng: `assign_unassigned_task`, `table_config_write_context`, `create_agent_membership_atomic`, `delete_task_agent_atomic`, `replace_role_permissions`, `replace_user_roles` (đồ thị gọi SQL của Task 0.5 liệt kê đủ).
5. Đổi tên bảng cũ sang `legacy_*` (`portal_account`, `roles`, `user_roles`, `role_permissions`, `permissions`, `task_agents`, `agent_members`), giữ một thời gian để tra cứu, rồi drop.
6. Xoá code chuyển tiếp: `compat.ts`, `legacy/*`, decision diff, script + hàm đồng bộ, `authz_production_auth_fingerprint`; cổng cô lập thay bằng cổng "không ai đọc `legacy_*`".
7. Khối production của `schema.sql` viết lại theo mô hình authz (hết seed theo tên role).
8. (Tuỳ chọn) đổi tên `authz_*` → tên gọn — chỉ khi đáng công; tiền tố không gây hại.

Plan này giữ sẵn đường cho giai đoạn chốt: id account/role giữ nguyên khi đồng bộ; bảng authz khai báo cột tường minh như bảng lâu dài; mọi chỗ đọc bảng phân quyền production cũ tập trung ở `production-read.ts`, hàm/script đồng bộ và decision diff.

## Self-review (đã chạy khi viết plan)

- **Phủ nguồn:** mọi mục NOT FIXED / PARTIAL trong bảng của review độc lập (A–H) và mọi mục BR P1-01…P1-07, P2-01…P2-09 đều có task, được Nhóm 0 làm mất gốc (G P1-01 → Task 5 chỉ còn kiểm; N-9 → Task 10 hết áp dụng; G P2-04 → cổng 0.5), hoặc nằm trong "cần chủ repo quyết định". 16 comment review Codex của plan: xem bảng "Xử lý review Codex của plan".
- **Phạm vi cô lập:** không task nào ghi bảng phân quyền production hay đổi cấu trúc bảng/hàm hiện hữu — đã rà Task 0.2–0.5, 4, 5, 9, 10, 11, 12, 16, 17. Đọc bảng phân quyền production chỉ ở: hàm/script đồng bộ, decision diff, `production-read.ts`, và bên trong 4 RPC Time Off của `main` (ma trận). Quét 2026-09-26: ngoài 2 hàm đã thay bằng bản `authz_*`, không RPC nghiệp vụ nào code gọi mà đọc/ghi bảng phân quyền trừ 4 hàm Time Off (chỉ đọc). Ghi nghiệp vụ (task, hồ sơ, Time Off, push, `login_attempts`, hàng đợi, storage avatar) được duyệt tường minh; ngoại lệ avatar cũ đã chặn (Task 0.4 Step 2).
- **Placeholder:** mọi bước sửa code có đoạn code hoặc câu thay thế cụ thể; chỗ port thân hàm SQL dài (Task 0.2 Step 3, 12, 16, 17) chỉ rõ nguồn (`git show 6bbeb69:<rollout>` hoặc `git show main:supabase/schema.sql`, tìm theo tên hàm) và đúng khối cần đổi; khối lock của preflight sinh bằng test (Task 8 Step 2), không điền tay.
- **Review Codex lần 2:** 8 comment P1/P2 đã sửa trong plan; 3 comment P0 (#1–#3 của bảng lần 2) đóng theo quyết định chủ repo (phương án 1, xác nhận 2026-09-27) — ghi thành khối "Quyết định của chủ repo" đầu file.
- **Nhất quán tên:** `AUTHZ_TABLES` / `PRODUCTION_AUTH_TABLES` / `AUTHZ_ACCOUNT_COLUMNS` (0.1 → 0.4, 0.5, 7, 11, 21), `fetchAllRows` (0.3 → 7, 11 — truy vấn luôn có `{ count: "exact" }`), `computeRoleGrants` / `diffAllAccounts` / `checkApprovedDiffs` / `ApprovedDiff` (0.3 → 7), `authz_sync_from_production` / `authz_production_auth_fingerprint` (0.3 → 8, 0.5), `productionAvatarUrl` / `productionAccountStates` / `timeOffAccountGate` (0.4), `GENERIC_UNASSIGNED_PUSH` (15), `p_skip_account_ids` / `--skip-account` (0.3 ↔ runbook bước 10), `isRosterAgentEmail` (11), `isQueueEligible` (16), `requireFreshApiGrant` (14), `canOpenTableConfig` (18), `importUpdateRejection` (3), chữ ký mới `canDeleteTask(actor, task, isAgentOwner)` … (2 → 19); `authz_set_commission_name` 4 tham số (0.2 bảng port = Task 4); số hàm `authz_*` = 20 (18 ở bảng port + 2 hàm đồng bộ) khớp cổng tên role (Task 0.2 Step 5b).
