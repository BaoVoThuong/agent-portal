# Review: DB optimize + Role Manager (2026-10-12)

**Phạm vi:** toàn bộ thay đổi CHƯA commit trên `main` (~120 file), gồm 2 phần:

- **DB optimize** (2026-10-10 → 12): region `syd1`, cache tra cứu 60 giây, giữ link ảnh đã ký, sync tự dọn run hỏng.
- **Role Manager / RBAC** (tối 2026-10-09): phân quyền chỉ theo ô tick, bỏ tên role và cột `portal_account.role`, trần uỷ quyền (`delegation.ts`).

**Cách review:** skill `code-review` (mức high) quét diff, sau đó kiểm tra tay từng phát hiện trên code và trên database production (chỉ dùng lệnh đọc). Phát hiện nào kiểm tra không đúng đã bị loại.

**Trạng thái kiểm thử:** `vitest` 1.667/1.667 pass, `tsc --noEmit` sạch, `eslint` sạch trên các file đã sửa.

---

## Tóm tắt

| # | Mức | Phần | Vấn đề | File |
|---|---|---|---|---|
| 1 | 🔴 Cao | Role | Bật lại role đã tắt mà không qua trần uỷ quyền | `src/app/api/admin/roles/[id]/route.ts:82` |
| 2 | 🔴 Cao | Role | Account Manager tự gán mình làm Assistant, không kiểm trần uỷ quyền | `src/app/api/config/assistants/route.ts:49` |
| 3 | 🔴 Cao, cần quyết | Role | Manager bị loại khỏi nhóm CS (5 người "Admin Health Task") — **đang có hiệu lực trên production** | `overview-data.ts:110`, SQL `assign_unassigned_task` |
| 4 | 🟠 TB | DB | Resume một run hỏng không dọn các run cũ hơn | `datasync/lib/sync-runner.js:59` |
| 5 | 🟠 TB | DB | Bước dọn có thể xoá một run đang upload song song | `datasync/lib/sync-runner.js:150` |
| 6 | 🟠 TB | Role | Thiếu `VAPID_SUBJECT` thì push tắt hẳn, không có log | `src/lib/notifications/push-server.ts:52` |
| 7 | 🟠 TB | DB + Role | Khoá tài khoản / đổi role chưa xoá cache quyền 60 giây | `src/auth.ts:43` |
| 8 | 🟡 Thấp | Role | Không tắt / xoá được role mặc định, vì app không đổi được `is_default` | `roles/[id]/route.ts:117`, `:178` |
| 9 | 🟡 Thấp | Role | Route sửa account dư 2–3 lượt gọi DB | `src/app/api/admin/users/[id]/route.ts:236` |
| 10 | 🟡 Thấp | Role | Truy vấn "ai có task.manage" bị viết 2 lần | `src/lib/tasks/membership.ts:224` |
| 11 | 🟡 Thấp | Role | Comment còn ghi luật "task-admin role" đã bỏ | 3 chỗ, xem mục 11 |
| 12 | ⚪ Ghi chú | Role | `delete token.role/roles` không bao giờ được ghi xuống cookie | `src/auth.ts:174` |

**Nên sửa trước khi deploy:** mục 1, 2, 4, 5, 6, và **quyết định mục 3**. Riêng mục 3 không đợi được deploy: nó đã có hiệu lực trên production từ 2026-10-10 01:42 UTC (xem chi tiết bên dưới).

---

## 1. 🔴 Bật lại role đã tắt mà không qua trần uỷ quyền

**Luật trần uỷ quyền** (`src/lib/rbac/delegation.ts`): Role Manager chỉ được cấp những quyền chính mình đang có. Luật này chỉ chạy khi request có gửi `permissionKeys`:

```ts
// src/app/api/admin/roles/[id]/route.ts:124
if (permissionKeys) {
  const delegation = checkRolePermissionChange({
    actorPermissions: session?.user?.permissions ?? [],
    currentKeys: await fetchRolePermissionKeys(id),
    nextKeys: permissionKeys,
  });
```

Còn nhánh `is_active` (dòng 82) chỉ kiểm quyền `management.role_manager`.

**Tình huống lỗi:** role "Sub Admin" (có `task.manage`, `management.account_manager`) đang tắt. Một người chỉ có `management.role_manager` gửi `PATCH {is_active: true}`. Không có kiểm tra uỷ quyền nào chạy, và mọi người giữ role đó lấy lại `task.manage` cùng `account_manager`, những quyền mà người bật không có và không được phép cấp.

