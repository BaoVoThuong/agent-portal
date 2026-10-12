# Sửa lỗi sau review DB optimize + Role Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Người thực hiện:** user tự code (chốt 2026-10-12). Mỗi task có thể làm và kiểm tra độc lập, theo thứ tự số.

**Goal:** Sửa mọi lỗi có thật mà 2 bản review (Claude, Codex) tìm ra trong đợt thay đổi chưa commit (DB optimize + Role Manager), để deploy an toàn.

> **Ghi chú triển khai 2026-10-12 (Codex):** Yêu cầu mới của user là thực hiện kế hoạch và ghi chú chỗ sai. Phần code và schema đã được chuẩn bị local. Cả 5 rollout SQL đã chạy production (CS pool, Account RPC, Role RPC, Google RPC, Sheet sync); lượt sync thử P&C finalize 4.239 dòng và refresh mart thành công. Code chưa commit/push/deploy nên chưa thể kiểm tra API/UI sau deploy. Một số nhận định trong kế hoạch cần đính chính:
>
> - `PATCH {}` trước khi sửa trả danh sách role, quyền và số lượng thành viên; `fetchRolesWithPermissions()` không trả `user_id`. Vẫn là lỗi lộ dữ liệu quản trị vì thiếu kiểm quyền đầu route.
> - Chỉ gọi `rbacLookup.invalidate()` không đủ để quyền có hiệu lực ngay: JWT cũ giữ `rbacRefreshedAt` tới 5 phút và bỏ qua lookup. Đã đặt ngưỡng refresh JWT bằng 0; mọi lần kiểm quyền đọc lookup dùng chung (tối đa một truy vấn/email/instance/phút), nên instance ghi nhận thay đổi ngay và instance khác tối đa 60 giây. Cần đo tải DB sau deploy.
> - Mốc 10 phút của sync là chính sách giữ dữ liệu, không chứng minh run đã chết. `FOR UPDATE SKIP LOCKED` chỉ bảo vệ run đang khóa trong một transaction finalize; manual upload còn chạy giữa các batch vẫn có thể bị dọn. README và SQL đã ghi rõ trường hợp phải chạy lại.
> - Rollout thêm RPC cần `NOTIFY pgrst, 'reload schema'` sau `CREATE FUNCTION` để PostgREST nhận hàm mới; đã thêm vào các file rollout 10–12.
> - Sau rollout, đã kiểm quyền EXECUTE: 6 RPC mới chỉ `service_role` được gọi, `authenticated` không được gọi. Đã chạy smoke test SQL trong transaction `ROLLBACK` cho tạo/sửa role, tạo Google account, sửa/xóa account và trường hợp ghi lỗi phải rollback; xác nhận không còn account/role test. Lượt sync P&C trên production finalize 4.239 dòng; trong 15 phút sau đó chỉ có run `finalized`.
> - Chưa có quyền truy cập cấu hình Vercel Production trong workspace nên chưa xác minh `VAPID_SUBJECT` trên Vercel. `.env.local` có subject nhưng không chứng minh Production cũng có.

**Trạng thái:** task 1–13 đã sửa code/schema, chạy kiểm tra local và áp dụng SQL production. Task 14 step 1 đã qua (`tsc`, 1.673 test/205 file, ESLint 0 lỗi và 1 cảnh báo React Compiler có sẵn); step 2 và các bước commit/push/deploy, kiểm tra UI/API sau deploy còn mở theo ràng buộc “không commit/push khi user chưa bảo”. Các checkbox chi tiết phía dưới là bản kế hoạch gốc, không dùng làm trạng thái triển khai.

**Architecture:** Có 3 lớp sửa.
1. **TypeScript thuần** (task 3–9): kiểm quyền sớm hơn, luật uỷ quyền mới viết dạng pure function có test, lọc role đã tắt, xoá cache.
2. **SQL RPC trong transaction** (task 10–13): mỗi thao tác nhiều bước (sửa account + role, tạo role + quyền, tạo account Google + role, finalize sync) chạy trong **một** hàm Postgres, nên lỗi ở bước sau cuộn lại cả bước trước. **Không có database test** (Q3): SQL được kiểm bằng guard md5, file rollback chuẩn bị trước, truy vấn chỉ đọc sau khi chạy, và kịch bản thủ công trên account / role test (task 2).
3. **Nhóm CS** (task 1): manager được làm CS lại, trừ role Admin. Lỗi này **đang có hiệu lực trên production**.

**Tech Stack:** Next.js 16 (App Router, `src/proxy.ts`), next-auth 5.0.0-beta.31, Supabase (Postgres 17, PostgREST, CLI v2.120), vitest 2.

**Đọc trước:**
- `docs/2026-10-12-review-db-optimize-role-manager.md` (review của Claude, 12 mục)
- `docs/2026-10-12-db-optimize-role-manager-review.md` (review của Codex, 9 mục)

## Global Constraints

- **Không commit / push** khi user chưa bảo.
- File `supabase/rollouts/*.sql` (gồm cả file `.rollback.sql`) **giữ local, không commit**.
- Chạy SQL lên production: `supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw -f <file> -o json`. **Tránh 02:00 UTC** (giờ cron sync). Làm theo đúng quy trình ở task 2.
- Mọi thay đổi logic đều thêm entry vào `changelog.md` (mới nhất ở trên). Mỗi task có bước changelog riêng. Tạo entry chung `## 2026-10-13 — Sửa lỗi sau review DB optimize + Role Manager` ở lần ghi đầu tiên, các task sau thêm bullet vào entry đó.
- `AGENTS.md`: bản Next.js này có thay đổi phá vỡ tương thích. Nếu không chắc về API của route thì đọc `node_modules/next/dist/docs/`.
- Lệnh kiểm tra: `npx vitest run <file>`, `npx tsc --noEmit -p tsconfig.json`, `npx eslint <files>`.
- Luật của đợt RBAC 2026-10-09 (`src/lib/rbac/no-role-name-authz.test.ts`): quyền chỉ theo ô tick. Tên role "Admin" chỉ dùng trong các file thuộc allow-list. Test này phải luôn xanh.
- UI hiện tên người, không hiện email thô (`personLabel` / `formatEmailAsName` trong `src/lib/tasks/people.ts`).

## Quyết định đã chốt (2026-10-12)

| # | Câu hỏi | Trả lời |
|---|---|---|
| Q1 | Nhóm CS | **A**: manager vẫn làm CS, role Admin thì không. Dữ liệu 60 ngày: 4/5 người "Admin Health Task" được giao 75 task, có 11 task đang mở, 3.206 thao tác. Admin có 0 task đang mở. |
| Q2 | Chặn tự sửa + áp trần uỷ quyền cho cả Agent lẫn Assistant | Có |
| Q3 | Dựng Postgres local để test SQL | **Không.** Dùng quy trình ở task 2. |
| Q4 | Tự gán role mặc định cho account Google không có role | Không |
| Q5 | Role mặc định | Chỉ đổi lời nhắn |
| Q6 | Deploy 2 đợt | Có. Đợt 1 = task 1–9, đợt 2 = task 10–13. |
| Q7 | Sync hỏng không resume được nữa khi có sync mới của cùng tab chạy quá 10 phút | Chấp nhận |

## Đối chiếu 2 bản review

Đã kiểm tra lại trên code và trên production (chỉ đọc), ngày 2026-10-12.

| Mục | Kết luận | Mức | Task |
|---|---|---|---|
| Codex 1: role đã tắt vẫn có trong ô chọn người nhận Task/Lead | Đúng. Lỗi có từ trước. Production hiện không có role nào đang tắt. | TB | 5 |
| Codex 2: 2 thao tác cùng lúc làm mất Admin cuối | Đúng (kiểm rồi mới ghi, không khoá). Khó xảy ra: chỉ có 3 Admin. | TB | 10 |
| Codex 3: sửa account/role ghi một nửa | Đúng. Đổi role + tắt Agent đang giữ Personal lead trong cùng 1 lần lưu → API trả 409 nhưng role **đã đổi**. | Cao | 10, 11 |
| Codex 4: đăng nhập Google tạo account không có role | Đúng, nhưng fail-closed (không có quyền gì). | TB | 12 |
| Codex 5: sync cũ ghi đè sync mới | Đúng. Lỗi có từ trước. | TB–Cao | 13 |
| Codex 6: rollout RBAC không chạy lại được | Đúng. File đã chạy rồi, chỉ cần sửa ghi chú. | Thấp | 9 |
| Codex 7: staging vẫn tăng nếu sync hỏng liên tục | Đúng. | TB | 13 |
| Codex 8: `PATCH {}` vào role trả dữ liệu quản trị | **Đúng, đang có trên production.** Lỗi có từ trước. | Cao | 3 |
| Codex 9: không đổi được role mặc định | Đúng (trùng mục 8 của Claude). | Thấp | 8 |
| Claude 1: bật lại role không qua trần uỷ quyền | Đúng | Cao | 3 |
| Claude 2: Account Manager tự gán mình làm Assistant | Đúng | Cao | 4 |
| Claude 3: manager rời nhóm CS | **Đang có hiệu lực trên production** | Cao | 1 |
| Claude 4, 5: bước dọn sync (resume không dọn; xoá nhầm run đang chạy) | Đúng | TB | 13 |
| Claude 6: thiếu `VAPID_SUBJECT` thì push tắt hẳn | Đúng | TB | 6 |
| Claude 7: cache quyền không bị xoá khi admin sửa | Đúng | TB | 7 |
| Claude 9: route account dư lượt gọi DB | Đúng | Thấp | 10 |
| Claude 10: truy vấn "ai có task.manage" viết 2 lần | Đúng | Thấp | 5 |
| Claude 11, 12: comment sai luật | Đúng | Thấp | 9 |

---

## File Structure

**Tạo mới**
- `supabase/rollouts/2026-10-13-cs-pool-managers.sql` + `.rollback.sql`
- `supabase/rollouts/2026-10-13-account-atomic.sql`
- `supabase/rollouts/2026-10-13-role-atomic.sql`
- `supabase/rollouts/2026-10-13-google-signin-atomic.sql`
- `supabase/rollouts/2026-10-13-sheet-sync-supersede-retention.sql` + `.rollback.sql`
- `src/lib/admin/account-write-errors.ts` (+ `.test.ts`): đổi lỗi từ RPC account thành HTTP status và lời nhắn.
- `src/lib/rbac/permission-holders.test.ts`

**Sửa**
- `src/lib/tasks/overview-data.ts`, `src/lib/tasks/overview.ts`, `src/lib/rbac/admin-role.ts` (nhóm CS)
- `src/lib/rbac/delegation.ts` (+test): thêm `rolePatchGrant`, `checkMembershipChange`
- `src/lib/rbac/permission-holders.ts`: thêm `fetchActiveRoleIdsWithAnyPermission`
- `src/lib/rbac/role-management.ts`: thêm `fetchUserPermissionKeysByEmail`; bỏ các hàm không còn dùng
- `src/lib/rbac/access.ts`: bỏ `assignDefaultRoleToUser`
- `src/lib/admin/account-manager-access.ts`: `loadAccountManager` trả thêm `permissions`
- `src/app/api/admin/roles/[id]/route.ts`, `src/app/api/admin/roles/route.ts`, `src/app/api/admin/users/[id]/route.ts`, `src/app/api/config/agents/route.ts`, `src/app/api/config/assistants/route.ts`
- `src/lib/tasks/assignees.ts`, `src/lib/leads/assignees.ts`, `src/lib/tasks/membership.ts`
- `src/auth.ts`, `src/lib/notifications/push-server.ts`
- `datasync/lib/sync-runner.js` (+test), `datasync/lib/supabase.js`, `datasync/README.md`, `datasync/schema.sql`, `supabase/schema.sql`
- Chỉ sửa comment: `src/lib/table-config/scope-access.ts`, `src/lib/table-config/access.ts`, `src/app/(authed)/config/page.tsx`, `src/lib/table-config/scope-access.test.ts`, `supabase/rollouts/2026-10-09-rbac-cleanup.sql`

---

## Task 1: Nhóm CS gồm cả manager, trừ role Admin (GẤP — đợt 1)

