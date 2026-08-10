# Export Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded "only managers may export" rule with a real RBAC permission (`task.export`), shared by Tasks and Enrollment, that must be granted explicitly — holding a manager role is no longer sufficient on its own.

**Architecture:** Export access today is a single two-line function returning `actor.isManager`, consumed by four call sites (two server pages that hide the UI, two API routes that enforce it). This plan adds one permission key to the RBAC catalogue, seeds it, and rewrites that one function to read the permission from the session. The four call sites change only in that they must now pass the session's permission list.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (service-role), NextAuth v5 session carrying `user.permissions`, Vitest.

## Global Constraints

- **This is a breaking permission change, by explicit owner decision.** Manager status alone will no longer grant export. Anyone who is not on a role carrying the new key loses export until it is granted.
- Only `origin` is pushed automatically; never `vercel`.
- Log the change in `agent-portal/changelog.md`, flagged as breaking.
- After every task: `npx tsc --noEmit`, `npx vitest run`, `rtk proxy npx eslint <touched files>` clean.
- Reply to the user in Vietnamese, concise, when done.

## Codex review comments — 2026-08-09

> **[CODEX REVIEW — BLOCKER] Rollout hiện tự mâu thuẫn.** Chỉ chạy block
> `insert into permissions ... on conflict` ở Task 4 Step 1 **không** tự tạo row
> `role_permissions` cho `Admin`; việc `Admin` nhận toàn bộ permission chỉ xảy ra
> khi block `cross join permissions` phía sau cũng được chạy. Vì vậy câu “adding
> the key ... is sufficient for Admin” chỉ đúng khi chạy thêm role seed (hoặc
> grant bằng `/role-manager`). Không nên lấy “re-run whole schema.sql” làm cách
> mặc định trên production vì file này còn xoá/rebuild grant của `Admin`/`Agent`
> và thực hiện nhiều DDL/DML khác. Plan phải cung cấp một rollout SQL idempotent,
> tối thiểu gồm catalogue row **và** explicit grant cho `Admin`, rồi verify trong
> cùng transaction/runbook.

> **[CODEX REVIEW — BLOCKER] Plan này không độc lập với enrollment-agent-permission.**
> `src/app/api/enrollment/export/route.ts` hiện gọi
> `fetchEnrollmentRecords(program)` không có actor scope. Nếu cấp `task.export`
> cho một agent/assistant không có `task.manage`, họ có thể export toàn bộ ACA /
> Medicare dù list UI đã/đang được scope. Permission export chỉ cho phép hành vi
> export; nó không được mở rộng data visibility. Task 3 phải truyền actor vào
> query export đã scope, hoặc plan này phải bắt buộc triển khai sau Task 4 của
> `enrollment-agent-permission`. Vì vậy kết luận Self-Review “independent ... can
> ship first or last” là sai.

> **[CODEX REVIEW — HIGH] Không gọi `auth()` lần hai trong cùng API request.**
> `loadEnrollmentActor()` đã gọi `auth()` nhưng chỉ trả actor. Thêm một `auth()`
> riêng ở hai export route tạo hai nguồn auth context và thừa work. Nên mở rộng
> kết quả loader để trả `permissions` (không cần nhét vào `EnrollmentActor`), hoặc
> tạo một request auth-context loader dùng chung, rồi actor và export gate cùng
> đọc từ một session snapshot.

> **[CODEX REVIEW — MEDIUM] Context/call-site name đã stale so với working tree.**
> Hai page hiện dùng `canExport` và prop `canExport`, không còn
> `canExportImport`. Khi thực thi phải đọc compiler/`rg` thay vì giữ tên cũ trong
> Step 1–2.

---

## Owner decisions (do not revisit)

| Question | Decision |
|---|---|
| One permission or two? | **One**, shared by Tasks and Enrollment |
| Do managers get it automatically? | **No** — the permission is required, full stop |
| Which roles get it seeded? | `Admin`, plus `Admin Health Task` **granted manually** — see the finding below |

## Context an implementer needs

**The entire current implementation** — `src/lib/table-config/export-access.ts`, the whole file:

```ts
import type { EnrollmentActor } from "@/lib/enrollment/access";

export async function canActorExport(actor: EnrollmentActor): Promise<boolean> {
  return actor.isManager;
}
```