**Đề xuất:** coi việc bật lại là "cấp mới toàn bộ quyền của role". Thay khối ở dòng 124:

```ts
const reactivating = updates.is_active === true && !role.is_active;
if (permissionKeys || reactivating) {
  const liveKeys = await fetchRolePermissionKeys(id);
  const delegation = checkRolePermissionChange({
    actorPermissions: session?.user?.permissions ?? [],
    // Role đang tắt không cấp gì; bật lại = cấp mới mọi quyền của nó.
    // Chỉ dùng [] khi bật lại, để "bỏ bớt quyền" vẫn luôn được phép.
    currentKeys: reactivating ? [] : liveKeys,
    nextKeys: permissionKeys ?? liveKeys,
  });
  if (!delegation.ok) {
    return NextResponse.json({ error: delegation.error }, { status: delegation.status });
  }
}
```

Thêm test vào `delegation` hoặc test của route: bật lại một role có quyền mà người bật không có → 403.

---

## 2. 🔴 Account Manager tự gán mình làm Assistant

**Thay đổi:** `/api/config/agents` và `/api/config/assistants` đổi cổng kiểm tra từ `loadConfigAdmin()` (task manager) sang `loadAccountManager()` (chỉ cần `management.account_manager`). Lý do ghi trong `src/lib/admin/account-manager-access.ts` là hợp lý: API phải theo đúng quyền của trang Account Manager.

**Lỗ hổng:** route ghi `agent_members` mà không chặn tự gán cho mình, và cũng không áp trần uỷ quyền như luồng sửa account (`checkAccountChange`). Mà quan hệ Assistant **chính là quyền xem dữ liệu**:

- **Lead:** Assistant xem và làm lead của Agent đó. Một Account Manager có `lead.work` có thể tự gán mình làm Assistant của mọi Agent để xem mọi lead.
- **Task:** theo mô hình hiện tại, CS thường thấy toàn bộ task, còn Assistant chỉ thấy task của Agent mình. Ngược lại, **tự xoá mình khỏi Assistant** (`DELETE`) thì từ phạm vi hẹp thành thấy toàn bộ.

Trước thay đổi này, chỉ task manager mới gọi được 2 route, mà task manager vốn đã thấy hết.

**Đề xuất (tối thiểu):** chặn tự gán và tự gỡ, cho cả `POST` lẫn `DELETE`:

```ts
// src/app/api/config/assistants/route.ts — trong POST và DELETE, sau khi parse body
if (cs_email === admin.email.trim().toLowerCase()) {
  return NextResponse.json(
    { error: "You cannot change your own Assistant access." },
    { status: 400 }
  );
}
```

**Đề xuất (đầy đủ, khớp luật account):** cho `loadAccountManager()` trả thêm `permissions`, rồi áp dụng
`checkAccountChange({ actorPermissions, isSelf: false, targetPermissionKeys: <quyền của cs_email> })`,
để Account Manager không đổi phạm vi dữ liệu của người có quyền cao hơn mình. Luật tương tự cho `/api/config/agents` (thêm/gỡ Agent cũng đổi phạm vi xem).

---

## 3. 🔴 Manager bị loại khỏi nhóm CS — cần quyết định ngay

**Nguyên nhân:** 3 luật cộng lại với nhau.

1. Bước 3 của `supabase/rollouts/2026-10-09-rbac-cleanup.sql` xoá `task.work` khỏi **mọi** role có `task.manage`:
   ```sql
   delete from role_permissions w
   where w.permission_key = 'task.work'
     and exists (select 1 from role_permissions m where m.role_id = w.role_id and m.permission_key = 'task.manage');
   ```
   Comment của file chỉ nhắc *"Admin, Linh Le, Sub Admin"*, nhưng câu lệnh áp dụng cho cả **"Admin Health Task"**.
2. Role Manager không cho một role giữ cả hai quyền: `normalizeExclusivePermissionKeys` (`src/lib/rbac/permissions.ts:50`) bỏ `task.work` khi đã có `task.manage`.
3. "Nhóm CS" lại chỉ tính người có **đúng** `task.work`:
   - Bảng CS trên Overview: `src/lib/tasks/overview-data.ts:110`, `row.permission_key === "task.work"`. Code cũ (HEAD) cũng như vậy.
   - Hàm SQL `assign_unassigned_task` (chia task từ Overview) ném `INVALID_CS` nếu người nhận không có `rp.permission_key = 'task.work'`.