**Bối cảnh.** Bước 3 của `supabase/rollouts/2026-10-09-rbac-cleanup.sql` (đã chạy production 2026-10-10 01:42 UTC) xoá `task.work` khỏi **mọi** role có `task.manage`, kể cả "Admin Health Task". Trong khi đó "nhóm CS" chỉ tính người có đúng `task.work`:
- `src/lib/tasks/overview-data.ts:110` — `row.permission_key === "task.work"` (bảng CS trên Overview, thứ tự hàng chờ).
- Hàm SQL `assign_unassigned_task` (`supabase/schema.sql:3699–3845`, khớp production theo md5 `b7f180d91601989a1c0c1f59c80d971b`) — ném `INVALID_CS` khi người nhận không có `task.work`.

Role Manager không cho một role giữ cả hai quyền (`normalizeExclusivePermissionKeys`, `src/lib/rbac/permissions.ts:50`).

**Dữ liệu production (60 ngày, đo 2026-10-12):**
- "Admin Health Task": 5 người. 4 người được giao 75 task, 11 task đang mở, 3.206 thao tác. Đây là manager có làm task.
- Admin: 3 người, 0 task đang mở.
- Linh Le: 1 người, 0 thao tác. Sub Admin: 0 người.

Task được giao chủ yếu qua sửa task (`patch`, 511 lần) và lúc tạo (`create`, 20 lần). Hai đường này dùng ô chọn người nhận, vốn có tính `task.manage`, nên **vẫn chạy**. Thứ bị hỏng là bảng CS trên Overview (người "Admin Health Task" biến mất khỏi bảng khối lượng việc và hàng chờ) và nút chia task trên Overview.

Bảng CS vẫn loại Agent và Assistant như trước: `aggregateOverview` (`src/lib/tasks/overview.ts:468-474`) lọc `!account.isAssistant && !input.taskAgents.includes(account.email)`, và `assign_unassigned_task` loại `task_agents` cùng `agent_members.is_assistant`. Hai luật này không đổi.

Vì vậy, sau khi sửa (số liệu production 2026-10-12):
- Linh Le là Agent nên không hiện.
- Cả 3 Admin đều là Agent nên không hiện. Luật loại Admin vẫn giữ, phòng khi sau này có Admin không phải Agent.
- Trong 5 người "Admin Health Task" có 1 Agent và 1 Assistant, nên **3 người quay lại bảng CS**.

**Files:**
- Modify: `src/lib/tasks/overview-data.ts`, `src/lib/tasks/overview.ts`, `src/lib/rbac/admin-role.ts`
- Create: `supabase/rollouts/2026-10-13-cs-pool-managers.rollback.sql`, `supabase/rollouts/2026-10-13-cs-pool-managers.sql`
- Modify: `supabase/schema.sql:3699-3845`

- [ ] **Step 1: Tạo file rollback TRƯỚC khi sửa `supabase/schema.sql`.** Bản trong working tree đang khớp production.

```bash
cd agent-portal
{ echo "-- Rollback for 2026-10-13-cs-pool-managers.sql: the live assign_unassigned_task before it (md5 b7f180d91601989a1c0c1f59c80d971b)."; sed -n '3699,3845p' supabase/schema.sql; } > supabase/rollouts/2026-10-13-cs-pool-managers.rollback.sql
head -2 supabase/rollouts/2026-10-13-cs-pool-managers.rollback.sql
tail -1 supabase/rollouts/2026-10-13-cs-pool-managers.rollback.sql
```

Expected: dòng 2 là `create or replace function assign_unassigned_task(`, dòng cuối là `$$;`.

- [ ] **Step 2: Bảng CS ở Overview.** Trong `src/lib/tasks/overview-data.ts`, thay:

```ts
  const workRoleIds = new Set(
    rolePermissions
      .filter(
        (row) => row.permission_key === "task.work" && activeRoleIds.has(row.role_id)
      )
      .map((row) => row.role_id)
  );
```

bằng:

```ts
  // CS pool: anyone whose active role can work tasks — task.work, or
  // task.manage, which includes it (managers such as "Admin Health Task" also
  // work tasks; decided 2026-10-12). The fixed Admin role stays out through
  // canWork below.
  const workRoleIds = new Set(
    rolePermissions
      .filter(
        (row) =>
          (row.permission_key === "task.work" || row.permission_key === "task.manage") &&
          activeRoleIds.has(row.role_id)
      )
      .map((row) => row.role_id)
  );
```

Thay comment:

```ts
    // Label only: the fixed Admin role. The CS pool no longer looks at this —
    // it follows task.work (see aggregateOverview).
```

bằng:

```ts
    // The fixed Admin role: its label, and kept out of the CS pool (canWork).
```

Thay `      canWork: workUserIds.has(account.id),` bằng `      canWork: workUserIds.has(account.id) && !isAdmin,`.

- [ ] **Step 3: Comment trong `src/lib/tasks/overview.ts`.** Thay:

```ts
  // The CS pool is whoever holds task.work (canWork). Managers are not in it
  // because task.manage includes task.work and a role never stores both — not
  // because of a role name; isAdmin is a label only (2026-10-09).
```

bằng:

```ts
  // The CS pool is canWork: task.work or task.manage (which includes it),
  // minus the fixed Admin role — decided in overview-data.ts (2026-10-12).
```

- [ ] **Step 4: Tài liệu luật tên Admin.** Trong `src/lib/rbac/admin-role.ts`, thay 2 dòng:

```ts
 * role for three things: it is locked (view-only in Role Manager), it shows
 * the "Admin" label, and at least one active account must hold it.
```

bằng:

```ts
 * role for four things: it is locked (view-only in Role Manager), it shows
 * the "Admin" label, at least one active account must hold it, and its
 * holders are left out of the CS assignment pool.
```

- [ ] **Step 5: Viết rollout** `supabase/rollouts/2026-10-13-cs-pool-managers.sql`. File gồm 3 phần theo thứ tự:

  1. Header và guard:

```sql
-- Nhóm CS gồm cả manager (task.manage), trừ role Admin cố định (2026-10-12).
-- Rollout RBAC 2026-10-09 bỏ task.work khỏi mọi role có task.manage, nên
-- "Admin Health Task" (manager có làm task) bị assign_unassigned_task từ chối.
-- Rollback: 2026-10-13-cs-pool-managers.rollback.sql.
do $guard$
declare live_md5 text;
begin
  select md5(p.prosrc) into live_md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'assign_unassigned_task';
  if live_md5 is distinct from 'b7f180d91601989a1c0c1f59c80d971b' then
    raise exception 'ROLLOUT_ABORTED: live assign_unassigned_task differs from supabase/schema.sql (md5 %)', live_md5;
  end if;
end $guard$;
```

  2. Chép **nguyên văn** `supabase/schema.sql` dòng 3699–3845. Đây chính là nội dung file rollback, bỏ dòng comment đầu.

  3. Trong bản vừa chép, đổi **đúng một khối**:

```sql
        where ur.user_id = account.id
          and rp.permission_key = 'task.work'
          and r.is_active
```

  thành:

```sql
        where ur.user_id = account.id
          and rp.permission_key in ('task.work', 'task.manage')
          and r.is_active
          and lower(btrim(r.name)) <> 'admin'
```

- [ ] **Step 6: Đổi y hệt khối đó trong `supabase/schema.sql`.** Cả file chỉ có một chỗ khớp. Kiểm bằng `grep -c "rp.permission_key = 'task.work'" supabase/schema.sql`: trước khi đổi là 1, sau khi đổi là 0.

- [ ] **Step 7: Kiểm tra code**

```bash
npx vitest run src/lib/tasks/overview.test.ts src/lib/rbac/no-role-name-authz.test.ts
npx tsc --noEmit -p tsconfig.json
npx eslint src/lib/tasks/overview-data.ts src/lib/tasks/overview.ts src/lib/rbac/admin-role.ts
```

Expected: PASS, không lỗi.

- [ ] **Step 8: Chạy rollout** theo quy trình ở task 2, càng sớm càng tốt (trước giờ làm việc ở US). Sau đó xác minh:

```bash
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw "select prosrc like '%''task.manage''%' as has_manage, prosrc like '%<> ''admin''%' as excludes_admin from pg_proc where proname = 'assign_unassigned_task'" -o json
```

Expected: cả hai `true`. Phần Overview chỉ thay đổi sau khi deploy code đợt 1.

- [ ] **Step 9: Changelog** (tạo entry `## 2026-10-13 — Sửa lỗi sau review DB optimize + Role Manager` ở đầu `changelog.md`):

```markdown
- **Nhóm CS gồm cả manager, trừ Admin:** rollout RBAC 2026-10-09 bỏ `task.work`
  khỏi mọi role có `task.manage`, nên manager có làm task ("Admin Health Task" —
  4/5 người được giao 75 task trong 60 ngày) rời bảng CS ở Overview và bị
  `assign_unassigned_task` từ chối. Giờ nhóm CS = role có `task.work` HOẶC
  `task.manage`, trừ role Admin cố định (`overview-data.ts` + SQL).
  **SQL rollout (đã / cần chạy):** `supabase/rollouts/2026-10-13-cs-pool-managers.sql`.
```

- [ ] **Step 10: Commit** (chỉ khi user bảo): `git add src/lib/tasks/overview-data.ts src/lib/tasks/overview.ts src/lib/rbac/admin-role.ts supabase/schema.sql changelog.md && git commit -m "fix(tasks): managers stay in the CS pool, Admin stays out"`

---

## Task 2: Quy trình chạy SQL lên production khi không có database test

Q3 = không dựng database test. Mỗi file rollout ở task 1, 10, 11, 12, 13 chạy theo đúng quy trình này. Task này không sửa code.

- [ ] **Step 1: Đọc lại file SQL trước khi chạy.** Kiểm theo checklist:
  - Mọi hàm `security definer` có `set search_path = public, pg_temp`.
  - Có `revoke … from public, anon, authenticated` và `grant execute … to service_role`.
  - Không có `drop` hay `delete` ngoài những gì task mô tả.
  - Tên hàm và tham số khớp đúng với chỗ code gọi (`supabase.rpc("<tên>", { p_… })`).

  Có thể nhờ Claude hoặc Codex đọc thêm một lượt.

- [ ] **Step 2: Rollout nào THAY một hàm đang chạy** (task 1, task 13) **phải có file `.rollback.sql`** chứa bản hiện tại, tạo trước khi sửa file schema, và có **guard md5**: dừng nếu hàm trên production khác bản trong repo. Rollout chỉ THÊM hàm mới (task 10, 11, 12) thì không cần rollback. Muốn gỡ thì `drop function` đúng các hàm đó.

- [ ] **Step 3: Chạy ngoài khung 02:00 UTC** (cron sync), bằng:

```bash
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw -f supabase/rollouts/<file>.sql -o json
```

  Nếu kết quả có `"rows"` là chạy xong. Nếu có `ROLLOUT_ABORTED` thì **dừng**: production đã khác repo, phải so lại trước khi làm tiếp.

- [ ] **Step 4: Xác minh bằng câu truy vấn chỉ đọc** ghi trong từng task.

- [ ] **Step 5: Kịch bản thủ công trên account / role TEST** (không đụng account thật). Ở Account Manager, tạo account test (email giả, ví dụ `rbac-test-2026-10-13@<domain công ty>`, role "Task CS"). Ở Role Manager, tạo role test tên "RBAC Test". Xong thì xoá cả hai. Chi tiết từng kịch bản nằm trong task 10, 11, 14.

- [ ] **Step 6: Nếu có sự cố** sau khi chạy rollout thay hàm, chạy file `.rollback.sql` tương ứng ngay, rồi xác minh lại như step 4.

---

## Task 3: Role PATCH — kiểm quyền trước, bật lại role phải qua trần uỷ quyền (đợt 1)

Sửa Codex 8 và Claude 1.
- `PATCH /api/admin/roles/[id]` chỉ kiểm `management.role_manager` bên trong từng nhánh field. Một request `{}` không vào nhánh nào mà vẫn trả `fetchRolesWithPermissions()`. Lỗi này **đang có trên production**: mọi user đã đăng nhập đều đọc được role, quyền và số lượng thành viên.
- Nhánh `is_active: true` không chạy `checkRolePermissionChange`, nên người bật lại role có thể trả lại cho nó những quyền mà chính họ không có.

