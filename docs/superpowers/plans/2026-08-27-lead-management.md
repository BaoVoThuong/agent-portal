# Lead Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép manager import lead theo lô từ sự kiện, giao tay cho agent, và nhìn thấy ngay agent nào chưa liên hệ lead nào — trong khi agent ghi nhật ký từng lần tương tác có cấu trúc thay vì comment tự do.

**Architecture:** Module song song với Enrollment, không phải program thứ ba của nó. Dùng lại `table_column` cho cột tự cấu hình, `CommentThread` KHÔNG dùng lại (nhật ký là bảng riêng có cấu trúc), hệ chuông và realtime dùng lại. Bốn trường thống kê (`first_contacted_at`, `last_contacted_at`, `contact_attempt_count`, `next_follow_up_at`) được lưu sẵn trên `leads` để bảng List không phải aggregate cho từng dòng. Cờ cảnh báo là hàm thuần tính lúc đọc — không cron, không cột trạng thái phái sinh trong DB.

**Tech Stack:** Next.js 16.2.4 App Router · Supabase PostgREST (service-role, phân quyền ở tầng ứng dụng) · Tailwind v4 (không có file config) · vitest 2.1.9 · xlsx ^0.18.5 (đã có sẵn trong `package.json`)

## Global Constraints

- **Test runner chỉ chạy `src/**/*.test.ts`** — `vitest.config.ts` đặt `environment: "node"`, KHÔNG có jsdom. **Không viết được test cho file `.tsx`.** Mọi logic cần test phải nằm trong `.ts` thuần; task UI verify bằng tay trên `localhost:3000`.
- Baseline trước khi bắt đầu: `npm run test:run` → **108 files / 780 tests passed**. Mỗi task phải giữ con số này không giảm.
- Mỗi task kết thúc bằng `npm run typecheck && npm run lint && npm run test:run` đều sạch, rồi mới commit.
- Mọi thay đổi logic ghi vào `agent-portal/changelog.md` (không ghi đổi UI thuần: màu, spacing, copy).
- SQL: mỗi thay đổi schema tạo **một file rollout forward-only** trong `supabase/rollouts/YYYY-MM-DD-<tên>.sql` **và** sửa `supabase/schema.sql` cho khớp. Cả hai, không được chỉ một.
- **Không tự push.** Push là một lần xin phép riêng, phải nêu rõ remote.
- Không dùng `next/image` cho ảnh remote — Vercel tính Image Optimization thành meter riêng.

## Bài học từ sự cố đã xảy ra trong repo này — bắt buộc tuân thủ

Ba lỗi dưới đây đã thực sự gây sự cố production. Đừng lặp lại.

1. **Không đặt tên biến plpgsql trùng tên cột của bảng mà hàm đó truy vấn.** `patch_task_atomic` khai `overdue_at timestamptz` trong khi `task_overdue_events` có cột cùng tên → SQLSTATE 42702, nút Unlock chết từ 08/08 đến 27/08 mới bị phát hiện. Quy ước: hậu tố `_value` cho biến (`status_id_value`), và **luôn alias bảng** trong query (`from leads as lead`).
2. **Không thêm `.is("deleted_at", null)` vào bảng không có cột đó.** Commit `a1418b7` thêm filter này vào `enrollment_attachments` (bảng không có `deleted_at`) → PostgREST trả 42703, sập toàn bộ enrollment detail. Kiểm tra cột tồn tại trước khi lọc.
3. **Không đặt việc làm thay đổi `updated_at` vào trong `after()`.** Response gửi đi trước, `updated_at` đổi sau → client giữ token cũ → request kế tiếp ăn 409. Chỉ đặt notification và broadcast vào `after()`.

---

## Phân chia giai đoạn

Bốn phase, mỗi phase tự nó chạy được và demo được.

| Phase | Giao được gì | Task |
|---|---|---|
| 1 | Schema + từ vựng cấu hình + RPC. Chưa có UI. | 1-4 |
| 2 | Bảng Leads chạy được: xem, giao tay, ghi nhật ký tương tác | 5-9 |
| 3 | Import Excel theo sự kiện | 10-12 |
| 4 | Cờ cảnh báo, Overview, chuông | 13-16 |

Dừng sau Phase 2 vẫn có sản phẩm dùng được (nhập tay + giao + theo dõi). Phase 3 và 4 là tăng tốc và giám sát.

---

## Cấu trúc file

**Tạo mới — SQL**
- `supabase/rollouts/2026-08-27-lead-schema.sql` — 7 bảng, index, grant
- `supabase/rollouts/2026-08-28-lead-rpc.sql` — RPC atomic

**Tạo mới — thư viện (`.ts`, test được)**
- `src/lib/leads/types.ts` — kiểu và hằng, không I/O
- `src/lib/leads/access.ts` — quyết định phân quyền, **hàm thuần, không I/O**
- `src/lib/leads/alerts.ts` — engine cờ cảnh báo, **hàm thuần**
- `src/lib/leads/queries.ts` — đọc DB
- `src/lib/leads/vocabulary.ts` — validate từ vựng cấu hình (Task 17)
- `src/lib/leads/import-parse.ts` — parse Excel → dòng đã chuẩn hoá, **hàm thuần**
- `src/lib/leads/realtime-topics.ts`, `src/lib/leads/realtime.ts`

**Tạo mới — route**
- `src/app/api/leads/route.ts` (GET danh sách, POST tạo tay)
- `src/app/api/leads/[id]/interactions/route.ts` (POST ghi tương tác)
- `src/app/api/leads/assign/route.ts` (POST giao hàng loạt)
- `src/app/api/leads/import/route.ts` (POST import)
- `src/app/api/leads/events/route.ts` (GET, POST)
- `src/app/api/leads/vocabulary/route.ts` (GET, POST, PATCH) — Task 17
- `src/app/api/leads/overview/route.ts` (GET)

**Tạo mới — UI (`.tsx`, KHÔNG test được)**
- `src/app/(authed)/leads/page.tsx`
- `src/app/(authed)/leads/_components/LeadsClient.tsx`
- `src/app/(authed)/leads/_components/LeadDetailDrawer.tsx`
- `src/app/(authed)/leads/_components/InteractionLog.tsx`
- `src/app/(authed)/leads/_components/LeadImportDialog.tsx`
- `src/app/(authed)/leads/_components/LeadOverview.tsx`

**Sửa file có sẵn**
- `src/lib/rbac/permissions.ts` — thêm 3 permission
- `src/lib/table-config/types.ts:1` — thêm scope `lead_pc`, `lead_health`
- `src/lib/table-config/queries.ts:11` — thêm cột mặc định cho 2 scope mới
- `src/app/(authed)/_components/sidebar.module.css` + nav — thêm mục Leads

---

## Phase 1 — Nền dữ liệu

### Task 1: Schema 7 bảng

**Files:**
- Create: `supabase/rollouts/2026-08-27-lead-schema.sql`
- Modify: `supabase/schema.sql` (nối vào cuối, trước phần grant tổng)

**Interfaces:**
- Produces: bảng `lead_events`, `leads`, `lead_statuses`, `lead_interaction_types`, `lead_interactions`, `lead_assignment_history`, `lead_alert_settings`; sequence `leads_display_number_seq`

- [ ] **Step 1: Viết file rollout**

```sql
-- Lead Management: schema nền. Forward-only.
-- Quy ước theo enrollment_records: uuid pk, custom_values jsonb cho cột do
-- admin thêm, archived_at cho soft-delete, email luôn chuẩn hoá lower+btrim.

create or replace function lead_norm_email(p_email text)
returns text language sql immutable set search_path = public as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

create table if not exists lead_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  location text,
  notes text,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- kind là thứ máy đọc; label là thứ người đọc. Admin đặt nhãn tiếng Việt hay
-- tiếng Anh tuỳ ý, engine cảnh báo chỉ nhìn kind.
create table if not exists lead_statuses (
  id uuid primary key default gen_random_uuid(),
  product text not null check (product in ('pc', 'health')),
  label text not null,
  color text,
  position integer not null default 0,
  kind text not null check (kind in ('open', 'scheduled', 'won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- counts_as_contact quyết định loại này có tắt đèn đỏ hay không.
-- Call/Text/Email = true, Note = false.
create table if not exists lead_interaction_types (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  color text,
  position integer not null default 0,
  counts_as_contact boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create sequence if not exists leads_display_number_seq;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  display_number bigint not null default nextval('leads_display_number_seq'),
  product text not null check (product in ('pc', 'health')),
  event_id uuid references lead_events(id) on delete set null,
  full_name text,
  phone text,
  email text,
  assigned_to_email text,
  assigned_at timestamptz,
  assigned_by_email text,
  status_id uuid references lead_statuses(id) on delete restrict,
  -- Bốn cột dưới suy ra được từ lead_interactions nhưng cố tình lưu sẵn: bảng
  -- List phải hiện "3 lần thử, lần cuối 2 ngày trước" cho vài trăm dòng cùng
  -- lúc, aggregate cho từng dòng là đúng lỗi MEDIUM-09 trong review 23/08.
  -- log_lead_interaction_atomic là nơi DUY NHẤT được ghi bốn cột này.
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  contact_attempt_count integer not null default 0,
  next_follow_up_at timestamptz,
  closed_at timestamptz,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_by_email text,
  updated_at timestamptz not null default now(),
  custom_values jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  client_request_id uuid
);

create table if not exists lead_interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  type_id uuid not null references lead_interaction_types(id) on delete restrict,
  status_id uuid references lead_statuses(id) on delete restrict,
  note text,
  actor_email text not null,
  occurred_at timestamptz not null default now(),
  follow_up_at timestamptz,
  client_request_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists lead_assignment_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  from_email text,
  to_email text,
  reason text,
  actor_email text not null,
  created_at timestamptz not null default now()
);

create table if not exists lead_alert_settings (
  product text primary key check (product in ('pc', 'health')),
  no_contact_hours integer not null default 24 check (no_contact_hours > 0),
  stale_days integer not null default 3 check (stale_days > 0),
  max_attempts integer not null default 4 check (max_attempts > 0),
  updated_by_email text,
  updated_at timestamptz not null default now()
);

insert into lead_alert_settings (product) values ('pc'), ('health')
on conflict (product) do nothing;



-- Index bám đúng cách bảng được đọc: luôn lọc archived_at is null, rồi lọc
-- theo product, rồi sắp theo created_at.
-- Bắt buộc phải có trước phần seed bên trên: `on conflict do nothing` không có
-- unique index nào để bấu vào thì nó im lặng không làm gì cả, và chạy lại
-- rollout lần hai sẽ nhân đôi toàn bộ từ vựng.
create unique index if not exists lead_interaction_types_label_unique_idx
  on lead_interaction_types (label) where archived_at is null;
create unique index if not exists lead_statuses_label_unique_idx
  on lead_statuses (product, label) where archived_at is null;

create index if not exists leads_product_active_idx
  on leads (product, created_at desc) where archived_at is null;
create index if not exists leads_assigned_idx
  on leads (assigned_to_email, product) where archived_at is null;
create index if not exists leads_event_idx on leads (event_id);
create index if not exists lead_interactions_lead_idx
  on lead_interactions (lead_id, occurred_at desc);
create index if not exists lead_assignment_history_lead_idx
  on lead_assignment_history (lead_id, created_at desc);

-- Chống import trùng: cùng một sự kiện không được có hai lead trùng số.
create unique index if not exists leads_event_phone_unique_idx
  on leads (event_id, phone) where phone is not null and archived_at is null;

-- Từ vựng mặc định. Admin sửa/xoá/thêm thoải mái sau, nhưng phải có sẵn thứ gì
-- đó ngay từ đầu: không có status và loại tương tác thì form ghi nhật ký chỉ
-- là hai dropdown rỗng và cả module không dùng được.
insert into lead_interaction_types (label, position, counts_as_contact) values
  ('Call',  10, true),
  ('Text',  20, true),
  ('Email', 30, true),
  ('Note',  40, false)
on conflict do nothing;

do $$
declare
  product_value text;
begin
  foreach product_value in array array['pc', 'health'] loop
    insert into lead_statuses (product, label, position, kind) values
      (product_value, 'New',             10, 'open'),
      (product_value, 'Working',         20, 'open'),
      (product_value, 'No answer',       30, 'open'),
      (product_value, 'Call back',       40, 'scheduled'),
      (product_value, 'Won',             50, 'won'),
      (product_value, 'Not interested',  60, 'lost'),
      (product_value, 'Wrong number',    70, 'lost')
    on conflict do nothing;
  end loop;
end $$;
```

- [ ] **Step 2: Chạy thử trên PostgreSQL cục bộ trước khi đụng Supabase**