**Its four call sites:**

| File | Line | Purpose |
|---|---|---|
| `src/app/(authed)/tasks/page.tsx` | `:66` | computes `canExportImport` prop → hides the Import/Export menu |
| `src/app/(authed)/enrollment/page.tsx` | `:61` | same, for Enrollment |
| `src/app/api/tasks/export/route.ts` | `:56` | server enforcement, returns 403 |
| `src/app/api/enrollment/export/route.ts` | `:76` | server enforcement, returns 403 |

There is also `src/lib/table-config/export-access.test.ts`, which currently asserts the `isManager` behaviour and must be rewritten.

**How permissions work in this repo:**
- The catalogue is `PERMISSIONS` in `src/lib/rbac/permissions.ts:1-17` (16 keys today; `TASK_MANAGE` and `TASK_WORK` are the two task ones).
- Checking is `can(permissions, key)` from `src/lib/rbac/client.ts`.
- The session carries `user.permissions`, already read by `buildTaskActor(session.user.permissions, …)`.
- The DB catalogue is seeded by `insert into permissions (...) values (...) on conflict (key) do update …` at `supabase/schema.sql:163-185`.

**⚠️ Finding that changes the "which roles" answer.** Only **two** roles are seeded — `Admin` and `Agent` (`supabase/schema.sql:271-279`). And `Admin` receives **every** permission automatically:

```sql
-- supabase/schema.sql:286-291
insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r cross join permissions p
where r.name = 'Admin'
on conflict (role_id, permission_key) do nothing;
```

Two consequences:
1. **Adding the key to the `permissions` seed is sufficient for `Admin`.** No role-permission seeding is needed, and writing one would be redundant.
2. **`"Admin Health Task"` is not seeded anywhere** — `grep` finds zero occurrences in `schema.sql`. It exists only as a *name to check for* in `TASK_ADMIN_ROLE_NAMES` (`src/lib/tasks/access.ts:13-16`), i.e. a role an operator creates by hand. It therefore **cannot** be seeded; it must be granted through `/role-manager`. Task 4 covers this as an operational step, not a code step.

Also note `SYSTEM_ROLE_NAMES.SUPER_ADMIN = "Admin"` (`src/lib/rbac/system-roles.ts:19-22`) — the system role is literally named `Admin`, not "Super Admin".

**One more caution:** re-running `schema.sql` executes `delete from role_permissions … where r.name in ('Admin','Agent')` before re-inserting (`:281-285`). Any *manual* grant made to `Admin` or `Agent` in `/role-manager` is wiped by a schema re-run. Grants to other roles (like `Admin Health Task`) survive.

> **[CODEX REVIEW] Chính caution này là lý do Task 4 không nên cho phép “re-run
> the whole file” như một lựa chọn tương đương với chạy migration nhỏ. Hãy biến
> hai câu SQL cần thiết (catalogue + Admin grant) thành runbook chính; full schema
> chỉ là lựa chọn recovery có kiểm soát.**

---

### Task 1: Add the permission key to the catalogue

**Files:**
- Modify: `src/lib/rbac/permissions.ts`
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: `PERMISSIONS.TASK_EXPORT` with value `"task.export"`, consumed by Task 2.

- [ ] **Step 1: Add the TypeScript key**

In `src/lib/rbac/permissions.ts`, extend the object (keep it next to the other task keys):

```ts
  TASK_MANAGE: "task.manage",
  TASK_WORK: "task.work",
  TASK_EXPORT: "task.export",
} as const;
```

`PermissionKey` is derived from the object's values, so it widens automatically — no other type edit is needed.

- [ ] **Step 2: Add the database catalogue row**

In `supabase/schema.sql`, inside the `insert into permissions (key, label, description, group_key, group_label, sort_order) values` block (`:163-179`), append after the `task.work` row. **The current last row has no trailing comma** — add one to it, then add the new row:

```sql
  ('task.manage', 'Tasks - Manage', 'Create, assign and manage all tasks, and see the backlog.', 'tasks', 'Tasks', 100),
  ('task.work', 'Tasks - Work', 'Work on tasks assigned to you.', 'tasks', 'Tasks', 200),
  ('task.export', 'Tasks - Export', 'Export task and enrollment tables to Excel. Required on its own — a manager role alone does not grant export.', 'tasks', 'Tasks', 300)
on conflict (key) do update set
```