**Hệ quả:** mọi manager vĩnh viễn không được chia task từ CS Overview và không hiện trong bảng CS. Comment của rollout chỉ định loại Admin ra.

**Số liệu production** (đo 2026-10-12, chỉ đọc):

| Role | task.manage | task.work | Thành viên | Đang bật trong hàng chờ chia task |
|---|---|---|---|---|
| Admin | ✓ | — | 3 | 0 |
| **Admin Health Task** | ✓ | — | **5** | **2** |
| Linh Le | ✓ | — | 1 | 0 |
| Sub Admin | ✓ | — | 0 | 0 |
| Task CS | — | ✓ | 22 | 5 |
| Health Agent | — | ✓ | 15 | 0 |

- Rollout đã chạy lúc **2026-10-10 01:42 UTC**. Bằng chứng: quyền `customer_registration.view_all` được tạo lúc đó, cột `roles.is_default` đã có, và hàm `assign_unassigned_task` đã khác bản cũ.
- Từ lúc đó tới giờ **chưa có task nào được tạo** vì đúng vào cuối tuần (cuối tuần trước cũng là 0). Nên chưa ai thấy lỗi, nhưng **sáng thứ Hai giờ US sẽ lộ ra**.
- Một trong 2 người "Admin Health Task" trong hàng chờ được chia 5 task trong khoảng 1–8/10.

**Hai hướng, cần bạn chọn:**

- **A. Manager vẫn làm CS được** (khớp với "Manage bao gồm Work"): nhóm CS = có `task.work` HOẶC `task.manage`, trừ role Admin cố định.
  - `overview-data.ts:110` → `["task.work", "task.manage"].includes(row.permission_key)`, rồi loại `adminUserIds`.
  - Viết rollout sửa `assign_unassigned_task`: `rp.permission_key in ('task.work','task.manage')` và `not` thuộc role Admin. Cập nhật luôn `supabase/schema.sql`.
- **B. Manager không làm CS** (đúng như code đang chạy): báo cho 5 người "Admin Health Task", tắt 2 dòng của họ trong `task_assignment_queue_members`, và sửa comment của rollout cho đúng (thêm "Admin Health Task").

Nếu hôm nay chưa kịp sửa code mà cần giữ nguyên hành vi cũ cho "Admin Health Task", cách tạm thời là cấp lại `task.work` cho role đó bằng SQL. Lưu ý: lần sau có người lưu role này trong Role Manager, `task.work` sẽ bị bỏ lại.

---

## 4. 🟠 Resume một run hỏng không dọn các run cũ hơn (phần DB)

`pruneSupersededRuns` chỉ chạy sau một lần sync mới (`sync-runner.js:137`). Nhánh `--resume-run` (dòng 59) finalize xong là `return`, không dọn gì.

**Tình huống lỗi:** run A (cũ hơn) hỏng, sau đó run B cũng hỏng. Người vận hành resume B thành công, nhưng A vẫn còn. Về sau có người resume A theo một dòng log cũ, và bảng thật bị ghi đè bằng bản cũ của A. README và changelog lại hứa điều này không xảy ra.

**Đề xuất:** gọi dọn ngay sau finalize ở nhánh resume (gộp với mục 5):

```js
// sync-runner.js, nhánh options.resumeRun, ngay sau dòng log "Resumed and finalized"
await pruneSupersededRuns(config, new Date().toISOString());
```

## 5. 🟠 Bước dọn có thể xoá một run đang upload song song (phần DB)

Ngưỡng hiện tại là thời điểm run bắt đầu, lấy theo đồng hồ của Vercel (`runStartedAt`). Mọi run `running` tạo trước mốc đó đều bị xoá, kể cả run **đang upload**.

**Tình huống lỗi:** cron 02:00 UTC chạy trùng với một lần sync tay của cùng tab. Run tay A bắt đầu trước và đang upload staging. Run cron B bắt đầu sau nhưng finalize trước, nên B xoá A. Lần upsert hoặc finalize tiếp theo của A lỗi khoá ngoại. Ngoài ra, nếu đồng hồ Vercel chạy nhanh hơn Postgres, một run bắt đầu ngay sau B cũng có thể bị xoá.

**Đề xuất:** chỉ xoá run đã "chết chắc chắn". Cron có `maxDuration = 300` giây, nên run nào cũ hơn 10 phút thì không thể còn đang chạy:

```js
// datasync/lib/sync-runner.js
// A run cannot outlive the cron's maxDuration (300 s); anything older than this
// is dead, so pruning never races a live upload or clock skew.
const PRUNE_MIN_AGE_MS = 10 * 60 * 1000;

async function pruneSupersededRuns(config, startedAt) {
  const cutoff = new Date(Date.parse(startedAt) - PRUNE_MIN_AGE_MS).toISOString();
  try {
    await deleteSupabaseRows("sheet_sync_runs", {
      status: "running",
      target_table: config.table,
      source_sheet_id: config.sheetId,
      source_gid: config.gid,
      created_at: { lt: cutoff },
    });
  } catch (error) { /* như cũ */ }
}
```

Cập nhật test trong `datasync/lib/sync-runner.test.mjs`: ngưỡng phải cách thời điểm bắt đầu run ít nhất 10 phút. Thêm 1 test cho nhánh resume.

---

## 6. 🟠 Thiếu `VAPID_SUBJECT` thì push tắt hẳn, không có log

```ts
// src/lib/notifications/push-server.ts:52
const subject = process.env.VAPID_SUBJECT?.trim();
if (!publicKey || !privateKey || !subject) {
  return false;   // trước đây có email dự phòng viết cứng
}
```

**Tình huống lỗi:** Vercel production có 2 khoá VAPID nhưng chưa bao giờ khai `VAPID_SUBJECT`, vì trước đây có email dự phòng. Sau khi deploy, mọi thông báo push (mention, assign) ngừng hẳn mà log không có dòng nào.

**Đề xuất:**

1. **Trước khi deploy:** kiểm tra Vercel → Settings → Environment Variables có `VAPID_SUBJECT` (dạng `mailto:...`). Máy local có biến này; production thì chưa kiểm được.
2. Ghi cảnh báo 1 lần khi có khoá mà thiếu subject:
   ```ts
   let warnedMissingSubject = false;
   // ...
   if (publicKey && privateKey && !subject && !warnedMissingSubject) {
     warnedMissingSubject = true;
     console.warn("[push] VAPID_SUBJECT is not set — web push is disabled");
   }
   ```

---

## 7. 🟠 Khoá tài khoản / đổi role chưa xoá cache quyền

`src/auth.ts:43` cache quyền 60 giây cho mỗi email trên mỗi instance. Cache `agent_members` / `task_agents` có hàm xoá khi admin sửa (`invalidateTaskMembershipLookups`), còn cache quyền thì chưa.

**Tình huống lỗi:** Account Manager khoá một tài khoản bị lộ, hoặc hạ quyền một role. Ngay cả trên instance vừa xử lý thao tác đó, người kia vẫn giữ quyền cũ thêm tối đa 60 giây.

**Đề xuất:**

```ts
// src/auth.ts
export function invalidateRbacLookup(email?: string) {
  rbacLookup.invalidate(email);
}
```

Gọi `invalidateRbacLookup(targetEmail)` sau khi ghi thành công trong `PATCH` và `DELETE` của `/api/admin/users/[id]`. Gọi `invalidateRbacLookup()` (xoá hết) sau `PATCH` và `DELETE` của `/api/admin/roles/[id]`. Các instance khác vẫn cần tối đa 60 giây. Đây là đánh đổi đã chấp nhận, đã ghi trong changelog.

> Bối cảnh: cửa sổ "5 phút trong JWT" chưa bao giờ có tác dụng, vì `await auth()` của next-auth 5 beta không ghi cookie mới. Nên trước đợt DB optimize, mọi `auth()` đều query lại (~24.500 lần/ngày).

---

## 8. 🟡 Không tắt / xoá được role mặc định

`roles/[id]/route.ts:117` và `:178` trả lỗi *"Choose another default role first."*, nhưng không có API hay nút nào đổi `roles.is_default`. Muốn bỏ role "Agent" thì chỉ còn cách sửa bằng SQL.

**Đề xuất:** thêm thao tác "Đặt làm mặc định" trong Role Manager, gồm 1 RPC đổi cờ trong một transaction (vì có unique partial index cho phép tối đa 1 role mặc định). Hoặc tạm thời đổi lời nhắn thành "Default role can only be changed by an administrator in the database."

## 9. 🟡 Route sửa account dư lượt gọi database

`src/app/api/admin/users/[id]/route.ts:236` gọi `fetchUserRoleId(id)` và `userHoldsAdminRole(id)` song song. Hàm sau gọi `fetchAdminRoleId()` (quét bảng `roles`) và đếm `user_roles` thêm một lần. Khi hạ quyền admin, `hasActiveAdminOtherThan` lại quét `roles` thêm lần nữa. Còn `DELETE` thì gọi tuần tự.