```bash
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"
SOCK=/tmp/pgleads; rm -rf "$SOCK" /tmp/leadpg; mkdir -p "$SOCK"
initdb -D /tmp/leadpg -U postgres --auth=trust >/dev/null
pg_ctl -D /tmp/leadpg -o "-p 55443 -k $SOCK" -l /tmp/leadpg.log start >/dev/null
sleep 2
psql -h "$SOCK" -p 55443 -U postgres -q -c "create extension if not exists pgcrypto;"
psql -h "$SOCK" -p 55443 -U postgres -v ON_ERROR_STOP=1 \
  -f supabase/rollouts/2026-08-27-lead-schema.sql
```
Expected: không có dòng nào bắt đầu bằng `ERROR`.

- [ ] **Step 3: Nối cùng nội dung vào `supabase/schema.sql`**

Chèn ngay trước dòng cuối cùng của file. Nội dung y hệt file rollout, bỏ phần `create or replace function lead_norm_email` nếu `schema.sql` đã có hàm cùng tên (kiểm bằng `grep -c "function lead_norm_email" supabase/schema.sql`).

- [ ] **Step 4: Nạp lại toàn bộ `schema.sql` vào DB sạch để chắc không vỡ thứ tự**

```bash
psql -h "$SOCK" -p 55443 -U postgres -q -c "drop schema public cascade; create schema public;"
psql -h "$SOCK" -p 55443 -U postgres -q -c "create extension if not exists pgcrypto;"
psql -h "$SOCK" -p 55443 -U postgres -f supabase/schema.sql 2>&1 | grep -c ERROR
```
Expected: in ra `0`.

- [ ] **Step 5: Dọn và commit**

```bash
pg_ctl -D /tmp/leadpg stop >/dev/null; rm -rf /tmp/leadpg "$SOCK"
git add supabase/rollouts/2026-08-27-lead-schema.sql supabase/schema.sql
git commit -m "feat(leads): add lead management schema"
```

### Task 2: Kiểu và hằng dùng chung

**Files:**
- Create: `src/lib/leads/types.ts`
- Test: `src/lib/leads/types.test.ts`

**Interfaces:**
- Produces: `LEAD_PRODUCTS`, `LeadProduct`, `isLeadProduct`, `toLeadProduct`, `STATUS_KINDS`, `StatusKind`, `LeadRow`, `LeadStatus`, `LeadInteractionType`, `LeadInteraction`, `LeadAlertSettings`

- [ ] **Step 1: Viết test đỏ**

```ts
// src/lib/leads/types.test.ts
import { describe, expect, it } from "vitest";
import { isLeadProduct, toLeadProduct } from "./types";

describe("toLeadProduct", () => {
  it("accepts the two real products", () => {
    expect(toLeadProduct("pc")).toBe("pc");
    expect(toLeadProduct("health")).toBe("health");
  });

  // Falls back rather than throwing: this reads a URL query string, and a
  // stale bookmark must not 500 the page.
  it("falls back to pc for anything else", () => {
    expect(toLeadProduct("aca")).toBe("pc");
    expect(toLeadProduct(undefined)).toBe("pc");
    expect(toLeadProduct(123)).toBe("pc");
  });

  it("isLeadProduct narrows without a fallback", () => {
    expect(isLeadProduct("health")).toBe(true);
    expect(isLeadProduct("HEALTH")).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy để chắc nó fail**

Run: `npx vitest run src/lib/leads/types.test.ts`
Expected: FAIL — `Cannot find module './types'`

- [ ] **Step 3: Viết `src/lib/leads/types.ts`**

```ts
export const LEAD_PRODUCTS = ["pc", "health"] as const;
export type LeadProduct = (typeof LEAD_PRODUCTS)[number];

export function isLeadProduct(value: unknown): value is LeadProduct {
  return (
    typeof value === "string" &&
    (LEAD_PRODUCTS as readonly string[]).includes(value)
  );
}

export function toLeadProduct(value: unknown): LeadProduct {
  return isLeadProduct(value) ? value : "pc";
}

/** Cái máy đọc. Nhãn hiển thị do admin đặt và không ảnh hưởng logic. */
export const STATUS_KINDS = ["open", "scheduled", "won", "lost"] as const;
export type StatusKind = (typeof STATUS_KINDS)[number];

export function isStatusKind(value: unknown): value is StatusKind {
  return (
    typeof value === "string" &&
    (STATUS_KINDS as readonly string[]).includes(value)
  );
}

export type LeadStatus = {
  id: string;
  product: LeadProduct;
  label: string;
  color: string | null;
  position: number;
  kind: StatusKind;
  archived_at: string | null;
};

export type LeadInteractionType = {
  id: string;
  label: string;
  color: string | null;
  position: number;
  counts_as_contact: boolean;
  archived_at: string | null;
};

export type LeadRow = {
  id: string;
  display_number: number;
  product: LeadProduct;
  event_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  assigned_to_email: string | null;
  assigned_at: string | null;
  assigned_by_email: string | null;
  status_id: string | null;
  first_contacted_at: string | null;
  last_contacted_at: string | null;
  contact_attempt_count: number;
  next_follow_up_at: string | null;
  closed_at: string | null;
  created_by_email: string;
  created_at: string;
  updated_by_email: string | null;
  updated_at: string;
  custom_values: Record<string, unknown>;
  archived_at: string | null;
};

export type LeadInteraction = {
  id: string;
  lead_id: string;
  type_id: string;
  status_id: string | null;
  note: string | null;
  actor_email: string;
  occurred_at: string;
  follow_up_at: string | null;
  created_at: string;
};

export type LeadAlertSettings = {
  product: LeadProduct;
  no_contact_hours: number;
  stale_days: number;
  max_attempts: number;
};
```

- [ ] **Step 4: Test xanh**

Run: `npx vitest run src/lib/leads/types.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/types.ts src/lib/leads/types.test.ts
git commit -m "feat(leads): add shared lead types"
```

### Task 3: Engine cờ cảnh báo

Đây là phần logic đáng giá nhất của module và nó là hàm thuần — test được đầy đủ, không cần DB.

**Files:**
- Create: `src/lib/leads/alerts.ts`
- Test: `src/lib/leads/alerts.test.ts`

**Interfaces:**
- Consumes: `LeadRow`, `LeadStatus`, `LeadAlertSettings` từ `./types`
- Produces: `type LeadAlert = "never_contacted" | "stale" | "follow_up_overdue" | "exhausted"`; `resolveLeadAlerts(lead, status, settings, now): LeadAlert[]`; `ALERT_SEVERITY: Record<LeadAlert, "red" | "amber">`

- [ ] **Step 1: Viết test đỏ**

```ts
// src/lib/leads/alerts.test.ts
import { describe, expect, it } from "vitest";
import { ALERT_SEVERITY, resolveLeadAlerts } from "./alerts";
import type { LeadAlertSettings, LeadRow, LeadStatus } from "./types";

const settings: LeadAlertSettings = {
  product: "pc",
  no_contact_hours: 24,
  stale_days: 3,
  max_attempts: 4,
};

const NOW = new Date("2026-09-01T12:00:00Z");
const hoursAgo = (n: number) =>
  new Date(NOW.getTime() - n * 3600_000).toISOString();

function lead(patch: Partial<LeadRow> = {}): LeadRow {
  return {
    id: "l1", display_number: 1, product: "pc", event_id: null,
    full_name: "A", phone: "1", email: null,
    assigned_to_email: "cs@x.com", assigned_at: hoursAgo(1),
    assigned_by_email: "mgr@x.com", status_id: "s-open",
    first_contacted_at: null, last_contacted_at: null,
    contact_attempt_count: 0, next_follow_up_at: null, closed_at: null,
    created_by_email: "mgr@x.com", created_at: hoursAgo(1),
    updated_by_email: null, updated_at: hoursAgo(1),
    custom_values: {}, archived_at: null,
    ...patch,
  };
}

const openStatus: LeadStatus = {
  id: "s-open", product: "pc", label: "Đang theo", color: null,
  position: 0, kind: "open", archived_at: null,
};
const wonStatus: LeadStatus = { ...openStatus, id: "s-won", kind: "won" };

describe("resolveLeadAlerts", () => {
  it("stays quiet while the lead is still inside the window", () => {
    expect(resolveLeadAlerts(lead(), openStatus, settings, NOW)).toEqual([]);
  });

  it("flags a lead nobody has called since it was assigned", () => {
    const row = lead({ assigned_at: hoursAgo(30) });
    expect(resolveLeadAlerts(row, openStatus, settings, NOW)).toContain(
      "never_contacted"
    );
  });

  // Chưa giao cho ai thì không ai có lỗi. Đây là lead trong kho, không phải
  // lead bị bỏ bê.
  it("does not flag an unassigned lead", () => {
    const row = lead({ assigned_to_email: null, assigned_at: null });
    expect(resolveLeadAlerts(row, openStatus, settings, NOW)).toEqual([]);
  });

  it("flags a lead that was contacted once then abandoned", () => {
    const row = lead({
      assigned_at: hoursAgo(200),
      first_contacted_at: hoursAgo(190),
      last_contacted_at: hoursAgo(100),
      contact_attempt_count: 1,
    });
    const alerts = resolveLeadAlerts(row, openStatus, settings, NOW);
    expect(alerts).toContain("stale");
    expect(alerts).not.toContain("never_contacted");
  });

  it("flags a missed callback promise", () => {
    const row = lead({
      last_contacted_at: hoursAgo(2),
      contact_attempt_count: 1,
      next_follow_up_at: hoursAgo(1),
    });
    expect(resolveLeadAlerts(row, openStatus, settings, NOW)).toContain(
      "follow_up_overdue"
    );
  });

  it("marks a hard-to-reach lead amber, not red", () => {
    const row = lead({
      last_contacted_at: hoursAgo(2),
      first_contacted_at: hoursAgo(50),
      contact_attempt_count: 4,
    });
    const alerts = resolveLeadAlerts(row, openStatus, settings, NOW);
    expect(alerts).toContain("exhausted");
    expect(ALERT_SEVERITY.exhausted).toBe("amber");
    expect(ALERT_SEVERITY.never_contacted).toBe("red");
  });

  // Lead đã đóng thì không còn là việc của ai nữa.
  it("goes silent once the status is terminal", () => {
    const row = lead({
      assigned_at: hoursAgo(500),
      next_follow_up_at: hoursAgo(400),
      contact_attempt_count: 9,
    });
    expect(resolveLeadAlerts(row, wonStatus, settings, NOW)).toEqual([]);
  });

  // Status có thể bị admin xoá khỏi bộ từ vựng trong khi lead vẫn trỏ vào nó.
  it("treats an unknown status as still open", () => {
    const row = lead({ assigned_at: hoursAgo(30) });
    expect(resolveLeadAlerts(row, null, settings, NOW)).toContain(
      "never_contacted"
    );
  });
});
```

- [ ] **Step 2: Chạy để chắc nó fail**

Run: `npx vitest run src/lib/leads/alerts.test.ts`
Expected: FAIL — `Cannot find module './alerts'`

- [ ] **Step 3: Viết `src/lib/leads/alerts.ts`**

```ts
import type { LeadAlertSettings, LeadRow, LeadStatus } from "./types";

export type LeadAlert =
  | "never_contacted"
  | "stale"
  | "follow_up_overdue"
  | "exhausted";

/**
 * Đỏ = agent chưa làm phần việc của mình. Vàng = agent đã làm nhưng lead khó.
 * Phân biệt này quan trọng: gom chung một màu là đổ lỗi cho người gọi 4 lần
 * không ai nghe máy giống hệt người chưa bấm số bao giờ.
 */