The `on conflict (key) do update` tail already present means re-running is safe and will refresh the label/description.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npx vitest run` → unchanged from baseline. Nothing consumes the key yet.
Run: `rtk proxy npx eslint src/lib/rbac/permissions.ts` → clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rbac/permissions.ts supabase/schema.sql
git commit -m "feat(rbac): add task.export permission key"
```

---

### Task 2: Make `canActorExport` read the permission

**Files:**
- Modify: `src/lib/table-config/export-access.ts`
- Modify: `src/lib/table-config/export-access.test.ts`

**Interfaces:**
- Consumes: `PERMISSIONS.TASK_EXPORT` (Task 1), `can` from `@/lib/rbac/client`.
- Produces: `canActorExport(permissions: readonly string[] | undefined): boolean` — **note the signature change**: it no longer takes an actor, and it is no longer `async`. Task 3 updates all four call sites.

Why the signature changes rather than keeping the actor: `EnrollmentActor` (= `TaskActor`) carries only `email`, `isManager`, `isWorker` — it has **no** permission list. Threading the permissions through the actor would mean widening a type used across both modules for a single feature. Passing the session's permission array directly is smaller and makes the dependency obvious at each call site.

- [ ] **Step 1: Write the failing test**

Replace the whole of `src/lib/table-config/export-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { canActorExport } from "./export-access";

describe("canActorExport", () => {
  it("allows a holder of the export permission", () => {
    expect(canActorExport([PERMISSIONS.TASK_EXPORT])).toBe(true);
  });

  it("allows a holder who also has other permissions", () => {
    expect(
      canActorExport([PERMISSIONS.TASK_WORK, PERMISSIONS.TASK_EXPORT])
    ).toBe(true);
  });

  // The behaviour change this task exists for: management permissions are no
  // longer sufficient. Export must be granted explicitly.
  it("denies a manager who has not been granted export", () => {
    expect(canActorExport([PERMISSIONS.TASK_MANAGE])).toBe(false);
  });

  it("denies an empty or missing permission list", () => {
    expect(canActorExport([])).toBe(false);
    expect(canActorExport(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/table-config/export-access.test.ts`
Expected: FAIL — the current implementation takes an actor object, so the calls are type-errors / return the wrong result.

- [ ] **Step 3: Rewrite the implementation**

Replace the whole of `src/lib/table-config/export-access.ts`:

```ts
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

/**
 * Export is its own permission, deliberately NOT implied by task.manage or by
 * holding an admin role. Owner decision 2026-08-09: exporting the full task /
 * enrollment table is a data-egress action and is granted per person.
 *
 * The `Admin` system role receives every permission automatically
 * (supabase/schema.sql:286-291), so administrators keep export; any other role
 * must be granted `task.export` explicitly in /role-manager.
 *
 * One key covers both Tasks and Enrollment by owner decision — the two export
 * routes are the same capability over two tables.
 */
export function canActorExport(
  permissions: readonly string[] | undefined
): boolean {
  return can(permissions, PERMISSIONS.TASK_EXPORT);
}
```

⚠️ Before writing, open `src/lib/rbac/client.ts` and confirm `can`'s exact signature and its behaviour on `undefined`. The test above asserts `canActorExport(undefined) === false`; if `can` does not already handle `undefined`, guard it here rather than changing the test.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/table-config/export-access.test.ts` → PASS (4 tests).
Run: `npx tsc --noEmit`
Expected: **four errors**, one per call site (`tasks/page.tsx`, `enrollment/page.tsx`, and the two export routes) — they still pass an actor. That is expected and Task 3 fixes it. If the count is not four, re-grep for `canActorExport` before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-config/export-access.ts src/lib/table-config/export-access.test.ts
git commit -m "feat(rbac): gate export behind task.export permission"
```

---

### Task 3: Update the four call sites

**Files:**
- Modify: `src/app/(authed)/tasks/page.tsx`
- Modify: `src/app/(authed)/enrollment/page.tsx`
- Modify: `src/app/api/tasks/export/route.ts`
- Modify: `src/app/api/enrollment/export/route.ts`

**Interfaces:**
- Consumes: `canActorExport(permissions)` from Task 2.

- [ ] **Step 1: `tasks/page.tsx`**

The call is inside the `Promise.all` at `:66` as `canActorExport(actor)`. The session is already in scope as `session` (from `requireAnyPermission`), so change it to:

```ts
    canActorExport(session.user.permissions),
