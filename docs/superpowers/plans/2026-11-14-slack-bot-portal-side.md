# Slack Bot — phần sửa portal (Kế hoạch A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portal có (1) danh sách người được dùng Slack bot, quản lý tại trang `/slack-bot`, và (2) route chạy thử import Enrollment `/api/enrollment/import/dry-run` dùng đúng logic của import thật, để repo bot (Kế hoạch B, viết sau) gọi.

**Architecture:** Bảng mới `public.slack_bot_users` + quyền mới `slack_bot.manage` gác trang và API quản lý bảng đó. Vòng kiểm từng dòng trong `src/app/api/enrollment/import/route.ts` được tách nguyên văn sang `src/lib/enrollment/import-rows.ts`, thêm cờ `dryRun`; route import thật và route dry-run cùng gọi hàm này. Phần đọc ma trận Excel trong `EnrollmentImportDialog.tsx` được tách sang `recordsFromMatrix` trong `src/lib/enrollment/import.ts` để dialog và dry-run đọc file giống hệt nhau.

**Tech Stack:** Next.js (bản trong repo — đọc `node_modules/next/dist/docs/` trước khi viết route, theo `AGENTS.md`), TypeScript, Supabase JS (service role qua `getSupabaseAdmin()`), Vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-14-slack-support-bot-design.md` (§4, §6.3, §6.4).

## Global Constraints

- Làm trên **git worktree riêng tách từ `main` mới nhất**, không làm trong thư mục `agent-portal` chính: thư mục chính đang có code State Licensing chưa commit sửa cùng `permissions.ts`, `permission-matrix.ts`, `module-boundaries.test.ts`, `routes.ts`, `Sidebar.tsx`, `schema.sql`, `changelog.md`. Nếu State Licensing đã commit lên `main` trước khi bắt đầu thì tách từ commit đó; nếu chưa, tách từ `main` và khi merge thì giải xung đột bằng cách giữ cả hai phần.
- Máy dev trỏ thẳng **DB production**. Không chạy import thật khi test. Chỉ dùng dry-run và đọc.
- File rollout mới trong `supabase/rollouts/` **giữ local, không commit**. Chạy lên production **chỉ sau khi Bảo duyệt**, chạy thử trong transaction + rollback trước.
- Kế hoạch và spec này **không commit**. Chỉ commit code.
- **Không push.** Làm xong báo Bảo.
- Mọi thay đổi logic ghi `changelog.md` (mới nhất ở trên cùng, tiếng Việt).
- Không có cross-module grant: thư mục nào chỉ dùng hằng `PERMISSIONS` của module đó (`src/lib/rbac/module-boundaries.test.ts`).
- Lệnh kiểm chuẩn: `npm run lint`, `npx tsc --noEmit`, `npx vitest run`.
- Giao diện theo module Task: ít chữ mô tả, dùng ô tick, dialog kiểu "New enrollment", hiện tên người thay vì email thô khi có tên.

---

## File map

| File | Việc |
|---|---|
| `supabase/rollouts/2026-11-14-slack-bot-users.sql` (mới, KHÔNG commit) | Quyền `slack_bot.manage` + bảng `slack_bot_users` |
| `supabase/schema.sql` | Thêm đúng khối SQL như rollout (bản dựng DB mới) |
| `src/lib/rbac/permissions.ts` | Hằng `SLACK_BOT_MANAGE` + định nghĩa |
| `src/lib/rbac/module-boundaries.test.ts` | Module "Slack Bot" |
| `src/lib/rbac/routes.ts` | `/slack-bot` cuối `ACCESSIBLE_ROUTES` |
| `src/app/(authed)/_components/Sidebar.tsx` | Mục "Slack Bot" trong nhóm Account Management |
| `src/lib/slack-bot/users.ts` (mới) | Kiểu dữ liệu + kiểm input + đổi lỗi DB thành thông báo |
| `src/lib/slack-bot/users.test.ts` (mới) | Test cho file trên |
| `src/app/api/slack-bot/users/route.ts` (mới) | `GET` danh sách, `POST` thêm |
| `src/app/api/slack-bot/users/[id]/route.ts` (mới) | `PATCH` sửa, `DELETE` xoá |
| `src/app/(authed)/slack-bot/page.tsx` (mới) | Trang server: gác quyền, nạp dữ liệu |
| `src/app/(authed)/slack-bot/SlackBotUsersClient.tsx` (mới) | Bảng + dialog thêm/sửa |
| `src/lib/enrollment/import.ts` | Thêm `recordsFromMatrix` |
| `src/lib/enrollment/import.test.ts` | Test `recordsFromMatrix` |
| `src/app/(authed)/enrollment/_components/EnrollmentImportDialog.tsx` | Dùng `recordsFromMatrix` |
| `src/lib/enrollment/import-rows.ts` (mới) | Vòng kiểm/ghi từng dòng, có `dryRun` |
| `src/app/api/enrollment/import/route.ts` | Gọi `processEnrollmentImportRows` |
| `src/lib/enrollment/bot-secret.ts` (mới) + `.test.ts` | So secret của bot |
| `src/app/api/enrollment/import/dry-run/route.ts` (mới) | Route chạy thử |
| `AGENTS.md`, `changelog.md` | Ghi chú + changelog |

---

### Task 1: Rollout SQL — quyền `slack_bot.manage` và bảng `slack_bot_users`

**Files:**
- Create: `supabase/rollouts/2026-11-14-slack-bot-users.sql` (không commit)
- Modify: `supabase/schema.sql` (thêm cuối file)

**Interfaces:**
- Produces: bảng `public.slack_bot_users(id uuid, slack_email text, portal_account_id uuid null, can_diagnose bool, can_change_access bool, can_edit_code bool, can_approve bool, note text null, created_by_email text, updated_by_email text, created_at timestamptz, updated_at timestamptz)`; permission key `slack_bot.manage`; tên constraint `slack_bot_users_linked_for_write` (Task 3 dựa vào tên này để báo lỗi).

- [ ] **Step 1: Viết file rollout**

```sql
-- =====================================================================
-- Slack Bot (2026-11-14): danh sách người được dùng Slack bot ở #agent_portal
-- và quyền portal quản lý danh sách đó.
--
--   slack_bot.manage  "Slack Bot - Manage"  (mới)  — mở trang /slack-bot
--
-- Quyền dùng bot cấp THEO NGƯỜI (bảng slack_bot_users), không theo role:
-- mỗi account chỉ có đúng một role, và còn phải cấp cho email ngoài portal.
-- Không tick gì = Ask only. Change access / Edit code / Approve bắt buộc gắn
-- account portal.
--
-- Chạy TRƯỚC khi deploy code. Idempotent.
-- =====================================================================

begin;

insert into permissions (key, label, description, group_key, group_label, sort_order)
values (
  'slack_bot.manage',
  'Slack Bot - Manage',
  'Choose who can use the Slack bot in #agent_portal and what each person can ask it to do.',
  'slack_bot',
  'Slack Bot',
  100
)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  sort_order = excluded.sort_order;

-- Cấp cho các role đang có Role Manager (hiện chỉ Admin), như các quyền quản trị khác.
insert into role_permissions (role_id, permission_key)
select distinct rp.role_id, 'slack_bot.manage'
from role_permissions rp
where rp.permission_key = 'management.role_manager'
on conflict do nothing;