export const ALERT_SEVERITY: Record<LeadAlert, "red" | "amber"> = {
  never_contacted: "red",
  stale: "red",
  follow_up_overdue: "red",
  exhausted: "amber",
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Hàm thuần, không I/O — đó là lý do không cần cron để "quét lead quá hạn".
 * Cờ là hàm của bốn cột đã lưu sẵn trên `leads` cộng settings cộng thời điểm
 * hiện tại, nên tính lúc đọc là đủ và luôn tươi.
 *
 * `status` nhận null khi lead trỏ tới một status admin đã xoá; coi như còn mở
 * để lead không im lặng biến mất khỏi màn hình manager.
 */
export function resolveLeadAlerts(
  lead: LeadRow,
  status: LeadStatus | null,
  settings: LeadAlertSettings,
  now: Date = new Date()
): LeadAlert[] {
  if (lead.archived_at) return [];
  if (status && (status.kind === "won" || status.kind === "lost")) return [];
  // Chưa giao thì không ai có lỗi.
  if (!lead.assigned_to_email || !lead.assigned_at) return [];

  const alerts: LeadAlert[] = [];
  const nowMs = now.getTime();

  if (!lead.first_contacted_at) {
    const assignedMs = Date.parse(lead.assigned_at);
    if (
      Number.isFinite(assignedMs) &&
      nowMs - assignedMs > settings.no_contact_hours * HOUR_MS
    ) {
      alerts.push("never_contacted");
    }
  } else if (lead.last_contacted_at) {
    const lastMs = Date.parse(lead.last_contacted_at);
    if (
      Number.isFinite(lastMs) &&
      nowMs - lastMs > settings.stale_days * DAY_MS
    ) {
      alerts.push("stale");
    }
  }

  if (lead.next_follow_up_at) {
    const dueMs = Date.parse(lead.next_follow_up_at);
    if (Number.isFinite(dueMs) && dueMs < nowMs) {
      alerts.push("follow_up_overdue");
    }
  }

  // contact_attempt_count chỉ tăng qua log_lead_interaction_atomic và chỉ khi
  // loại tương tác có counts_as_contact, nên chạm ngưỡng nghĩa là agent đã
  // thật sự thử đủ số lần. Không cần kiểm thêm first_contacted_at.
  if (lead.contact_attempt_count >= settings.max_attempts) {
    alerts.push("exhausted");
  }

  return alerts;
}
```

- [ ] **Step 4: Test xanh**

Run: `npx vitest run src/lib/leads/alerts.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/alerts.ts src/lib/leads/alerts.test.ts
git commit -m "feat(leads): add the lead alert engine"
```

### Task 4: RPC ghi tương tác

**Files:**
- Create: `supabase/rollouts/2026-08-28-lead-rpc.sql`
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: `log_lead_interaction_atomic(p_lead_id uuid, p_type_id uuid, p_status_id uuid, p_note text, p_actor_email text, p_follow_up_at timestamptz, p_client_request_id uuid, p_now timestamptz)` → `returns table (interaction jsonb, lead jsonb, was_created boolean)`

- [ ] **Step 1: Viết RPC**

```sql
-- Ghi một lần tương tác VÀ cập nhật bốn cột thống kê trên leads trong cùng một
-- transaction. Đây là nơi DUY NHẤT được ghi first_contacted_at,
-- last_contacted_at, contact_attempt_count, next_follow_up_at — nếu có đường
-- thứ hai thì hai nguồn sẽ lệch nhau và không ai biết bên nào đúng.
--
-- Mọi biến local đều có hậu tố _value và mọi bảng đều được alias: hàm này đọc
-- các cột tên `note`, `status_id`, `occurred_at` nên trùng tên biến sẽ gây
-- SQLSTATE 42702 y như sự cố patch_task_atomic ngày 08/08.
create or replace function log_lead_interaction_atomic(
  p_lead_id uuid,
  p_type_id uuid,
  p_status_id uuid default null,
  p_note text default null,
  p_actor_email text default null,
  p_follow_up_at timestamptz default null,
  p_client_request_id uuid default null,
  p_now timestamptz default now()
) returns table (interaction jsonb, lead jsonb, was_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  lead_value leads%rowtype;
  interaction_value lead_interactions%rowtype;
  type_value lead_interaction_types%rowtype;
  status_kind_value text;
  actor_value text;
begin
  actor_value := lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;

  select * into lead_value from leads as lead
  where lead.id = p_lead_id and lead.archived_at is null
  for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND';
  end if;

  select * into type_value from lead_interaction_types as itype
  where itype.id = p_type_id and itype.archived_at is null;
  if not found then
    raise exception 'LEAD_TYPE_NOT_FOUND';
  end if;

  -- Bấm hai lần vì mạng chậm không được đếm thành hai lần gọi: con số
  -- contact_attempt_count là căn cứ để manager đánh giá agent.
  if p_client_request_id is not null then
    select * into interaction_value from lead_interactions as li
    where li.lead_id = p_lead_id
      and li.client_request_id = p_client_request_id;
    if found then
      interaction := to_jsonb(interaction_value);
      lead := to_jsonb(lead_value);
      was_created := false;
      return next;
      return;
    end if;
  end if;

  if p_status_id is not null then
    select st.kind into status_kind_value from lead_statuses as st
    where st.id = p_status_id and st.archived_at is null;
    if status_kind_value is null then
      raise exception 'LEAD_STATUS_NOT_FOUND';
    end if;
    if status_kind_value <> 'scheduled' and p_follow_up_at is not null then
      raise exception 'LEAD_FOLLOW_UP_REQUIRES_SCHEDULED';
    end if;
    if status_kind_value = 'scheduled' and p_follow_up_at is null then
      raise exception 'LEAD_FOLLOW_UP_REQUIRED';
    end if;
  end if;

  insert into lead_interactions (
    lead_id, type_id, status_id, note, actor_email,
    occurred_at, follow_up_at, client_request_id
  ) values (
    p_lead_id, p_type_id, p_status_id, nullif(btrim(coalesce(p_note, '')), ''),
    actor_value, p_now, p_follow_up_at, p_client_request_id
  ) returning * into interaction_value;

  update leads as lead set
    -- Chỉ loại có counts_as_contact mới đụng vào đồng hồ. [Note] ghi được
    -- nhưng không tắt đèn đỏ.
    first_contacted_at = case
      when type_value.counts_as_contact and lead.first_contacted_at is null
      then p_now else lead.first_contacted_at end,
    last_contacted_at = case
      when type_value.counts_as_contact then p_now
      else lead.last_contacted_at end,
    contact_attempt_count = lead.contact_attempt_count
      + case when type_value.counts_as_contact then 1 else 0 end,
    next_follow_up_at = case
      when p_follow_up_at is not null then p_follow_up_at
      when status_kind_value in ('won', 'lost') then null
      else lead.next_follow_up_at end,
    status_id = coalesce(p_status_id, lead.status_id),
    closed_at = case
      when status_kind_value in ('won', 'lost') then p_now
      when status_kind_value is not null then null
      else lead.closed_at end,
    updated_at = p_now,
    updated_by_email = actor_value
  where lead.id = p_lead_id
  returning * into lead_value;

  interaction := to_jsonb(interaction_value);
  lead := to_jsonb(lead_value);
  was_created := true;
  return next;
end;
$$;

revoke all on function log_lead_interaction_atomic(uuid, uuid, uuid, text, text, timestamptz, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function log_lead_interaction_atomic(uuid, uuid, uuid, text, text, timestamptz, uuid, timestamptz)
  to service_role;
```

- [ ] **Step 2: Test trên PostgreSQL cục bộ — chứng minh idempotency và đồng hồ**

```bash
export PATH="/Applications/Postgres.app/Contents/Versions/latest/bin:$PATH"
SOCK=/tmp/pgleads; rm -rf "$SOCK" /tmp/leadpg; mkdir -p "$SOCK"
initdb -D /tmp/leadpg -U postgres --auth=trust >/dev/null
pg_ctl -D /tmp/leadpg -o "-p 55443 -k $SOCK" -l /tmp/leadpg.log start >/dev/null
sleep 2
psql -h "$SOCK" -p 55443 -U postgres -q -c "create extension if not exists pgcrypto; create role service_role; create role anon; create role authenticated;"
psql -h "$SOCK" -p 55443 -U postgres -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-27-lead-schema.sql
psql -h "$SOCK" -p 55443 -U postgres -v ON_ERROR_STOP=1 -f supabase/rollouts/2026-08-28-lead-rpc.sql

psql -h "$SOCK" -p 55443 -U postgres <<'SQL'
insert into lead_statuses (id, product, label, kind)
values ('11111111-1111-4111-8111-111111111111','pc','Đang theo','open');
insert into lead_interaction_types (id, label, counts_as_contact)
values ('22222222-2222-4222-8222-222222222222','Call',true),
       ('33333333-3333-4333-8333-333333333333','Note',false);
insert into leads (id, product, full_name, phone, assigned_to_email, assigned_at, created_by_email)
values ('44444444-4444-4444-8444-444444444444','pc','Test','555','cs@x.com',now(),'mgr@x.com');

-- gọi lần 1
select was_created from log_lead_interaction_atomic(
  '44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',
  p_actor_email => 'cs@x.com', p_client_request_id => '55555555-5555-4555-8555-555555555555');
-- gửi lại đúng request đó
select was_created from log_lead_interaction_atomic(
  '44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222',
  p_actor_email => 'cs@x.com', p_client_request_id => '55555555-5555-4555-8555-555555555555');
-- ghi chú nội bộ: KHÔNG được tăng bộ đếm
select was_created from log_lead_interaction_atomic(
  '44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333',
  p_actor_email => 'cs@x.com');

select contact_attempt_count, first_contacted_at is not null as contacted
from leads where id = '44444444-4444-4444-8444-444444444444';
SQL
```
Expected: `was_created` lần lượt `t`, `f`, `t`; dòng cuối `contact_attempt_count = 1` và `contacted = t`.

- [ ] **Step 3: Nối vào `supabase/schema.sql`, nạp lại toàn bộ để kiểm thứ tự**

```bash
psql -h "$SOCK" -p 55443 -U postgres -q -c "drop schema public cascade; create schema public; create extension if not exists pgcrypto;"
psql -h "$SOCK" -p 55443 -U postgres -f supabase/schema.sql 2>&1 | grep -c ERROR
pg_ctl -D /tmp/leadpg stop >/dev/null; rm -rf /tmp/leadpg "$SOCK"
```
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add supabase/rollouts/2026-08-28-lead-rpc.sql supabase/schema.sql
git commit -m "feat(leads): add the atomic interaction log RPC"
```

---

## Phase 2 — Bảng Leads chạy được

### Task 5: Quyền

**Files:**
- Modify: `src/lib/rbac/permissions.ts:1-20` (thêm 3 key) và `PERMISSION_DEFINITIONS`
- Create: `src/lib/leads/access.ts`
- Test: `src/lib/leads/access.test.ts`

**Interfaces:**
- Consumes: `can` từ `@/lib/rbac/client`, `PERMISSIONS` từ `@/lib/rbac/permissions`
- Produces: `LeadActor = { email, isManager, isWorker }`; `buildLeadActor(permissions, email)`; `canManageLeads(actor)`; `canWorkLeads(actor)`; `canViewLead(actor, lead)`; `canLogInteraction(actor, lead)`

- [ ] **Step 1: Thêm permission vào `src/lib/rbac/permissions.ts`**

Trong object `PERMISSIONS`, ngay sau `TASK_EXPORT: "task.export",` thêm:
```ts
  LEAD_MANAGE: "lead.manage",
  LEAD_WORK: "lead.work",
  LEAD_EXPORT: "lead.export",
```
Và thêm vào cuối mảng `PERMISSION_DEFINITIONS`:
```ts
  {
    key: PERMISSIONS.LEAD_MANAGE,
    label: "Manage Leads",
    groupKey: "leads",
    groupLabel: "Lead Management",
    description: "Import leads, assign them, and see every agent's queue.",
    sortOrder: 100,
  },
  {
    key: PERMISSIONS.LEAD_WORK,
    label: "Work Leads",
    groupKey: "leads",
    groupLabel: "Lead Management",
    description: "See and log interactions on leads assigned to you.",
    sortOrder: 200,
  },
  {
    key: PERMISSIONS.LEAD_EXPORT,
    label: "Export Leads",
    groupKey: "leads",
    groupLabel: "Lead Management",
    description: "Download the lead table as a spreadsheet.",
    sortOrder: 300,
  },
```

- [ ] **Step 2: Viết test đỏ**

```ts
// src/lib/leads/access.test.ts
import { describe, expect, it } from "vitest";
import { buildLeadActor, canViewLead, canLogInteraction, canManageLeads } from "./access";
import type { LeadRow } from "./types";

const manager = buildLeadActor(["lead.manage"], "mgr@x.com");
const agent = buildLeadActor(["lead.work"], "cs@x.com");
const outsider = buildLeadActor(["task.work"], "other@x.com");

const mine = { assigned_to_email: "cs@x.com" } as LeadRow;
const theirs = { assigned_to_email: "someone@x.com" } as LeadRow;
const unassigned = { assigned_to_email: null } as LeadRow;

describe("lead access", () => {
  it("manager sees every lead", () => {
    expect(canViewLead(manager, theirs)).toBe(true);
    expect(canViewLead(manager, unassigned)).toBe(true);
  });

  // Đây là quy tắc riêng tư trung tâm của module: agent chỉ thấy lead của mình.
  it("agent sees only their own", () => {
    expect(canViewLead(agent, mine)).toBe(true);
    expect(canViewLead(agent, theirs)).toBe(false);
    expect(canViewLead(agent, unassigned)).toBe(false);
  });

  it("matches the owner case-insensitively", () => {
    expect(canViewLead(agent, { assigned_to_email: "CS@X.COM" } as LeadRow)).toBe(true);
  });

  it("locks out anyone without a lead permission", () => {
    expect(canViewLead(outsider, mine)).toBe(false);
    expect(canManageLeads(outsider)).toBe(false);
  });

  // Manager nhìn được nhưng không thay agent ghi nhật ký cuộc gọi: nhật ký là
  // lời khai của người đã gọi.
  it("only the owning agent logs interactions", () => {
    expect(canLogInteraction(agent, mine)).toBe(true);
    expect(canLogInteraction(manager, theirs)).toBe(false);
    expect(canLogInteraction(manager, { assigned_to_email: "mgr@x.com" } as LeadRow)).toBe(true);
  });
});
```

- [ ] **Step 3: Chạy để chắc nó fail**

Run: `npx vitest run src/lib/leads/access.test.ts`
Expected: FAIL — `Cannot find module './access'`

- [ ] **Step 4: Viết `src/lib/leads/access.ts`**

```ts
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import type { LeadRow } from "./types";

export type LeadActor = {
  email: string;
  isManager: boolean;
  isWorker: boolean;
};

function normalize(email: string | null | undefined): string {
  return email?.trim().toLowerCase() ?? "";
}

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

export function canManageLeads(actor: LeadActor): boolean {
  return actor.isManager;
}

export function canWorkLeads(actor: LeadActor): boolean {
  return actor.isWorker;
}

/**
 * Manager thấy hết. Agent chỉ thấy lead đang đứng tên mình — kể cả lead chưa
 * giao cho ai cũng không thấy, vì kho chưa giao là việc của manager.
 */
export function canViewLead(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">
): boolean {
  if (actor.isManager) return true;
  if (!actor.isWorker) return false;
  const owner = normalize(lead.assigned_to_email);
  return owner !== "" && owner === normalize(actor.email);
}

/**
 * Ghi nhật ký là lời khai của người đã gọi, nên chỉ chủ sở hữu lead ghi được —
 * manager xem được nhưng không ghi thay. Nếu manager tự giao lead cho mình thì
 * lúc đó họ là chủ sở hữu và ghi được như mọi agent khác.
 */
export function canLogInteraction(
  actor: LeadActor,
  lead: Pick<LeadRow, "assigned_to_email">
): boolean {
  if (!actor.isWorker) return false;
  const owner = normalize(lead.assigned_to_email);
  return owner !== "" && owner === normalize(actor.email);
}
```

- [ ] **Step 5: Test xanh + toàn bộ suite**

Run: `npx vitest run src/lib/leads/access.test.ts && npm run typecheck`
Expected: PASS 5 tests; typecheck sạch

- [ ] **Step 6: Commit**

```bash
git add src/lib/rbac/permissions.ts src/lib/leads/access.ts src/lib/leads/access.test.ts
git commit -m "feat(leads): add lead permissions and access rules"
```

### Task 6: Scope cấu hình cột

**Files:**
- Modify: `src/lib/table-config/types.ts:1`
- Modify: `src/lib/table-config/queries.ts:11-64`

**Interfaces:**
- Produces: `TableScope` mở rộng thành `"cs" | "aca" | "medicare" | "lead_pc" | "lead_health"`

- [ ] **Step 1: Mở rộng scope**

Trong `src/lib/table-config/types.ts` dòng 1, đổi:
```ts
export const TABLE_SCOPES = ["cs", "aca", "medicare"] as const;
```
thành:
```ts
export const TABLE_SCOPES = [
  "cs",
  "aca",
  "medicare",
  "lead_pc",
  "lead_health",
] as const;
```

- [ ] **Step 2: Chạy typecheck để trình biên dịch chỉ ra mọi chỗ cần bổ sung**

Run: `npm run typecheck`
Expected: FAIL — `Property 'lead_pc' is missing in type ... but required in type 'Record<TableScope, TableColumn[]>'` tại `src/lib/table-config/queries.ts:11`.

Đây là tác dụng của `Record<TableScope, ...>`: quên một scope là không build được, không phải phát hiện lúc chạy.

- [ ] **Step 3: Thêm cột mặc định**

Trong `src/lib/table-config/queries.ts`, thêm hai khoá vào object `DEFAULT_TABLE_COLUMNS` (hàm `col` đã có sẵn trong file, chữ ký `col(scope, key, label, type, position, hiddenDefault?, pinned?)`):

```ts
  lead_pc: [
    col("lead_pc", "key", "Key", "text", 10, false, true),
    col("lead_pc", "name", "Name", "text", 20, false, true),
    col("lead_pc", "phone", "Phone", "text", 30),
    col("lead_pc", "email", "Email", "text", 40),
    col("lead_pc", "assignee", "Assigned to", "person", 50),
    col("lead_pc", "status", "Status", "dropdown", 60),
    col("lead_pc", "attempts", "Attempts", "number", 70),
    col("lead_pc", "lastContact", "Last contact", "date", 80),
    col("lead_pc", "followUp", "Follow up", "date", 90),
    col("lead_pc", "event", "Event", "text", 100),
    col("lead_pc", "createdAt", "Imported", "date", 110, true),
  ],
  lead_health: [
    col("lead_health", "key", "Key", "text", 10, false, true),
    col("lead_health", "name", "Name", "text", 20, false, true),
    col("lead_health", "phone", "Phone", "text", 30),
    col("lead_health", "email", "Email", "text", 40),
    col("lead_health", "assignee", "Assigned to", "person", 50),
    col("lead_health", "status", "Status", "dropdown", 60),
    col("lead_health", "attempts", "Attempts", "number", 70),
    col("lead_health", "lastContact", "Last contact", "date", 80),
    col("lead_health", "followUp", "Follow up", "date", 90),
    col("lead_health", "event", "Event", "text", 100),
    col("lead_health", "createdAt", "Imported", "date", 110, true),
  ],
```

- [ ] **Step 4: Typecheck + test đầy đủ**

Run: `npm run typecheck && npm run test:run`
Expected: typecheck sạch; test **≥ 780 passed** (một vài test của table-config duyệt qua mọi scope nên số test có thể tăng — không được giảm).

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-config/types.ts src/lib/table-config/queries.ts
git commit -m "feat(leads): add lead table-config scopes"
```

### Task 7: Truy vấn danh sách có phân trang

**Files:**
- Create: `src/lib/leads/queries.ts`
- Test: `src/lib/leads/queries.test.ts`

**Interfaces:**
- Consumes: `LeadActor` từ `./access`, `LeadProduct`/`LeadRow` từ `./types`
- Produces: `LEAD_PAGE_SIZE = 50`; `buildLeadListFilter(actor, params)` → `{ product, assignedTo, eventId, statusId, limit, offset }`; `fetchLeadsPage(actor, params, supabase?)` → `{ rows: LeadRow[]; total: number }`

**Vì sao có task riêng cho việc này:** `/api/tasks` tải toàn bộ danh sách không phân trang và bản review 23/08 ghi nhận là HIGH-03. Với ~3.000 lead tích luỹ, lặp lại sai lầm đó là tự chuốc lấy nợ.

- [ ] **Step 1: Viết test đỏ cho phần thuần**

```ts
// src/lib/leads/queries.test.ts
import { describe, expect, it } from "vitest";
import { buildLeadListFilter, LEAD_PAGE_SIZE } from "./queries";
import { buildLeadActor } from "./access";

const manager = buildLeadActor(["lead.manage"], "mgr@x.com");
const agent = buildLeadActor(["lead.work"], "cs@x.com");

describe("buildLeadListFilter", () => {
  // Bộ lọc theo chủ sở hữu được ÁP Ở SERVER, không phải ẩn ở client. Agent gõ
  // thẳng ?assigned_to=someone@else vẫn chỉ nhận được lead của chính mình.
  it("pins an agent to their own leads whatever they ask for", () => {
    const filter = buildLeadListFilter(agent, {
      product: "pc",
      assigned_to: "someone@else.com",
    });
    expect(filter.assignedTo).toBe("cs@x.com");
  });

  it("lets a manager filter by any agent", () => {
    const filter = buildLeadListFilter(manager, {
      product: "pc",
      assigned_to: "someone@else.com",
    });
    expect(filter.assignedTo).toBe("someone@else.com");
  });

  it("leaves a manager unfiltered when no agent is named", () => {
    expect(buildLeadListFilter(manager, { product: "pc" }).assignedTo).toBeNull();
  });

  it("defaults to page one", () => {
    const filter = buildLeadListFilter(manager, { product: "pc" });
    expect(filter.limit).toBe(LEAD_PAGE_SIZE);
    expect(filter.offset).toBe(0);
  });

  it("clamps a hostile page size instead of trusting it", () => {
    expect(buildLeadListFilter(manager, { product: "pc", limit: "99999" }).limit)
      .toBe(LEAD_PAGE_SIZE);
    expect(buildLeadListFilter(manager, { product: "pc", limit: "-5" }).limit)
      .toBe(LEAD_PAGE_SIZE);
    expect(buildLeadListFilter(manager, { product: "pc", limit: "10" }).limit)
      .toBe(10);
  });

  it("falls back to pc for an unknown product", () => {
    expect(buildLeadListFilter(manager, { product: "banana" }).product).toBe("pc");
  });
});
```

- [ ] **Step 2: Chạy để chắc nó fail**

Run: `npx vitest run src/lib/leads/queries.test.ts`
Expected: FAIL — `Cannot find module './queries'`

- [ ] **Step 3: Viết `src/lib/leads/queries.ts`**

```ts
import { getSupabaseAdmin } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadActor } from "./access";
import { toLeadProduct, type LeadProduct, type LeadRow } from "./types";

export const LEAD_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export type LeadListParams = {
  product?: unknown;
  assigned_to?: unknown;
  event_id?: unknown;
  status_id?: unknown;
  limit?: unknown;
  offset?: unknown;
};

export type LeadListFilter = {
  product: LeadProduct;
  assignedTo: string | null;
  eventId: string | null;
  statusId: string | null;
  limit: number;
  offset: number;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function count(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(typeof value === "string" ? value : "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) return fallback;
  return parsed;
}

/**
 * Hàm thuần để test được luật quan trọng nhất: agent bị ghim vào chính mình ở
 * SERVER. Không bao giờ dựa vào việc client không gửi tham số đó.
 */
export function buildLeadListFilter(
  actor: LeadActor,
  params: LeadListParams
): LeadListFilter {
  const requested = text(params.assigned_to);
  return {
    product: toLeadProduct(params.product),
    assignedTo: actor.isManager
      ? requested?.toLowerCase() ?? null
      : actor.email.trim().toLowerCase(),
    eventId: text(params.event_id),
    statusId: text(params.status_id),
    limit: count(params.limit, LEAD_PAGE_SIZE, MAX_PAGE_SIZE),
    offset: count(params.offset, 0, 1_000_000) || 0,
  };
}

const LEAD_COLUMNS =
  "id,display_number,product,event_id,full_name,phone,email," +
  "assigned_to_email,assigned_at,assigned_by_email,status_id," +
  "first_contacted_at,last_contacted_at,contact_attempt_count," +
  "next_follow_up_at,closed_at,created_by_email,created_at," +
  "updated_by_email,updated_at,custom_values,archived_at";

export async function fetchLeadsPage(
  actor: LeadActor,
  params: LeadListParams,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<{ rows: LeadRow[]; total: number; filter: LeadListFilter }> {
  const filter = buildLeadListFilter(actor, params);
  let query = supabase
    .from("leads")
    .select(LEAD_COLUMNS, { count: "exact" })
    .is("archived_at", null)
    .eq("product", filter.product)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(filter.offset, filter.offset + filter.limit - 1);

  if (filter.assignedTo) query = query.eq("assigned_to_email", filter.assignedTo);
  if (filter.eventId) query = query.eq("event_id", filter.eventId);
  if (filter.statusId) query = query.eq("status_id", filter.statusId);

  const { data, error, count: total } = await query;
  if (error) throw new Error(error.message);
  return {
    rows: (data ?? []) as unknown as LeadRow[],
    total: total ?? 0,
    filter,
  };
}
```

- [ ] **Step 4: Test xanh**

Run: `npx vitest run src/lib/leads/queries.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/queries.ts src/lib/leads/queries.test.ts
git commit -m "feat(leads): add paginated lead queries"
```

### Task 8: Route đọc danh sách và ghi tương tác

**Files:**
- Create: `src/app/api/leads/route.ts`
- Create: `src/app/api/leads/[id]/interactions/route.ts`

**Interfaces:**
- Consumes: `fetchLeadsPage`, `buildLeadActor`, `canViewLead`, `canLogInteraction`
- Produces: `GET /api/leads?product=&assigned_to=&event_id=&status_id=&limit=&offset=` → `{ leads, total, limit, offset }`; `POST /api/leads/:id/interactions` body `{ type_id, status_id?, note?, follow_up_at?, client_request_id? }` → `{ interaction, lead }`

> **Thứ tự bắt buộc:** làm Step 1 (realtime) trước, vì route ở Step 3 import từ nó. Đảo thứ tự thì typecheck ở Step 5 sẽ đỏ vì thiếu module.

- [ ] **Step 1: Viết `src/lib/leads/realtime-topics.ts` và `realtime.ts`**

Nội dung đầy đủ ở Step 3 bên dưới — tạo hai file đó trước, rồi quay lại Step 2.

- [ ] **Step 2: Viết `src/app/api/leads/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canWorkLeads } from "@/lib/leads/access";
import { fetchLeadsPage } from "@/lib/leads/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = buildLeadActor(session.user.permissions, email);
  if (!canWorkLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const { rows, total, filter } = await fetchLeadsPage(actor, params);
  return NextResponse.json({
    leads: rows,
    total,
    limit: filter.limit,
    offset: filter.offset,
  });
}
```

- [ ] **Step 3: Viết `src/app/api/leads/[id]/interactions/route.ts`**

```ts
import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildLeadActor, canLogInteraction } from "@/lib/leads/access";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";
import type { LeadRow } from "@/lib/leads/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = buildLeadActor(session.user.permissions, email);

  const supabase = getSupabaseAdmin();
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id,assigned_to_email")
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (leadError) {
    return NextResponse.json({ error: leadError.message }, { status: 500 });
  }
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!canLogInteraction(actor, lead as Pick<LeadRow, "assigned_to_email">)) {
    return NextResponse.json(
      { error: "This lead is not assigned to you." },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const typeId = typeof body?.type_id === "string" ? body.type_id : "";
  if (!UUID_RE.test(typeId)) {
    return NextResponse.json({ error: "type_id is required." }, { status: 400 });
  }
  const statusId = typeof body?.status_id === "string" && UUID_RE.test(body.status_id)
    ? body.status_id
    : null;
  const requestId =
    typeof body?.client_request_id === "string" && UUID_RE.test(body.client_request_id)
      ? body.client_request_id
      : null;

  const { data, error } = await supabase
    .rpc("log_lead_interaction_atomic", {
      p_lead_id: id,
      p_type_id: typeId,
      p_status_id: statusId,
      p_note: typeof body?.note === "string" ? body.note : null,
      p_actor_email: actor.email,
      p_follow_up_at:
        typeof body?.follow_up_at === "string" ? body.follow_up_at : null,
      p_client_request_id: requestId,
    })
    .single();

  if (error) {
    // Các mã dưới đây do RPC raise; đổi thành câu người đọc hiểu được thay vì
    // ném nguyên thông báo Postgres ra giao diện.
    const map: Record<string, [string, number]> = {
      LEAD_NOT_FOUND: ["Not found", 404],
      LEAD_TYPE_NOT_FOUND: ["That interaction type no longer exists.", 400],
      LEAD_STATUS_NOT_FOUND: ["That status no longer exists.", 400],
      LEAD_FOLLOW_UP_REQUIRED: ["Pick the date and time you promised to call back.", 400],
      LEAD_FOLLOW_UP_REQUIRES_SCHEDULED: [
        "Only a call-back status can carry a follow-up time.", 400,
      ],
    };
    for (const [code, [message, status]] of Object.entries(map)) {
      if (error.message.includes(code)) {
        return NextResponse.json({ error: message }, { status });
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const sourceId = readLeadMutationSourceId(req);
  // Chỉ broadcast nằm trong after(). RPC đã commit và đã đổi updated_at TRƯỚC
  // khi response rời đi, nên client không bao giờ giữ token cũ.
  after(async () => {
    await broadcastLeadsChanged(sourceId);
  });

  const result = data as { interaction: unknown; lead: unknown };
  return NextResponse.json({
    interaction: result.interaction,
    lead: result.lead,
  });
}
```

- [ ] **Step 3 (nội dung cho Step 1): `src/lib/leads/realtime-topics.ts` và `realtime.ts`**

```ts
// src/lib/leads/realtime-topics.ts
export const LEADS_TOPIC = "leads-stream";
export const LEAD_MUTATION_SOURCE_HEADER = "x-lead-client-source";

export function leadRoomTopic(leadId: string): string {
  return `lead-${leadId}`;
}

/**
 * Chỉ bỏ qua tiếng vọng khi CẢ HAI bên có source id thật. Coi hai id cùng
 * thiếu là một sẽ nuốt mất cập nhật của người khác — đúng lỗi đã sửa ở
 * isOwnRealtimeMutation bên tasks.
 */
export function isOwnLeadMutation(
  localSourceId: string | undefined,
  messageSourceId: unknown
): boolean {
  return Boolean(localSourceId && messageSourceId === localSourceId);
}
```

```ts
// src/lib/leads/realtime.ts
import { LEADS_TOPIC, LEAD_MUTATION_SOURCE_HEADER, leadRoomTopic } from "./realtime-topics";

export { LEADS_TOPIC, LEAD_MUTATION_SOURCE_HEADER, leadRoomTopic };

export function readLeadMutationSourceId(request: Request): string | undefined {
  const sourceId = request.headers.get(LEAD_MUTATION_SOURCE_HEADER)?.trim();
  if (!sourceId || sourceId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(sourceId)) {
    return undefined;
  }
  return sourceId;
}

export async function broadcastLeadsChanged(sourceId?: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: LEADS_TOPIC,
            event: "changed",
            payload: sourceId ? { sourceId } : {},
          },
        ],
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Viết test cho `isOwnLeadMutation`**

```ts
// src/lib/leads/realtime-topics.test.ts
import { describe, expect, it } from "vitest";
import { isOwnLeadMutation } from "./realtime-topics";

describe("isOwnLeadMutation", () => {
  it("suppresses only a genuine echo of this tab", () => {
    expect(isOwnLeadMutation("tab-a", "tab-a")).toBe(true);
    expect(isOwnLeadMutation("tab-a", "tab-b")).toBe(false);
  });

  // Nếu coi hai id cùng thiếu là một thì mọi cập nhật từ route cũ sẽ bị nuốt.
  it("never suppresses when either side has no id", () => {
    expect(isOwnLeadMutation(undefined, undefined)).toBe(false);
    expect(isOwnLeadMutation("tab-a", undefined)).toBe(false);
    expect(isOwnLeadMutation(undefined, "tab-b")).toBe(false);
  });
});
```

- [ ] **Step 5: Typecheck, test, commit**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: sạch cả ba; test ≥ 782

```bash
git add src/app/api/leads src/lib/leads/realtime.ts src/lib/leads/realtime-topics.ts src/lib/leads/realtime-topics.test.ts
git commit -m "feat(leads): add lead list and interaction routes"
```

### Task 9: Màn hình Leads

**Files:**
- Create: `src/app/(authed)/leads/page.tsx`
- Create: `src/app/(authed)/leads/_components/LeadsClient.tsx`
- Create: `src/app/(authed)/leads/_components/LeadDetailDrawer.tsx`
- Create: `src/app/(authed)/leads/_components/InteractionLog.tsx`

**Không có test tự động cho task này** — vitest chạy `environment: "node"` và chỉ nhận `src/**/*.test.ts`. Verify bằng tay theo kịch bản ở Step 4.

**Interfaces:**
- Consumes: `GET /api/leads`, `POST /api/leads/:id/interactions`, `fetchTableColumns("lead_pc" | "lead_health")`
- Produces: route `/leads` render được

- [ ] **Step 1: Viết `page.tsx` (server component)**

```tsx
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildLeadActor } from "@/lib/leads/access";
import { fetchLeadsPage } from "@/lib/leads/queries";
import { fetchTableColumnsWithOptions } from "@/lib/table-config/queries";
import { toLeadProduct } from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";
import { LeadsClient } from "./_components/LeadsClient";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const raw = Array.isArray(params.product) ? params.product[0] : params.product;
  const product = toLeadProduct(raw);

  const session = await requireAnyPermission([
    PERMISSIONS.LEAD_MANAGE,
    PERMISSIONS.LEAD_WORK,
  ]);
  const email = session.user.email ?? "";
  const actor = buildLeadActor(session.user.permissions, email);
  const supabase = getSupabaseAdmin();

  // Bốn truy vấn độc lập nhau — chạy song song thay vì nối đuôi, giống cách
  // enrollment/page.tsx làm.
  const [page, config, statuses, types] = await Promise.all([
    fetchLeadsPage(actor, { product }, supabase),
    fetchTableColumnsWithOptions(product === "pc" ? "lead_pc" : "lead_health", supabase),
    supabase
      .from("lead_statuses")
      .select("id,product,label,color,position,kind,archived_at")
      .eq("product", product)
      .is("archived_at", null)
      .order("position"),
    supabase
      .from("lead_interaction_types")
      .select("id,label,color,position,counts_as_contact,archived_at")
      .is("archived_at", null)
      .order("position"),
  ]);

  return (
    <LeadsClient
      product={product}
      currentEmail={email}
      isManager={actor.isManager}
      initialLeads={page.rows}
      initialTotal={page.total}
      columns={config.columns}
      columnOptions={config.options}
      statuses={statuses.data ?? []}
      interactionTypes={types.data ?? []}
    />
  );
}
```

- [ ] **Step 2: Viết `LeadsClient.tsx`**

Bảng dạng List. Yêu cầu bắt buộc:
- Mỗi dòng: các cột theo `columns`, cộng một chấm màu cờ cảnh báo tính bằng `resolveLeadAlerts`
- Ô tích chọn nhiều dòng; thanh hành động nổi lên khi có ít nhất một dòng được chọn, chỉ hiện với `isManager`
- Nút phân trang dùng `total`, `limit`, `offset` từ response
- Bấm vào dòng → mở `LeadDetailDrawer`
- Đăng ký realtime `LEADS_TOPIC`, dùng `isOwnLeadMutation` để bỏ qua tiếng vọng của chính tab mình
- Nhịp làm tươi định kỳ **phải** kiểm `document.visibilityState === "visible"` trước khi gọi API. Tab nền không được poll — đây là thứ từng chiếm 55% invocation của cả hệ thống.

- [ ] **Step 3: Viết `InteractionLog.tsx`**

Đây là chỗ thay thế comment tự do. Composer **không phải** ô nhập trống:

```
[ Loại tương tác ▾ ]  [ Kết quả ▾ ]  [ Hẹn gọi lại: __ ]   ← chỉ hiện khi kết quả có kind='scheduled'
[ Ghi chú....................................... ]
                                    [ Ghi nhận ]
```

Quy tắc:
- Loại và Kết quả bắt buộc chọn, nút Ghi nhận disabled cho tới khi đủ
- Chọn kết quả `kind === "scheduled"` thì ô ngày giờ hiện ra và trở thành bắt buộc
- Mỗi lần gửi sinh một `crypto.randomUUID()` làm `client_request_id`, giữ nguyên khi bấm lại sau lỗi mạng — bấm hai lần không được đếm thành hai cuộc gọi
- Danh sách bên dưới hiện các entry đã ghi: `[Call] · Không nghe máy · Bảo Võ · 2 giờ trước` kèm ghi chú

- [ ] **Step 4: Verify bằng tay**

```bash
npm run dev
```
Mở `http://localhost:3000/leads`, kiểm đủ 6 điểm:
1. Đăng nhập bằng tài khoản chỉ có `lead.work` → chỉ thấy lead của mình
2. Đăng nhập bằng tài khoản có `lead.manage` → thấy hết, có thanh chọn nhiều dòng
3. Ghi một `[Call]` + kết quả → cột Attempts tăng 1, Last contact đổi
4. Ghi một `[Note]` → Attempts **không** đổi
5. Chọn kết quả loại hẹn gọi lại mà bỏ trống ngày giờ → nút Ghi nhận vẫn disabled
6. Mở hai tab, ghi tương tác ở tab A → tab B tự cập nhật, tab A **không** load lại hai lần

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint && npm run test:run`

```bash
git add "src/app/(authed)/leads"
git commit -m "feat(leads): add the leads table and interaction log"
```

---

## Phase 3 — Import

### Task 10: Parser Excel

**Files:**
- Create: `src/lib/leads/import-parse.ts`
- Test: `src/lib/leads/import-parse.test.ts`

**Interfaces:**
- Produces: `type ParsedLead = { full_name, phone, email, custom_values }`; `type ParseResult = { rows: ParsedLead[]; skipped: { row: number; reason: string }[] }`; `normalizePhone(raw)`; `parseLeadRows(records, mapping)`

Tách parser ra khỏi route để test được — route xử lý `File` nên không test được trong môi trường node.

- [ ] **Step 1: Viết test đỏ**

```ts
// src/lib/leads/import-parse.test.ts
import { describe, expect, it } from "vitest";
import { normalizePhone, parseLeadRows } from "./import-parse";

describe("normalizePhone", () => {
  // Số điện thoại là khoá chống trùng, nên hai cách viết cùng một số phải cho
  // ra cùng một chuỗi, nếu không import lần hai sẽ đẻ ra bản sao.
  it("reduces the many ways people write a US number to one", () => {
    expect(normalizePhone("(714) 555-0123")).toBe("7145550123");
    expect(normalizePhone("714.555.0123")).toBe("7145550123");
    expect(normalizePhone("+1 714 555 0123")).toBe("7145550123");
    expect(normalizePhone("1-714-555-0123")).toBe("7145550123");
  });

  it("returns null for anything that cannot be a number", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("N/A")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });

  // Excel biến số điện thoại thành số thực rồi mất số 0 đầu — chuyện xảy ra
  // thật, không phải giả định.
  it("keeps a number Excel turned into a float", () => {
    expect(normalizePhone(7145550123)).toBe("7145550123");
  });
});

describe("parseLeadRows", () => {
  const mapping = { full_name: "Name", phone: "Cell", email: "Email" };

  it("maps the named columns and keeps the rest as custom values", () => {
    const result = parseLeadRows(
      [{ Name: "An Nguyen", Cell: "(714) 555-0123", Email: "an@x.com", Language: "VI" }],
      mapping
    );
    expect(result.rows).toEqual([
      {
        full_name: "An Nguyen",
        phone: "7145550123",
        email: "an@x.com",
        custom_values: { Language: "VI" },
      },
    ]);
    expect(result.skipped).toEqual([]);
  });

  // Lead không có số thì không gọi được — cả module xoay quanh việc gọi, nên
  // bỏ qua và báo rõ còn hơn nhận vào rồi để đó.
  it("skips a row with no usable phone and says which row", () => {
    const result = parseLeadRows(
      [{ Name: "No Phone", Cell: "N/A", Email: "x@x.com" }],
      mapping
    );
    expect(result.rows).toEqual([]);
    expect(result.skipped).toEqual([{ row: 2, reason: "Missing phone number" }]);
  });

  it("drops a duplicate inside the same file, keeping the first", () => {
    const result = parseLeadRows(
      [
        { Name: "First", Cell: "714-555-0123" },
        { Name: "Second", Cell: "(714) 555 0123" },
      ],
      mapping
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].full_name).toBe("First");
    expect(result.skipped).toEqual([
      { row: 3, reason: "Duplicate phone number in this file" },
    ]);
  });

  it("lowercases email so the same person is not two people", () => {
    const result = parseLeadRows(
      [{ Name: "A", Cell: "7145550123", Email: "  An@X.COM " }],
      mapping
    );
    expect(result.rows[0].email).toBe("an@x.com");
  });
});
```

- [ ] **Step 2: Chạy để chắc nó fail**

Run: `npx vitest run src/lib/leads/import-parse.test.ts`
Expected: FAIL — `Cannot find module './import-parse'`

- [ ] **Step 3: Viết `src/lib/leads/import-parse.ts`**

```ts
export type ParsedLead = {
  full_name: string | null;
  phone: string;
  email: string | null;
  custom_values: Record<string, unknown>;
};

export type ParseResult = {
  rows: ParsedLead[];
  skipped: { row: number; reason: string }[];
};

export type LeadColumnMapping = {
  full_name?: string;
  phone: string;
  email?: string;
};

/**
 * Rút số điện thoại về chỉ còn chữ số, bỏ mã quốc gia 1 của Mỹ. Đây là khoá
 * chống trùng, nên hai cách viết cùng một số bắt buộc phải cho cùng kết quả.
 */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (digits.length === 0) return null;
  const trimmed = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  return trimmed.length >= 7 ? trimmed : null;
}

function cell(record: Record<string, unknown>, key: string | undefined): string | null {
  if (!key) return null;
  const value = record[key];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * `row` trong danh sách bỏ qua là số dòng NHÌN THẤY trong Excel: +1 cho dòng
 * tiêu đề, +1 vì Excel đếm từ 1. Người dùng phải mở đúng dòng đó lên sửa được.
 */
export function parseLeadRows(
  records: readonly Record<string, unknown>[],
  mapping: LeadColumnMapping
): ParseResult {
  const rows: ParsedLead[] = [];
  const skipped: ParseResult["skipped"] = [];
  const seenPhones = new Set<string>();
  const mappedKeys = new Set(
    [mapping.full_name, mapping.phone, mapping.email].filter(Boolean) as string[]
  );

  records.forEach((record, index) => {
    const excelRow = index + 2;
    const phone = normalizePhone(cell(record, mapping.phone));
    if (!phone) {
      skipped.push({ row: excelRow, reason: "Missing phone number" });
      return;
    }
    if (seenPhones.has(phone)) {
      skipped.push({ row: excelRow, reason: "Duplicate phone number in this file" });
      return;
    }
    seenPhones.add(phone);

    const custom: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (!mappedKeys.has(key) && value !== null && value !== undefined && value !== "") {
        custom[key] = value;
      }
    }

    const email = cell(record, mapping.email);
    rows.push({
      full_name: cell(record, mapping.full_name),
      phone,
      email: email ? email.toLowerCase() : null,
      custom_values: custom,
    });
  });

  return { rows, skipped };
}
```

- [ ] **Step 4: Test xanh**

Run: `npx vitest run src/lib/leads/import-parse.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/import-parse.ts src/lib/leads/import-parse.test.ts
git commit -m "feat(leads): add the lead import parser"
```

### Task 11: Route import và sự kiện

**Files:**
- Create: `src/app/api/leads/events/route.ts`
- Create: `src/app/api/leads/import/route.ts`

**Interfaces:**
- Consumes: `parseLeadRows`, `canManageLeads`
- Produces: `POST /api/leads/events` → `{ event }`; `POST /api/leads/import` (multipart: `file`, `event_id`, `product`, `mapping` JSON) → `{ inserted, skipped, duplicates }`

- [ ] **Step 1: Viết route import**

```ts
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildLeadActor, canManageLeads } from "@/lib/leads/access";
import { parseLeadRows, type LeadColumnMapping } from "@/lib/leads/import-parse";
import { toLeadProduct } from "@/lib/leads/types";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email);
  if (!canManageLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is larger than 5 MB." },
      { status: 400 }
    );
  }

  let mapping: LeadColumnMapping;
  try {
    mapping = JSON.parse(String(form.get("mapping") ?? "")) as LeadColumnMapping;
  } catch {
    return NextResponse.json({ error: "Column mapping is missing." }, { status: 400 });
  }
  if (!mapping?.phone) {
    return NextResponse.json(
      { error: "Choose which column holds the phone number." },
      { status: 400 }
    );
  }

  const product = toLeadProduct(form.get("product"));
  const eventId = String(form.get("event_id") ?? "") || null;

  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return NextResponse.json({ error: "That file has no sheets." }, { status: 400 });
  }
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets[sheetName],
    { defval: null }
  );
  if (records.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `That file has ${records.length} rows; the limit is ${MAX_ROWS}.` },
      { status: 400 }
    );
  }

  const parsed = parseLeadRows(records, mapping);
  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { inserted: 0, skipped: parsed.skipped, duplicates: 0 },
      { status: 200 }
    );
  }

  const supabase = getSupabaseAdmin();
  // ignoreDuplicates dựa vào leads_event_phone_unique_idx: import lại đúng file
  // đó không tạo bản sao, và cũng không làm hỏng cả lô vì một dòng trùng.
  const { data, error } = await supabase
    .from("leads")
    .upsert(
      parsed.rows.map((row) => ({
        product,
        event_id: eventId,
        full_name: row.full_name,
        phone: row.phone,
        email: row.email,
        custom_values: row.custom_values,
        created_by_email: actor.email,
      })),
      { onConflict: "event_id,phone", ignoreDuplicates: true }
    )
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const inserted = data?.length ?? 0;
  return NextResponse.json({
    inserted,
    duplicates: parsed.rows.length - inserted,
    skipped: parsed.skipped,
  });
}
```

- [ ] **Step 2: Viết route events**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildLeadActor, canManageLeads, canWorkLeads } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email);
  if (!canWorkLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("lead_events")
    .select("id,name,event_date,location,notes,created_at")
    .is("archived_at", null)
    .order("event_date", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email);
  if (!canManageLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "The event needs a name." }, { status: 400 });
  }
  const { data, error } = await getSupabaseAdmin()
    .from("lead_events")
    .insert({
      name,
      event_date: typeof body?.event_date === "string" ? body.event_date : null,
      location: typeof body?.location === "string" ? body.location : null,
      notes: typeof body?.notes === "string" ? body.notes : null,
      created_by_email: actor.email,
    })
    .select("id,name,event_date,location,notes,created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}
```