```

`canActorExport` is now synchronous. Leaving a plain boolean inside `Promise.all` is harmless — `Promise.all` accepts non-promises — so the surrounding array does not need restructuring. Keep the destructured `canExportImport` name and the prop passed to `<TaskBoardClient>` exactly as they are.

- [ ] **Step 2: `enrollment/page.tsx`**

Same shape, at `:61`:

```ts
    canActorExport(session.user.permissions),
```

- [ ] **Step 3: `api/tasks/export/route.ts`**

At `:56` the guard reads `if (!(await canActorExport(actorResult.actor))) {`. The route resolves its actor through the enrollment/task actor loader, which does **not** carry permissions — so re-read the top of this route and find the session. If the route already calls `auth()`, use `session?.user?.permissions`. If it only has an actor result, add an `auth()` call and take permissions from it.

Target shape:

```ts
  if (!canActorExport(session?.user?.permissions)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
```

Keep the existing status code and error body — do not "improve" the message; the client surfaces it.

> **[CODEX REVIEW] Dùng permissions từ cùng auth context đã tạo actor; không thêm
> `auth()` thứ hai. Đồng thời test route phải có case user có `task.export` nhưng
> thiếu cả `task.work`/`task.manage`: export vẫn phải bị board-access gate từ
> chối.**

- [ ] **Step 4: `api/enrollment/export/route.ts`**

Identical change at `:76`.

> **[CODEX REVIEW — BLOCKER] Không “identical” hoàn toàn: route Enrollment còn
> phải fetch record bằng actor-scoped query. Thêm regression test chứng minh một
> assistant có `task.export` chỉ export record thuộc agent họ assist, kể cả khi
> request body cố gửi ID của record ngoài scope.**

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → `No errors found` (closes the four errors from Task 2).
Run: `npx vitest run` → `FAIL (0)`, total up by the delta from Task 2's rewritten test file.
Run: `rtk proxy npx eslint "src/app/(authed)/tasks/page.tsx" "src/app/(authed)/enrollment/page.tsx" src/app/api/tasks/export/route.ts src/app/api/enrollment/export/route.ts` → clean.
Run: `rtk proxy grep -rn "canActorExport" src/` → exactly five hits (four call sites + the definition) and **no** occurrence still passing an actor.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authed)/tasks/page.tsx" "src/app/(authed)/enrollment/page.tsx" src/app/api/tasks/export/route.ts src/app/api/enrollment/export/route.ts
git commit -m "feat(rbac): pass session permissions to export gate"
```

---

### Task 4: Roll out — seed, grant, verify

**Files:** none modified. This task is database + operational.

- [ ] **Step 1: Apply the catalogue row**

Run the `insert into permissions … on conflict (key) do update` block from `supabase/schema.sql:163-185` against the target database, or re-run the whole file if that is the established process.

```sql
select key, label, group_key, sort_order from permissions where key = 'task.export';
```
Expected: one row.

⚠️ If re-running the whole `schema.sql`, be aware it also runs `delete from role_permissions … where r.name in ('Admin','Agent')` (`:281-285`) and rebuilds those two roles' grants. Any manual grant previously made to `Admin` or `Agent` is lost. Grants on other roles are untouched.

- [ ] **Step 2: Confirm `Admin` picked it up automatically**

```sql
select r.name
from role_permissions rp
join roles r on r.id = rp.role_id
where rp.permission_key = 'task.export'
order by r.name;
```
Expected: `Admin` present, because of the `cross join` seed at `:286-291`. If it is absent, the catalogue insert ran but the role-permission seed did not — re-run `:286-291`.

- [ ] **Step 3: Grant to `Admin Health Task` by hand, if that role exists**

```sql
select name, is_system, is_active from roles order by name;
```

If `Admin Health Task` (or `Task Admin`) is in the list, open `/role-manager` and tick **Tasks - Export** for it. This is deliberately a UI step, not SQL: `/role-manager` writes through `replace_role_permissions`, which keeps the role's permission set consistent.

- [ ] **Step 4: Find out who is about to lose export**

Run **before** deploying, so the blast radius is a known number rather than a surprise:

```sql
select a.email, a.role, coalesce(string_agg(r.name, ', ' order by r.name), '(no roles)') as roles
from portal_account a
left join user_roles ur on ur.user_id = a.id
left join roles r on r.id = ur.role_id
where a.is_active
  and a.id not in (
    select ur2.user_id
    from user_roles ur2
    join role_permissions rp on rp.role_id = ur2.role_id
    where rp.permission_key = 'task.export'
  )
group by a.email, a.role
order by a.email;
```

Everyone listed can export today (if they are a manager) and will not after deploy. Decide per person whether to grant.

> **[CODEX REVIEW — HIGH] Query trên liệt kê mọi active account chưa có
> `task.export`, không chỉ manager hiện đang export được, nên “blast radius” bị
> over-count. Cần lọc đúng tập actor mà `buildTaskActor(...).isManager` hiện trả
> true (bao gồm legacy/admin role-name rules), hoặc đổi nhãn query thành
> “accounts without export” và chạy một query riêng cho actual managers.**

- [ ] **Step 5: Manual verification after deploy**

- As an `Admin`-role user: the Import/Export menu is visible on `/tasks` and `/enrollment`, and both exports download.
- As a user **with** `task.export` but **without** `task.manage`: the menu is visible and export works. *(This is the new capability the change exists to enable.)*
- As a manager **without** `task.export`: the menu is hidden, and a direct `POST /api/tasks/export` returns **403**. Test the API directly — hiding the UI is not the enforcement.

> **[CODEX REVIEW] Case thứ hai vẫn phải cấp `task.work`; chỉ có `task.export`
> không đủ vào board vì page/API actor loader yêu cầu `task.manage` hoặc
> `task.work`. Ghi rõ precondition để manual test không cho kết quả 403 sai lý
> do.**

- [ ] **Step 6: Changelog**

Add an entry at the top of `## Unreleased`, marked **breaking**: export is now gated by the new `task.export` permission instead of manager status; one key covers both Tasks and Enrollment; the `Admin` system role receives it automatically via the existing catalogue seed, every other role must be granted it in `/role-manager`; `canActorExport` changed signature from `(actor)` to `(permissions)` and is no longer async.

```bash
git add agent-portal/changelog.md
git commit -m "docs(changelog): record export permission gate"
```

---

## Self-Review

**Spec coverage.** C1 (one shared key) → Task 1's single `TASK_EXPORT`. C2 (permission required, manager insufficient) → Task 2's implementation and its explicit "denies a manager" test. C3 (seed to admin roles) → Task 4 Steps 2–3, split because only `Admin` can be seeded; `Admin Health Task` is not a seeded role and must be granted through the UI.

**Placeholder scan.** No TBD. Every code step carries its code; every rollout step carries its SQL.

**Type consistency.** `canActorExport` has one signature — `(permissions: readonly string[] | undefined) => boolean` — used identically in the test, the implementation, and all four call sites. `PERMISSIONS.TASK_EXPORT` is spelled the same in Tasks 1 and 2.

**Risks deliberately front-loaded.**
- *Someone loses export on deploy day.* This is the intended behaviour, but Task 4 Step 4 turns it into a list of names beforehand instead of a support ticket afterwards.
- *Hiding the UI mistaken for enforcement.* Task 4 Step 5 requires testing the API directly with a manager who lacks the permission.
- *`session` not in scope in the two API routes.* Step 3 tells the implementer to re-read the route rather than assume, because the two export routes resolve their actor differently from the pages.
- *A schema re-run silently wiping manual grants on `Admin`/`Agent`.* Called out at Task 4 Step 1 with the exact line reference.

**Sequencing.** Task 1 → Task 2 → Task 3 (each consumes the previous). Task 4 is rollout and must follow a deploy. Independent of the other two plans in this set; can ship first or last.

> **[CODEX REVIEW — CORRECTION] Không independent: phải ship cùng/sau actor
> scoping của Enrollment export. Nếu buộc phải ship trước, tuyệt đối chưa grant
> `task.export` cho scoped agent/assistant; chỉ `Admin` được grant tạm thời.**