create table if not exists public.slack_bot_users (
  id uuid primary key default gen_random_uuid(),
  slack_email text not null,
  portal_account_id uuid references public.portal_account(id) on delete cascade,
  can_diagnose boolean not null default false,
  can_change_access boolean not null default false,
  can_edit_code boolean not null default false,
  can_approve boolean not null default false,
  note text,
  created_by_email text not null,
  updated_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slack_bot_users_email_shape check (slack_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint slack_bot_users_linked_for_write check (
    portal_account_id is not null
    or not (can_change_access or can_edit_code or can_approve)
  )
);

create unique index if not exists slack_bot_users_email_key
  on public.slack_bot_users (lower(btrim(slack_email)));
create index if not exists slack_bot_users_account_idx
  on public.slack_bot_users (portal_account_id);

alter table public.slack_bot_users enable row level security;
revoke all on table public.slack_bot_users from anon, authenticated;

notify pgrst, 'reload schema';

commit;
```

Ghi chú cho người làm: xoá account thì `on delete cascade` xoá luôn dòng quyền bot của người đó, đúng spec §4 ("account đã xoá thì mất mọi quyền bot"). Account chỉ bị **khoá** (`is_active = false`) thì dòng vẫn còn và bot từ chối (Kế hoạch B Task 6); mở khoá lại là dùng được tiếp. Ghi điều này vào changelog ở Task 9.

> **[codex review · cần sửa trước rollout]** Spec §4 quy định account đã xoá thì mất *mọi* quyền bot. Với `on delete set null`, dòng chỉ có `can_diagnose` vẫn tồn tại và Kế hoạch B sẽ cho dùng tiếp. Đề xuất `on delete cascade` để xoá luôn quyền bot khi xoá account; nếu muốn bắt quản trị viên gỡ quyền trước thì dùng `on delete restrict` và mô tả rõ thao tác. Thêm test cho trường hợp account liên kết bị xoá.
>
> **[claude · đồng ý, đã sửa]** Đúng, `set null` biến người bị xoá account thành "người ngoài portal" còn Diagnose, trái spec. Chọn `cascade` chứ không `restrict`: Account Manager có `delete_account_atomic`, bắt Admin vào `/slack-bot` gỡ trước chỉ thêm một bước dễ quên mà không thêm an toàn gì. Test: Step 3b dưới đây.

- [ ] **Step 3b (sau Step 3, cùng transaction thử): kiểm cascade.** Thêm vào bản `/tmp/slack-bot-dryrun.sql`, ngay trước `rollback;`:

```sql
-- Account tạm → dòng bot → xoá account → dòng bot phải mất.
insert into portal_account (email, name, is_active) values ('slack-bot-cascade-test@example.invalid', 'Cascade Test', true);
insert into slack_bot_users (slack_email, portal_account_id, can_diagnose, created_by_email, updated_by_email)
select 'cascade-test@example.invalid', id, true, 'test', 'test' from portal_account where email = 'slack-bot-cascade-test@example.invalid';
delete from portal_account where email = 'slack-bot-cascade-test@example.invalid';
do $$ begin
  if exists (select 1 from slack_bot_users where slack_email = 'cascade-test@example.invalid') then
    raise exception 'CASCADE_FAILED';
  end if;
end $$;
```

Expected: không có `CASCADE_FAILED`; cả transaction rollback nên không để lại dữ liệu. Nếu insert `portal_account` cần thêm cột bắt buộc khác, thêm đúng cột đó theo `schema.sql`.

- [ ] **Step 2: Thêm đúng khối SQL đó (bỏ `begin;` / `commit;` / `notify`) vào cuối `supabase/schema.sql`**, kèm dòng chú thích đầu khối `-- Slack Bot (rollout 2026-11-14-slack-bot-users.sql).`

- [ ] **Step 3: Kiểm cú pháp bằng cách chạy thử rồi rollback trên production — CHỈ sau khi Bảo duyệt.** Hỏi Bảo trước. Nếu được duyệt:

```bash
export PATH="/opt/homebrew/bin:$PATH"
cd <worktree>
sed 's/^commit;$/rollback;/' supabase/rollouts/2026-11-14-slack-bot-users.sql > /tmp/slack-bot-dryrun.sql
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw -f /tmp/slack-bot-dryrun.sql
```

Expected: không lỗi. Chưa chạy bản thật ở bước này (bản thật chạy ở Task 9, trước deploy).

- [ ] **Step 4: Commit `schema.sql` (không add file rollout)**

```bash
git add supabase/schema.sql
git commit -m "feat(slack-bot): add slack_bot_users table and slack_bot.manage permission to schema"
```

---

### Task 2: Quyền `SLACK_BOT_MANAGE` trong code, menu và trang đích

**Files:**
- Modify: `src/lib/rbac/permissions.ts`
- Modify: `src/lib/rbac/module-boundaries.test.ts`
- Modify: `src/lib/rbac/routes.ts`
- Modify: `src/app/(authed)/_components/Sidebar.tsx`
- Test: `src/lib/rbac/permissions.test.ts`

**Interfaces:**
- Produces: `PERMISSIONS.SLACK_BOT_MANAGE === "slack_bot.manage"`; module boundary prefix `lib/slack-bot/`, `app/api/slack-bot/`, `app/(authed)/slack-bot/` chỉ được dùng `SLACK_BOT_MANAGE`.

- [ ] **Step 1: Viết test fail** — thêm vào cuối `src/lib/rbac/permissions.test.ts`:

```ts
describe("slack bot permission", () => {
  it("is its own single-tick group, not placed in the matrix rows", () => {
    expect(PERMISSIONS.SLACK_BOT_MANAGE).toBe("slack_bot.manage");
    expect(PERMISSION_DEFINITIONS).toContainEqual(
      expect.objectContaining({ key: "slack_bot.manage", groupKey: "slack_bot", groupLabel: "Slack Bot" }),
    );
    // Không xếp vào ma trận → Role Manager hiện nó ở mục "Other" thành một ô tick.
    expect(PLACED_PERMISSION_KEYS.has("slack_bot.manage")).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, phải fail**

Run: `npx vitest run src/lib/rbac/permissions.test.ts`
Expected: FAIL — `PERMISSIONS.SLACK_BOT_MANAGE` là `undefined`.

- [ ] **Step 3: Sửa `src/lib/rbac/permissions.ts`**

Trong object `PERMISSIONS`, thêm dòng cuối trước `} as const;`:

```ts
  SLACK_BOT_MANAGE: "slack_bot.manage",
```

Trong mảng `PERMISSION_DEFINITIONS`, thêm phần tử (đặt cạnh định nghĩa `ROLE_MANAGER`):

```ts
  // Slack Bot (2026-11-14). Chữ phải khớp rollout 2026-11-14-slack-bot-users.sql.
  {
    key: PERMISSIONS.SLACK_BOT_MANAGE,
    label: "Slack Bot - Manage",
    groupKey: "slack_bot",
    groupLabel: "Slack Bot",
    description: "Choose who can use the Slack bot in #agent_portal and what each person can ask it to do.",
    sortOrder: 100,
  },
```

Không thêm vào `IMPLIED_PERMISSIONS`, không thêm vào `permission-matrix.ts`.

- [ ] **Step 4: Sửa `src/lib/rbac/module-boundaries.test.ts`** — thêm hằng và 3 dòng vào `MODULES`:

```ts
const SLACK_BOT = /^SLACK_BOT_MANAGE$/;
```

```ts
  { prefix: "lib/slack-bot/", allowed: SLACK_BOT, module: "Slack Bot" },
  { prefix: "app/api/slack-bot/", allowed: SLACK_BOT, module: "Slack Bot" },
  { prefix: "app/(authed)/slack-bot/", allowed: SLACK_BOT, module: "Slack Bot" },
```

- [ ] **Step 5: Sửa `src/lib/rbac/routes.ts`** — thêm phần tử **cuối** `ACCESSIBLE_ROUTES` (đặt cuối để không đổi trang đích sau đăng nhập của ai):

```ts
  {
    href: "/slack-bot",
    permission: PERMISSIONS.SLACK_BOT_MANAGE,
  },
```

- [ ] **Step 6: Sửa `src/app/(authed)/_components/Sidebar.tsx`**

Nhóm "Account Management" trong `menuData`:

```ts
  {
    title: "Account Management",
    anyPermission: [PERMISSIONS.ACCOUNT_MANAGER, PERMISSIONS.ROLE_MANAGER, PERMISSIONS.SLACK_BOT_MANAGE],
    children: [
      {
        href: "/account-manager",
        label: "Account Manager",
        permission: PERMISSIONS.ACCOUNT_MANAGER,
      },
      {
        href: "/role-manager",
        label: "Role Manager",
        permission: PERMISSIONS.ROLE_MANAGER,
      },
      {
        href: "/slack-bot",
        label: "Slack Bot",
        permission: PERMISSIONS.SLACK_BOT_MANAGE,
      },
    ],
  },
```

Trong `groupForPath`, điều kiện nhóm Account Management thêm `pathname.startsWith("/slack-bot") ||`.

- [ ] **Step 7: Chạy test, phải pass**

Run: `npx vitest run src/lib/rbac`
Expected: PASS hết (gồm `permissions.test.ts`, `module-boundaries.test.ts`, `no-role-name-authz.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add src/lib/rbac/permissions.ts src/lib/rbac/permissions.test.ts src/lib/rbac/module-boundaries.test.ts src/lib/rbac/routes.ts "src/app/(authed)/_components/Sidebar.tsx"
git commit -m "feat(slack-bot): add slack_bot.manage permission and menu entry"
```

---

### Task 3: Kiểm input danh sách Slack Bot (hàm thuần)

**Files:**
- Create: `src/lib/slack-bot/users.ts`
- Test: `src/lib/slack-bot/users.test.ts`

**Interfaces:**
- Produces:
  - `type SlackBotFlags = { can_diagnose: boolean; can_change_access: boolean; can_edit_code: boolean; can_approve: boolean }`
  - `type SlackBotUserInput = SlackBotFlags & { slack_email: string; portal_account_id: string | null; note: string | null }`
  - `type SlackBotUserRow = SlackBotUserInput & { id: string; created_by_email: string; updated_by_email: string; created_at: string; updated_at: string }`
  - `parseSlackBotUserInput(body: unknown): { ok: true; value: SlackBotUserInput } | { ok: false; error: string }`
  - `slackBotWriteFailure(error: { code?: string; message: string }): { status: 400 | 409 | 500; error: string }`
  - `SLACK_BOT_USER_COLUMNS: string` (chuỗi select cho Supabase)

- [ ] **Step 1: Viết test fail** — `src/lib/slack-bot/users.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSlackBotUserInput, slackBotWriteFailure } from "./users";

const base = {
  slack_email: "  Khang416@Gmail.com ",
  portal_account_id: "6f1c1f0e-8c1a-4d1b-9e55-0a1b2c3d4e5f",
  can_diagnose: true,
  can_change_access: true,
  can_edit_code: false,
  can_approve: true,
  note: "  Health support ",
};

describe("parseSlackBotUserInput", () => {
  it("trims and lower-cases the email and trims the note", () => {
    const result = parseSlackBotUserInput(base);
    expect(result).toEqual({
      ok: true,
      value: { ...base, slack_email: "khang416@gmail.com", note: "Health support" },
    });
  });

  it("accepts an outside email with nothing ticked (Ask only)", () => {
    const result = parseSlackBotUserInput({ slack_email: "someone@outside.com", portal_account_id: null });
    expect(result).toEqual({
      ok: true,
      value: {
        slack_email: "someone@outside.com",
        portal_account_id: null,
        can_diagnose: false,
        can_change_access: false,
        can_edit_code: false,
        can_approve: false,
        note: null,
      },
    });
  });

  it("rejects write abilities without a portal account", () => {
    for (const flag of ["can_change_access", "can_edit_code", "can_approve"] as const) {
      const result = parseSlackBotUserInput({ slack_email: "a@b.co", portal_account_id: null, [flag]: true });
      expect(result).toEqual({
        ok: false,
        error: "Change access, Edit code and Approve need a linked portal account.",
      });
    }
  });

  it("rejects a malformed email or account id", () => {
    expect(parseSlackBotUserInput({ slack_email: "not-an-email" })).toEqual({ ok: false, error: "Enter a valid Slack email." });
    expect(parseSlackBotUserInput({ slack_email: "a@b.co", portal_account_id: "abc" })).toEqual({
      ok: false,
      error: "Invalid portal account.",
    });
  });

  it("rejects non-boolean flags instead of guessing", () => {
    expect(parseSlackBotUserInput({ slack_email: "a@b.co", can_diagnose: "yes" })).toEqual({
      ok: false,
      error: "Invalid Slack bot permissions.",
    });
  });
});

describe("slackBotWriteFailure", () => {
  it("maps the unique email index to 409", () => {
    expect(slackBotWriteFailure({ code: "23505", message: "duplicate key" })).toEqual({
      status: 409,
      error: "This Slack email is already on the list.",
    });
  });

  it("maps the linked-account check to 400", () => {
    expect(
      slackBotWriteFailure({ code: "23514", message: 'violates check constraint "slack_bot_users_linked_for_write"' }),
    ).toEqual({ status: 400, error: "Change access, Edit code and Approve need a linked portal account." });
  });

  it("keeps other errors as 500", () => {
    expect(slackBotWriteFailure({ message: "boom" })).toEqual({ status: 500, error: "boom" });
  });
});
```

- [ ] **Step 2: Chạy test, phải fail**

Run: `npx vitest run src/lib/slack-bot/users.test.ts`
Expected: FAIL — không tìm thấy module `./users`.

- [ ] **Step 3: Viết `src/lib/slack-bot/users.ts`**

```ts
/**
 * Danh sách người được dùng Slack bot ở #agent_portal (2026-11-14).
 *
 * Quyền dùng bot cấp THEO NGƯỜI, không theo role: mỗi account chỉ có đúng một
 * role, và còn phải cấp cho email ngoài portal. Không tick gì = Ask only (bot
 * chỉ trả lời cách dùng portal, không tra dữ liệu). Change access / Edit code /
 * Approve chỉ cho người đã gắn account portal — DB cũng chặn bằng
 * slack_bot_users_linked_for_write.
 */

export type SlackBotFlags = {
  can_diagnose: boolean;
  can_change_access: boolean;
  can_edit_code: boolean;
  can_approve: boolean;
};

export type SlackBotUserInput = SlackBotFlags & {
  slack_email: string;
  portal_account_id: string | null;
  note: string | null;
};

export type SlackBotUserRow = SlackBotUserInput & {
  id: string;
  created_by_email: string;
  updated_by_email: string;
  created_at: string;
  updated_at: string;
};

export const SLACK_BOT_USER_COLUMNS =
  "id,slack_email,portal_account_id,can_diagnose,can_change_access,can_edit_code,can_approve,note,created_by_email,updated_by_email,created_at,updated_at";

const FLAG_KEYS = ["can_diagnose", "can_change_access", "can_edit_code", "can_approve"] as const;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEEDS_ACCOUNT = "Change access, Edit code and Approve need a linked portal account.";

export function parseSlackBotUserInput(
  body: unknown,
): { ok: true; value: SlackBotUserInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request." };
  }
  const input = body as Record<string, unknown>;

  const email = typeof input.slack_email === "string" ? input.slack_email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid Slack email." };

  const rawAccount = input.portal_account_id;
  let accountId: string | null = null;
  if (rawAccount !== undefined && rawAccount !== null && rawAccount !== "") {
    if (typeof rawAccount !== "string" || !UUID_RE.test(rawAccount)) {
      return { ok: false, error: "Invalid portal account." };
    }
    accountId = rawAccount;
  }

  const flags = {} as SlackBotFlags;
  for (const key of FLAG_KEYS) {
    const value = input[key];
    if (value === undefined) {
      flags[key] = false;
      continue;
    }
    if (typeof value !== "boolean") return { ok: false, error: "Invalid Slack bot permissions." };
    flags[key] = value;
  }
  if (!accountId && (flags.can_change_access || flags.can_edit_code || flags.can_approve)) {
    return { ok: false, error: NEEDS_ACCOUNT };
  }

  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null;

  return {
    ok: true,
    value: { slack_email: email, portal_account_id: accountId, ...flags, note },
  };
}

export function slackBotWriteFailure(error: { code?: string; message: string }): {
  status: 400 | 409 | 500;
  error: string;
} {
  if (error.code === "23505") return { status: 409, error: "This Slack email is already on the list." };
  if (error.code === "23514" && error.message.includes("slack_bot_users_linked_for_write")) {
    return { status: 400, error: NEEDS_ACCOUNT };
  }
  if (error.code === "23514") return { status: 400, error: "Enter a valid Slack email." };
  if (error.code === "23503") return { status: 400, error: "Invalid portal account." };
  return { status: 500, error: error.message };
}
```

- [ ] **Step 4: Chạy test, phải pass**

Run: `npx vitest run src/lib/slack-bot/users.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slack-bot/users.ts src/lib/slack-bot/users.test.ts
git commit -m "feat(slack-bot): validate Slack bot user input"
```

---

### Task 4: API quản lý danh sách

**Files:**
- Create: `src/app/api/slack-bot/users/route.ts`
- Create: `src/app/api/slack-bot/users/[id]/route.ts`
- Create: `src/lib/slack-bot/link-guard.ts`
- Test: `src/lib/slack-bot/link-guard.test.ts`

**Interfaces:**
- Consumes: `parseSlackBotUserInput`, `slackBotWriteFailure`, `SLACK_BOT_USER_COLUMNS`, `SlackBotUserRow` (Task 3); `PERMISSIONS.SLACK_BOT_MANAGE` (Task 2); `checkAccountChange` từ `src/lib/rbac/delegation.ts` (đã có: `checkAccountChange({ actorPermissions, isSelf, targetPermissionKeys })` trả `{ ok: true } | { ok: false; status; error }`); `fetchUserPermissionKeys(userId: string): Promise<string[]>` từ `src/lib/rbac/role-management.ts` (đã có).
- Produces:
  - `GET /api/slack-bot/users` → `{ users: SlackBotUserRow[] }`
  - `POST /api/slack-bot/users` body `SlackBotUserInput` → `201 { user: SlackBotUserRow }`
  - `PATCH /api/slack-bot/users/:id` body `SlackBotUserInput` (gửi đủ mọi trường) → `{ user: SlackBotUserRow }`
  - `DELETE /api/slack-bot/users/:id` → `{ ok: true }`
  - `checkSlackBotLink(input: { actorEmail: string; actorPermissions: readonly string[]; account: { id: string; email: string; is_active: boolean } | null; accountPermissionKeys: readonly string[] }): { ok: true } | { ok: false; status: 400 | 403; error: string }`

Vì sao cần `checkSlackBotLink`: gắn một Slack email vào account nào thì bot chạy thử import (và ở giai đoạn 2 là import thật) **dưới tên account đó**. Không chặn thì ai có `slack_bot.manage` cũng gắn được Slack email của mình vào account Admin. Dùng lại đúng trần uỷ quyền của Account Manager.

- [ ] **Step 1: Viết test fail** — `src/lib/slack-bot/link-guard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkSlackBotLink } from "./link-guard";

const account = { id: "a1", email: "dung.ha@epsins.co", is_active: true };

describe("checkSlackBotLink", () => {
  it("allows no link at all", () => {
    expect(
      checkSlackBotLink({ actorEmail: "x@y.co", actorPermissions: [], account: null, accountPermissionKeys: [] }),
    ).toEqual({ ok: true });
  });

  it("allows linking an account whose permissions the actor also holds", () => {
    expect(
      checkSlackBotLink({
        actorEmail: "bao.vo@excelplannings.com",
        actorPermissions: ["task.manage", "slack_bot.manage"],
        account,
        accountPermissionKeys: ["task.manage"],
      }),
    ).toEqual({ ok: true });
  });

  it("blocks linking an account with permissions the actor lacks", () => {
    expect(
      checkSlackBotLink({
        actorEmail: "someone@epsins.co",
        actorPermissions: ["slack_bot.manage"],
        account,
        accountPermissionKeys: ["management.role_manager"],
      }),
    ).toEqual({ ok: false, status: 403, error: "This account has permissions you do not have." });
  });

  it("blocks linking a disabled account", () => {
    expect(
      checkSlackBotLink({
        actorEmail: "bao.vo@excelplannings.com",
        actorPermissions: ["slack_bot.manage"],
        account: { ...account, is_active: false },
        accountPermissionKeys: [],
      }),
    ).toEqual({ ok: false, status: 400, error: "Link an active account." });
  });
});
```

- [ ] **Step 2: Chạy test, phải fail**

Run: `npx vitest run src/lib/slack-bot/link-guard.test.ts`
Expected: FAIL — không tìm thấy module.

- [ ] **Step 3: Viết `src/lib/slack-bot/link-guard.ts`**

```ts
import { checkAccountChange } from "@/lib/rbac/delegation";
import { fetchUserPermissionKeys } from "@/lib/rbac/role-management";
import type { getSupabaseAdmin } from "@/lib/supabase";

type LinkedAccount = { id: string; email: string; is_active: boolean };

/**
 * Gắn Slack email vào account nào thì bot chạy thử (và về sau ghi) dưới tên
 * account đó, nên dùng đúng trần uỷ quyền của Account Manager: không gắn được
 * account có quyền mà người sửa không có.
 */
export function checkSlackBotLink(input: {
  actorEmail: string;
  actorPermissions: readonly string[];
  account: LinkedAccount | null;
  accountPermissionKeys: readonly string[];
}): { ok: true } | { ok: false; status: 400 | 403; error: string } {
  if (!input.account) return { ok: true };
  if (!input.account.is_active) return { ok: false, status: 400, error: "Link an active account." };
  return checkAccountChange({
    actorPermissions: input.actorPermissions,
    isSelf: input.account.email.trim().toLowerCase() === input.actorEmail.trim().toLowerCase(),
    targetPermissionKeys: input.accountPermissionKeys,
  });
}

/** `null` = không gắn account; `"missing"` = id không tồn tại. */
export async function loadLink(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  accountId: string | null,
): Promise<null | "missing" | { account: LinkedAccount; permissionKeys: string[] }> {
  if (!accountId) return null;
  const { data, error } = await supabase
    .from("portal_account")
    .select("id,email,is_active")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return "missing";
  return { account: data as LinkedAccount, permissionKeys: await fetchUserPermissionKeys(accountId) };
}
```

`checkAccountChange` trả `DelegationResult = { ok: true } | { ok: false; status: 400 | 403; error: string }` (đã kiểm trong `src/lib/rbac/delegation.ts`), nên trả thẳng được. `fetchUserPermissionKeys` đọc DB nên `loadLink` không có unit test; nó được kiểm ở bước chạy tay Task 5 Step 3.

- [ ] **Step 4: Chạy test, phải pass**

Run: `npx vitest run src/lib/slack-bot`
Expected: PASS.

- [ ] **Step 5: Đọc tài liệu route handler** trong `node_modules/next/dist/docs/` (tìm "route handlers" và "dynamic params") để xác nhận `context.params` là Promise như `src/app/api/admin/users/[id]/route.ts` đang dùng.

- [ ] **Step 6: Viết `src/app/api/slack-bot/users/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  SLACK_BOT_USER_COLUMNS,
  parseSlackBotUserInput,
  slackBotWriteFailure,
} from "@/lib/slack-bot/users";
import { checkSlackBotLink, loadLink } from "@/lib/slack-bot/link-guard";

export const dynamic = "force-dynamic";

async function requireManager() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!can(session.user.permissions, PERMISSIONS.SLACK_BOT_MANAGE)) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, email, permissions: session.user.permissions ?? [] };
}

export async function GET() {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  const { data, error } = await getSupabaseAdmin()
    .from("slack_bot_users")
    .select(SLACK_BOT_USER_COLUMNS)
    .order("slack_email", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(req: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const parsed = parseSlackBotUserInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const link = await loadLink(supabase, parsed.value.portal_account_id);
  if (link === "missing") return NextResponse.json({ error: "Invalid portal account." }, { status: 400 });
  const allowed = checkSlackBotLink({
    actorEmail: guard.email,
    actorPermissions: guard.permissions,
    account: link?.account ?? null,
    accountPermissionKeys: link?.permissionKeys ?? [],
  });
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const { data, error } = await supabase
    .from("slack_bot_users")
    .insert({ ...parsed.value, created_by_email: guard.email, updated_by_email: guard.email })
    .select(SLACK_BOT_USER_COLUMNS)
    .single();
  if (error) {
    const failure = slackBotWriteFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
  return NextResponse.json({ user: data }, { status: 201 });
}
```

- [ ] **Step 7: Viết `src/app/api/slack-bot/users/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  SLACK_BOT_USER_COLUMNS,
  parseSlackBotUserInput,
  slackBotWriteFailure,
} from "@/lib/slack-bot/users";
import { checkSlackBotLink, loadLink } from "@/lib/slack-bot/link-guard";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function requireManager() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!can(session.user.permissions, PERMISSIONS.SLACK_BOT_MANAGE)) {
    return { ok: false as const, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true as const, email, permissions: session.user.permissions ?? [] };
}

export async function PATCH(req: Request, context: RouteContext) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;

  const parsed = parseSlackBotUserInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const link = await loadLink(supabase, parsed.value.portal_account_id);
  if (link === "missing") return NextResponse.json({ error: "Invalid portal account." }, { status: 400 });
  const allowed = checkSlackBotLink({
    actorEmail: guard.email,
    actorPermissions: guard.permissions,
    account: link?.account ?? null,
    accountPermissionKeys: link?.permissionKeys ?? [],
  });
  if (!allowed.ok) return NextResponse.json({ error: allowed.error }, { status: allowed.status });

  const { data, error } = await supabase
    .from("slack_bot_users")
    .update({ ...parsed.value, updated_by_email: guard.email, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(SLACK_BOT_USER_COLUMNS)
    .maybeSingle();
  if (error) {
    const failure = slackBotWriteFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ user: data });
}

export async function DELETE(_req: Request, context: RouteContext) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  const { id } = await context.params;
  const { data, error } = await getSupabaseAdmin()
    .from("slack_bot_users")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

`requireManager` lặp ở hai file: chấp nhận được (mỗi file 10 dòng, cùng mẫu với các route admin khác). Nếu reviewer muốn gộp thì đưa vào `src/lib/slack-bot/route-guard.ts`.

- [ ] **Step 8: Kiểm**

Run: `npm run lint && npx tsc --noEmit && npx vitest run src/lib/slack-bot src/lib/rbac`
Expected: không lỗi, test PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/slack-bot "src/app/api/slack-bot"
git commit -m "feat(slack-bot): API to manage who can use the Slack bot"
```

---

### Task 5: Trang `/slack-bot`

**Files:**
- Create: `src/app/(authed)/slack-bot/page.tsx`
- Create: `src/app/(authed)/slack-bot/SlackBotUsersClient.tsx`

**Interfaces:**
- Consumes: API Task 4; `SlackBotUserRow` (Task 3); `requirePermission` từ `src/lib/rbac/server.ts`; `TaskSelect` từ `src/app/(authed)/tasks/_components/TaskSelect.tsx` (props `label, value, options: {value,label}[], searchable, placeholder, onChange, buttonClassName, menuClassName, disabled`); `FIELD_INPUT_CLASS`, `FIELD_SELECT_BUTTON_CLASS`, `FormField` từ `src/app/(authed)/account-manager/AccountWorkFields.tsx`.

- [ ] **Step 1: Viết `src/app/(authed)/slack-bot/page.tsx`**

```tsx
import { requirePermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { SLACK_BOT_USER_COLUMNS, type SlackBotUserRow } from "@/lib/slack-bot/users";
import { SlackBotUsersClient } from "./SlackBotUsersClient";

export const dynamic = "force-dynamic";

export default async function SlackBotPage() {
  await requirePermission(PERMISSIONS.SLACK_BOT_MANAGE);
  const supabase = getSupabaseAdmin();
  const [usersRes, accountsRes] = await Promise.all([
    supabase.from("slack_bot_users").select(SLACK_BOT_USER_COLUMNS).order("slack_email", { ascending: true }),
    supabase.from("portal_account").select("id,email,name,is_active").order("name", { ascending: true }),
  ]);
  if (usersRes.error) throw new Error(usersRes.error.message);
  if (accountsRes.error) throw new Error(accountsRes.error.message);
  return (
    <SlackBotUsersClient
      initialUsers={(usersRes.data ?? []) as SlackBotUserRow[]}
      accounts={(accountsRes.data ?? []) as Array<{ id: string; email: string; name: string | null; is_active: boolean }>}
    />
  );
}
```

- [ ] **Step 2: Viết `src/app/(authed)/slack-bot/SlackBotUsersClient.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import type { SlackBotFlags, SlackBotUserInput, SlackBotUserRow } from "@/lib/slack-bot/users";
import { TaskSelect } from "../tasks/_components/TaskSelect";
import {
  FIELD_INPUT_CLASS as INPUT_CLASS,
  FIELD_SELECT_BUTTON_CLASS as SELECT_BUTTON_CLASS,
  FormField as Field,
} from "../account-manager/AccountWorkFields";

type Account = { id: string; email: string; name: string | null; is_active: boolean };

const FLAGS: Array<{ key: keyof SlackBotFlags; label: string; needsAccount: boolean }> = [
  { key: "can_diagnose", label: "Diagnose", needsAccount: false },
  { key: "can_change_access", label: "Change access", needsAccount: true },
  { key: "can_edit_code", label: "Edit code", needsAccount: true },
  { key: "can_approve", label: "Approve", needsAccount: true },
];

const EMPTY: SlackBotUserInput = {
  slack_email: "",
  portal_account_id: null,
  can_diagnose: false,
  can_change_access: false,
  can_edit_code: false,
  can_approve: false,
  note: null,
};

function accountLabel(account: Account | undefined): string {
  if (!account) return "—";
  const name = account.name?.trim() || account.email;
  return account.is_active ? name : `${name} (disabled)`;
}

export function SlackBotUsersClient({ initialUsers, accounts }: { initialUsers: SlackBotUserRow[]; accounts: Account[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [editing, setEditing] = useState<{ id: string | null; value: SlackBotUserInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const accountOptions = useMemo(
    () => accounts.filter((account) => account.is_active).map((account) => ({ value: account.id, label: `${accountLabel(account)} · ${account.email}` })),
    [accounts],
  );

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(editing.id ? `/api/slack-bot/users/${editing.id}` : "/api/slack-bot/users", {
        method: editing.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing.value),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not save.");
      const saved = payload.user as SlackBotUserRow;
      setUsers((current) =>
        [...current.filter((user) => user.id !== saved.id), saved].sort((a, b) => a.slack_email.localeCompare(b.slack_email)),
      );
      setEditing(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(user: SlackBotUserRow) {
    if (!window.confirm(`Remove ${user.slack_email} from the Slack bot?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/slack-bot/users/${user.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Could not remove.");
      setUsers((current) => current.filter((item) => item.id !== user.id));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "Could not remove.");
    } finally {
      setBusy(false);
    }
  }

  const value = editing?.value;
  const linked = Boolean(value?.portal_account_id);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[#172b4d]">Slack Bot</h1>
        <button
          type="button"
          onClick={() => setEditing({ id: null, value: EMPTY })}
          className="inline-flex h-9 items-center gap-1.5 rounded bg-[#0c66e4] px-3 text-sm font-bold text-white hover:bg-[#0055cc]"
        >
          <Plus className="h-4 w-4" /> Add person
        </button>
      </header>

      {error && !editing && (
        <p className="rounded border border-[#f87168] bg-[#ffeceb] px-3 py-2 text-sm text-[#ae2e24]">{error}</p>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[#dfe1e6] bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#fafbfc] text-left text-xs font-semibold uppercase text-[#626f86]">
            <tr>
              <th className="px-4 py-2">Slack email</th>
              <th className="px-4 py-2">Portal account</th>
              {FLAGS.map((flag) => (
                <th key={flag.key} className="px-3 py-2 text-center">{flag.label}</th>
              ))}
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={FLAGS.length + 3} className="px-4 py-10 text-center text-[#6b778c]">No one yet.</td>
              </tr>
            )}
            {users.map((user) => (
              <tr
                key={user.id}
                className="cursor-pointer border-t border-[#ebecf0] hover:bg-[#f7f8f9]"
                onClick={() => setEditing({ id: user.id, value: { ...user } })}
              >
                <td className="px-4 py-2 font-semibold text-[#172b4d]">{user.slack_email}</td>
                <td className="px-4 py-2 text-[#44546f]">
                  {user.portal_account_id ? accountLabel(accountById.get(user.portal_account_id)) : "Outside portal"}
                </td>
                {FLAGS.map((flag) => (
                  <td key={flag.key} className="px-3 py-2 text-center">{user[flag.key] ? "✓" : ""}</td>
                ))}
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    aria-label={`Remove ${user.slack_email}`}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      void remove(user);
                    }}
                    className="inline-flex h-8 w-8 items-center justify-center rounded text-[#626f86] hover:bg-[#f4f5f7] hover:text-[#ae2e24]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && value && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="flex max-h-[calc(100dvh-3rem)] w-full max-w-[520px] flex-col overflow-hidden rounded-lg bg-white shadow-[0_16px_48px_rgba(9,30,66,0.32)]"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-[#dfe1e6] px-6 py-4">
              <h2 className="text-lg font-semibold text-[#172b4d]">{editing.id ? "Edit person" : "Add person"}</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setEditing(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded text-[#626f86] hover:bg-[#f4f5f7]"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
              <Field label="Slack email" required>
                <input
                  className={INPUT_CLASS}
                  type="email"
                  value={value.slack_email}
                  placeholder="name@company.com"
                  onChange={(event) => setEditing({ ...editing, value: { ...value, slack_email: event.target.value } })}
                />
              </Field>

              <Field label="Portal account" hint="Leave empty for someone outside the portal.">
                <TaskSelect
                  label="Portal account"
                  value={value.portal_account_id ?? ""}
                  searchable
                  options={[{ value: "", label: "Outside portal" }, ...accountOptions]}
                  placeholder="Outside portal"
                  onChange={(next) => {
                    const accountId = next || null;
                    setEditing({
                      ...editing,
                      value: accountId
                        ? { ...value, portal_account_id: accountId }
                        : { ...value, portal_account_id: null, can_change_access: false, can_edit_code: false, can_approve: false },
                    });
                  }}
                  buttonClassName={SELECT_BUTTON_CLASS}
                  menuClassName="min-w-full"
                />
              </Field>

              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold text-[#44546f]">Can ask the bot to</legend>
                {FLAGS.map((flag) => {
                  const disabled = flag.needsAccount && !linked;
                  return (
                    <label key={flag.key} className={`flex items-center gap-2 text-sm ${disabled ? "text-[#a5adba]" : "text-[#172b4d]"}`}>
                      <input
                        type="checkbox"
                        checked={value[flag.key]}
                        disabled={disabled}
                        onChange={(event) => setEditing({ ...editing, value: { ...value, [flag.key]: event.target.checked } })}
                      />
                      {flag.label}
                      {disabled ? " (needs a portal account)" : ""}
                    </label>
                  );
                })}
                <p className="text-xs text-[#6b778c]">Nothing ticked: the bot only answers how-to questions.</p>
              </fieldset>

              <Field label="Note">
                <input
                  className={INPUT_CLASS}
                  type="text"
                  value={value.note ?? ""}
                  placeholder="Optional"
                  onChange={(event) => setEditing({ ...editing, value: { ...value, note: event.target.value || null } })}
                />
              </Field>

              {error && <p className="text-sm font-semibold text-[#ae2e24]">{error}</p>}
            </div>

            <footer className="flex shrink-0 justify-end gap-2 border-t border-[#dfe1e6] px-6 py-3">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="h-9 rounded px-3 text-sm font-semibold text-[#44546f] hover:bg-[#f1f2f4]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !value.slack_email.trim()}
                className="h-9 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:bg-[#091e420f] disabled:text-[#091e424f]"
              >
                {busy ? "Saving..." : "Save"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}
```

Kiểm trước khi code: mở `AccountWorkFields.tsx` xác nhận `FormField` nhận `label`, `required`, `hint`, `children`. Mở `TaskSelect.tsx` xác nhận option `value: ""` được chấp nhận (nếu không, đổi giá trị "Outside portal" thành hằng `"__none__"` và map về `null`).

- [ ] **Step 3: Chạy thử trên localhost (DB production, chỉ sau khi Bảo đã chạy rollout thật ở Task 9 Step 1 — nếu chưa thì bỏ qua bước này và làm ở Task 9)**

Run: `npm run dev`, đăng nhập bằng account có `slack_bot.manage`, mở `/slack-bot`.
Kiểm tay: thêm `test-bot@example.com` không gắn account → chỉ tick được Diagnose; gắn account → tick được hết; lưu trùng email → báo "This Slack email is already on the list."; xoá dòng test.

- [ ] **Step 4: Kiểm**

Run: `npm run lint && npx tsc --noEmit && npx vitest run src/lib/rbac/module-boundaries.test.ts`
Expected: không lỗi.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/slack-bot"
git commit -m "feat(slack-bot): Slack Bot page to manage bot users"
```

---

### Task 6: Tách phần đọc ma trận Excel thành `recordsFromMatrix`

**Files:**
- Modify: `src/lib/enrollment/import.ts`
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentImportDialog.tsx` (đoạn trong `try { ... }` sau `XLSX.utils.sheet_to_json`, khoảng dòng 146–177)
- Test: `src/lib/enrollment/import.test.ts`

**Interfaces:**
- Produces: `recordsFromMatrix(matrix: readonly (readonly unknown[])[], firstRow?: number): { headers: string[]; records: Record<string, unknown>[]; rowNumbers: number[] }` — throw `Error("The first row must contain column headers.")` khi không có tiêu đề. `headers` là khoá đã qua `uniqueImportHeaders` và bỏ khoá rỗng, đúng như `nextHeaders` của dialog hiện tại. `rowNumbers[i]` là số dòng Excel của `records[i]` (đếm cả dòng trống bị bỏ). `firstRow` là số dòng Excel của `matrix[0]` (mặc định 1).
- Modifies: `parseEnrollmentImportRows(records, matched, columns, context, rowNumbers?: readonly number[])` — tham số thứ 5 mới, tuỳ chọn; có thì dùng `rowNumbers[index]` làm số dòng, không có thì giữ `index + 2` như cũ.
- Mọi chỗ đọc sheet (dialog, bot) phải gọi `sheet_to_json(sheet, { header: 1, defval: null, blankrows: true })` và truyền `firstRow = XLSX.utils.decode_range(sheet["!ref"] ?? "A1").s.r + 1`, để chỉ số trong ma trận khớp dòng Excel.

- [ ] **Step 1: Viết test fail** — thêm vào `src/lib/enrollment/import.test.ts` (import thêm `recordsFromMatrix` và `importHeaderLabel` ở đầu file):

```ts
describe("recordsFromMatrix", () => {
  it("keeps two columns with the same title apart and drops blank rows", () => {
    const { headers, records } = recordsFromMatrix([
      ["Client Name", "ID", "ID", ""],
      ["Ann", "M-1", null, "x"],
      [null, "", "  ", null],
      ["Bob", null, "M-2", null],
    ]);
    expect(headers.map(importHeaderLabel)).toEqual(["Client Name", "ID", "ID"]);
    expect(records).toHaveLength(2);
    expect(records[0][headers[1]]).toBe("M-1");
    expect(records[1][headers[2]]).toBe("M-2");
  });

  it("keeps the real Excel row number across blank rows and a sheet that starts below row 1", () => {
    const matrix = [["Client Name"], ["Ann"], [null], ["Bob"]];
    expect(recordsFromMatrix(matrix).rowNumbers).toEqual([2, 4]);
    expect(recordsFromMatrix(matrix, 3).rowNumbers).toEqual([4, 6]);
  });

  it("rejects a sheet without headers", () => {
    expect(() => recordsFromMatrix([[null, ""], ["a", "b"]])).toThrow("The first row must contain column headers.");
  });
});
```

Thêm một case vào `describe` sẵn có của `parseEnrollmentImportRows` trong cùng file test (dùng lại fixture `columns` / `context` mà các case khác đang dùng): hai record, record thứ hai thiếu Client Name, truyền `rowNumbers = [2, 7]` → `skipped` phải là `[{ row: 7, reason: "Missing Client Name" }]`.

- [ ] **Step 2: Chạy test, phải fail**

Run: `npx vitest run src/lib/enrollment/import.test.ts -t recordsFromMatrix`
Expected: FAIL — `recordsFromMatrix` không tồn tại.

- [ ] **Step 3: Thêm vào `src/lib/enrollment/import.ts`** (ngay sau `importHeaderLabel`). Đây là đúng đoạn code đang nằm trong dialog, chuyển nguyên văn:

```ts
/**
 * Ma trận đọc từ sheet (dòng đầu là tiêu đề) → tiêu đề + từng dòng.
 *
 * Đọc theo vị trí chứ không dùng chế độ object của sheet_to_json: hai cột trùng
 * tên (file ACA cũ có hai cột "ID") phải giữ ô của riêng mình. Dialog import và
 * route dry-run của Slack bot cùng dùng hàm này để đọc file y như nhau.
 */
export function recordsFromMatrix(
  matrix: readonly (readonly unknown[])[],
  firstRow = 1,
): { headers: string[]; records: Record<string, unknown>[]; rowNumbers: number[] } {
  const keys = uniqueImportHeaders((matrix[0] ?? []).map((value) => String(value ?? "").trim()));
  const headers = keys.filter((key) => importHeaderLabel(key) !== "");
  if (headers.length === 0) throw new Error("The first row must contain column headers.");
  const records: Record<string, unknown>[] = [];
  const rowNumbers: number[] = [];
  matrix.forEach((row, index) => {
    if (index === 0) return;
    if (!row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== "")) return;
    const record: Record<string, unknown> = {};
    keys.forEach((key, column) => {
      if (key) record[key] = row[column] ?? null;
    });
    records.push(record);
    // Dòng trống bị bỏ nhưng vẫn được đếm: lỗi phải chỉ đúng dòng người dùng thấy.
    rowNumbers.push(firstRow + index);
  });
  return { headers, records, rowNumbers };
}
```

Sửa `parseEnrollmentImportRows` trong cùng file: thêm tham số cuối `rowNumbers?: readonly number[]`, và đổi

```ts
    const excelRow = index + 2;
```

thành

```ts
    const excelRow = rowNumbers?.[index] ?? index + 2;
```

> **[codex review · đề xuất]** `.filter(...)` bỏ dòng trống trước khi `parseEnrollmentImportRows` tính `index + 2`, nên lỗi sau một dòng trống sẽ mang số dòng Excel sai. Giữ `sourceRow` của từng record qua parser, hoặc để parser nhận ma trận gốc và tự bỏ dòng trống mà vẫn giữ chỉ số. Test file có dòng trống giữa hai dòng dữ liệu.
>
> **[claude · đồng ý, đã sửa]** Đúng, và đây là lỗi **đang có sẵn** trong dialog import trên production (không phải do lần tách này): file có dòng trống thì "Row N" trong hộp lỗi lệch. Sửa theo cách thứ nhất (`rowNumbers` đi kèm records, tham số tuỳ chọn để không đổi chữ ký cũ). Mình bổ sung thêm một nguyên nhân lệch khác Codex chưa nêu: sheet có vùng dữ liệu bắt đầu dưới dòng 1 (`!ref` = `A3:…`), nên thêm `firstRow`. Ghi vào changelog như một bug fix.

- [ ] **Step 4: Sửa dialog** — trong `EnrollmentImportDialog.tsx`, thay đoạn từ `const keys = uniqueImportHeaders(` tới hết `.map((row) => { ... });` (gán `nextRecords`) bằng:

```ts
      const { headers: nextHeaders, records: nextRecords, rowNumbers } = recordsFromMatrix(
        matrix,
        XLSX.utils.decode_range(sheet["!ref"] ?? "A1").s.r + 1,
      );
```

Ngay trên đó, đổi lệnh đọc thành `XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: true })`. Lưu `rowNumbers` vào state cạnh `records` (ví dụ `const [rowNumbers, setRowNumbers] = useState<number[]>([])`, gọi `setRowNumbers(rowNumbers)` cạnh `setRecords(nextRecords)`, reset về `[]` trong `reset()`), và truyền vào `parseEnrollmentImportRows(records, matched, columns, context, rowNumbers)` trong `useMemo` (thêm `rowNumbers` vào mảng phụ thuộc).

Thêm `recordsFromMatrix` vào import từ `@/lib/enrollment/import`. Bỏ `uniqueImportHeaders` khỏi import nếu không còn dùng chỗ nào trong file (giữ `importHeaderLabel` nếu còn dùng).

- [ ] **Step 5: Chạy test, phải pass**

Run: `npx vitest run src/lib/enrollment && npx tsc --noEmit && npm run lint`
Expected: PASS, không lỗi.

- [ ] **Step 6: Commit**

```bash
git add src/lib/enrollment/import.ts src/lib/enrollment/import.test.ts "src/app/(authed)/enrollment/_components/EnrollmentImportDialog.tsx"
git commit -m "refactor(enrollment-import): read the sheet matrix in one shared helper"
```

---

### Task 7: Tách vòng kiểm từng dòng ra `processEnrollmentImportRows` (có `dryRun`)

**Files:**
- Create: `src/lib/enrollment/import-rows.ts`
- Modify: `src/app/api/enrollment/import/route.ts`

**Interfaces:**
- Produces:

```ts
export type EnrollmentImportRowInput = { row?: unknown; id?: unknown; body?: unknown };
export type EnrollmentImportResult = {
  created: number;
  updated: number;
  failed: { row: number; error: string }[];
};
export async function processEnrollmentImportRows(input: {
  program: EnrollmentProgram;
  rows: EnrollmentImportRowInput[];
  actorEmail: string;
  dryRun: boolean;
}): Promise<{ ok: true; result: EnrollmentImportResult } | { ok: false; response: NextResponse }>;
```

Khi `dryRun: true`: chạy **mọi bước kiểm** như import thật (patch, custom values, cột bắt buộc, chủ sở hữu, Record ID có tồn tại không), **không** gọi `.update(...)`, **không** gọi `create_enrollment_atomic`, **không** broadcast. `created` / `updated` là số dòng **sẽ** được tạo / cập nhật.

Lỗi chỉ có khi ghi thật (ví dụ constraint DB lúc insert) thì dry-run không bắt được. Ghi điều này trong comment đầu hàm.

> **[codex review · đề xuất]** Thêm test tích hợp cho hai bất biến trước khi chuyển route: (1) dry-run không gọi bất kỳ lệnh ghi/broadcast nào và số dòng DB không đổi; (2) cùng input cho ra cùng lỗi *kiểm tra* ở dry-run và import thật. Ghi rõ lỗi chỉ phát sinh ở bước ghi DB nằm ngoài cam kết tương đương, rồi kiểm thử giới hạn thời gian với file gần 1.000 dòng.
>
> **[claude · đồng ý một phần]** Đồng ý cần kiểm cả hai bất biến và thời gian chạy. **Không đồng ý làm bằng test tích hợp với DB:** máy dev và mọi môi trường hiện có đều trỏ thẳng DB production, nên bất biến (2) muốn chạy "import thật" là ghi hồ sơ thật lên production. Thay bằng unit test có `vi.mock` (repo đã dùng cách này, ví dụ `src/lib/rbac/role-deletion-route.test.ts`): giả lập Supabase và các hàm kiểm, rồi chạy cùng input với `dryRun` true/false, so `failed` và đếm lệnh ghi. Bất biến (1) phần "số dòng DB không đổi" giữ ở bước chạy tay Task 8 Step 7 (chỉ đọc count). Thời gian chạy 1.000 dòng: thêm Step 4b dưới đây, đo bằng dry-run (không ghi), hỏi Bảo trước vì nó tạo khoảng 2.000 câu đọc lên DB production.

- [ ] **Step 1: Tạo `src/lib/enrollment/import-rows.ts`** bằng cách **chuyển nguyên văn** từ `src/app/api/enrollment/import/route.ts`: các hằng `STRING_FIELDS`, `OPTION_FIELDS`, `COLUMN_KEY_BY_FIELD`, kiểu `IncomingRow` (đổi tên thành `EnrollmentImportRowInput`, export), hàm `cleanText`, `buildRowPatch`, `checkOwnership`, và toàn bộ thân vòng `for (const raw of payload.rows ...)` cùng khối broadcast cuối. Bọc như sau:

```ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
// ...mọi import mà vòng lặp + buildRowPatch + checkOwnership đang dùng, chép từ route.ts
// (parseEnrollmentDate, assertEnrollmentOptionSet, fetchEnrollmentOptionData, firstStageOption,
//  enrollmentOwnershipFieldLabel, validateEnrollmentOwnership, readCarrierIdsInput,
//  sanitizeEnrollmentPatchForProgram, broadcastEnrollmentChanged, enrollmentSchemaErrorResponse,
//  EnrollmentProgram, customValueIssuesMessage, isCustomValueRecord, validateCustomValues,
//  findMissingRequiredFieldsFromContext, missingRequiredFieldsMessage,
//  fetchWriteValidationContext, reminderResetForDueChange)

/**
 * Kiểm (và nếu không phải dryRun thì ghi) từng dòng import Enrollment.
 *
 * Tách khỏi route 2026-11-14 để route dry-run của Slack bot dùng ĐÚNG luật của
 * import thật. dryRun chạy mọi bước kiểm nhưng bỏ update / create_enrollment_atomic
 * / broadcast. Lỗi chỉ xuất hiện lúc ghi (constraint DB khi insert) thì dry-run
 * không bắt được.
 */
export async function processEnrollmentImportRows(input: {
  program: EnrollmentProgram;
  rows: EnrollmentImportRowInput[];
  actorEmail: string;
  dryRun: boolean;
}): Promise<{ ok: true; result: EnrollmentImportResult } | { ok: false; response: NextResponse }> {
  const { program, rows, actorEmail, dryRun } = input;
  const supabase = getSupabaseAdmin();
  const optionData = await fetchEnrollmentOptionData(program);
  const nowIso = new Date().toISOString();
  const failed: { row: number; error: string }[] = [];
  let created = 0;
  let updated = 0;

  for (const raw of rows) {
    // ... thân vòng lặp chép NGUYÊN VĂN từ route.ts, với 4 chỗ đổi:
    //   (1) `actorResult.actor.email` → `actorEmail`
    //   (2) ngay TRƯỚC `if (recordId) { const { data, error } = await supabase.from("enrollment_records").update(`
    //       thêm:   if (dryRun) { if (recordId) updated += 1; else created += 1; continue; }
    //       (khối select `current` ở trên vẫn chạy trong dryRun, nên "No record found with this ID." vẫn được báo)
    //   (3) `if (schemaResponse) return schemaResponse;` → `if (schemaResponse) return { ok: false, response: schemaResponse };`
    //   (4) không đổi gì khác
  }

  if (!dryRun && (created > 0 || updated > 0)) {
    await broadcastEnrollmentChanged(program).catch(() => undefined);
  }

  return { ok: true, result: { created, updated, failed } };
}
```

Bước (2) cụ thể: sau đoạn

```ts
      const sanitized = sanitizeEnrollmentPatchForProgram(program, record);
```

thêm

```ts
      if (dryRun) {
        if (recordId) updated += 1;
        else created += 1;
        continue;
      }
```

- [ ] **Step 2: Sửa route** — `src/app/api/enrollment/import/route.ts` còn lại: các import cần cho phần đầu (`NextResponse`, `loadEnrollmentActor`, `canActorImport`, `parseEnrollmentProgram`), hằng `MAX_ROWS`, comment khối giải thích, và `POST` rút gọn:

```ts
export async function POST(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json({ error: actorResult.error }, { status: actorResult.status });
  }
  if (!canActorImport(actorResult.permissions)) {
    return NextResponse.json({ error: "You do not have permission to import." }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as { program?: unknown; rows?: unknown } | null;
  const program = parseEnrollmentProgram(payload?.program);
  if (!program) {
    return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  }
  if (!payload || !Array.isArray(payload.rows)) {
    return NextResponse.json({ error: "rows must be an array." }, { status: 400 });
  }
  if (payload.rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `At most ${MAX_ROWS} rows per import.` }, { status: 400 });
  }

  const outcome = await processEnrollmentImportRows({
    program,
    rows: payload.rows as EnrollmentImportRowInput[],
    actorEmail: actorResult.actor.email,
    dryRun: false,
  });
  if (!outcome.ok) return outcome.response;
  return NextResponse.json(outcome.result);
}
```

Giữ nguyên comment khối "Nhập hồ sơ Enrollment từ file Excel..." phía trên `POST` và comment của `MAX_ROWS`.

- [ ] **Step 2b: Unit test hai bất biến** — `src/lib/enrollment/import-rows.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const writes = { update: 0, rpc: 0, broadcast: 0 };

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        // Record ID "missing" không tồn tại; mọi id khác tồn tại.
        maybeSingle: async () => ({ data: currentId === "missing" ? null : { custom_values: {}, due_date: null }, error: null }),
        update: () => {
          writes.update += 1;
          return chain;
        },
      };
      return chain;
    },
    rpc: async () => {
      writes.rpc += 1;
      return { data: "new-id", error: null };
    },
  }),
}));
let currentId: string | null = null;