- [ ] **Step 3: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint && npm run test:run`

```bash
git add src/app/api/leads/import src/app/api/leads/events
git commit -m "feat(leads): add lead import and event routes"
```

### Task 12: Hộp thoại import

**Files:**
- Create: `src/app/(authed)/leads/_components/LeadImportDialog.tsx`
- Modify: `src/app/(authed)/leads/_components/LeadsClient.tsx`

**Không có test tự động.** Verify tay ở Step 3.

- [ ] **Step 1: Ba bước trong hộp thoại**

1. Chọn sự kiện (danh sách có sẵn) hoặc tạo mới ngay tại chỗ
2. Chọn file → đọc header client-side bằng `XLSX.read`, hiện dropdown map cột cho `full_name` / `phone` / `email`; **đoán sẵn** dựa trên tên header (`/name/i`, `/phone|cell|mobile/i`, `/e-?mail/i`)
3. Xem trước 5 dòng đầu đã map, rồi bấm Import

- [ ] **Step 2: Hiện kết quả trung thực**

Sau khi import, hiện đúng ba con số: `inserted`, `duplicates`, và bảng các dòng bị bỏ qua kèm số dòng Excel và lý do. **Không** gộp thành "Import thành công" — người dùng phải biết 12 dòng bị bỏ và bỏ vì sao để về sửa file.

- [ ] **Step 3: Verify tay**

1. Import một file 20 dòng → đủ 20, `duplicates: 0`
2. Import lại đúng file đó → `inserted: 0`, `duplicates: 20`, không có bản sao nào trong bảng
3. Import file có 2 dòng thiếu số điện thoại → `skipped` chỉ đúng số dòng Excel
4. Import file 3 MB → chạy được; file 6 MB → báo lỗi rõ ràng, không treo

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/leads/_components/LeadImportDialog.tsx" "src/app/(authed)/leads/_components/LeadsClient.tsx"
git commit -m "feat(leads): add the lead import dialog"
```