**Files:**
- Modify: `src/lib/rbac/delegation.ts`
- Test: `src/lib/rbac/delegation.test.ts`
- Modify: `src/app/api/admin/roles/[id]/route.ts` (hàm `PATCH`)

**Interfaces:**
- Produces: `rolePatchGrant(input: { roleIsActive: boolean; nextIsActive: boolean | undefined; liveKeys: readonly string[]; permissionKeys: readonly string[] | null }): { currentKeys: readonly string[]; nextKeys: readonly string[] } | null`

- [ ] **Step 1: Viết test fail.** Trong `src/lib/rbac/delegation.test.ts`, thêm `rolePatchGrant` vào import từ `"@/lib/rbac/delegation"`, rồi thêm vào cuối file:

```ts
describe("rolePatchGrant", () => {
  it("checks nothing when the PATCH grants no permission", () => {
    expect(
      rolePatchGrant({ roleIsActive: true, nextIsActive: undefined, liveKeys: ["task.manage"], permissionKeys: null })
    ).toBeNull();
    expect(
      rolePatchGrant({ roleIsActive: false, nextIsActive: false, liveKeys: ["task.manage"], permissionKeys: null })
    ).toBeNull();
  });

  it("treats turning a disabled role back on as granting all of its permissions", () => {
    const grant = rolePatchGrant({
      roleIsActive: false,
      nextIsActive: true,
      liveKeys: ["task.manage", "management.account_manager"],
      permissionKeys: null,
    });
    if (!grant) throw new Error("expected a grant to check");
    expect(grant).toEqual({ currentKeys: [], nextKeys: ["task.manage", "management.account_manager"] });
    expect(checkRolePermissionChange({ actorPermissions: ROLE_MANAGER, ...grant }).ok).toBe(false);
  });

  it("keeps removing permissions allowed on an active role", () => {
    const grant = rolePatchGrant({
      roleIsActive: true,
      nextIsActive: undefined,
      liveKeys: ["task.manage", "lead.manage"],
      permissionKeys: ["task.manage"],
    });
    if (!grant) throw new Error("expected a grant to check");
    expect(checkRolePermissionChange({ actorPermissions: ROLE_MANAGER, ...grant })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Chạy, phải FAIL:** `npx vitest run src/lib/rbac/delegation.test.ts`. Expected: FAIL vì `rolePatchGrant` chưa được export.

- [ ] **Step 3: Viết hàm.** Thêm vào cuối `src/lib/rbac/delegation.ts`:

```ts
/**
 * What a Role Manager PATCH grants, as inputs for checkRolePermissionChange, or
 * null when it grants nothing. Turning a disabled role back on grants every
 * permission it stores, so it is checked as a grant from nothing. Only then is
 * the current set empty — removing permissions stays allowed.
 */