vi.mock("@/lib/enrollment/options", () => ({
  fetchEnrollmentOptionData: async () => ({ optionsBySet: { stage: [{ id: "stage-1" }] } }),
  assertEnrollmentOptionSet: async (id: string) => {
    if (id === "bad") throw new Error("Invalid Stage option.");
    return { id };
  },
  firstStageOption: () => ({ id: "stage-1" }),
}));
vi.mock("@/lib/enrollment/ownership", () => ({
  validateEnrollmentOwnership: async (patch: { agent_email: string | null }) =>
    patch.agent_email === "gone@x.co" ? { field: "agent_email" } : null,
  enrollmentOwnershipFieldLabel: () => "Agent",
}));
vi.mock("@/lib/table-config/write-context", () => ({ fetchWriteValidationContext: async () => ({}) }));
vi.mock("@/lib/table-config/custom-values", () => ({
  isCustomValueRecord: (value: unknown) => typeof value === "object" && value !== null,
  validateCustomValues: () => ({ ok: true, values: {} }),
  customValueIssuesMessage: () => "Invalid custom value",
}));
vi.mock("@/lib/table-config/required", () => ({
  findMissingRequiredFieldsFromContext: (_ctx: unknown, input: { fieldValues: Record<string, unknown>; partial: boolean }) =>
    !input.partial && !input.fieldValues.fub ? ["FUB Link"] : [],
  missingRequiredFieldsMessage: (missing: string[]) => `Missing required: ${missing.join(", ")}`,
}));
vi.mock("@/lib/enrollment/realtime", () => ({
  broadcastEnrollmentChanged: async () => {
    writes.broadcast += 1;
  },
}));