---

## Phase 4 — Giao lead, cảnh báo, Overview

### Task 13: Route giao lead hàng loạt

**Files:**
- Create: `src/app/api/leads/assign/route.ts`
- Test: `src/lib/leads/assign.test.ts`
- Create: `src/lib/leads/assign.ts`

**Interfaces:**
- Produces: `validateAssignRequest(body)` → `{ leadIds: string[]; toEmail: string | null; reason: string | null } | { error: string }`; `POST /api/leads/assign` body `{ lead_ids, to_email, reason? }` → `{ assigned: number }`

- [ ] **Step 1: Viết test đỏ cho phần thuần**

```ts
// src/lib/leads/assign.test.ts
import { describe, expect, it } from "vitest";
import { validateAssignRequest, MAX_ASSIGN_BATCH } from "./assign";

const uuid = (n: number) =>
  `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

describe("validateAssignRequest", () => {
  it("accepts a normal batch and lowercases the target", () => {
    const result = validateAssignRequest({
      lead_ids: [uuid(1), uuid(2)],
      to_email: "  CS@X.COM ",
    });
    expect(result).toEqual({
      leadIds: [uuid(1), uuid(2)],
      toEmail: "cs@x.com",
      reason: null,
    });
  });

  // Bỏ gán về kho là thao tác hợp lệ, không phải lỗi.
  it("allows clearing the owner", () => {
    const result = validateAssignRequest({ lead_ids: [uuid(1)], to_email: null });
    expect(result).toEqual({ leadIds: [uuid(1)], toEmail: null, reason: null });
  });

  it("rejects an empty selection", () => {
    expect(validateAssignRequest({ lead_ids: [], to_email: "cs@x.com" }))
      .toEqual({ error: "Select at least one lead." });
  });

  it("rejects an id that is not a uuid instead of passing it to the database", () => {
    expect(validateAssignRequest({ lead_ids: ["'; drop table leads; --"], to_email: null }))
      .toEqual({ error: "One of the selected leads is not valid." });
  });

  // Không có trần thì một cú bấm nhầm có thể chuyển cả nghìn lead trong một
  // request, và bảng lịch sử bàn giao cũng phình theo.
  it("rejects a batch past the cap", () => {
    const ids = Array.from({ length: MAX_ASSIGN_BATCH + 1 }, (_, i) => uuid(i + 1));
    expect(validateAssignRequest({ lead_ids: ids, to_email: null }))
      .toEqual({ error: `Assign at most ${MAX_ASSIGN_BATCH} leads at a time.` });
  });

  it("drops a blank reason rather than storing an empty string", () => {
    const result = validateAssignRequest({
      lead_ids: [uuid(1)], to_email: null, reason: "   ",
    });
    expect(result).toEqual({ leadIds: [uuid(1)], toEmail: null, reason: null });
  });
});
```

- [ ] **Step 2: Chạy để chắc nó fail**

Run: `npx vitest run src/lib/leads/assign.test.ts`
Expected: FAIL — `Cannot find module './assign'`

- [ ] **Step 3: Viết `src/lib/leads/assign.ts`**

```ts
export const MAX_ASSIGN_BATCH = 500;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AssignRequest = {
  leadIds: string[];
  toEmail: string | null;
  reason: string | null;
};