export function rolePatchGrant(input: {
  roleIsActive: boolean;
  nextIsActive: boolean | undefined;
  liveKeys: readonly string[];
  permissionKeys: readonly string[] | null;
}): { currentKeys: readonly string[]; nextKeys: readonly string[] } | null {
  const reactivating = input.nextIsActive === true && !input.roleIsActive;
  if (!input.permissionKeys && !reactivating) return null;
  return {
    currentKeys: reactivating ? [] : input.liveKeys,
    nextKeys: input.permissionKeys ?? input.liveKeys,
  };
}
```

- [ ] **Step 4: Chạy, phải PASS:** `npx vitest run src/lib/rbac/delegation.test.ts`.

- [ ] **Step 5: Viết lại `PATCH`.** Trong `src/app/api/admin/roles/[id]/route.ts`:
  - Đổi import thành `import { checkRolePermissionChange, rolePatchGrant } from "@/lib/rbac/delegation";`.
  - Thay **toàn bộ** hàm `export async function PATCH(...) { … }` (từ dòng `export async function PATCH` tới ngay trước `export async function DELETE`) bằng:

```ts
export async function PATCH(req: Request, context: RouteContext) {
  const session = await auth();

  // Every field here is Role Manager work: check once, before reading the body
  // or the database. An empty PATCH used to skip every per-field check and
  // still return the full role list.
  if (!can(session?.user?.permissions, PERMISSIONS.ROLE_MANAGER)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const payload = (await req.json()) as RolePatchPayload;
    const permissionKeys = parsePermissionKeys(payload.permissionKeys);
    const patch: { name?: string; description?: string | null; is_active?: boolean } = {};

    if (payload.name !== undefined) {
      const nextName = typeof payload.name === "string" ? payload.name.trim() : "";
      if (!nextName) {
        return NextResponse.json({ error: "Role name is required." }, { status: 400 });
      }
      patch.name = nextName;
    }

    if (payload.description !== undefined) {
      patch.description =
        typeof payload.description === "string" && payload.description.trim()
          ? payload.description.trim()
          : null;
    }

    if (payload.is_active !== undefined) {
      if (typeof payload.is_active !== "boolean") {
        return NextResponse.json({ error: "Invalid role status." }, { status: 400 });
      }
      patch.is_active = payload.is_active;
    }

    if (Object.keys(patch).length === 0 && permissionKeys === null) {
      return NextResponse.json({ error: "No role changes provided." }, { status: 400 });
    }

    const role = await fetchRoleById(id);
    if (isProtectedRole(role)) {
      return NextResponse.json({ error: "Admin cannot be edited." }, { status: 400 });
    }

    if (patch.name !== undefined && isAdminRoleName(patch.name)) {
      return NextResponse.json({ error: "Admin is a reserved role name." }, { status: 400 });
    }

    if (patch.is_active === false && role.is_default) {
      return NextResponse.json({ error: "Choose another default role first." }, { status: 400 });
    }

    const grant = rolePatchGrant({
      roleIsActive: role.is_active,
      nextIsActive: patch.is_active,
      liveKeys: await fetchRolePermissionKeys(id),
      permissionKeys,
    });
    if (grant) {
      const delegation = checkRolePermissionChange({
        actorPermissions: session?.user?.permissions ?? [],
        ...grant,
      });
      if (!delegation.ok) {
        return NextResponse.json({ error: delegation.error }, { status: delegation.status });
      }
    }

    if (Object.keys(patch).length > 0) {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase
        .from("roles")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    if (permissionKeys) {
      await replaceRolePermissions(id, permissionKeys);
    }

    const roles = await fetchRolesWithPermissions();
    return NextResponse.json({
      role: roles.find((item) => item.id === id),
      roles,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to update role." },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 6: Kiểm tra**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run src/lib/rbac
npx eslint 'src/app/api/admin/roles/[id]/route.ts' src/lib/rbac/delegation.ts src/lib/rbac/delegation.test.ts
```

Expected: không lỗi. Kiểm thủ công trên `npm run dev`: đăng nhập bằng account không có Role Manager, chạy `fetch('/api/admin/roles/<id>', {method:'PATCH', body:'{}'}).then(r => r.status)` trong console trình duyệt. Expected: `401`.

- [ ] **Step 7: Changelog:**

```markdown
- **Role Manager PATCH:** kiểm `management.role_manager` một lần ở đầu. Trước đó
  `PATCH {}` (có trên production) trả danh sách role / quyền / số lượng thành viên cho mọi
  người đã đăng nhập. Body rỗng giờ trả 400.
- **Bật lại role đã tắt phải qua trần uỷ quyền** (`rolePatchGrant`): coi như cấp
  mới mọi quyền của role, nên người bật phải giữ đủ các quyền đó.
```

- [ ] **Step 8: Commit** (chỉ khi user bảo): `git commit -m "fix(rbac): check Role Manager first and gate role reactivation by delegation"`

---

## Task 4: Agent/Assistant — không tự sửa, áp trần uỷ quyền (đợt 1)

Sửa Claude 2. `/api/config/assistants` và `/api/config/agents` chỉ cần `management.account_manager`. Membership lại quyết định ai xem được task/lead của ai, nên Account Manager có thể tự gán mình làm Assistant của mọi Agent để xem lead của họ, hoặc tự gỡ mình khỏi Assistant để từ phạm vi hẹp thành thấy toàn bộ task.

**Files:**
- Modify: `src/lib/rbac/delegation.ts` + `src/lib/rbac/delegation.test.ts`
- Modify: `src/lib/rbac/role-management.ts`
- Modify: `src/lib/admin/account-manager-access.ts`
- Modify: `src/app/api/config/assistants/route.ts` (POST, DELETE), `src/app/api/config/agents/route.ts` (POST, DELETE)

**Interfaces:**
- Produces: `checkMembershipChange(input: { actorPermissions: readonly string[]; isSelf: boolean; targetPermissionKeys: readonly string[] }): DelegationResult`
- Produces: `fetchUserPermissionKeysByEmail(email: string): Promise<string[]>`
- Produces: `loadAccountManager()` → `{ ok: true; email: string; permissions: string[] } | { ok: false; … }`

- [ ] **Step 1: Viết test fail.** Thêm `checkMembershipChange` vào import của `src/lib/rbac/delegation.test.ts`, rồi thêm:

```ts
describe("checkMembershipChange", () => {
  it("refuses changing your own Agent or Assistant membership", () => {
    expect(
      checkMembershipChange({ actorPermissions: EVERYTHING, isSelf: true, targetPermissionKeys: [] })
    ).toEqual({ ok: false, status: 400, error: "You cannot change your own Agent or Assistant membership." });
  });

  it("refuses an account holding permissions you do not have", () => {
    expect(
      checkMembershipChange({
        actorPermissions: ACCOUNT_MANAGER,
        isSelf: false,
        targetPermissionKeys: ["management.role_manager"],
      }).ok
    ).toBe(false);
  });

  it("allows an account whose permissions fit inside yours", () => {
    expect(
      checkMembershipChange({ actorPermissions: ACCOUNT_MANAGER, isSelf: false, targetPermissionKeys: ["task.work"] })
    ).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Chạy, phải FAIL:** `npx vitest run src/lib/rbac/delegation.test.ts`.

- [ ] **Step 3: Viết hàm.** Thêm vào cuối `src/lib/rbac/delegation.ts`:

```ts
/**
 * Account Manager on Agent / Assistant membership (task_agents, agent_members).
 * Membership decides whose tasks and leads someone sees, so nobody changes
 * their own, and you may only change it for an account inside your ceiling —
 * the same rule as editing that account.
 */
export function checkMembershipChange(input: {
  actorPermissions: readonly string[];
  isSelf: boolean;
  targetPermissionKeys: readonly string[];
}): DelegationResult {
  if (input.isSelf) {
    return { ok: false, status: 400, error: "You cannot change your own Agent or Assistant membership." };
  }
  return checkAccountChange({
    actorPermissions: input.actorPermissions,
    isSelf: false,
    targetPermissionKeys: input.targetPermissionKeys,
  });
}
```

- [ ] **Step 4: Chạy, phải PASS:** `npx vitest run src/lib/rbac/delegation.test.ts`.

- [ ] **Step 5: Lấy quyền theo email.** Trong `src/lib/rbac/role-management.ts`, ngay sau `fetchUserPermissionKeys`, thêm:

```ts
/** Permission keys of the account with this email, through its active roles; [] if no such account. */
export async function fetchUserPermissionKeysByEmail(email: string): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("portal_account")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return [];
  return fetchUserPermissionKeys((data as { id: string }).id);
}
```

- [ ] **Step 6: `loadAccountManager` trả thêm quyền.** Trong `src/lib/admin/account-manager-access.ts`:
  - Thay `  | { ok: true; email: string }` bằng `  | { ok: true; email: string; permissions: string[] }`.
  - Thay `  return { ok: true, email };` bằng `  return { ok: true, email, permissions: session.user.permissions ?? [] };`.

- [ ] **Step 7: `src/app/api/config/assistants/route.ts`.** Thêm import:

```ts
import { checkMembershipChange } from "@/lib/rbac/delegation";
import { fetchUserPermissionKeysByEmail } from "@/lib/rbac/role-management";
```

Trong **cả `POST` và `DELETE`**, ngay sau khối trả `"agent_email and cs_email are required."`, chèn:

```ts
  const membership = checkMembershipChange({
    actorPermissions: admin.permissions,
    isSelf: cs_email === admin.email.trim().toLowerCase(),
    targetPermissionKeys: await fetchUserPermissionKeysByEmail(cs_email),
  });
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }
```

- [ ] **Step 8: `src/app/api/config/agents/route.ts`.** Thêm đúng 2 import như step 7. Trong **cả `POST` và `DELETE`**, ngay sau dòng `if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });`, chèn:

```ts
  const membership = checkMembershipChange({
    actorPermissions: admin.permissions,
    isSelf: email === admin.email.trim().toLowerCase(),
    targetPermissionKeys: await fetchUserPermissionKeysByEmail(email),
  });
  if (!membership.ok) {
    return NextResponse.json({ error: membership.error }, { status: membership.status });
  }
```

- [ ] **Step 9: Kiểm tra**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run src/lib/rbac src/lib/tasks/membership.test.ts
npx eslint src/app/api/config/agents/route.ts src/app/api/config/assistants/route.ts src/lib/rbac/delegation.ts src/lib/rbac/role-management.ts src/lib/admin/account-manager-access.ts
```

Kiểm thủ công: ở Account Manager, thêm chính mình làm Assistant. Expected: báo lỗi "You cannot change your own Agent or Assistant membership.".

- [ ] **Step 10: Changelog:**

```markdown
- **Agent / Assistant:** `/api/config/agents` và `/api/config/assistants` chặn tự
  thêm/gỡ chính mình và chỉ cho đổi membership của account nằm trong trần uỷ
  quyền (`checkMembershipChange`). Trước đó Account Manager tự gán mình làm
  Assistant của mọi Agent để xem lead của họ được.
```

- [ ] **Step 11: Commit** (chỉ khi user bảo).

---

## Task 5: Role đã tắt không còn trong ô chọn người nhận; gộp truy vấn người giữ quyền (đợt 1)

Sửa Codex 1 và Claude 10.
- `fetchTaskAssignees` (`src/lib/tasks/assignees.ts`) và `fetchLeadAssignees` (`src/lib/leads/assignees.ts`) không lọc `roles.is_active`.
- `fetchTaskManagerEmails` (`src/lib/tasks/membership.ts`) là bản chép lại của `fetchEmailsWithPermission`.

**Files:**
- Modify: `src/lib/rbac/permission-holders.ts`
- Create: `src/lib/rbac/permission-holders.test.ts`
- Modify: `src/lib/tasks/assignees.ts`, `src/lib/leads/assignees.ts`, `src/lib/tasks/membership.ts`

**Interfaces:**
- Produces: `fetchActiveRoleIdsWithAnyPermission(permissionKeys: readonly string[]): Promise<string[]>`

- [ ] **Step 1: Viết test fail** `src/lib/rbac/permission-holders.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

// In-memory stand-in for the few PostgREST builder calls these helpers make.
function fakeSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        select: () => builder,
        in: (column: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[column]));
          return builder;
        },
        eq: (column: string, value: unknown) => {
          rows = rows.filter((row) => row[column] === value);
          return builder;
        },
        then: (resolve: (result: { data: Row[]; error: null }) => void) =>
          resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
}

const TABLES: Record<string, Row[]> = {
  role_permissions: [
    { role_id: "r-on", permission_key: "lead.work" },
    { role_id: "r-off", permission_key: "lead.work" },
    { role_id: "r-mgr", permission_key: "lead.manage" },
  ],
  roles: [
    { id: "r-on", is_active: true },
    { id: "r-off", is_active: false },
    { id: "r-mgr", is_active: true },
  ],
  user_roles: [
    { user_id: "u-on", role_id: "r-on" },
    { user_id: "u-off", role_id: "r-off" },
    { user_id: "u-mgr", role_id: "r-mgr" },
  ],
  portal_account: [
    { id: "u-on", email: "On@Example.com", is_active: true },
    { id: "u-off", email: "off@example.com", is_active: true },
    { id: "u-mgr", email: "mgr@example.com", is_active: true },
  ],
};

async function load() {
  vi.resetModules();
  vi.doMock("@/lib/supabase", () => ({ getSupabaseAdmin: () => fakeSupabase(TABLES) }));
  return import("@/lib/rbac/permission-holders");
}

describe("permission holders skip disabled roles", () => {
  it("returns only active roles that grant any of the keys", async () => {
    const mod = await load();
    const ids = await mod.fetchActiveRoleIdsWithAnyPermission(["lead.work", "lead.manage"]);
    expect([...ids].sort()).toEqual(["r-mgr", "r-on"]);
  });

  it("leaves members of a disabled role out of the email list", async () => {
    const mod = await load();
    expect(await mod.fetchEmailsWithPermission("lead.work")).toEqual(["on@example.com"]);
  });
});
```

- [ ] **Step 2: Chạy, phải FAIL:** `npx vitest run src/lib/rbac/permission-holders.test.ts`. Expected: test đầu FAIL vì hàm chưa được export. Test thứ hai có thể đã PASS vì hàm cũ vốn lọc role tắt.

- [ ] **Step 3: Viết helper.** Trong `src/lib/rbac/permission-holders.ts`:
  - Xoá 3 dòng comment bắt đầu bằng ``* `lib/tasks/membership.ts` có `fetchTaskManagerEmails()` `` và kết thúc ở `không phải việc của đợt này.`.
  - Thêm hàm này phía trên `fetchEmailsWithPermission`:

```ts
/**
 * Roles that are active and grant any of these permissions. A disabled role
 * grants nothing, so its members must not be offered as assignees or counted
 * as holders.
 */
export async function fetchActiveRoleIdsWithAnyPermission(
  permissionKeys: readonly string[]
): Promise<string[]> {
  const supabase = getSupabaseAdmin();

  const { data: permissionRows, error: permissionError } = await supabase
    .from("role_permissions")
    .select("role_id")
    .in("permission_key", [...permissionKeys]);
  if (permissionError) throw new Error(permissionError.message);

  const roleIds = [
    ...new Set((permissionRows ?? []).map((row) => (row as { role_id: string }).role_id)),
  ];
  if (roleIds.length === 0) return [];

  const { data: activeRoles, error: activeRoleError } = await supabase
    .from("roles")
    .select("id")
    .in("id", roleIds)
    .eq("is_active", true);
  if (activeRoleError) throw new Error(activeRoleError.message);

  return [...new Set((activeRoles ?? []).map((row) => (row as { id: string }).id))];
}
```

  - Trong `fetchEmailsWithPermission`, thay toàn bộ đoạn từ `  const supabase = getSupabaseAdmin();` tới hết khối `const activeRoleIds = [ … ]; if (activeRoleIds.length === 0) return [];` bằng:

```ts
  const supabase = getSupabaseAdmin();
  const activeRoleIds = await fetchActiveRoleIdsWithAnyPermission([permissionKey]);
  if (activeRoleIds.length === 0) return [];
```

- [ ] **Step 4: Chạy, phải PASS:** `npx vitest run src/lib/rbac/permission-holders.test.ts`.

- [ ] **Step 5: Task picker** (`src/lib/tasks/assignees.ts`, trong `fetchTaskAssignees`). Thay:

```ts
  const { data: rp, error: rpErr } = await supabase
    .from("role_permissions")
    .select("role_id")
    .in("permission_key", [PERMISSIONS.TASK_WORK, PERMISSIONS.TASK_MANAGE]);
  if (rpErr) throw new Error(rpErr.message);

  const roleIds = [...new Set((rp ?? []).map((r) => (r as { role_id: string }).role_id))];
  if (roleIds.length === 0) return [];
```

bằng:

```ts
  const roleIds = await fetchActiveRoleIdsWithAnyPermission([
    PERMISSIONS.TASK_WORK,
    PERMISSIONS.TASK_MANAGE,
  ]);
  if (roleIds.length === 0) return [];
```

Thêm `import { fetchActiveRoleIdsWithAnyPermission } from "@/lib/rbac/permission-holders";`. Đổi comment `// Active accounts whose role grants task.work or task.manage. Used by the` thành `// Active accounts whose ACTIVE role grants task.work or task.manage. Used by the`.

- [ ] **Step 6: Lead picker** (`src/lib/leads/assignees.ts`, trong `fetchLeadAssignees`). Thay:

```ts
  const { data: rolePermissions, error: rpError } = await supabase
    .from("role_permissions")
    .select("role_id")
    .in("permission_key", [PERMISSIONS.LEAD_WORK, PERMISSIONS.LEAD_MANAGE]);
  if (rpError) throw new Error(rpError.message);

  const roleIds = [
    ...new Set(
      (rolePermissions ?? []).map((row) => (row as { role_id: string }).role_id)
    ),
  ];
  if (roleIds.length === 0) return [];
```

bằng:

```ts
  const roleIds = await fetchActiveRoleIdsWithAnyPermission([
    PERMISSIONS.LEAD_WORK,
    PERMISSIONS.LEAD_MANAGE,
  ]);
  if (roleIds.length === 0) return [];
```

Thêm import tương tự. Trong comment đầu hàm, đổi `filtered to active accounts.` thành `filtered to active roles and active accounts.`.

- [ ] **Step 7: Bỏ bản chép.** Trong `src/lib/tasks/membership.ts`, thay toàn bộ thân `fetchTaskManagerEmails` (từ `export async function fetchTaskManagerEmails(): Promise<string[]> {` tới dấu `}` đóng hàm) bằng:

```ts
export async function fetchTaskManagerEmails(): Promise<string[]> {
  return fetchEmailsWithPermission(PERMISSIONS.TASK_MANAGE);
}
```

Thêm `import { fetchEmailsWithPermission } from "@/lib/rbac/permission-holders";`. Nếu tsc / eslint báo import nào không còn dùng thì xoá.

- [ ] **Step 8: Kiểm tra:** `npx tsc --noEmit -p tsconfig.json && npx vitest run && npx eslint src/lib/rbac/permission-holders.ts src/lib/rbac/permission-holders.test.ts src/lib/tasks/assignees.ts src/lib/leads/assignees.ts src/lib/tasks/membership.ts`. Expected: toàn bộ PASS.

- [ ] **Step 9: Changelog:**

```markdown
- **Ô chọn người nhận Task / Lead** (`fetchTaskAssignees`, `fetchLeadAssignees`,
  cả bước kiểm khi giao task) bỏ người thuộc role ĐÃ TẮT. Gộp truy vấn vào
  `fetchActiveRoleIdsWithAnyPermission`; `fetchTaskManagerEmails` dùng lại
  `fetchEmailsWithPermission`.
```

- [ ] **Step 10: Commit** (chỉ khi user bảo).

---

## Task 6: Thiếu `VAPID_SUBJECT` thì ghi cảnh báo (đợt 1)

Sửa Claude 6. `ensureVapid()` (`src/lib/notifications/push-server.ts`) trả `false` một cách im lặng. Kết quả được cache theo instance, nên cảnh báo chỉ in một lần.

**Files:** Modify `src/lib/notifications/push-server.ts`

- [ ] **Step 1:** Thay:

```ts
  if (!publicKey || !privateKey || !subject) {
    vapidConfigured = false;
    return false;
  }
```

bằng:

```ts
  if (!publicKey || !privateKey || !subject) {
    if (publicKey && privateKey) {
      // Keys are set, so push is meant to be on: say why it is not.
      console.warn("[push] VAPID_SUBJECT is not set — web push is disabled.");
    }
    vapidConfigured = false;
    return false;
  }
```

- [ ] **Step 2:** `npx tsc --noEmit -p tsconfig.json && npx eslint src/lib/notifications/push-server.ts`. Không có unit test cho một dòng log. Việc chính là bước kiểm Vercel ở task 14.

- [ ] **Step 3: Changelog:** `- **Push:** có khoá mà thiếu \`VAPID_SUBJECT\` thì log cảnh báo một lần, thay vì tắt im lặng.`

---

## Task 7: Xoá cache quyền khi admin sửa account / role (đợt 1)

Sửa Claude 7. Cache quyền 60 giây ở `src/auth.ts` chưa bao giờ bị xoá. Xoá **toàn bộ** cache khi có thao tác ghi của admin: thao tác này hiếm, và cách này không lo lệch chữ hoa / thường giữa email trong token và email trong database.

**Files:** Modify `src/auth.ts`, `src/app/api/admin/users/[id]/route.ts`, `src/app/api/admin/roles/[id]/route.ts`

**Interfaces:** Produces `invalidateRbacLookups(): void` (export từ `@/auth`)

- [ ] **Step 1:** Trong `src/auth.ts`, ngay sau khối `const rbacLookup = createSharedLookup(…);`, thêm:

```ts
/**
 * Forget cached access on this instance after an account or role write, so
 * the change applies here at once. Other instances catch up within
 * RBAC_LOOKUP_REUSE_MS.
 */
export function invalidateRbacLookups(): void {
  rbacLookup.invalidate();
}
```

- [ ] **Step 2: Gọi ở 4 chỗ ghi thành công.**
  - **`src/app/api/admin/users/[id]/route.ts`**: đổi `import { auth } from "@/auth";` thành `import { auth, invalidateRbacLookups } from "@/auth";`.
    - `PATCH`: thay `    return NextResponse.json({ user: data });` bằng 2 dòng: `    invalidateRbacLookups();` rồi `    return NextResponse.json({ user: data });`.
    - `DELETE`: thay `    return NextResponse.json({ success: true });` bằng 2 dòng: `    invalidateRbacLookups();` rồi `    return NextResponse.json({ success: true });`.
  - **`src/app/api/admin/roles/[id]/route.ts`**: đổi import tương tự.
    - `PATCH`: thay `    const roles = await fetchRolesWithPermissions();` bằng 2 dòng: `    invalidateRbacLookups();` rồi `    const roles = await fetchRolesWithPermissions();`.
    - `DELETE`: chèn `    invalidateRbacLookups();` ngay trước `    return NextResponse.json({ ok: true, roles: await fetchRolesWithPermissions() });`.

- [ ] **Step 3:** `npx tsc --noEmit -p tsconfig.json && npx vitest run src/lib/shared-lookup.test.ts src/lib/rbac`. Hành vi `invalidate()` đã có test trong `shared-lookup.test.ts`.

- [ ] **Step 4: Changelog:** `- **Cache quyền 60 giây:** sửa / xoá account hoặc role thì xoá cache trên instance đó ngay; instance khác vẫn tối đa 60 giây.`

---

## Task 8: Đổi lời nhắn khi chạm vào role mặc định (đợt 1)

Sửa Codex 9 và Claude 8 (Q5: chỉ đổi lời nhắn). Không có màn hình nào đổi `roles.is_default`.

**Files:** Modify `src/app/api/admin/roles/[id]/route.ts`

- [ ] **Step 1:** Thêm ngay dưới hàm `isProtectedRole`:

```ts
// No screen sets roles.is_default (new Google sign-ups get this role); it is
// changed by SQL only, so do not point users at a step they cannot take.
const DEFAULT_ROLE_LOCKED =
  "This is the role new Google sign-ups get, so it cannot be disabled or deleted. Ask an administrator to change the default role in the database.";
```

- [ ] **Step 2:** Thay cả 2 chỗ `{ error: "Choose another default role first." }` (trong `PATCH` và `DELETE`) bằng `{ error: DEFAULT_ROLE_LOCKED }`.

- [ ] **Step 3:** `npx tsc --noEmit -p tsconfig.json && npx eslint 'src/app/api/admin/roles/[id]/route.ts'`.

- [ ] **Step 4: Changelog:** `- **Role mặc định:** lời nhắn khi tắt / xoá role mặc định nói đúng là phải đổi bằng SQL (app không có chỗ đổi).`

---

## Task 9: Sửa comment và tài liệu mô tả sai luật (đợt 1)

Sửa Claude 11, 12 và Codex 6. Không đổi hành vi.

- [ ] **Step 1:** `src/lib/table-config/scope-access.ts`: thay ``* `loadConfigAdmin()` (đòi `task.manage` VÀ vai trò task-admin), `isLeadManager` `` bằng ``* `loadConfigAdmin()` (đòi `task.manage`), `isLeadManager` ``.

- [ ] **Step 2:** `src/lib/table-config/access.ts`: thay 2 dòng

```ts
 * Bảng Health giữ nguyên luật cũ (`loadConfigAdmin` — `task.manage` VÀ vai trò
 * task-admin). Bảng lead đi theo `canManageLeads`. Một cổng chung cho cả bốn là
```

bằng:

```ts
 * Bảng Health theo `loadConfigAdmin` (đòi `task.manage`). Bảng lead đi theo
 * `canManageLeads`. Một cổng chung cho cả bốn là
```

- [ ] **Step 3:** `src/app/(authed)/config/page.tsx`: thay 2 dòng

```ts
  // quyền Health cho người không phải task-admin (`loadConfigAdmin` đòi
  // `task.manage` VÀ vai trò admin — xem chú thích ở lib/tasks/access.ts), hoặc
```

bằng:

```ts
  // quyền Health cho người không có `task.manage` (`loadConfigAdmin`), hoặc
```

- [ ] **Step 4:** `src/lib/table-config/scope-access.test.ts`: thay `it("task-admin mở mọi bảng Health", () => {` bằng `it("người có task.manage mở mọi bảng Health", () => {`.

- [ ] **Step 5:** `src/auth.ts`: thay

```ts
        // legacy admin/agent role. Nothing reads them; drop them so the cookie
        // shrinks and no future code is tempted to.
```

bằng:

```ts
        // legacy admin/agent role. Nothing reads them; drop them from the token
        // so no future code is tempted to. (The cookie keeps them until the next
        // sign-in: `await auth()` never writes a refreshed token back.)
```

- [ ] **Step 6:** `supabase/rollouts/2026-10-09-rbac-cleanup.sql`:
  - Thay `-- phút). Code cũ vẫn chạy đúng với dữ liệu sau file này. Idempotent.` bằng:

```sql
-- phút). Code cũ vẫn chạy đúng với dữ liệu sau file này.
-- CHẠY MỘT LẦN — đã chạy production 2026-10-10 01:42 UTC. Chạy lại sẽ dừng ở
-- guard 1b vì assign_unassigned_task đã đổi: cố ý, không phải lỗi.
```

  - Thay 3 dòng comment của bước 3:

```sql
--  3. Manage bao gồm Work: bỏ task.work / lead.work ở role đã có Manage tương
--     ứng (Admin, Linh Le, Sub Admin). Không ai mất quyền: code coi Manage là
--     Work. Admin ra khỏi nhóm chia task CS vì không còn task.work.
```

    bằng:

```sql
--  3. Manage bao gồm Work: bỏ task.work / lead.work ở MỌI role đã có Manage
--     tương ứng (Admin, Linh Le, Sub Admin, Admin Health Task). Nhóm chia task
--     CS sau đó loại cả manager — sửa lại ở 2026-10-13-cs-pool-managers.sql.
```

- [ ] **Step 7:** `npx vitest run src/lib/table-config && npx tsc --noEmit -p tsconfig.json`.

- [ ] **Step 8: Commit đợt 1** (task 1–9; chỉ khi user bảo; tách khỏi phần RBAC theo task 14).

---

## Task 10: Sửa / xoá account trong 1 transaction, khoá luật "còn ít nhất 1 Admin" (đợt 2)

Sửa Codex 2, Codex 3 (phần account) và Claude 9.
- `PATCH /api/admin/users/[id]` gọi `replaceUserRoles` **trước**, rồi mới update `portal_account` trong một request riêng.
- Luật "còn ít nhất 1 Admin" được kiểm **trước khi ghi** và không có khoá.

**Files:**
- Create: `supabase/rollouts/2026-10-13-account-atomic.sql`
- Create: `src/lib/admin/account-write-errors.ts` + `.test.ts`
- Modify: `src/app/api/admin/users/[id]/route.ts`
- Modify: `src/lib/rbac/role-management.ts` (xoá `fetchAdminRoleId`, `userHoldsAdminRole`, `hasActiveAdminOtherThan`)
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces (SQL): `update_account_atomic(p_user_id uuid, p_patch jsonb, p_role_id uuid) returns jsonb` (trả các cột `id,email,name,agent_id,is_active,created_at`); `delete_account_atomic(p_user_id uuid) returns void`. Cả hai ném `LAST_ADMIN` hoặc `USER_NOT_FOUND`.
- Produces (TS): `accountWriteFailure(error: { code?: string; message: string }): { status: 400 | 409 | 500; error: string }`

- [ ] **Step 1: Viết rollout** `supabase/rollouts/2026-10-13-account-atomic.sql`:

```sql
-- Account Manager writes in one transaction (review 2026-10-12, Codex 2 + 3).
--
-- Before: PATCH /api/admin/users/[id] replaced user_roles, THEN updated
-- portal_account in a second request. If the update failed (e.g. the trigger
-- that blocks deactivating an Agent who still owns Personal leads), the API
-- answered 409 but the role had already changed. The "at least one active
-- Admin" rule was a read before the write, so two concurrent demotions could
-- both pass it.
--
-- Now one RPC per write. Both take the same advisory lock and check the Admin
-- rule AFTER writing, inside the transaction, so a failure rolls everything
-- back. Only adds functions. Run BEFORE deploying the code that calls them.

create or replace function public.assert_active_admin_remains()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- "Admin" is the one role known by name (src/lib/rbac/admin-role.ts).
  if not exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id and r.is_active
    join public.portal_account a on a.id = ur.user_id and a.is_active
    where lower(btrim(r.name)) = 'admin'
  ) then
    raise exception 'LAST_ADMIN';
  end if;
end;
$$;

create or replace function public.update_account_atomic(
  p_user_id uuid,
  p_patch jsonb,
  p_role_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  -- Every write that can remove an Admin takes this lock, so two concurrent
  -- demotions cannot both see "another Admin remains".
  perform pg_advisory_xact_lock(hashtextextended('portal_account:admin_invariant', 0));

  p_patch := coalesce(p_patch, '{}'::jsonb);
  update public.portal_account set
    email = case when p_patch ? 'email' then p_patch->>'email' else email end,
    name = case when p_patch ? 'name' then p_patch->>'name' else name end,
    agent_id = case when p_patch ? 'agent_id' then p_patch->>'agent_id' else agent_id end,
    is_active = case when p_patch ? 'is_active' then (p_patch->>'is_active')::boolean else is_active end,
    password_hash = case when p_patch ? 'password_hash' then p_patch->>'password_hash' else password_hash end
  where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  if p_role_id is not null then
    perform public.replace_user_roles(p_user_id, array[p_role_id]);
  end if;

  perform public.assert_active_admin_remains();

  select jsonb_build_object(
           'id', a.id, 'email', a.email, 'name', a.name, 'agent_id', a.agent_id,
           'is_active', a.is_active, 'created_at', a.created_at)
    into result
  from public.portal_account a
  where a.id = p_user_id;
  return result;
end;
$$;

create or replace function public.delete_account_atomic(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('portal_account:admin_invariant', 0));
  -- user_roles rows go with it (on delete cascade).
  delete from public.portal_account where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;
  perform public.assert_active_admin_remains();
end;
$$;

revoke all on function public.assert_active_admin_remains() from public, anon, authenticated;
revoke all on function public.update_account_atomic(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.update_account_atomic(uuid, jsonb, uuid) to service_role;
revoke all on function public.delete_account_atomic(uuid) from public, anon, authenticated;
grant execute on function public.delete_account_atomic(uuid) to service_role;
```

- [ ] **Step 2: Test TS fail** `src/lib/admin/account-write-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { accountWriteFailure } from "@/lib/admin/account-write-errors";

describe("accountWriteFailure", () => {
  it("maps the last-Admin rule", () => {
    expect(accountWriteFailure({ message: "LAST_ADMIN" })).toEqual({
      status: 400,
      error: "At least one active Admin account is required.",
    });
  });

  it("maps the Personal lead trigger", () => {
    expect(accountWriteFailure({ message: "AGENT_HAS_PERSONAL_LEADS" }).status).toBe(409);
  });

  it("maps a duplicate email or Agent ID", () => {
    expect(accountWriteFailure({ code: "23505", message: "duplicate key value" })).toEqual({
      status: 409,
      error: "An account with this email or Agent ID already exists.",
    });
  });

  it("passes anything else through as a 500", () => {
    expect(accountWriteFailure({ message: "boom" })).toEqual({ status: 500, error: "boom" });
  });
});
```

Run `npx vitest run src/lib/admin/account-write-errors.test.ts`. Expected: FAIL, không tìm thấy module.

- [ ] **Step 3: Viết** `src/lib/admin/account-write-errors.ts`:

```ts
/**
 * HTTP answer for an error from update_account_atomic / delete_account_atomic
 * (supabase/rollouts/2026-10-13-account-atomic.sql). The RPC rolled everything
 * back, so nothing was saved.
 */
export function accountWriteFailure(error: { code?: string; message: string }): {
  status: 400 | 409 | 500;
  error: string;
} {
  if (error.message.includes("LAST_ADMIN")) {
    return { status: 400, error: "At least one active Admin account is required." };
  }
  if (error.message.includes("AGENT_HAS_PERSONAL_LEADS")) {
    return {
      status: 409,
      error:
        "This Agent still owns Personal leads. Reassign them to another Agent before deactivating the account.",
    };
  }
  if (error.code === "23505") {
    return { status: 409, error: "An account with this email or Agent ID already exists." };
  }
  return { status: 500, error: error.message };
}
```

Chạy lại test. Expected: PASS.

- [ ] **Step 4: Route `PATCH`** (`src/app/api/admin/users/[id]/route.ts`).
  - Thay khối import từ `"@/lib/rbac/role-management"` bằng:

```ts
import {
  fetchActiveRolesByIds,
  fetchRolePermissionKeys,
  fetchUserPermissionKeys,
  fetchUserRoleId,
} from "@/lib/rbac/role-management";
import { accountWriteFailure } from "@/lib/admin/account-write-errors";
```

    rồi xoá dòng `import { isAdminRoleName } from "@/lib/rbac/admin-role";`.

  - Thay:

```ts
    const [targetPermissionKeys, currentRoleId, targetIsAdmin] = await Promise.all([
      fetchUserPermissionKeys(id),
      fetchUserRoleId(id),
      userHoldsAdminRole(id),
    ]);
```

    bằng:

```ts
    const [targetPermissionKeys, currentRoleId] = await Promise.all([
      fetchUserPermissionKeys(id),
      fetchUserRoleId(id),
    ]);
```

  - Xoá khối:

```ts
    const willRemoveAdmin =
      targetIsAdmin &&
      ((nextRole !== null && !isAdminRoleName(nextRole.name)) ||
        updates.is_active === false);

    if (willRemoveAdmin && !(await hasActiveAdminOtherThan(id))) {
      return NextResponse.json(
        { error: "At least one active Admin account is required." },
        { status: 400 }
      );
    }
```

  - Thay toàn bộ đoạn từ `    if (nextRole) {` tới hết `    return NextResponse.json({ user: data });` (đoạn này đã có `invalidateRbacLookups();` từ task 7) bằng:

```ts
    // Role, account fields and the "at least one Admin" rule commit together
    // or not at all (supabase/rollouts/2026-10-13-account-atomic.sql).
    const { data, error } = await supabase.rpc("update_account_atomic", {
      p_user_id: id,
      p_patch: updates,
      p_role_id: nextRole?.id ?? null,
    });

    if (error) {
      const failure = accountWriteFailure(error);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }

    invalidateRbacLookups();
    return NextResponse.json({ user: data });
```

- [ ] **Step 5: Route `DELETE`.**
  - Xoá khối:

```ts
    if ((await userHoldsAdminRole(id)) && !(await hasActiveAdminOtherThan(id))) {
      return NextResponse.json(
        { error: "At least one active Admin account is required." },
        { status: 400 }
      );
    }
```

  - Thay:

```ts
    // user_roles xóa theo cascade (FK on delete cascade).
    const { error: deleteError } = await supabase
      .from(PORTAL_ACCOUNT_TABLE)
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }
```

    bằng:

```ts
    // Delete and the "at least one Admin" rule commit together; user_roles go
    // by cascade.
    const { error: deleteError } = await supabase.rpc("delete_account_atomic", { p_user_id: id });

    if (deleteError) {
      const failure = accountWriteFailure(deleteError);
      return NextResponse.json({ error: failure.error }, { status: failure.status });
    }
```

- [ ] **Step 6: Dọn `src/lib/rbac/role-management.ts`.** Chạy `git grep -n "fetchAdminRoleId\|userHoldsAdminRole\|hasActiveAdminOtherThan" -- src`. Expected: chỉ còn định nghĩa trong file này. Xoá 3 hàm đó. Xoá thêm type `UserRoleWithUserRow` và import `isAdminRoleName` nếu tsc / eslint báo không còn dùng.

- [ ] **Step 7: Đưa SQL vào `supabase/schema.sql`.** Chép từ `create or replace function public.assert_active_admin_remains()` tới dòng `grant execute on function public.delete_account_atomic(uuid) to service_role;` của rollout, dán ngay sau hàm `replace_user_roles` (hết khối `$$;`, khoảng dòng 165).

- [ ] **Step 8: Kiểm tra code**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
npx eslint 'src/app/api/admin/users/[id]/route.ts' src/lib/admin/account-write-errors.ts src/lib/admin/account-write-errors.test.ts src/lib/rbac/role-management.ts
```

Expected: toàn bộ PASS (gồm cả `no-role-name-authz.test.ts`).

- [ ] **Step 9: Chạy rollout** theo task 2 (trước khi deploy đợt 2). Xác minh:

```bash
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw "select proname, prosecdef, has_function_privilege('anon', oid, 'execute') as anon_exec from pg_proc where proname in ('assert_active_admin_remains','update_account_atomic','delete_account_atomic') order by 1" -o json
```

Expected: có 3 hàm; `update_account_atomic` / `delete_account_atomic` có `prosecdef = true`; `anon_exec = false` cho cả 3.

- [ ] **Step 10: Kịch bản thủ công sau deploy đợt 2** (account test, task 2 step 5):
  1. Đổi tên account test → lưu được.
  2. Đổi role và tắt account trong **cùng một** lần lưu → cả hai đều đổi.
  3. Bật lại → lưu được.
  4. Xoá account test → xoá được.

  Ca `LAST_ADMIN` không chạy trên production được vì sẽ phải hạ quyền Admin thật. Ca này chỉ kiểm bằng cách đọc SQL.

- [ ] **Step 11: Changelog:**

```markdown
- **Account Manager ghi trong 1 transaction** (`update_account_atomic`,
  `delete_account_atomic`): đổi role + sửa account cùng thành công hoặc cùng cuộn
  lại. Trước đó tắt một Agent còn giữ Personal lead kèm đổi role thì API báo 409
  nhưng role đã đổi. Luật "còn ít nhất 1 Admin" kiểm SAU khi ghi, dưới advisory
  lock, nên 2 thao tác cùng lúc không làm mất Admin cuối. Bớt 2–3 lượt gọi DB.
  **SQL rollout (chạy TRƯỚC deploy):** `supabase/rollouts/2026-10-13-account-atomic.sql`.
```

---

## Task 11: Tạo / sửa role trong 1 transaction (đợt 2)

Sửa Codex 3 (phần role).
- `POST /api/admin/roles` insert role rồi mới gọi `replace_role_permissions`. Nếu bước sau lỗi thì còn lại một role có 0 quyền.
- `PATCH` (sau task 3) update role rồi mới thay quyền.

**Files:**
- Create: `supabase/rollouts/2026-10-13-role-atomic.sql`
- Modify: `src/app/api/admin/roles/route.ts` (POST), `src/app/api/admin/roles/[id]/route.ts` (PATCH)
- Modify: `src/lib/rbac/role-management.ts` (xoá `replaceRolePermissions` nếu không còn chỗ dùng), `supabase/schema.sql`

**Interfaces:**
- Produces (SQL): `create_role_atomic(p_name text, p_description text, p_is_active boolean, p_permission_keys text[]) returns uuid`; `update_role_atomic(p_role_id uuid, p_patch jsonb, p_permission_keys text[]) returns void`. Với `p_permission_keys`: `null` = giữ nguyên quyền; mảng rỗng = xoá hết quyền.

- [ ] **Step 1: Viết rollout** `supabase/rollouts/2026-10-13-role-atomic.sql`:

```sql
-- Role Manager writes in one transaction (review 2026-10-12, Codex 3).
-- Before: POST inserted the role, then replaced its permissions in a second
-- request — a failure left a role with no permissions; PATCH could rename or
-- disable a role and then fail on its permissions. Only adds functions. Run
-- BEFORE deploying the code that calls them.

create or replace function public.create_role_atomic(
  p_name text,
  p_description text,
  p_is_active boolean,
  p_permission_keys text[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_role_id uuid;
begin
  insert into public.roles (name, description, is_active, is_system)
  values (p_name, p_description, coalesce(p_is_active, true), false)
  returning id into new_role_id;

  perform public.replace_role_permissions(new_role_id, p_permission_keys);
  return new_role_id;
end;
$$;

create or replace function public.update_role_atomic(
  p_role_id uuid,
  p_patch jsonb,
  p_permission_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  p_patch := coalesce(p_patch, '{}'::jsonb);
  update public.roles set
    name = case when p_patch ? 'name' then p_patch->>'name' else name end,
    description = case when p_patch ? 'description' then p_patch->>'description' else description end,
    is_active = case when p_patch ? 'is_active' then (p_patch->>'is_active')::boolean else is_active end,
    updated_at = now()
  where id = p_role_id;
  if not found then
    raise exception 'ROLE_NOT_FOUND';
  end if;

  -- null = permissions unchanged; an empty array clears them.
  if p_permission_keys is not null then
    perform public.replace_role_permissions(p_role_id, p_permission_keys);
  end if;
end;
$$;

revoke all on function public.create_role_atomic(text, text, boolean, text[]) from public, anon, authenticated;
grant execute on function public.create_role_atomic(text, text, boolean, text[]) to service_role;
revoke all on function public.update_role_atomic(uuid, jsonb, text[]) from public, anon, authenticated;
grant execute on function public.update_role_atomic(uuid, jsonb, text[]) to service_role;
```

- [ ] **Step 2: Route POST.** Trong `src/app/api/admin/roles/route.ts`, thay:

```ts
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("roles")
      .insert([
        {
          name: payload.name,
          description: payload.description,
          is_active: payload.isActive,
          is_system: false,
        },
      ])
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const role = data as unknown as { id: string };
    await replaceRolePermissions(role.id, payload.permissionKeys);

    const roles = await fetchRolesWithPermissions();
    return NextResponse.json(
      { role: roles.find((item) => item.id === role.id), roles },
      { status: 201 }
    );
```

bằng:

```ts
    // Role and its permissions are created together or not at all.
    const { data: roleId, error } = await getSupabaseAdmin().rpc("create_role_atomic", {
      p_name: payload.name,
      p_description: payload.description,
      p_is_active: payload.isActive,
      p_permission_keys: payload.permissionKeys,
    });

    if (error) {
      const duplicate = error.code === "23505";
      return NextResponse.json(
        { error: duplicate ? "A role with this name already exists." : error.message },
        { status: duplicate ? 409 : 500 }
      );
    }

    const roles = await fetchRolesWithPermissions();
    return NextResponse.json(
      { role: roles.find((item) => item.id === roleId), roles },
      { status: 201 }
    );
```

Xoá `replaceRolePermissions` khỏi import của file.

- [ ] **Step 3: Route PATCH.** Trong `src/app/api/admin/roles/[id]/route.ts`, thay:

```ts
    if (Object.keys(patch).length > 0) {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase
        .from("roles")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    if (permissionKeys) {
      await replaceRolePermissions(id, permissionKeys);
    }
```

bằng:

```ts
    // Fields and permissions change together or not at all.
    const { error } = await getSupabaseAdmin().rpc("update_role_atomic", {
      p_role_id: id,
      p_patch: patch,
      p_permission_keys: permissionKeys,
    });
    if (error) {
      const duplicate = error.code === "23505";
      return NextResponse.json(
        { error: duplicate ? "A role with this name already exists." : error.message },
        { status: duplicate ? 409 : 500 }
      );
    }
```

Xoá `replaceRolePermissions` khỏi import. Chạy `git grep -n "replaceRolePermissions" -- src`: nếu chỉ còn định nghĩa trong `role-management.ts` thì xoá luôn hàm đó.

- [ ] **Step 4: Đưa SQL vào `supabase/schema.sql`**, ngay sau hàm `replace_role_permissions` (khoảng dòng 134): chép từ `create or replace function public.create_role_atomic(` tới dòng `grant` cuối của rollout.

- [ ] **Step 5: Kiểm tra code:** `npx tsc --noEmit -p tsconfig.json && npx vitest run src/lib/rbac && npx eslint src/app/api/admin/roles/route.ts 'src/app/api/admin/roles/[id]/route.ts' src/lib/rbac/role-management.ts`.

- [ ] **Step 6: Chạy rollout** theo task 2. Xác minh:

```bash
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw "select proname, has_function_privilege('anon', oid, 'execute') as anon_exec from pg_proc where proname in ('create_role_atomic','update_role_atomic') order by 1" -o json
```

Expected: có 2 hàm, `anon_exec = false`.

- [ ] **Step 7: Kịch bản thủ công sau deploy đợt 2** (role test "RBAC Test"):
  1. Tạo role với 1 quyền (ví dụ `task.work`) → role xuất hiện, có đúng 1 quyền.
  2. Đổi tên + thêm 1 quyền trong cùng một lần lưu → cả hai đều đổi.
  3. Tạo role thứ hai trùng tên "RBAC Test" → lỗi 409 "A role with this name already exists.".
  4. Tắt rồi bật lại → được (nếu bạn giữ đủ các quyền của role).
  5. Xoá role test.

- [ ] **Step 8: Changelog:**

```markdown
- **Role Manager ghi trong 1 transaction** (`create_role_atomic`,
  `update_role_atomic`): role và quyền cùng thành công hoặc cùng cuộn lại; trùng
  tên trả 409. **SQL rollout (chạy TRƯỚC deploy):**
  `supabase/rollouts/2026-10-13-role-atomic.sql`.
```

---

## Task 12: Đăng nhập Google — tạo account và gán role cùng lúc (đợt 2)

Sửa Codex 4 (Q4: **không** tự gán role cho account cũ).
- `signIn` (`src/auth.ts`) bỏ qua lỗi khi insert `portal_account` mà vẫn `return true`.
- `assignDefaultRoleToUser` (`src/lib/rbac/access.ts`) bỏ qua lỗi `delete` / `insert`.

**Files:**
- Create: `supabase/rollouts/2026-10-13-google-signin-atomic.sql`
- Modify: `src/auth.ts`, `src/lib/rbac/access.ts`, `supabase/schema.sql`

**Interfaces:** Produces (SQL) `create_account_with_default_role(p_email text, p_name text) returns uuid`, ném `NO_DEFAULT_ROLE`.

- [ ] **Step 1: Viết rollout** `supabase/rollouts/2026-10-13-google-signin-atomic.sql`:

```sql
-- First Google sign-in creates the account and gives it the default role in
-- one transaction (review 2026-10-12, Codex 4). Before: an insert error was
-- ignored and the sign-in still succeeded; a failed role assignment left an
-- account with no role that was never retried. Email is stored exactly as
-- Google sends it, as before — the RBAC lookup matches it verbatim.
-- Only adds a function. Run BEFORE deploying the code that calls it.

create or replace function public.create_account_with_default_role(
  p_email text,
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  default_role_id uuid;
  new_user_id uuid;
begin
  -- At most one default role (roles_single_default_idx).
  select id into default_role_id from public.roles where is_default and is_active;
  if default_role_id is null then
    raise exception 'NO_DEFAULT_ROLE';
  end if;

  insert into public.portal_account (email, name, password_hash, is_active)
  values (p_email, p_name, 'google-auth', true)
  returning id into new_user_id;

  insert into public.user_roles (user_id, role_id) values (new_user_id, default_role_id);
  return new_user_id;
end;
$$;

revoke all on function public.create_account_with_default_role(text, text) from public, anon, authenticated;
grant execute on function public.create_account_with_default_role(text, text) to service_role;
```

- [ ] **Step 2: `signIn`.** Trong `src/auth.ts`, thay:

```ts
          const { data: createdUser } = await supabase
            .from(PORTAL_ACCOUNT_TABLE)
            .insert([
              {
                email: user.email,
                name: user.name,
                password_hash: "google-auth", // Đánh dấu đây là user dùng Google
                is_active: true,
              },
            ])
            .select("id")
            .single();

          if (createdUser?.id) {
            await assignDefaultRoleToUser(createdUser.id);
          }

          return true;
```

bằng:

```ts
          // Account and default role in one transaction
          // (supabase/rollouts/2026-10-13-google-signin-atomic.sql). No session
          // without a role: a roleless account sees nothing and is never retried.
          const { error: createError } = await supabase.rpc("create_account_with_default_role", {
            p_email: user.email,
            p_name: user.name ?? null,
          });
          if (createError) {
            console.error("[auth] could not create Google account", { error: createError.message });
            return false;
          }
          return true;
```

Xoá `assignDefaultRoleToUser` khỏi import trong `src/auth.ts`. Chạy `git grep -n assignDefaultRoleToUser -- src`: nếu không còn chỗ dùng thì xoá hàm đó (cùng comment phía trên) trong `src/lib/rbac/access.ts`.

- [ ] **Step 3: Đưa SQL vào `supabase/schema.sql`**, ngay sau các hàm của task 10.

- [ ] **Step 4: Kiểm tra code:** `npx tsc --noEmit -p tsconfig.json && npx vitest run src/lib/rbac && npx eslint src/auth.ts src/lib/rbac/access.ts`.

- [ ] **Step 5: Chạy rollout** theo task 2. Xác minh hàm có trên production và role mặc định đang bật:

```bash
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw "select (select count(*) from pg_proc where proname = 'create_account_with_default_role') as fn, (select name from roles where is_default and is_active) as default_role" -o json
```

Expected: `fn = 1`, `default_role = Agent`. Không kiểm thủ công được nếu không có một account Google mới. Sau deploy, xem log Vercel có dòng `[auth] could not create Google account` hay không.

- [ ] **Step 6: Changelog:**

```markdown
- **Đăng nhập Google lần đầu** (`create_account_with_default_role`): tạo account
  + gán role mặc định trong 1 transaction; lỗi thì không cho đăng nhập (log
  `[auth] could not create Google account`). **SQL rollout (chạy TRƯỚC deploy):**
  `supabase/rollouts/2026-10-13-google-signin-atomic.sql`.
```

---

## Task 13: Sync — chặn run cũ ghi đè run mới, dọn run chết ngay trong database (đợt 2)

Sửa Codex 5, Codex 7, Claude 4 và Claude 5. Thay bước dọn bằng JavaScript (thêm trong đợt DB optimize) bằng logic SQL trong cùng transaction, dùng đồng hồ của database:
- `finalize_sheet_sync` **từ chối** một run (`SUPERSEDED_RUN`) nếu cùng tab đã có run mới hơn ở trạng thái `finalized`.
- `begin_sheet_sync` và `finalize_sheet_sync` xoá run `running` **cũ hơn 10 phút** của cùng tab, dùng `for update skip locked` nên không bao giờ chờ hay deadlock với một lần finalize đang chạy.
- Resume (`--resume-run`) cũng gọi `finalize_sheet_sync`, nên cũng được dọn theo.

Bản trên production khớp `datasync/schema.sql`: md5 `begin_sheet_sync` = `472e678c8f385d469a15fc3effd23ed5`, `finalize_sheet_sync` = `3a4559e9392742f813e198a9b2063fd0`.

**Files:**
- Create: `supabase/rollouts/2026-10-13-sheet-sync-supersede-retention.rollback.sql`, `supabase/rollouts/2026-10-13-sheet-sync-supersede-retention.sql`
- Modify: `datasync/schema.sql:815-982`
- Modify: `datasync/lib/sync-runner.js`, `datasync/lib/supabase.js`, `datasync/lib/sync-runner.test.mjs`, `datasync/README.md`

**Interfaces:** Produces (SQL) `prune_stale_sheet_sync_runs(p_target_table text, p_source_sheet_id text, p_source_gid text, p_keep_run_id uuid) returns integer`. `finalize_sheet_sync` ném lỗi có message bắt đầu bằng `SUPERSEDED_RUN`.

- [ ] **Step 1: Tạo file rollback TRƯỚC khi sửa `datasync/schema.sql`**

```bash
{ echo "-- Rollback for 2026-10-13-sheet-sync-supersede-retention.sql: the live begin/finalize before it."; sed -n '815,982p' datasync/schema.sql; echo "drop function if exists public.prune_stale_sheet_sync_runs(text, text, text, uuid);"; } > supabase/rollouts/2026-10-13-sheet-sync-supersede-retention.rollback.sql
grep -c "create or replace function public\.\(begin\|finalize\)_sheet_sync" supabase/rollouts/2026-10-13-sheet-sync-supersede-retention.rollback.sql
```

Expected: `2`.

- [ ] **Step 2: Viết rollout** `supabase/rollouts/2026-10-13-sheet-sync-supersede-retention.sql`, gồm 5 phần theo thứ tự:

  1. Header và guard:

```sql
-- Sheet sync: refuse stale promotions and prune dead runs in the database
-- (review 2026-10-12: Codex 5 + 7, Claude 4 + 5). Replaces the client-side
-- pruning added to datasync/lib/sync-runner.js on 2026-10-12.
--
-- - finalize_sheet_sync refuses a run when a newer run of the same tab has
--   already finalized (SUPERSEDED_RUN). The advisory lock only serialized
--   promotions; a run that waited behind a newer one then replaced the
--   partition with its older copy.
-- - begin_sheet_sync and finalize_sheet_sync delete unfinished runs of the tab
--   that are more than 10 minutes old (their staged rows go by cascade), so
--   failed runs no longer pile up — 366 MB / 76 % of the database by 2026-10.
--
-- Rollback: 2026-10-13-sheet-sync-supersede-retention.rollback.sql.
-- Avoid 02:00 UTC (cron sync). Code deploy order does not matter.
do $guard$
declare
  begin_md5 text;
  finalize_md5 text;
begin
  select md5(prosrc) into begin_md5 from pg_proc where proname = 'begin_sheet_sync';
  select md5(prosrc) into finalize_md5 from pg_proc where proname = 'finalize_sheet_sync';
  if begin_md5 is distinct from '472e678c8f385d469a15fc3effd23ed5'
     or finalize_md5 is distinct from '3a4559e9392742f813e198a9b2063fd0' then
    raise exception 'ROLLOUT_ABORTED: sheet sync functions differ from datasync/schema.sql (begin %, finalize %)',
      begin_md5, finalize_md5;
  end if;
end $guard$;
```

  2. Hàm mới:

```sql
create or replace function public.prune_stale_sheet_sync_runs(
  p_target_table text,
  p_source_sheet_id text,
  p_source_gid text,
  p_keep_run_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed_count integer;
begin
  -- An unfinished run more than 10 minutes old is dead: the cron route's
  -- maxDuration is 300 s and a manual upload takes about 2 minutes. A run that
  -- another session is finalizing right now holds its row lock and is skipped,
  -- so this never waits on (or deadlocks with) a concurrent finalize.
  delete from public.sheet_sync_runs
  where run_id in (
    select s.run_id
    from public.sheet_sync_runs s
    where s.target_table = p_target_table
      and s.source_sheet_id = p_source_sheet_id
      and s.source_gid = p_source_gid
      and s.status = 'running'
      and s.run_id is distinct from p_keep_run_id
      and s.created_at < now() - interval '10 minutes'
    for update skip locked
  );
  get diagnostics removed_count = row_count;
  return removed_count;
end;
$$;
```

  3. `begin_sheet_sync`: chép **nguyên văn** `datasync/schema.sql:815-855`, chỉ thêm đoạn sau ngay trước `end;` cuối hàm (tức sau khối `raise exception 'run id is already finalized with different metadata';` … `end if;`):

```sql

  -- A new run of this tab makes its dead unfinished runs obsolete.
  perform public.prune_stale_sheet_sync_runs(p_target_table, p_source_sheet_id, p_source_gid, p_run_id);
```

  4. `finalize_sheet_sync`: chép **nguyên văn** `datasync/schema.sql:857-982`, với 2 chỗ thêm:
     - Ngay sau câu `perform pg_advisory_xact_lock(...);` (khối `-- Serialize replacement of one source partition.`), thêm:

```sql

  -- The lock only serializes promotions; it does not order them. A run that
  -- waited here while a newer run of the same tab promoted would otherwise
  -- replace the partition with its older copy of the Sheet.
  if exists (
    select 1
    from public.sheet_sync_runs newer
    where newer.target_table = p_target_table
      and newer.source_sheet_id = p_source_sheet_id
      and newer.source_gid = p_source_gid
      and newer.status = 'finalized'
      and newer.created_at > run_row.created_at
  ) then
    raise exception 'SUPERSEDED_RUN: a newer run of this sheet tab already finalized';
  end if;
```

     - Thay 2 dòng cuối thân hàm:

```sql
  delete from public.sheet_sync_staging where run_id = p_run_id;
  return v_inserted_count;
```

       bằng:

```sql
  delete from public.sheet_sync_staging where run_id = p_run_id;
  perform public.prune_stale_sheet_sync_runs(p_target_table, p_source_sheet_id, p_source_gid, p_run_id);
  return v_inserted_count;
```

  5. Quyền, ở cuối file:

```sql
revoke all on function public.prune_stale_sheet_sync_runs(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.prune_stale_sheet_sync_runs(text, text, text, uuid) to service_role;
```

- [ ] **Step 3: Đồng bộ `datasync/schema.sql`.** Thay 2 hàm `begin_sheet_sync` và `finalize_sheet_sync` bằng đúng bản trong rollout (phần 3, 4). Thêm `prune_stale_sheet_sync_runs` (phần 2) ngay trước `begin_sheet_sync`, và 2 dòng quyền (phần 5) vào khối `revoke` / `grant` ở khoảng dòng 1002.

- [ ] **Step 4: Bỏ bước dọn bằng JS.**
  - `datasync/lib/supabase.js`: chạy `git diff datasync/lib/supabase.js`. Diff chỉ được chứa thay đổi `lt` của đợt DB optimize. Xác nhận xong thì `git checkout HEAD -- datasync/lib/supabase.js`.
  - `datasync/lib/sync-runner.js`:
    - Đổi `const { callSupabaseRpc, deleteSupabaseRows, upsertSupabase } = require("./supabase");` thành `const { callSupabaseRpc, upsertSupabase } = require("./supabase");`.
    - Xoá dòng `  const runStartedAt = new Date().toISOString();`.
    - Xoá dòng `  await pruneSupersededRuns(config, runStartedAt);`.
    - Xoá toàn bộ hàm `pruneSupersededRuns` và khối comment phía trên nó.
    - Trong `catch (error)` quanh `finalize_sheet_sync` (luồng sync thường), thay:

```js
  } catch (error) {
    // Staged rows survive a failed promotion (it rolls back as one unit), so
    // the upload does not have to be repeated once the cause is fixed.
    console.error(
```

      bằng:

```js
  } catch (error) {
    if (String(error?.message ?? "").includes("SUPERSEDED_RUN")) {
      // A newer run of this tab already finalized; this upload is obsolete and
      // the database refused it. Nothing to resume.
      console.error(
        `[${config.name}] Promotion refused: a newer run of this tab already finalized. Nothing to resume.`
      );
      throw error;
    }
    // Staged rows survive a failed promotion (it rolls back as one unit), so
    // the upload does not have to be repeated once the cause is fixed.
    console.error(
```

- [ ] **Step 5: Viết lại test** `datasync/lib/sync-runner.test.mjs` (thay toàn bộ nội dung):

```js
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { syncConfig } = require("./sync-runner.js");

const config = {
  name: "health-test",
  table: "health_raw_data",
  sheetId: "sheet-1",
  gid: "42",
  columns: [{ source: "agent", target: "agent" }],
};

// Routes every fetch the runner makes: the Sheet CSV export and Supabase REST.
function fakeNetwork({ finalize = () => new Response("1") } = {}) {
  const calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input, init = {}) => {
      const url = new URL(String(input));
      calls.push({ method: init.method ?? "GET", url });
      if (url.hostname === "docs.google.com") return new Response("agent\nann@example.com\n");
      if (url.pathname === "/rest/v1/rpc/finalize_sheet_sync") return finalize();
      if (url.pathname.startsWith("/rest/v1/rpc/")) return new Response("");
      return new Response(null, { status: 201 });
    })
  );
  return calls;
}

function loggedErrors() {
  return vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
}

describe("syncConfig", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://db.example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("leaves pruning to the database: a successful sync sends no DELETE", async () => {
    const calls = fakeNetwork();

    await syncConfig(config);

    expect(calls.some((call) => call.url.pathname.endsWith("/finalize_sheet_sync"))).toBe(true);
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("explains a superseded run without suggesting a resume", async () => {
    fakeNetwork({
      finalize: () =>
        new Response('{"message":"SUPERSEDED_RUN: a newer run of this sheet tab already finalized"}', {
          status: 400,
        }),
    });

    await expect(syncConfig(config)).rejects.toThrow("SUPERSEDED_RUN");
    expect(loggedErrors()).toContain("newer run");
    expect(loggedErrors()).not.toContain("--resume-run");
  });

  it("still prints the resume command when promotion fails for another reason", async () => {
    fakeNetwork({
      finalize: () => new Response("canceling statement due to statement timeout", { status: 500 }),
    });

    await expect(syncConfig(config)).rejects.toThrow("finalize_sheet_sync");
    expect(loggedErrors()).toContain("--resume-run");
  });
});
```

Run `npx vitest run datasync/lib/sync-runner.test.mjs`. Expected: PASS 3/3. Kiểm ngược: tạm xoá khối `if (String(error?.message …` thì test 2 phải FAIL; xong khôi phục lại.

- [ ] **Step 6: README.** Trong `datasync/README.md`, thay đoạn:

```markdown
A failed run can only be resumed until a newer run of the same tab finalizes.
That run deletes every older unfinished run of the tab and its staged rows, so
an old copy can never be promoted over newer data.
```

bằng:

```markdown
A failed run can be resumed until a newer run of the same tab starts or
finalizes more than 10 minutes later: `begin_sheet_sync` and
`finalize_sheet_sync` delete unfinished runs of the tab older than 10 minutes,
with their staged rows. `finalize_sheet_sync` also refuses (`SUPERSEDED_RUN`) a
run when a newer run of the tab has already finalized, so an old copy can never
be promoted over newer data.
```

- [ ] **Step 7: Kiểm tra code:** `npx vitest run && node --check datasync/lib/sync-runner.js`.

- [ ] **Step 8: Chạy rollout** theo task 2 (ngoài 02:00 UTC). Xác minh:

```bash
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw "select proname, prosrc like '%SUPERSEDED_RUN%' as guarded, prosrc like '%prune_stale_sheet_sync_runs%' as prunes from pg_proc where proname in ('begin_sheet_sync','finalize_sheet_sync','prune_stale_sheet_sync_runs') order by 1" -o json
```

Expected: có 3 hàm; `finalize_sheet_sync` có `guarded = true`; `begin_sheet_sync` và `finalize_sheet_sync` có `prunes = true`.

- [ ] **Step 9: Chạy thử một lần sync thật** để chắc `begin` / `finalize` mới chạy được. Chọn `pc-raw-data` (khoảng 4.200 dòng, nhỏ hơn Health). Thao tác này **ghi lại dữ liệu `pc_raw_data` y như cron 02:00 UTC vẫn làm mỗi ngày**. Chạy từ thư mục `agent-portal` (dùng `.env.local`, trỏ vào production):

```bash
node datasync/sync.js --config pc-raw-data
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw "select status, count(*) from sheet_sync_runs where created_at > now() - interval '15 minutes' group by 1" -o json
```

Expected: sync in ra `Finalized … rows`, chỉ có dòng `finalized`. Nếu lỗi: chạy file `.rollback.sql` ngay (task 2 step 6) rồi báo lại.

- [ ] **Step 10: Changelog.** Trong entry `## 2026-10-10 — Hiệu năng database…`, thay bullet `**Sync tự dọn run hỏng cũ (2026-10-12, …)**` bằng:

```markdown
- **Sync dọn run hỏng ngay trong database (2026-10-13):** `begin_sheet_sync` và
  `finalize_sheet_sync` xoá run `running` cũ hơn 10 phút của cùng tab (cascade
  staging, `for update skip locked` nên không chờ / deadlock với finalize đang
  chạy). `finalize_sheet_sync` từ chối (`SUPERSEDED_RUN`) run cũ khi cùng tab đã
  có run mới hơn finalize — trước đó 2 lần sync chồng nhau có thể để bản Sheet
  cũ đè bản mới. Bỏ bước dọn bằng JS. **SQL rollout:**
  `supabase/rollouts/2026-10-13-sheet-sync-supersede-retention.sql`.
```

- [ ] **Step 11: Commit đợt 2** (chỉ khi user bảo).

---

## Task 14: Tách commit, deploy 2 đợt, kiểm tra sau deploy

- [ ] **Step 1: Kiểm tra toàn bộ ở local**

```bash
npx tsc --noEmit -p tsconfig.json
npx vitest run
npx eslint src datasync/lib/sync-runner.test.mjs vitest.config.ts
```

Expected: mọi test PASS, 0 lỗi.

- [ ] **Step 2: Vercel.** Kiểm tra Settings → Environment Variables (Production) có `VAPID_SUBJECT` (dạng `mailto:…`). Nếu thiếu thì thêm trước khi deploy.

- [ ] **Step 3: Tách commit** (chỉ khi user bảo), dùng `git add -p` để tách hunk:
  - **DB optimize** (2026-10-10 → 12): `vercel.json`, `src/lib/shared-lookup.ts`(+test), `src/lib/attachments/reuse-signed-urls.ts`, `src/lib/tasks/detail-cache.ts`(+test), `src/lib/enrollment/detail-cache.ts`(+test), `src/lib/tasks/membership.test.ts`, `datasync/*`, `vitest.config.ts`, cùng các hunk `rbacLookup` / `selectedAgentEmails` / `assistantAgentsByCs` / `invalidateTaskMembershipLookups` trong `src/auth.ts`, `src/lib/tasks/assignees.ts`, `src/lib/tasks/membership.ts`, `src/app/api/config/{agents,assistants}/route.ts`.
  - **RBAC 2026-10-09**: phần còn lại của đợt đó.
  - **Sửa sau review (plan này)**: theo bước commit của từng task.
  - Không commit `supabase/rollouts/2026-10-*`.

- [ ] **Step 4: Đợt 1** = DB optimize + RBAC + task 1–9.
  1. Chạy rollout của task 1 (`2026-10-13-cs-pool-managers.sql`) theo task 2.
  2. Deploy.
  3. Kiểm tra:
     - Overview → bảng CS có người "Admin Health Task", không có Admin.
     - Đăng nhập bằng account không có Role Manager, gửi `PATCH {}` vào `/api/admin/roles/<id>` → 401.
     - Ở Account Manager, thêm chính mình làm Assistant → báo lỗi.

- [ ] **Step 5: Đợt 2** = task 10–13.
  1. Chạy theo task 2: `2026-10-13-account-atomic.sql`, `2026-10-13-role-atomic.sql`, `2026-10-13-google-signin-atomic.sql`. Phải chạy **trước** khi deploy đợt 2.
  2. Chạy `2026-10-13-sheet-sync-supersede-retention.sql` cùng lần chạy thử sync (task 13 step 8–9).
  3. Deploy.
  4. Chạy kịch bản thủ công ở task 10 step 10 và task 11 step 7.

- [ ] **Step 6: Theo dõi sau đợt 2**
  - Sáng hôm sau (sau 02:00 UTC), chạy `select status, count(*) from sheet_sync_runs where created_at > now() - interval '1 day' group by 1;`. Expected: chỉ có `finalized`.
  - Log Vercel: không có `[auth] could not create Google account` và không có `[push] VAPID_SUBJECT is not set`.
  - Độ trễ: `response.origin_time` trong Supabase edge logs phải giảm từ ~190 ms xuống vài ms. Cần access token mới để đọc log.