**Đề xuất:** lấy `adminRoleId` 1 lần rồi so với `currentRoleId` (`targetIsAdmin = currentRoleId === adminRoleId`), bớt được 2–3 lượt gọi mỗi request.

## 10. 🟡 Truy vấn "ai có task.manage" bị viết 2 lần

`fetchTaskManagerEmails` (`src/lib/tasks/membership.ts:224`) viết lại đúng chuỗi join `role_permissions → roles → user_roles → portal_account` đã có trong `fetchEmailsWithPermission` (`src/lib/rbac/permission-holders.ts:15`).

**Đề xuất:** `fetchTaskManagerEmails = () => fetchEmailsWithPermission(PERMISSIONS.TASK_MANAGE)`, để sau này sửa luật ở một chỗ.

## 11. 🟡 Comment còn mô tả luật đã bỏ

Đợt RBAC đã bỏ luật "phải có role task-admin", nhưng comment vẫn ghi:

- `src/lib/table-config/scope-access.ts:18`: *"`loadConfigAdmin()` (đòi `task.manage` VÀ vai trò task-admin)"*
- `src/lib/table-config/access.ts:58`
- `src/app/(authed)/config/page.tsx:63`

Người đọc sau dễ tưởng còn luật đó rồi "khôi phục" lại. Nên sửa thành "đòi `task.manage`". Tên test `scope-access.test.ts:7` ("task-admin mở mọi bảng Health") cũng nên đổi theo.

## 12. ⚪ Ghi chú: `delete token.role/roles` không được ghi xuống cookie

`src/auth.ts:174` xoá `token.role` / `token.roles` *"so the cookie shrinks"*. Nhưng cùng lý do với mục 7, token sau khi làm mới không bao giờ được ghi lại cookie, nên cookie cũ vẫn mang 2 trường đó tới khi đăng nhập lại. Vô hại vì callback `session` không còn đọc chúng. Chỉ cần sửa comment cho đúng.

---

## Đã kiểm tra và ổn

- **Rollout RBAC đã chạy trên production** (2026-10-10 01:42 UTC). Code mới deploy được mà không cần chạy thêm SQL. Role mặc định "Agent" có và đang bật.
- **Production hiện chạy code cũ + dữ liệu mới:** code cũ của Lead vẫn coi manager là worker (`buildLeadActor`), nên không ai mất quyền Lead. Ngoại lệ duy nhất là mục 3.
- **Cache 60 giây cho `agent_members` / `task_agents`** giữ nguyên tính fail-closed: `fetchAssistantAgentsForCs` và `fetchSelectedAgentEmails` vẫn ném lỗi, `fetchAgentsForCs` vẫn trả `[]`, và lần đọc lỗi không bao giờ bị cache. Đã có test.
- **Link ảnh dùng lại** chỉ thay cho đúng file mà server vừa trả về, nên server vẫn quyết định ai xem được file nào.
- **Rollout DB đã chạy:** dọn staging (483 → 118 MB), xoá 3 index thừa, `search_path` cho 3 hàm definer. `refresh_health_mart` / `refresh_pc_mart` chạy thử OK, số dòng không đổi.

## Checklist deploy

1. Sửa mục 1, 2, 4, 5, 6; quyết định và xử lý mục 3.
2. Kiểm tra `VAPID_SUBJECT` trên Vercel.
3. Tách commit:
   - **DB optimize:** `vercel.json`; `src/lib/shared-lookup.ts` (+test); `src/lib/attachments/reuse-signed-urls.ts`; `src/lib/tasks/detail-cache.ts` (+test); `src/lib/enrollment/detail-cache.ts` (+test); `src/lib/tasks/membership.test.ts`; `datasync/lib/*`; `datasync/README.md`; `vitest.config.ts`. Ngoài ra có **một phần** của `src/auth.ts` (`rbacLookup`), `src/lib/tasks/assignees.ts` (`selectedAgentEmails`), `src/lib/tasks/membership.ts` (`assistantAgentsByCs`), và 2 route `config/agents`, `config/assistants` (dòng `invalidateTaskMembershipLookups`).
   - **RBAC:** phần còn lại.
   - Các file `supabase/rollouts/2026-10-*` để local, không commit.
4. Sau khi deploy: đo lại `response.origin_time` trong Supabase edge logs. Kỳ vọng giảm từ ~190 ms xuống vài ms. Cần một access token mới để đọc log.