export function validateAssignRequest(
  body: Record<string, unknown> | null
): AssignRequest | { error: string } {
  const ids = Array.isArray(body?.lead_ids) ? body.lead_ids : [];
  if (ids.length === 0) return { error: "Select at least one lead." };
  if (ids.length > MAX_ASSIGN_BATCH) {
    return { error: `Assign at most ${MAX_ASSIGN_BATCH} leads at a time.` };
  }
  const leadIds: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return { error: "One of the selected leads is not valid." };
    }
    leadIds.push(id);
  }
  const rawEmail = typeof body?.to_email === "string" ? body.to_email.trim() : "";
  const rawReason = typeof body?.reason === "string" ? body.reason.trim() : "";
  return {
    leadIds,
    toEmail: rawEmail === "" ? null : rawEmail.toLowerCase(),
    reason: rawReason === "" ? null : rawReason,
  };
}
```

- [ ] **Step 4: Viết route**

```ts
// src/app/api/leads/assign/route.ts
import { after, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildLeadActor, canManageLeads } from "@/lib/leads/access";
import { validateAssignRequest } from "@/lib/leads/assign";
import { broadcastLeadsChanged, readLeadMutationSourceId } from "@/lib/leads/realtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email);
  if (!canManageLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = validateAssignRequest(
    (await request.json().catch(() => null)) as Record<string, unknown> | null
  );
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  // Đọc chủ cũ TRƯỚC khi ghi đè, nếu không lịch sử bàn giao mất phần from_email
  // và không ai biết lead từng ở tay ai.
  const { data: before, error: beforeError } = await supabase
    .from("leads")
    .select("id,assigned_to_email")
    .in("id", parsed.leadIds)
    .is("archived_at", null);
  if (beforeError) {
    return NextResponse.json({ error: beforeError.message }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("leads")
    .update({
      assigned_to_email: parsed.toEmail,
      assigned_at: parsed.toEmail ? nowIso : null,
      assigned_by_email: actor.email,
      updated_at: nowIso,
      updated_by_email: actor.email,
    })
    .in("id", parsed.leadIds)
    .is("archived_at", null);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const rows = (before ?? []) as { id: string; assigned_to_email: string | null }[];
  const { error: historyError } = await supabase
    .from("lead_assignment_history")
    .insert(
      rows.map((row) => ({
        lead_id: row.id,
        from_email: row.assigned_to_email,
        to_email: parsed.toEmail,
        reason: parsed.reason,
        actor_email: actor.email,
      }))
    );
  if (historyError) {
    // Lead đã chuyển xong rồi; mất dòng lịch sử là chuyện đáng ghi log chứ
    // không đáng nói với người dùng rằng thao tác thất bại.
    console.error("Lead assignment history insert failed", historyError.message);
  }

  const sourceId = readLeadMutationSourceId(request);
  after(async () => {
    await broadcastLeadsChanged(sourceId);
  });

  return NextResponse.json({ assigned: rows.length });
}
```

- [ ] **Step 5: Test xanh, typecheck, commit**

Run: `npx vitest run src/lib/leads/assign.test.ts && npm run typecheck && npm run lint`

```bash
git add src/lib/leads/assign.ts src/lib/leads/assign.test.ts src/app/api/leads/assign
git commit -m "feat(leads): add bulk lead assignment"
```

### Task 14: Tổng hợp Overview

**Files:**
- Create: `src/lib/leads/overview.ts`
- Test: `src/lib/leads/overview.test.ts`
- Create: `src/app/api/leads/overview/route.ts`

**Interfaces:**
- Consumes: `resolveLeadAlerts`, `ALERT_SEVERITY`
- Produces: `summarizeLeads(leads, statusById, settings, now)` → `{ total, unassigned, byAlert: Record<LeadAlert, number>, byAgent: AgentSummary[], byEvent: EventSummary[] }`

- [ ] **Step 1: Viết test đỏ**

```ts
// src/lib/leads/overview.test.ts
import { describe, expect, it } from "vitest";
import { summarizeLeads } from "./overview";
import type { LeadAlertSettings, LeadRow, LeadStatus } from "./types";

const settings: LeadAlertSettings = {
  product: "pc", no_contact_hours: 24, stale_days: 3, max_attempts: 4,
};
const NOW = new Date("2026-09-01T12:00:00Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3600_000).toISOString();

const open: LeadStatus = {
  id: "s1", product: "pc", label: "Open", color: null,
  position: 0, kind: "open", archived_at: null,
};
const won: LeadStatus = { ...open, id: "s2", kind: "won" };
const statusById = new Map([["s1", open], ["s2", won]]);

function lead(patch: Partial<LeadRow>): LeadRow {
  return {
    id: Math.random().toString(36), display_number: 1, product: "pc",
    event_id: "e1", full_name: null, phone: "1", email: null,
    assigned_to_email: null, assigned_at: null, assigned_by_email: null,
    status_id: "s1", first_contacted_at: null, last_contacted_at: null,
    contact_attempt_count: 0, next_follow_up_at: null, closed_at: null,
    created_by_email: "m@x.com", created_at: hoursAgo(100),
    updated_by_email: null, updated_at: hoursAgo(100),
    custom_values: {}, archived_at: null, ...patch,
  };
}

describe("summarizeLeads", () => {
  it("counts what is still sitting in the pool", () => {
    const result = summarizeLeads(
      [lead({}), lead({ assigned_to_email: "a@x.com", assigned_at: hoursAgo(1) })],
      statusById, settings, NOW
    );
    expect(result.total).toBe(2);
    expect(result.unassigned).toBe(1);
  });

  it("attributes each red flag to the agent holding the lead", () => {
    const result = summarizeLeads(
      [
        lead({ assigned_to_email: "a@x.com", assigned_at: hoursAgo(30) }),
        lead({ assigned_to_email: "a@x.com", assigned_at: hoursAgo(30) }),
        lead({ assigned_to_email: "b@x.com", assigned_at: hoursAgo(1) }),
      ],
      statusById, settings, NOW
    );
    expect(result.byAlert.never_contacted).toBe(2);
    const a = result.byAgent.find((row) => row.email === "a@x.com");
    expect(a?.redCount).toBe(2);
    const b = result.byAgent.find((row) => row.email === "b@x.com");
    expect(b?.redCount).toBe(0);
  });

  // Tỉ lệ chốt phải tính trên số lead ĐÃ ĐÓNG, không phải trên tổng — nếu chia
  // cho tổng thì sự kiện vừa import xong lúc nào cũng trông như thất bại.
  it("computes the win rate over closed leads only", () => {
    const result = summarizeLeads(
      [
        lead({ event_id: "e1", status_id: "s2", closed_at: hoursAgo(1) }),
        lead({ event_id: "e1", status_id: "s1" }),
        lead({ event_id: "e1", status_id: "s1" }),
      ],
      statusById, settings, NOW
    );
    const event = result.byEvent.find((row) => row.eventId === "e1");
    expect(event?.total).toBe(3);
    expect(event?.won).toBe(1);
    expect(event?.closed).toBe(1);
    expect(event?.winRate).toBe(1);
  });

  it("reports a null win rate when nothing has closed yet", () => {
    const result = summarizeLeads([lead({})], statusById, settings, NOW);
    expect(result.byEvent[0].winRate).toBeNull();
  });

  it("ranks the worst agent first so the manager reads top-down", () => {
    const result = summarizeLeads(
      [
        lead({ assigned_to_email: "quiet@x.com", assigned_at: hoursAgo(1) }),
        lead({ assigned_to_email: "bad@x.com", assigned_at: hoursAgo(30) }),
        lead({ assigned_to_email: "bad@x.com", assigned_at: hoursAgo(30) }),
      ],
      statusById, settings, NOW
    );
    expect(result.byAgent[0].email).toBe("bad@x.com");
  });
});
```

- [ ] **Step 2: Chạy để chắc nó fail**

Run: `npx vitest run src/lib/leads/overview.test.ts`
Expected: FAIL — `Cannot find module './overview'`

- [ ] **Step 3: Viết `src/lib/leads/overview.ts`**

```ts
import { ALERT_SEVERITY, resolveLeadAlerts, type LeadAlert } from "./alerts";
import type { LeadAlertSettings, LeadRow, LeadStatus } from "./types";

export type AgentSummary = {
  email: string;
  total: number;
  redCount: number;
  amberCount: number;
  won: number;
};

export type EventSummary = {
  eventId: string | null;
  total: number;
  won: number;
  closed: number;
  /** null khi chưa lead nào đóng — khác hẳn với 0 nghĩa là đã đóng mà trượt hết. */
  winRate: number | null;
};

export type LeadSummary = {
  total: number;
  unassigned: number;
  byAlert: Record<LeadAlert, number>;
  byAgent: AgentSummary[];
  byEvent: EventSummary[];
};

export function summarizeLeads(
  leads: readonly LeadRow[],
  statusById: ReadonlyMap<string, LeadStatus>,
  settings: LeadAlertSettings,
  now: Date = new Date()
): LeadSummary {
  const byAlert: Record<LeadAlert, number> = {
    never_contacted: 0, stale: 0, follow_up_overdue: 0, exhausted: 0,
  };
  const agents = new Map<string, AgentSummary>();
  const events = new Map<string | null, EventSummary>();
  let unassigned = 0;

  for (const lead of leads) {
    const status = lead.status_id ? statusById.get(lead.status_id) ?? null : null;
    const alerts = resolveLeadAlerts(lead, status, settings, now);
    for (const alert of alerts) byAlert[alert] += 1;

    const isWon = status?.kind === "won";
    const isClosed = status?.kind === "won" || status?.kind === "lost";

    const event = events.get(lead.event_id) ?? {
      eventId: lead.event_id, total: 0, won: 0, closed: 0, winRate: null,
    };
    event.total += 1;
    if (isWon) event.won += 1;
    if (isClosed) event.closed += 1;
    events.set(lead.event_id, event);

    if (!lead.assigned_to_email) {
      unassigned += 1;
      continue;
    }
    const key = lead.assigned_to_email.toLowerCase();
    const agent = agents.get(key) ?? {
      email: key, total: 0, redCount: 0, amberCount: 0, won: 0,
    };
    agent.total += 1;
    if (isWon) agent.won += 1;
    for (const alert of alerts) {
      if (ALERT_SEVERITY[alert] === "red") agent.redCount += 1;
      else agent.amberCount += 1;
    }
    agents.set(key, agent);
  }

  for (const event of events.values()) {
    event.winRate = event.closed > 0 ? event.won / event.closed : null;
  }

  return {
    total: leads.length,
    unassigned,
    byAlert,
    // Nhiều cờ đỏ nhất lên đầu: manager mở màn hình này để tìm chỗ cần can
    // thiệp, không phải để đọc bảng chữ cái.
    byAgent: [...agents.values()].sort(
      (a, b) => b.redCount - a.redCount || b.total - a.total || a.email.localeCompare(b.email)
    ),
    byEvent: [...events.values()].sort((a, b) => b.total - a.total),
  };
}
```

- [ ] **Step 4: Viết route Overview**

```ts
// src/app/api/leads/overview/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildLeadActor, canManageLeads } from "@/lib/leads/access";
import { summarizeLeads } from "@/lib/leads/overview";
import { toLeadProduct, type LeadAlertSettings, type LeadRow, type LeadStatus } from "@/lib/leads/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email);
  // Overview để lộ khối lượng và thành tích của mọi agent, nên là màn hình
  // chỉ dành cho manager.
  if (!canManageLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const product = toLeadProduct(new URL(request.url).searchParams.get("product"));
  const supabase = getSupabaseAdmin();
  const [leadsRes, statusRes, settingsRes] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id,display_number,product,event_id,full_name,phone,email,assigned_to_email," +
        "assigned_at,assigned_by_email,status_id,first_contacted_at,last_contacted_at," +
        "contact_attempt_count,next_follow_up_at,closed_at,created_by_email,created_at," +
        "updated_by_email,updated_at,custom_values,archived_at"
      )
      .eq("product", product)
      .is("archived_at", null),
    supabase
      .from("lead_statuses")
      .select("id,product,label,color,position,kind,archived_at")
      .eq("product", product),
    supabase
      .from("lead_alert_settings")
      .select("product,no_contact_hours,stale_days,max_attempts")
      .eq("product", product)
      .maybeSingle(),
  ]);

  if (leadsRes.error) {
    return NextResponse.json({ error: leadsRes.error.message }, { status: 500 });
  }

  const statusById = new Map(
    ((statusRes.data ?? []) as LeadStatus[]).map((row) => [row.id, row])
  );
  const settings = (settingsRes.data ?? {
    product, no_contact_hours: 24, stale_days: 3, max_attempts: 4,
  }) as LeadAlertSettings;

  return NextResponse.json({
    summary: summarizeLeads(
      (leadsRes.data ?? []) as unknown as LeadRow[],
      statusById,
      settings
    ),
  });
}
```

- [ ] **Step 5: Test xanh, commit**

Run: `npx vitest run src/lib/leads/overview.test.ts && npm run typecheck && npm run lint`
Expected: PASS 5 tests

```bash
git add src/lib/leads/overview.ts src/lib/leads/overview.test.ts src/app/api/leads/overview
git commit -m "feat(leads): add the lead overview summary"
```

### Task 15: Màn Overview và cờ trong bảng

**Files:**
- Create: `src/app/(authed)/leads/_components/LeadOverview.tsx`
- Modify: `src/app/(authed)/leads/_components/LeadsClient.tsx`

**Không có test tự động.** Verify tay ở Step 3.

- [ ] **Step 1: Bốn ô đếm ở đầu Overview**

Chưa ai gọi · Bỏ lâu ngày · Quá hẹn · Gọi mãi không được. Ba ô đầu màu đỏ, ô cuối màu vàng. Bấm vào ô → nhảy sang tab Leads với bộ lọc tương ứng đã áp sẵn.

- [ ] **Step 2: Hai bảng bên dưới**

Bảng agent (sắp theo `redCount` giảm dần): email, tổng lead, số đỏ, số vàng, số chốt.
Bảng sự kiện: tên sự kiện, tổng, đã đóng, chốt, tỉ lệ. Tỉ lệ hiện `—` khi `winRate === null`, **không** hiện `0%`.

- [ ] **Step 3: Verify tay**

1. Tài khoản chỉ có `lead.work` mở `/leads?view=overview` → bị chặn, không thấy số liệu của người khác
2. Giao 1 lead rồi lùi đồng hồ máy quá 24 giờ → lead hiện cờ đỏ "Chưa ai gọi", ô đếm tăng 1
3. Ghi một `[Call]` cho lead đó → cờ đỏ tắt ngay
4. Sự kiện chưa lead nào đóng → cột tỉ lệ hiện `—`

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/leads/_components"
git commit -m "feat(leads): add the manager overview screen"
```