const { processEnrollmentImportRows } = await import("./import-rows");

const rows = [
  { row: 2, id: null, body: { client_name: "A", fub_link: "https://x", agent_email: "a@x.co" } }, // tạo được
  { row: 3, id: null, body: { client_name: "B", agent_email: "a@x.co" } }, // thiếu FUB Link
  { row: 4, id: null, body: { client_name: "C", fub_link: "https://x", agent_email: "gone@x.co" } }, // agent không hợp lệ
  { row: 5, id: null, body: { client_name: "D", fub_link: "https://x", stage_id: "bad" } }, // stage sai
];

describe("processEnrollmentImportRows", () => {
  beforeEach(() => {
    writes.update = 0;
    writes.rpc = 0;
    writes.broadcast = 0;
    currentId = null;
  });

  it("dry run writes nothing and broadcasts nothing", async () => {
    const outcome = await processEnrollmentImportRows({ program: "aca", rows, actorEmail: "me@x.co", dryRun: true });
    expect(outcome.ok && outcome.result.created).toBe(1);
    expect(writes).toEqual({ update: 0, rpc: 0, broadcast: 0 });
  });

  it("dry run and real import report the same validation failures", async () => {
    const dry = await processEnrollmentImportRows({ program: "aca", rows, actorEmail: "me@x.co", dryRun: true });
    const real = await processEnrollmentImportRows({ program: "aca", rows, actorEmail: "me@x.co", dryRun: false });
    expect(dry.ok && real.ok).toBe(true);
    if (!dry.ok || !real.ok) return;
    expect(dry.result.failed).toEqual(real.result.failed);
    expect(dry.result.failed.map((failure) => failure.row)).toEqual([3, 4, 5]);
    expect(writes.rpc).toBe(1);
    expect(writes.broadcast).toBe(1);
  });

  it("dry run still reports an unknown Record ID", async () => {
    currentId = "missing";
    const outcome = await processEnrollmentImportRows({
      program: "aca",
      rows: [{ row: 2, id: "missing", body: { client_name: "A" } }],
      actorEmail: "me@x.co",
      dryRun: true,
    });
    expect(outcome.ok && outcome.result.failed).toEqual([{ row: 2, error: "No record found with this ID." }]);
  });
});
```

Ghi chú: mock phải khớp đúng đường dẫn import mà `import-rows.ts` dùng. Hàm nào `import-rows.ts` import thêm (ví dụ `readCarrierIdsInput`, `sanitizeEnrollmentPatchForProgram`, `parseEnrollmentDate`, `reminderResetForDueChange`, `enrollmentSchemaErrorResponse`) thì để dùng bản thật nếu là hàm thuần; nếu nó chạm DB hay mạng thì mock thêm. Biến `currentId` được đọc lúc gọi `maybeSingle`, nên khai báo sau `vi.mock` vẫn đúng (mock được hoist, còn hàm bên trong chạy lúc test). Nếu Vitest báo lỗi hoist với biến ngoài, chuyển `writes`/`currentId` vào `vi.hoisted(() => ({ ... }))`.

Run: `npx vitest run src/lib/enrollment/import-rows.test.ts` · Expected: PASS.

- [ ] **Step 3: So diff để chắc chỉ là chuyển code**

Run: `git diff -M --stat && git diff src/app/api/enrollment/import/route.ts | grep '^-' | grep -v '^---' | wc -l`
Rồi đọc `src/lib/enrollment/import-rows.ts` cạnh bản `git show HEAD:src/app/api/enrollment/import/route.ts`: mọi dòng của vòng lặp, `buildRowPatch`, `checkOwnership` phải giống hệt, ngoài 3 chỗ đổi ở Step 1.

- [ ] **Step 4: Kiểm**

Run: `npm run lint && npx tsc --noEmit && npx vitest run src/lib/enrollment src/lib/rbac`
Expected: không lỗi, test PASS (`module-boundaries` vẫn pass vì `lib/enrollment/` chỉ dùng hằng `TASK_*`).

- [ ] **Step 4b: Đo thời gian 1.000 dòng (sau Task 8, hỏi Bảo trước, ngoài giờ cao điểm)** — tạo file 1.000 dòng giả từ template ACA (Client Name `TEST 0001`…, FUB Link `https://example.invalid/n`, Agent là tên Bảo), gọi dry-run như Task 8 Step 7 và đo `time curl ...`. Ghi kết quả vào changelog. Nếu quá 120 giây (mức bot chờ), dừng và báo Bảo trước khi làm tiếp Kế hoạch B; cách giảm là gom `fetchWriteValidationContext` theo bộ cột thay vì gọi mỗi dòng, làm thành một thay đổi riêng.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/import-rows.ts src/lib/enrollment/import-rows.test.ts src/app/api/enrollment/import/route.ts
git commit -m "refactor(enrollment-import): move the per-row checks into a shared function with a dry-run mode"
```

---

### Task 8: Route chạy thử `/api/enrollment/import/dry-run`

**Files:**
- Create: `src/lib/enrollment/bot-secret.ts`
- Test: `src/lib/enrollment/bot-secret.test.ts`
- Create: `src/app/api/enrollment/import/dry-run/route.ts`

**Interfaces:**
- Consumes: `processEnrollmentImportRows`, `EnrollmentImportRowInput` (Task 7); `recordsFromMatrix` (Task 6); đã có: `matchEnrollmentHeaders(headers, columns, records)`, `parseEnrollmentImportRows(records, matched, columns, context)`, `buildEnrollmentImportContext(options, people, customOptions)`, `enrollmentImportPayload(values, columns)`, `importHeaderLabel(header)`, `ENROLLMENT_IMPORT_MAX_ROWS` (đều trong `src/lib/enrollment/import.ts`); `fetchTableColumns(program)`, `fetchTableColumnOptions(program)` (`src/lib/table-config/queries.ts`); `fetchEnrollmentOptionData(program)` (`src/lib/enrollment/options.ts`, trả `{ options }` có `set_key`); `fetchEnrollmentPeople()` (`src/lib/enrollment/queries.ts`); `getUserAccessByEmail(email)` (`src/lib/rbac/access.ts`); `buildTaskActor(permissions, email)` (`src/lib/tasks/access.ts`); `canAccessEnrollment(actor)` (`src/lib/enrollment/access.ts` — xác nhận tên export khi code); `canActorImport(permissions)` (`src/lib/table-config/export-access.ts`).
- Produces (cho Kế hoạch B):
  - `POST /api/enrollment/import/dry-run`
  - Header: `Authorization: Bearer <BOT_PORTAL_SECRET>`
  - Body: `{ program: "aca" | "medicare" | "medicaid" | "other_service"; actor_email: string; rows: unknown[][]; first_row?: number }`. `rows` là **cả ma trận sheet**, dòng 0 là tiêu đề, đúng như `XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: true })`. `first_row` là số dòng Excel của `rows[0]` (mặc định 1).
  - 200: `{ header_matches: { matched: { header: string; key: string }[]; id_header: string | null; ignored: string[]; managed: string[] }; skipped: { row: number; reason: string }[]; created: number; updated: number; failed: { row: number; error: string }[] }`
  - 401 sai/thiếu secret; 503 server chưa cấu hình secret; 403 `actor_email` không có account active, không vào được Enrollment hoặc không có `task.import`; 400 body sai hoặc quá `ENROLLMENT_IMPORT_MAX_ROWS` dòng.

- [ ] **Step 1: Viết test fail** — `src/lib/enrollment/bot-secret.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { botSecretMatches } from "./bot-secret";