### Task 16: Nav, Settings ngưỡng, changelog

**Files:**
- Modify: nav trong `src/app/(authed)/_components/` (tìm bằng `grep -rn "enrollment" src/app/\(authed\)/_components/`)
- Create: `src/app/api/leads/settings/route.ts`
- Modify: `src/app/(authed)/settings/` — thêm khối "Lead alerts"
- Modify: `agent-portal/changelog.md`

- [ ] **Step 1: Thêm mục Leads vào nav**

Hiện với ai có `lead.manage` **hoặc** `lead.work`, dùng đúng cách các mục khác đang kiểm quyền trong file nav đó.

- [ ] **Step 2: Route settings**

`GET /api/leads/settings` trả cả hai product. `PATCH` nhận `{ product, no_contact_hours, stale_days, max_attempts }`, chỉ cho `lead.manage`. Chặn giá trị `<= 0` bằng cùng thông báo mà check constraint trong DB sẽ đưa ra, để người dùng không phải nhìn lỗi Postgres.

- [ ] **Step 3: Khối Settings**

Ba ô số cho mỗi product, kèm câu giải thích một dòng mỗi ô. Ví dụ: *"Báo đỏ nếu lead được giao quá __ giờ mà chưa ai gọi."*

- [ ] **Step 4: Ghi changelog**

Thêm một entry vào đầu `agent-portal/changelog.md` theo đúng khuôn đang dùng, gồm: Loại, Cái gì, Vì sao, Kiểm chứng.

- [ ] **Step 5: Kiểm chứng toàn bộ và commit**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: cả ba sạch; test ≥ 800 passed

```bash
git add -A
git commit -m "feat(leads): add navigation, alert settings, and changelog"
```

---

### Task 17: Màn admin cho từ vựng

Không có task này thì `kind` và `counts_as_contact` chỉ sửa được bằng SQL tay — trái hẳn với điều đã chốt là admin tự cấu hình được mọi thứ.

**Files:**
- Create: `src/lib/leads/vocabulary.ts`
- Test: `src/lib/leads/vocabulary.test.ts`
- Create: `src/app/api/leads/vocabulary/route.ts`
- Modify: `src/app/(authed)/settings/` — thêm khối "Lead vocabulary"

**Interfaces:**
- Consumes: `isStatusKind` từ `./types`, `canManageLeads` từ `./access`
- Produces: `validateStatusInput(body)` → `{ product, label, kind, color, position } | { error }`; `validateTypeInput(body)` → `{ label, counts_as_contact, color, position } | { error }`

- [ ] **Step 1: Viết test đỏ**

```ts
// src/lib/leads/vocabulary.test.ts
import { describe, expect, it } from "vitest";
import { validateStatusInput, validateTypeInput } from "./vocabulary";

describe("validateStatusInput", () => {
  it("accepts a status the admin named in their own language", () => {
    expect(
      validateStatusInput({ product: "pc", label: "  Đang chăm  ", kind: "open" })
    ).toEqual({ product: "pc", label: "Đang chăm", kind: "open", color: null, position: 0 });
  });

  // kind là thứ engine cảnh báo đọc. Nhận bừa một chuỗi lạ nghĩa là lead mang
  // status đó sẽ không bao giờ được coi là đã đóng và báo đỏ mãi mãi.
  it("refuses a kind the alert engine does not understand", () => {
    expect(validateStatusInput({ product: "pc", label: "X", kind: "maybe" }))
      .toEqual({ error: "Pick what this status means: open, scheduled, won, or lost." });
  });

  it("refuses an empty label", () => {
    expect(validateStatusInput({ product: "pc", label: "   ", kind: "open" }))
      .toEqual({ error: "The status needs a name." });
  });

  it("refuses an unknown product", () => {
    expect(validateStatusInput({ product: "aca", label: "X", kind: "open" }))
      .toEqual({ error: "Unknown product." });
  });
});

describe("validateTypeInput", () => {
  it("defaults a new type to NOT counting as contact", () => {
    // Mặc định an toàn: admin thêm loại mới mà quên tích ô thì nó chỉ là ghi
    // chú, chứ không âm thầm tắt đèn đỏ của cả hệ thống.
    expect(validateTypeInput({ label: "Zalo" })).toEqual({
      label: "Zalo", counts_as_contact: false, color: null, position: 0,
    });
  });

  it("takes the flag when it is given", () => {
    expect(validateTypeInput({ label: "Zalo", counts_as_contact: true })).toEqual({ label: "Zalo", counts_as_contact: true, color: null, position: 0 });
  });

  it("refuses an empty label", () => {
    expect(validateTypeInput({ label: "" }))
      .toEqual({ error: "The interaction type needs a name." });
  });
});
```

- [ ] **Step 2: Chạy để chắc nó fail**

Run: `npx vitest run src/lib/leads/vocabulary.test.ts`
Expected: FAIL — `Cannot find module './vocabulary'`

- [ ] **Step 3: Viết `src/lib/leads/vocabulary.ts`**

```ts
import { isLeadProduct, isStatusKind, type LeadProduct, type StatusKind } from "./types";

export type StatusInput = {
  product: LeadProduct;
  label: string;
  kind: StatusKind;
  color: string | null;
  position: number;
};

export type TypeInput = {
  label: string;
  counts_as_contact: boolean;
  color: string | null;
  position: number;
};

function label(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function position(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function color(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
}

export function validateStatusInput(
  body: Record<string, unknown> | null
): StatusInput | { error: string } {
  if (!isLeadProduct(body?.product)) return { error: "Unknown product." };
  const name = label(body?.label);
  if (!name) return { error: "The status needs a name." };
  if (!isStatusKind(body?.kind)) {
    return {
      error: "Pick what this status means: open, scheduled, won, or lost.",
    };
  }
  return {
    product: body.product,
    label: name,
    kind: body.kind,
    color: color(body?.color),
    position: position(body?.position),
  };
}

export function validateTypeInput(
  body: Record<string, unknown> | null
): TypeInput | { error: string } {
  const name = label(body?.label);
  if (!name) return { error: "The interaction type needs a name." };
  return {
    label: name,
    // Mặc định false. Một loại mới âm thầm được tính là đã liên hệ sẽ tắt đèn
    // đỏ toàn hệ thống mà không ai cố ý.
    counts_as_contact: body?.counts_as_contact === true,
    color: color(body?.color),
    position: position(body?.position),
  };
}
```

- [ ] **Step 4: Test xanh**

Run: `npx vitest run src/lib/leads/vocabulary.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Viết route**

`src/app/api/leads/vocabulary/route.ts`: `GET` trả `{ statuses, types }` cho ai có `lead.work` trở lên; `POST` và `PATCH` chỉ cho `lead.manage`, dùng hai hàm validate ở trên và trả `{ error }` với status 400 khi validate thất bại. Xoá dùng soft-delete: `PATCH` với `{ archived_at: <ISO> }`, **không** `DELETE` cứng — lead cũ vẫn trỏ vào status đó.

- [ ] **Step 6: Khối Settings**

Hai bảng sửa tại chỗ. Bảng status có cột Nhãn / Ý nghĩa (dropdown 4 giá trị) / Màu / Thứ tự. Bảng loại tương tác có cột Nhãn / Tính là đã liên hệ (checkbox) / Màu / Thứ tự. Bên dưới ô "Ý nghĩa" ghi một dòng giải thích: *"Won và Lost làm lead ngừng bị nhắc. Call back bắt buộc chọn ngày giờ hẹn."*

- [ ] **Step 7: Verify tay**

1. Thêm loại `Zalo` không tích ô → ghi một `Zalo` cho lead chưa gọi bao giờ → cờ đỏ **vẫn** còn
2. Sửa `Zalo` thành có tích ô → ghi thêm một `Zalo` → cờ đỏ tắt
3. Archive status `Won` → lead đang mang status đó vẫn hiển thị, không lỗi, và theo Task 3 được coi như còn mở

- [ ] **Step 8: Commit**

```bash
git add src/lib/leads/vocabulary.ts src/lib/leads/vocabulary.test.ts src/app/api/leads/vocabulary "src/app/(authed)/settings"
git commit -m "feat(leads): let admins configure statuses and interaction types"
```

---

## Những gì CỐ Ý không làm ở v1

Ghi lại để sau này không ai tưởng là bỏ sót:

- **Không tự động thu hồi lead.** Sếp đã chốt: hệ thống chỉ cảnh báo, manager quyết định. Không viết cron chuyển lead.
- **Không mention, không đính kèm trong nhật ký tương tác.** Nhật ký là bản ghi có cấu trúc chứ không phải chỗ bàn luận.
- **Không tự tạo Enrollment record khi chốt.** Lead đóng bằng status `kind='won'` là hết.
- **Không có màn Events riêng.** Sự kiện là thực thể trong DB và có báo cáo trong Overview, nhưng tạo/chọn nó nằm trong hộp thoại import.
- **Không có chuông cho lead ở Phase 1-4.** Route thông báo hiện đã gộp 2 nguồn và tốn ~11 truy vấn mỗi lượt poll; thêm nguồn thứ ba phải đi kèm việc gộp truy vấn lại thành một RPC. Đó là một plan riêng, không nhét vào đây.

## Việc kế tiếp sau plan này

1. Gộp truy vấn của route `/api/tasks/notifications` thành một RPC, rồi mới thêm `lead_notifications` làm nguồn thứ ba
2. Xuất Excel cho bảng Leads (`lead.export` đã tạo sẵn permission, chưa có route)
3. Nút chuyển lead thẳng sang Enrollment, nếu sau khi chạy thật thấy việc nhập đôi là phiền