describe("botSecretMatches", () => {
  const secret = "s3cret-value-with-enough-length-1234";

  it("accepts the exact bearer secret", () => {
    expect(botSecretMatches(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("rejects a wrong, missing or differently sized secret", () => {
    expect(botSecretMatches(`Bearer ${secret}x`, secret)).toBe(false);
    expect(botSecretMatches("Bearer short", secret)).toBe(false);
    expect(botSecretMatches(null, secret)).toBe(false);
    expect(botSecretMatches(secret, secret)).toBe(false);
  });

  it("never matches when the server has no secret configured", () => {
    expect(botSecretMatches("Bearer ", "")).toBe(false);
    expect(botSecretMatches("Bearer anything", undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, phải fail**

Run: `npx vitest run src/lib/enrollment/bot-secret.test.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết `src/lib/enrollment/bot-secret.ts`**

```ts
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * So header Authorization với BOT_PORTAL_SECRET mà không lộ độ dài hay vị trí
 * ký tự sai qua thời gian chạy: băm cả hai về 32 byte rồi timingSafeEqual.
 */
export function botSecretMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header || !header.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(header.slice("Bearer ".length)).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
```

- [ ] **Step 4: Chạy test, phải pass**

Run: `npx vitest run src/lib/enrollment/bot-secret.test.ts`
Expected: PASS.

- [ ] **Step 5: Viết `src/app/api/enrollment/import/dry-run/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getUserAccessByEmail } from "@/lib/rbac/access";
import { buildTaskActor } from "@/lib/tasks/access";
import { canAccessEnrollment } from "@/lib/enrollment/access";
import { canActorImport } from "@/lib/table-config/export-access";
import { parseEnrollmentProgram } from "@/lib/enrollment/types";
import { fetchEnrollmentOptionData } from "@/lib/enrollment/options";
import { fetchEnrollmentPeople } from "@/lib/enrollment/queries";
import { fetchTableColumnOptions, fetchTableColumns } from "@/lib/table-config/queries";
import {
  ENROLLMENT_IMPORT_MAX_ROWS,
  buildEnrollmentImportContext,
  enrollmentImportPayload,
  importHeaderLabel,
  matchEnrollmentHeaders,
  parseEnrollmentImportRows,
  recordsFromMatrix,
} from "@/lib/enrollment/import";
import { processEnrollmentImportRows } from "@/lib/enrollment/import-rows";
import { botSecretMatches } from "@/lib/enrollment/bot-secret";

export const dynamic = "force-dynamic";

/**
 * Chạy thử import Enrollment cho Slack bot (2026-11-14). KHÔNG ghi gì.
 *
 * Đọc file giống hệt dialog import (recordsFromMatrix → matchEnrollmentHeaders →
 * parseEnrollmentImportRows) rồi chạy đúng các bước kiểm của import thật
 * (processEnrollmentImportRows với dryRun). Quyền kiểm theo actor_email — email
 * account portal gắn với người hỏi trong slack_bot_users, do bot tra và gửi lên —
 * để kết quả giống hệt khi chính người đó bấm Import.
 *
 * Xác thực bằng BOT_PORTAL_SECRET, không bằng session. Secret này chỉ mở route này.
 */
export async function POST(request: Request) {
  const secret = process.env.BOT_PORTAL_SECRET;
  if (!secret) return NextResponse.json({ error: "Dry run is not configured." }, { status: 503 });
  if (!botSecretMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    program?: unknown;
    actor_email?: unknown;
    rows?: unknown;
    first_row?: unknown;
  } | null;
  const program = parseEnrollmentProgram(body?.program);
  if (!program) return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  const actorEmail = typeof body?.actor_email === "string" ? body.actor_email.trim().toLowerCase() : "";
  if (!actorEmail) return NextResponse.json({ error: "actor_email is required." }, { status: 400 });
  if (!Array.isArray(body?.rows) || !body.rows.every(Array.isArray)) {
    return NextResponse.json({ error: "rows must be the sheet as an array of rows." }, { status: 400 });
  }
  // +1: dòng tiêu đề.
  if (body.rows.length > ENROLLMENT_IMPORT_MAX_ROWS + 1) {
    return NextResponse.json({ error: `At most ${ENROLLMENT_IMPORT_MAX_ROWS} rows per import.` }, { status: 400 });
  }

  const access = await getUserAccessByEmail(actorEmail);
  if (access.unavailable) return NextResponse.json({ error: "Could not check access. Try again." }, { status: 503 });
  if (!access.isActive) return NextResponse.json({ error: "No active portal account for this person." }, { status: 403 });
  const actor = buildTaskActor(access.permissions, actorEmail);
  if (!canAccessEnrollment(actor) || !canActorImport(access.permissions)) {
    return NextResponse.json({ error: "This person does not have permission to import." }, { status: 403 });
  }

  let sheet: ReturnType<typeof recordsFromMatrix>;
  try {
    const firstRow = typeof body.first_row === "number" && Number.isInteger(body.first_row) && body.first_row >= 1 ? body.first_row : 1;
    sheet = recordsFromMatrix(body.rows as unknown[][], firstRow);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unreadable sheet." }, { status: 400 });
  }

  const [columns, columnOptions, optionData, people] = await Promise.all([
    fetchTableColumns(program),
    fetchTableColumnOptions(program),
    fetchEnrollmentOptionData(program),
    fetchEnrollmentPeople(),
  ]);
  const context = buildEnrollmentImportContext(optionData.options, people, columnOptions);
  const matched = matchEnrollmentHeaders(sheet.headers, columns, sheet.records);
  const parsed = parseEnrollmentImportRows(sheet.records, matched, columns, context, sheet.rowNumbers);

  const outcome = await processEnrollmentImportRows({
    program,
    actorEmail,
    dryRun: true,
    rows: parsed.rows.map((row) => ({
      row: row.row,
      id: row.id,
      body: enrollmentImportPayload(row.values, columns),
    })),
  });
  if (!outcome.ok) return outcome.response;

  return NextResponse.json({
    header_matches: {
      matched: [...matched.byHeader].map(([header, key]) => ({ header: importHeaderLabel(header), key })),
      id_header: matched.idHeader ? importHeaderLabel(matched.idHeader) : null,
      ignored: matched.ignored,
      managed: matched.managed,
    },
    skipped: parsed.skipped,
    ...outcome.result,
  });
}
```

Kiểm trước khi code: `src/lib/enrollment/access.ts` có export `canAccessEnrollment` không (được gọi trong `loadEnrollmentActor`). Nếu tên khác hoặc không export, export nó (không đổi logic). `fetchEnrollmentOptionData(program).options` phải có trường `set_key` mà `buildEnrollmentImportContext` cần (dialog đang truyền đúng `optionData.options` qua prop `options` — xem `src/app/(authed)/enrollment/page.tsx` dòng ~116).

Ghi chú bảo mật: message lỗi trong `failed` / `skipped` có thể chứa giá trị ô (ví dụ `Stage: unknown value "Ready to sign up"`). Route vẫn trả nguyên văn vì đây là cùng thông tin dialog hiện cho người dùng; **bot** (Kế hoạch B) chịu trách nhiệm che trước khi đưa cho Claude, theo spec §7.

- [ ] **Step 6: Kiểm tĩnh**

Run: `npm run lint && npx tsc --noEmit && npx vitest run`
Expected: không lỗi, toàn bộ test PASS.

- [ ] **Step 7: Chạy thử trên localhost (đọc DB production, không ghi)**

Thêm `BOT_PORTAL_SECRET=<chuỗi ngẫu nhiên 40 ký tự>` vào `.env.local` của worktree (không commit). `npm run dev`. Dùng file template ACA tải từ màn Enrollment → Import → Download template, điền 3 dòng giả: một dòng đúng, một dòng Stage `Ready to sign up`, một dòng thiếu FUB Link. Chuyển sang JSON bằng script tạm trong scratchpad:

```bash
node -e '
const XLSX = require("xlsx");
const wb = XLSX.readFile(process.argv[1]);
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null, blankrows: true });
process.stdout.write(JSON.stringify({ program: "aca", actor_email: "bao.vo@excelplannings.com", rows }));
' /path/to/test.xlsx > /tmp/dry-run-body.json
curl -s -X POST http://localhost:3000/api/enrollment/import/dry-run \
  -H "Authorization: Bearer $BOT_PORTAL_SECRET" -H "Content-Type: application/json" \
  --data @/tmp/dry-run-body.json | jq
```

Expected: `created` = 1, `skipped` hoặc `failed` có đúng 2 dòng với lý do Stage không tồn tại và thiếu FUB Link. So với hộp import trên màn hình (mở dialog, chọn cùng file, **KHÔNG bấm Import**): danh sách bị bỏ phải giống nhau.

Kiểm thêm: thiếu header → 401; sai secret → 401; `actor_email` của account không có `task.import` → 403.

Sau khi kiểm: `select count(*) from enrollment_records where created_at > now() - interval '30 minutes'` không được tăng do bước này (chạy một lần, hỏi Bảo trước).

- [ ] **Step 8: Commit**

```bash
git add src/lib/enrollment/bot-secret.ts src/lib/enrollment/bot-secret.test.ts "src/app/api/enrollment/import/dry-run"
git commit -m "feat(enrollment-import): dry-run endpoint for the Slack bot"
```

---

### Task 9: Changelog, AGENTS.md, rollout thật

**Files:**
- Modify: `changelog.md`
- Modify: `AGENTS.md`
- Modify: `supabase/APPLIED.md` (chỉ sau khi chạy rollout thật)

- [ ] **Step 1: Hỏi Bảo rồi mới chạy rollout thật trên production** (trước khi deploy code):

```bash
export PATH="/opt/homebrew/bin:$PATH"
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw -f supabase/rollouts/2026-11-14-slack-bot-users.sql
supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw "select key, label from permissions where key = 'slack_bot.manage'; select count(*) from slack_bot_users; select has_table_privilege('anon', 'public.slack_bot_users', 'select') as anon_can_read;" -o json
```

Expected: có dòng `slack_bot.manage`; `count = 0`; `anon_can_read = false`.

- [ ] **Step 2: Thêm entry đầu `changelog.md`** (ngay dưới đoạn mở đầu, trên entry mới nhất):

```markdown
## 2026-11-14 — Slack Bot: danh sách người dùng bot + chạy thử import Enrollment

- Quyền mới `slack_bot.manage` ("Slack Bot - Manage", hiện ở mục Other của Role Manager); rollout cấp cho các role đang có Role Manager. Trang mới `/slack-bot` (menu Account Management → Slack Bot), đặt cuối `ACCESSIBLE_ROUTES` nên không đổi trang đích sau đăng nhập của ai.
- Bảng `slack_bot_users`: quyền dùng Slack bot cấp THEO NGƯỜI theo Slack email, không theo role (mỗi account chỉ có một role; còn phải cấp cho email ngoài portal). Không tick gì = Ask only. Diagnose cho cả email ngoài portal; Change access / Edit code / Approve bắt buộc gắn account (DB chặn bằng constraint). Chỉ gắn được account active mà người sửa có đủ quyền của account đó (trần uỷ quyền như Account Manager). Xoá account thì dòng quyền bot gắn với account đó bị xoá theo (`on delete cascade`); khoá account thì bot từ chối người đó cho tới khi mở khoá.
- Import Enrollment: vòng kiểm từng dòng chuyển sang `processEnrollmentImportRows` (không đổi luật); phần đọc ma trận Excel chuyển sang `recordsFromMatrix` (dialog dùng chung). Sửa lỗi có sẵn: file có dòng trống hoặc vùng dữ liệu không bắt đầu ở dòng 1 thì "Row N" trong lỗi import bị lệch; giờ chỉ đúng dòng Excel. Route mới `POST /api/enrollment/import/dry-run` cho Slack bot: xác thực bằng `BOT_PORTAL_SECRET`, đọc file và kiểm y như import thật dưới quyền của `actor_email`, không ghi gì.
- Rollout `2026-11-14-slack-bot-users.sql` phải chạy trước khi deploy. Env mới `BOT_PORTAL_SECRET` (đặt trên Vercel portal; thiếu thì route dry-run trả 503).
```

- [ ] **Step 3: Thêm vào `AGENTS.md`** (cuối file):

```markdown
## Slack bot reads this schema

A separate private repo (`eps-slack-bot`) reads these tables directly with a read-only role: `portal_account` (id, email, name, is_active, agent_id, position_id, manager_id, created_at), `positions`, `roles`, `user_roles`, `role_permissions`, `permissions`, `agent_members`, `enrollment_option_sets`, `enrollment_options`, `table_column`, `table_column_option`, `slack_bot_users`. It also calls `POST /api/enrollment/import/dry-run`. When you rename or drop any of these columns, or change that route's request/response, update the bot too. Spec: `docs/superpowers/specs/2026-11-14-slack-support-bot-design.md`.
```

- [ ] **Step 4: Ghi `supabase/APPLIED.md`** một entry mới trên cùng (theo mẫu các entry hiện có): ngày giờ chạy, Bảo duyệt, kết quả kiểm ở Step 1.

- [ ] **Step 5: Kiểm toàn bộ lần cuối**

Run: `npm run lint && npx tsc --noEmit && npx vitest run && npm run build`
Expected: tất cả pass.

- [ ] **Step 6: Commit (không add rollout, không add plan/spec)**

```bash
git add changelog.md AGENTS.md supabase/APPLIED.md
git commit -m "docs(slack-bot): changelog, schema note for the bot, applied rollout"
```

- [ ] **Step 7: Báo Bảo** — liệt kê commit, kết quả test/build, rollout đã chạy hay chưa. **Không push.** Nhắc: cần đặt `BOT_PORTAL_SECRET` trên Vercel portal trước khi bot dùng route dry-run; sau deploy thì vào `/slack-bot` thêm người.
