# Health Table Phase 1 — Config Page & Column Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến "cột" của 3 bảng Health Task (CS/ACA/Medicare) từ hardcode thành dữ liệu DB do admin thiết kế, qua một Trang Config admin-only gồm 3 mục: Config Table, Config Value, Config Assistant.

**Architecture:** Thêm DB tables `table_column` (system + custom chung, có thứ tự) và `table_column_option` (lựa chọn dropdown custom), thêm `custom_values jsonb` vào `tasks` và `enrollment_records`. Pure logic (slug, value coercion, quyền sửa theo is_system) tách ra `src/lib/table-config/*` test bằng vitest. API routes mirror pattern của `option-sets`. UI `/config` admin-only.

**Tech Stack:** Next.js (bản fork trong repo — đọc `node_modules/next/dist/docs/` trước khi code), Supabase Postgres, TypeScript, vitest, Tailwind.

## Global Constraints

- **Next.js fork:** ĐỌC guide trong `node_modules/next/dist/docs/` trước khi viết code Next.js (route handler, server component). Bản này có breaking changes so với Next.js chuẩn (xem `AGENTS.md`).
- **Schema:** khai báo bảng trong `supabase/schema.sql` theo style `create table if not exists`, lowercase snake_case, `id uuid primary key default gen_random_uuid()`, `timestamptz not null default now()`.
- **Auth admin:** cổng admin = `actor.isManager` (đã map từ `isTaskViewAdmin`) — dùng lại `loadEnrollmentActor` / `buildTaskActor`.
- **Scope enum:** `'cs' | 'aca' | 'medicare'` ở mọi nơi.
- **Realtime:** sau mutation config, gọi `broadcastEnrollmentChanged()` (và tương đương cho tasks) như route hiện tại.
- **Test:** pure logic ở `src/lib/table-config/*.test.ts`, chạy `npx vitest run <file>`.

---

## Background & Existing Codebase Context

> Đọc kỹ mục này trước khi làm task nào. Nó mô tả toàn bộ hệ hiện tại để bạn (senior, chưa từng đụng repo này) hiểu vì sao từng task làm như vậy.

### Sản phẩm là gì
`agent-portal` là app Next.js + Supabase (Postgres) cho ~50 agent bảo hiểm. "Health Task" gồm **3 bảng dữ liệu**:
- **CS** — bảng công việc chăm sóc khách (task board), route `/tasks`, dữ liệu ở Postgres table `tasks`. Có 2 view: Kanban và **List** (`TaskListView.tsx`).
- **Enroll ACA** và **Enroll Medicare** — route `/enrollment`, chung Postgres table `enrollment_records`, phân biệt bằng cột `program` (`'aca'` | `'medicare'`). Medicare là bản rút gọn của ACA.

Hiện mỗi bảng là 1 "table display": cột được **hardcode trong code**. Mục tiêu Phase 1 là biến danh sách cột thành **dữ liệu trong DB** để admin tự thiết kế.

### Cột hiện đang hardcode như thế nào
Trong `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` (~3200 dòng), cột ACA là 1 mảng cứng:

```ts
// EnrollmentClient.tsx (hiện tại)
const ACA_ENROLLMENT_COLUMNS: EnrollmentColumn[] = [
  { key: "key", label: "Key", width: 100, sticky: true, sortable: true },
  { key: "client", label: "Client Name", width: 300, sticky: true, sortable: true },
  { key: "stage", label: "Stage", width: 260, sortable: true },
  { key: "caller", label: "Caller", width: 180, sortable: true },
  { key: "responsible", label: "Responsible Enroll", width: 200, sortable: true },
  { key: "payment", label: "Payment status", width: 180, sortable: true },
  { key: "carrier", label: "Carrier", width: 170, sortable: true },
  { key: "aca", label: "AC", width: 280, sortable: true },
  { key: "consent", label: "Consent", width: 104, sortable: true, align: "center" },
  { key: "platform", label: "Platform", width: 110, sortable: true },
  { key: "pcp2025", label: "PCP 2025", width: 180, sortable: true },
  { key: "pcp2026", label: "PCP 2026", width: 180, sortable: true },
  { key: "due", label: "Due Date", width: 110, sortable: true },
  { key: "fub", label: "FUB Link", width: 84, align: "center" },
  // ... createdBy/createdAt/updatedBy/updated/qc ...
];
// Medicare = lọc bỏ vài key + đổi label:
const MEDICARE_HIDDEN_COLUMNS = new Set(["caller","payment","aca","consent","platform","pcp2026"]);
const MEDICARE_COLUMN_LABELS = { responsible: "Assignee", pcp2025: "PCP" };
```
CS thì hardcode ở `src/app/(authed)/tasks/_components/task-list-columns.ts` (`TASK_LIST_COLUMNS`, mảng `{key,label,sortKey,locked,align}`).

**Các `key` này quan trọng:** khi seed cột system vào DB (Task 5), `table_column.key` PHẢI trùng đúng các key trên (`client`, `stage`, `caller`, ...) để renderer cũ (switch theo key) vẫn map được ô.

### `custom_values` sẽ lưu ở đâu — và vì sao JSONB chứ không phải bảng EAV riêng
Filter và sort của bảng đang chạy **client-side**: toàn bộ record được load về client rồi lọc/sắp trong JS (memo `filteredRecords` trong `EnrollmentClient.tsx` gọi `filterRecords(records, filters, optionsById)`). Nghĩa là điều quan trọng là **load nhanh + đủ trong 1 query**. Nếu lưu giá trị custom ở bảng value riêng (EAV) thì mỗi lần load phải pivot/join N cột → chậm và phức tạp. Lưu `custom_values jsonb` ngay trên record → toàn bộ giá trị custom về cùng row, filter/sort JS dùng được ngay, thêm/xoá cột không cần đổi cấu trúc bảng.

### Hệ Option-Set hiện có (Config Value sẽ mô phỏng cái này)
Dropdown của ACA (Stage/Carrier/Payment/…) hiện lưu ở 2 bảng:
```sql
create table if not exists enrollment_option_sets (
  id uuid primary key default gen_random_uuid(),
  program text not null default 'aca' check (program in ('aca','medicare')),
  key text not null check (key in ('stage','carrier','platform','consent','payment_status','aca_status')),
  label text not null,
  is_stage boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists enrollment_options (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references enrollment_option_sets(id) on delete restrict,
  label text not null,
  color text,
  position integer not null default 0,
  is_terminal boolean not null default false,
  triggers_qc boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
```
`table_column_option` (bảng mới) là bản rút gọn của `enrollment_options` cho dropdown custom.

### Mẫu API route + auth (mọi route mới bám theo mẫu này)
Route CRUD mẫu: `src/app/api/enrollment/option-sets/route.ts`. Điểm cần sao chép:
```ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";

export const dynamic = "force-dynamic";

export async function GET() {
  const actorResult = await loadEnrollmentActor();       // xác thực
  if (!actorResult.ok)
    return NextResponse.json({ error: actorResult.error }, { status: actorResult.status });
  // ... actorResult.actor.email / actorResult.actor.isManager
}
export async function POST(request: Request) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) return NextResponse.json({ error: actorResult.error }, { status: actorResult.status });
  if (!actorResult.actor.isManager)                       // cổng admin
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  // ... validate, getSupabaseAdmin().from(...).insert(...)
  await broadcastEnrollmentChanged();                     // đẩy realtime cho client khác
  return NextResponse.json({ ... });
}
```
- `loadEnrollmentActor()` (ở `src/lib/enrollment/access.ts`) đọc session, build ra `actor: { email, isManager, isWorker }`. `isManager === true` nghĩa là **admin** (map từ `isTaskViewAdmin` + quyền manage). Trả `{ ok:false, error, status }` nếu chưa đăng nhập (401) / không có quyền vào board (403).
- `getSupabaseAdmin()` (`src/lib/supabase`) trả Supabase client service-role (bỏ qua RLS) — CHỈ dùng server-side trong route.
- Route dùng `.select("col1,col2").eq(...).maybeSingle()/.single()`, trả `{ data, error }`; luôn check `error` trả 500.
- **Next.js fork caveat:** route động `[id]` nhận `{ params }` dạng `params: Promise<{ id: string }>` — phải `await params`. Xác nhận chữ ký chính xác ở `src/app/api/enrollment/option-sets/[id]/route.ts` trước khi viết route `[id]` mới.

### Quy ước schema.sql
Repo KHÔNG có thư mục migration — toàn bộ schema ở 1 file `supabase/schema.sql` (~2500 dòng), khai báo `create table if not exists ...`, lowercase snake_case, `id uuid primary key default gen_random_uuid()`, `timestamptz not null default now()`, FK `references x(id) on delete restrict|cascade|set null`. Áp schema bằng cách chạy lại file (kiểm tra `README.md`/`scripts/` để biết lệnh chính xác trong repo này). Vì `if not exists`, các lệnh phải idempotent; seed dùng `on conflict ... do nothing`.

### Quy ước test
Vitest. Logic thuần (không I/O) tách ra file `src/lib/**/**.ts` và test cạnh bên `*.test.ts`. Ví dụ style có sẵn: `src/lib/enrollment/column-visibility.test.ts`, `src/lib/tasks/sorting.test.ts`. Chạy 1 file: `npx vitest run <path>`. Logic chạm DB/Supabase KHÔNG unit-test (smoke test thủ công qua curl/dev server).

### Mô hình quyền (RBAC)
`src/lib/tasks/access.ts` định nghĩa `isTaskViewAdmin(user)` (true nếu role `admin`/super-admin/legacy-admin hoặc role task-admin) và `buildTaskActor(permissions, email, {isAdmin})` → `{ email, isManager, isWorker }`. Role `assistant` là 1 role RBAC riêng. Config Assistant (Task 10/14) chỉ **quản lý ai giữ role assistant**, KHÔNG định nghĩa quyền mới — phải tái dùng cơ chế gán role sẵn có (tìm ở `src/lib/rbac/`).

---

## File Structure

**Create:**
- `src/lib/table-config/types.ts` — `TableScope`, `ColumnType`, `TableColumn`, `TableColumnOption` + guards.
- `src/lib/table-config/columns.ts` — pure: `slugifyColumnKey`, `sortColumns`, `canEditColumnField`, `nextPosition`.
- `src/lib/table-config/values.ts` — pure: `coerceCustomValue`, `formatCustomValue`.
- `src/lib/table-config/queries.ts` — `fetchTableColumns(scope)`, `fetchTableColumnOptions(scope)`.
- `src/lib/table-config/access.ts` — `loadConfigAdmin()` (admin-only guard).
- `src/app/api/config/columns/route.ts` — GET list, POST create custom column.
- `src/app/api/config/columns/[id]/route.ts` — PATCH (label/position/hidden/type-custom-only), DELETE (archive).
- `src/app/api/config/columns/[id]/options/route.ts` — GET/POST options for a dropdown column.
- `src/app/api/config/columns/[id]/options/[optionId]/route.ts` — PATCH/DELETE option.
- `src/app/api/config/assistants/route.ts` — GET candidates + members, POST add, DELETE remove.
- `src/app/(authed)/config/page.tsx` — server component, admin-gate, loads data.
- `src/app/(authed)/config/_components/ConfigClient.tsx` — tab shell.
- `src/app/(authed)/config/_components/ConfigTableSection.tsx`
- `src/app/(authed)/config/_components/ConfigValueSection.tsx`
- `src/app/(authed)/config/_components/ConfigAssistantSection.tsx`
- Tests: `src/lib/table-config/columns.test.ts`, `values.test.ts`.

**Modify:**
- `supabase/schema.sql` — new tables + `custom_values` columns + seed inserts.
- `src/lib/enrollment/queries.ts` — select `custom_values`; carry into record type.
- `src/lib/enrollment/types.ts` — add `custom_values` to `EnrollmentRecord`.
- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` — render custom columns from `table_column` + values from `custom_values`.
- `src/lib/tasks/types.ts` + `src/lib/tasks/queries.ts` — same for `tasks`.

---

## Task 1: Schema — column model tables + custom_values

**Context:** Đây là nền DB. Hiện KHÔNG có bảng nào định nghĩa cột — cột đang hardcode trong code (xem Background). Task này tạo `table_column` (danh sách cột mỗi bảng, trộn system + custom) và `table_column_option` (lựa chọn dropdown custom), đồng thời thêm `custom_values jsonb` vào `tasks` và `enrollment_records` để giá trị ô custom nằm chung row (lý do chọn JSONB thay vì EAV: xem Background). Chưa có gì đọc mấy cột này — các task sau mới dùng. Chỉ sửa `supabase/schema.sql`.

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Add the two config tables**

Thêm vào `supabase/schema.sql` (sau block `enrollment_options`):

```sql
create table if not exists table_column (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('cs','aca','medicare')),
  key text not null,
  label text not null,
  type text not null
    check (type in ('text','number','dropdown','date','checkbox','link','person')),
  is_system boolean not null default false,
  position integer not null default 0,
  hidden_default boolean not null default false,
  required boolean not null default false,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (scope, key)
);

create table if not exists table_column_option (
  id uuid primary key default gen_random_uuid(),
  column_id uuid not null references table_column(id) on delete cascade,
  label text not null,
  color text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists table_column_option_column_idx
  on table_column_option(column_id);
```

- [ ] **Step 2: Add custom_values to record tables**

Trong block `create table ... enrollment_records`, thêm trước `archived_at`:

```sql
  custom_values jsonb not null default '{}'::jsonb,
```

Trong block `create table ... tasks`, thêm trước dòng `archived_at`:

```sql
  custom_values jsonb not null default '{}'::jsonb,
```

- [ ] **Step 3: Apply schema and verify**

Run: `psql "$DATABASE_URL" -f supabase/schema.sql` (hoặc quy trình apply schema của repo — kiểm tra `README.md`/`scripts/`).
Expected: không lỗi; `\d table_column` liệt kê đúng cột.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(config): add table_column model + custom_values jsonb"
```

---

## Task 2: Types + guards for the column model

**Context:** Bản TypeScript mirror của các row DB ở Task 1, cộng union string dùng khắp nơi cho `scope`/`type`. Chưa có folder `src/lib/table-config/` — tạo mới. Guard `toTableScope` để route sanitize query param `?scope=` (copy y hệt pattern `toEnrollmentProgram` đã có trong `src/lib/enrollment/types.ts`). Không đụng DB, không test riêng (chỉ typecheck).

**Files:**
- Create: `src/lib/table-config/types.ts`

**Interfaces:**
- Produces: `TableScope`, `ColumnType`, `TableColumn`, `TableColumnOption`, `isTableScope`, `toTableScope`, `isColumnType`.

- [ ] **Step 1: Write the types**

```ts
export const TABLE_SCOPES = ["cs", "aca", "medicare"] as const;
export type TableScope = (typeof TABLE_SCOPES)[number];

export const COLUMN_TYPES = [
  "text", "number", "dropdown", "date", "checkbox", "link", "person",
] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export function isTableScope(v: unknown): v is TableScope {
  return typeof v === "string" && (TABLE_SCOPES as readonly string[]).includes(v);
}
export function toTableScope(v: unknown): TableScope {
  return isTableScope(v) ? v : "cs";
}
export function isColumnType(v: unknown): v is ColumnType {
  return typeof v === "string" && (COLUMN_TYPES as readonly string[]).includes(v);
}

export type TableColumn = {
  id: string;
  scope: TableScope;
  key: string;
  label: string;
  type: ColumnType;
  is_system: boolean;
  position: number;
  hidden_default: boolean;
  required: boolean;
  archived_at: string | null;
};

export type TableColumnOption = {
  id: string;
  column_id: string;
  label: string;
  color: string | null;
  position: number;
  archived_at: string | null;
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/table-config/types.ts
git commit -m "feat(config): table-config types"
```

---

## Task 3: Pure column helpers (slug, sort, edit-permission)

**Context:** Logic thuần dùng bởi cả API và UI, nên tách ra test kỹ. `slugifyColumnKey` sinh `key` ổn định từ label admin gõ (thường tiếng Việt, vd "Ngày gọi" → `ngay-goi`) — key phải unique trong scope vì DB có `unique(scope,key)`. `canEditColumnField` hiện thực hoá luật đã chốt "**cột system chỉ đổi label/position/hidden**, cột custom toàn quyền" — được route PATCH (Task 8) và UI (Task 12) gọi để chặn. `nextPosition`/`sortColumns` cho thứ tự cột. Đây là task TDD đầu tiên: viết test trước.

**Files:**
- Create: `src/lib/table-config/columns.ts`
- Test: `src/lib/table-config/columns.test.ts`

**Interfaces:**
- Consumes: `TableColumn` from Task 2.
- Produces:
  - `slugifyColumnKey(label: string, existing: ReadonlySet<string>): string`
  - `sortColumns(cols: TableColumn[]): TableColumn[]`
  - `canEditColumnField(col: Pick<TableColumn,"is_system">, field: "label"|"position"|"hidden_default"|"type"|"key"): boolean`
  - `nextPosition(cols: {position:number}[]): number`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { slugifyColumnKey, sortColumns, canEditColumnField, nextPosition } from "./columns";
import type { TableColumn } from "./types";

const col = (over: Partial<TableColumn>): TableColumn => ({
  id: "1", scope: "aca", key: "k", label: "L", type: "text",
  is_system: false, position: 0, hidden_default: false, required: false,
  archived_at: null, ...over,
});

describe("slugifyColumnKey", () => {
  it("kebab-cases and strips accents", () => {
    expect(slugifyColumnKey("Ngày Gọi", new Set())).toBe("ngay-goi");
  });
  it("dedupes against existing keys", () => {
    expect(slugifyColumnKey("Stage", new Set(["stage"]))).toBe("stage-2");
    expect(slugifyColumnKey("Stage", new Set(["stage", "stage-2"]))).toBe("stage-3");
  });
  it("falls back when empty", () => {
    expect(slugifyColumnKey("!!!", new Set())).toMatch(/^col-/);
  });
});

describe("sortColumns", () => {
  it("orders by position then key", () => {
    const out = sortColumns([col({ key: "b", position: 20 }), col({ key: "a", position: 10 }), col({ key: "c", position: 10 })]);
    expect(out.map((c) => c.key)).toEqual(["a", "c", "b"]);
  });
});

describe("canEditColumnField", () => {
  it("system columns: only label/position/hidden_default", () => {
    expect(canEditColumnField({ is_system: true }, "label")).toBe(true);
    expect(canEditColumnField({ is_system: true }, "position")).toBe(true);
    expect(canEditColumnField({ is_system: true }, "hidden_default")).toBe(true);
    expect(canEditColumnField({ is_system: true }, "type")).toBe(false);
    expect(canEditColumnField({ is_system: true }, "key")).toBe(false);
  });
  it("custom columns: everything editable", () => {
    expect(canEditColumnField({ is_system: false }, "type")).toBe(true);
    expect(canEditColumnField({ is_system: false }, "key")).toBe(true);
  });
});

describe("nextPosition", () => {
  it("returns max+10, or 0 for empty", () => {
    expect(nextPosition([])).toBe(0);
    expect(nextPosition([{ position: 0 }, { position: 30 }])).toBe(40);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/table-config/columns.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { TableColumn } from "./types";

const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

export function slugifyColumnKey(label: string, existing: ReadonlySet<string>): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `col-${Date.now().toString(36)}`;
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function sortColumns(cols: TableColumn[]): TableColumn[] {
  return [...cols].sort(
    (a, b) => a.position - b.position || collator.compare(a.key, b.key)
  );
}

const SYSTEM_EDITABLE = new Set(["label", "position", "hidden_default"]);
export function canEditColumnField(
  col: Pick<TableColumn, "is_system">,
  field: "label" | "position" | "hidden_default" | "type" | "key"
): boolean {
  return col.is_system ? SYSTEM_EDITABLE.has(field) : true;
}

export function nextPosition(cols: { position: number }[]): number {
  if (cols.length === 0) return 0;
  return Math.max(...cols.map((c) => c.position)) + 10;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/table-config/columns.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-config/columns.ts src/lib/table-config/columns.test.ts
git commit -m "feat(config): pure column helpers with tests"
```

---

## Task 4: Value coercion + formatting per type

**Context:** Giá trị custom vào hệ thống dưới dạng chuỗi chưa kiểu (từ inline edit ở Task 17 hoặc từ file import ở Phase 3). Task này là NƠI DUY NHẤT chuẩn hoá + validate giá trị theo 7 kiểu (text/number/dropdown/date/checkbox/link/person) trước khi ghi vào `custom_values` jsonb, và format ngược ra chuỗi người-đọc-được để render/export. Tập trung 1 chỗ để inline edit, import, export dùng chung một luật. Logic thuần → TDD.

**Files:**
- Create: `src/lib/table-config/values.ts`
- Test: `src/lib/table-config/values.test.ts`

**Interfaces:**
- Consumes: `ColumnType`, `TableColumnOption`.
- Produces:
  - `coerceCustomValue(type: ColumnType, raw: unknown, ctx?: { optionIds?: ReadonlySet<string>; emails?: ReadonlySet<string> }): { ok: true; value: unknown } | { ok: false; error: string }`
  - `formatCustomValue(type: ColumnType, value: unknown, ctx?: { optionLabels?: Map<string,string>; names?: Map<string,string> }): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { coerceCustomValue, formatCustomValue } from "./values";

describe("coerceCustomValue", () => {
  it("number: parses numeric strings, rejects junk", () => {
    expect(coerceCustomValue("number", "42")).toEqual({ ok: true, value: 42 });
    expect(coerceCustomValue("number", "abc").ok).toBe(false);
  });
  it("checkbox: truthy/falsey words", () => {
    expect(coerceCustomValue("checkbox", "yes")).toEqual({ ok: true, value: true });
    expect(coerceCustomValue("checkbox", "0")).toEqual({ ok: true, value: false });
  });
  it("date: ISO passthrough, rejects bad", () => {
    expect(coerceCustomValue("date", "2026-07-31")).toEqual({ ok: true, value: "2026-07-31" });
    expect(coerceCustomValue("date", "31/13/2026").ok).toBe(false);
  });
  it("link: requires http(s)", () => {
    expect(coerceCustomValue("link", "https://x.io").ok).toBe(true);
    expect(coerceCustomValue("link", "ftp://x").ok).toBe(false);
  });
  it("dropdown: value must be a known option id", () => {
    const ctx = { optionIds: new Set(["opt1"]) };
    expect(coerceCustomValue("dropdown", "opt1", ctx).ok).toBe(true);
    expect(coerceCustomValue("dropdown", "nope", ctx).ok).toBe(false);
  });
  it("person: value must be a known email", () => {
    const ctx = { emails: new Set(["a@x.io"]) };
    expect(coerceCustomValue("person", "a@x.io", ctx).ok).toBe(true);
    expect(coerceCustomValue("person", "b@x.io", ctx).ok).toBe(false);
  });
  it("empty string clears the value (ok:true, value:null)", () => {
    expect(coerceCustomValue("text", "")).toEqual({ ok: true, value: null });
  });
});

describe("formatCustomValue", () => {
  it("dropdown renders option label", () => {
    expect(formatCustomValue("dropdown", "opt1", { optionLabels: new Map([["opt1", "New"]]) })).toBe("New");
  });
  it("checkbox renders Yes/No", () => {
    expect(formatCustomValue("checkbox", true)).toBe("Yes");
    expect(formatCustomValue("checkbox", false)).toBe("No");
  });
  it("null renders empty string", () => {
    expect(formatCustomValue("text", null)).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/table-config/values.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { ColumnType } from "./types";

type CoerceCtx = { optionIds?: ReadonlySet<string>; emails?: ReadonlySet<string> };
type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string };

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "x", "có", "co"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "", "không", "khong"]);

export function coerceCustomValue(type: ColumnType, raw: unknown, ctx: CoerceCtx = {}): CoerceResult {
  const s = typeof raw === "string" ? raw.trim() : raw;
  if (s === "" || s === null || s === undefined) return { ok: true, value: null };

  switch (type) {
    case "text":
    case "link": {
      const str = String(s);
      if (type === "link" && !/^https?:\/\/\S+$/i.test(str)) {
        return { ok: false, error: "Link phải bắt đầu bằng http(s)://" };
      }
      return { ok: true, value: str };
    }
    case "number": {
      const n = typeof s === "number" ? s : Number(String(s).replace(/,/g, ""));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: "Không phải số" };
    }
    case "checkbox": {
      const w = String(s).toLowerCase();
      if (TRUE_WORDS.has(w)) return { ok: true, value: true };
      if (FALSE_WORDS.has(w)) return { ok: true, value: false };
      return { ok: false, error: "Giá trị Có/Không không hợp lệ" };
    }
    case "date": {
      const str = String(s);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(str) || Number.isNaN(Date.parse(str))) {
        return { ok: false, error: "Ngày phải dạng YYYY-MM-DD" };
      }
      return { ok: true, value: str };
    }
    case "dropdown": {
      const id = String(s);
      if (ctx.optionIds && !ctx.optionIds.has(id)) {
        return { ok: false, error: "Lựa chọn không tồn tại" };
      }
      return { ok: true, value: id };
    }
    case "person": {
      const email = String(s).toLowerCase();
      if (ctx.emails && !ctx.emails.has(email)) {
        return { ok: false, error: "Nhân viên không tồn tại" };
      }
      return { ok: true, value: email };
    }
  }
}

export function formatCustomValue(
  type: ColumnType,
  value: unknown,
  ctx: { optionLabels?: Map<string, string>; names?: Map<string, string> } = {}
): string {
  if (value === null || value === undefined || value === "") return "";
  switch (type) {
    case "checkbox": return value ? "Yes" : "No";
    case "dropdown": return ctx.optionLabels?.get(String(value)) ?? String(value);
    case "person": return ctx.names?.get(String(value)) ?? String(value);
    default: return String(value);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/table-config/values.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-config/values.ts src/lib/table-config/values.test.ts
git commit -m "feat(config): typed value coercion + formatting"
```

---

## Task 5: Seed system columns

**Context:** Sau khi Task 15/16 chuyển render sang "cột lấy từ DB", nếu DB trống thì bảng sẽ mất sạch cột. Task này đổ các cột ĐANG hardcode vào `table_column` dưới dạng `is_system=true` để bảng hiển thị y như cũ. **Key phải trùng đúng** key hardcode hiện tại (`client`,`stage`,`caller`,`responsible`,`payment`,`carrier`,`aca`,`consent`,`platform`,`pcp2025`,`pcp2026`,`due`,`fub` cho ACA — xem `ACA_ENROLLMENT_COLUMNS` trong Background; CS xem `TASK_LIST_COLUMNS`) vì renderer cũ switch theo key. Idempotent bằng `on conflict (scope,key) do nothing`.

**Files:**
- Modify: `supabase/schema.sql` (seed insert block at end)

**Interfaces:**
- Produces: rows in `table_column` with `is_system=true` for each scope, keys matching existing hardcoded column keys.

- [ ] **Step 1: Add idempotent seed inserts**

Ở cuối `supabase/schema.sql`, thêm seed cho từng scope. Keys phải khớp `SortKey`/`TaskListColumnKey` hiện có để render map được. Ví dụ ACA (dựa `ACA_ENROLLMENT_COLUMNS`):

```sql
insert into table_column (scope, key, label, type, is_system, position, hidden_default)
values
  ('aca','client','Client Name','text',true,10,false),
  ('aca','stage','Stage','dropdown',true,20,false),
  ('aca','caller','Caller','person',true,30,false),
  ('aca','responsible','Responsible Enroll','person',true,40,false),
  ('aca','payment','Payment status','dropdown',true,50,false),
  ('aca','carrier','Carrier','dropdown',true,60,false),
  ('aca','aca','AC','dropdown',true,70,false),
  ('aca','consent','Consent','dropdown',true,80,false),
  ('aca','platform','Platform','dropdown',true,90,false),
  ('aca','pcp2025','PCP 2025','text',true,100,false),
  ('aca','pcp2026','PCP 2026','text',true,110,false),
  ('aca','due','Due Date','date',true,120,false),
  ('aca','fub','FUB Link','link',true,130,false)
on conflict (scope, key) do nothing;
```

Lặp tương tự cho `medicare` (bỏ caller/payment/aca/consent/platform/pcp2026, đổi label `responsible`→Assignee, `pcp2025`→PCP) và `cs` (client→`summary`/Task, `stage`→Stage, `assignee`, `category`, `priority`, `agent`, `reporter`, `created`, `activity` — khớp `TASK_LIST_COLUMNS`).

- [ ] **Step 2: Apply and verify counts**

Run: `psql "$DATABASE_URL" -f supabase/schema.sql`
Then: `psql "$DATABASE_URL" -c "select scope, count(*) from table_column group by scope;"`
Expected: 3 dòng, count > 0 mỗi scope; chạy lại lần 2 không tăng (idempotent).

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(config): seed system columns for cs/aca/medicare"
```

---

## Task 6: Query layer + admin access guard

**Context:** Loader server-side + cổng admin dùng lại bởi mọi route config. `fetchTableColumns/Options` mô phỏng `fetchEnrollmentOptionData` (xem Background). `loadConfigAdmin` bọc `loadEnrollmentActor` (đã xác thực + kiểm quyền vào board) rồi thêm điều kiện `actor.isManager` (= admin) — nếu không phải admin trả 403. Tách guard ra 1 chỗ để 5 route sau khỏi lặp.

**Files:**
- Create: `src/lib/table-config/queries.ts`, `src/lib/table-config/access.ts`

**Interfaces:**
- Consumes: `getSupabaseAdmin`, `TableScope`, `TableColumn`, `TableColumnOption`.
- Produces:
  - `fetchTableColumns(scope: TableScope): Promise<TableColumn[]>` (archived_at is null, sorted).
  - `fetchTableColumnOptions(scope: TableScope): Promise<TableColumnOption[]>`.
  - `loadConfigAdmin(): Promise<{ ok: true; actor: EnrollmentActor } | { ok: false; error; status }>`.

- [ ] **Step 1: Implement access guard (mirror loadEnrollmentActor + admin gate)**

```ts
// src/lib/table-config/access.ts
import { loadEnrollmentActor } from "@/lib/enrollment/access";

export async function loadConfigAdmin() {
  const res = await loadEnrollmentActor();
  if (!res.ok) return res;
  if (!res.actor.isManager) {
    return { ok: false as const, error: "Forbidden" as const, status: 403 as const };
  }
  return res;
}
```

- [ ] **Step 2: Implement queries (mirror fetchEnrollmentOptionData)**

```ts
// src/lib/table-config/queries.ts
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TableScope, TableColumn, TableColumnOption } from "./types";
import { sortColumns } from "./columns";

export async function fetchTableColumns(scope: TableScope): Promise<TableColumn[]> {
  const supabase = getSupabaseAdmin();
  const res = await supabase
    .from("table_column")
    .select("id,scope,key,label,type,is_system,position,hidden_default,required,archived_at")
    .eq("scope", scope)
    .is("archived_at", null);
  if (res.error) throw new Error(res.error.message);
  return sortColumns((res.data ?? []) as TableColumn[]);
}

export async function fetchTableColumnOptions(scope: TableScope): Promise<TableColumnOption[]> {
  const supabase = getSupabaseAdmin();
  const cols = await supabase.from("table_column").select("id").eq("scope", scope);
  if (cols.error) throw new Error(cols.error.message);
  const ids = (cols.data ?? []).map((c: { id: string }) => c.id);
  if (ids.length === 0) return [];
  const res = await supabase
    .from("table_column_option")
    .select("id,column_id,label,color,position,archived_at")
    .in("column_id", ids)
    .is("archived_at", null)
    .order("position", { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as TableColumnOption[];
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/table-config/queries.ts src/lib/table-config/access.ts
git commit -m "feat(config): query layer + admin guard"
```

---

## Task 7: Columns API route (list + create custom)

**Context:** Endpoint config đầu tiên. Copy khung từ `option-sets/route.ts` (xem Background): GET trả danh sách cột theo scope; POST tạo cột custom = insert row `is_system=false` với `key` sinh từ label (`slugifyColumnKey`) + `position = nextPosition`. Admin-only qua `loadConfigAdmin`. Sau mutation gọi `broadcastEnrollmentChanged()` để client khác reload.

**Files:**
- Create: `src/app/api/config/columns/route.ts`
- Test: `src/lib/table-config/columns.test.ts` (extend — validation helper is already unit-tested; route smoke-tested manually)

**Interfaces:**
- Consumes: `loadConfigAdmin`, `fetchTableColumns`, `slugifyColumnKey`, `nextPosition`, `isColumnType`, `toTableScope`.
- Produces: `GET ?scope=` → `{ columns: TableColumn[] }`; `POST { scope, label, type }` → `{ column }`.

- [ ] **Step 1: Implement (mirror option-sets route.ts)**

```ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { fetchTableColumns } from "@/lib/table-config/queries";
import { slugifyColumnKey, nextPosition } from "@/lib/table-config/columns";
import { isColumnType, toTableScope } from "@/lib/table-config/types";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await loadConfigAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const scope = toTableScope(new URL(request.url).searchParams.get("scope"));
  return NextResponse.json({ columns: await fetchTableColumns(scope) });
}

export async function POST(request: Request) {
  const gate = await loadConfigAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const body = await request.json().catch(() => null);
  const scope = toTableScope(body?.scope);
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const type = body?.type;
  if (!label) return NextResponse.json({ error: "Label bắt buộc." }, { status: 400 });
  if (!isColumnType(type)) return NextResponse.json({ error: "Kiểu cột không hợp lệ." }, { status: 400 });

  const existing = await fetchTableColumns(scope);
  const key = slugifyColumnKey(label, new Set(existing.map((c) => c.key)));
  const position = nextPosition(existing);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("table_column")
    .insert({ scope, key, label, type, is_system: false, position,
              created_by_email: gate.actor.email })
    .select("id,scope,key,label,type,is_system,position,hidden_default,required,archived_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await broadcastEnrollmentChanged();
  return NextResponse.json({ column: data });
}
```

- [ ] **Step 2: Manual smoke test**

Run dev server, POST as admin:
`curl -X POST localhost:3000/api/config/columns -d '{"scope":"aca","label":"Ngày gọi","type":"date"}'`
Expected: 200 `{ column: { key: "ngay-goi", type: "date", is_system: false } }`. As non-admin → 403.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/config/columns/route.ts
git commit -m "feat(config): columns list + create API"
```

---

## Task 8: Column PATCH/DELETE (enforce system-column rules)

**Context:** Sửa/đổi thứ tự/ẩn 1 cột (PATCH) và xoá (DELETE = archive mềm, giữ `custom_values` — quyết định b). Điểm mấu chốt: với cột `is_system=true` chỉ cho đổi `label/position/hidden_default`, chặn đổi `type`/`key` và chặn xoá (dùng `canEditColumnField` từ Task 3). Đây là route động `[id]` → nhớ caveat `params: Promise<{id}>` phải `await` (xem Background). Cùng pattern broadcast realtime như Task 7.

**Files:**
- Create: `src/app/api/config/columns/[id]/route.ts`

**Interfaces:**
- Consumes: `loadConfigAdmin`, `canEditColumnField`.
- Produces: `PATCH { label?, position?, hidden_default?, type? }`; `DELETE` (archive).

- [ ] **Step 1: Implement — reject disallowed field edits on system columns**

```ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadConfigAdmin } from "@/lib/table-config/access";
import { canEditColumnField } from "@/lib/table-config/columns";
import { broadcastEnrollmentChanged } from "@/lib/enrollment/realtime";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await loadConfigAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const supabase = getSupabaseAdmin();
  const { data: col, error: e0 } = await supabase
    .from("table_column").select("is_system").eq("id", id).maybeSingle();
  if (e0) return NextResponse.json({ error: e0.message }, { status: 500 });
  if (!col) return NextResponse.json({ error: "Không tìm thấy cột." }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of ["label", "position", "hidden_default", "type"] as const) {
    if (body[field] === undefined) continue;
    if (!canEditColumnField(col as { is_system: boolean }, field)) {
      return NextResponse.json(
        { error: `Cột hệ thống không được đổi ${field}.` }, { status: 403 });
    }
    patch[field] = body[field];
  }
  const { error } = await supabase.from("table_column").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await broadcastEnrollmentChanged();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await loadConfigAdmin();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const { id } = await params;
  const supabase = getSupabaseAdmin();
  const { data: col } = await supabase.from("table_column").select("is_system").eq("id", id).maybeSingle();
  if ((col as { is_system?: boolean } | null)?.is_system) {
    return NextResponse.json({ error: "Không được xoá cột hệ thống." }, { status: 403 });
  }
  const { error } = await supabase
    .from("table_column").update({ archived_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await broadcastEnrollmentChanged();
  return NextResponse.json({ ok: true });
}
```

> Ghi chú Next.js fork: chữ ký `params: Promise<{...}>` khớp bản trong repo (xem route `enrollment/option-sets/[id]/route.ts` để xác nhận chính xác trước khi code).

- [ ] **Step 2: Manual smoke test**

- PATCH label cột custom → 200. PATCH `type` cột system → 403. DELETE cột system → 403. DELETE cột custom → 200, `archived_at` set.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/config/columns/[id]/route.ts"
git commit -m "feat(config): column patch/delete with system-column guards"
```

---

## Task 9: Dropdown option APIs (custom columns)

**Context:** Cột kiểu `dropdown` do admin tạo cần danh sách lựa chọn (label + màu). Task này CRUD `table_column_option` — bản rút gọn của `enrollment_options` CRUD (xem Background), nhưng khoá theo `column_id` thay vì `set_id`. Phải chặn thêm option cho cột không phải `dropdown` (trả 400). Config Value UI (Task 13) gọi các endpoint này.

**Files:**
- Create: `src/app/api/config/columns/[id]/options/route.ts`, `.../[optionId]/route.ts`

**Interfaces:**
- Produces: `GET` list options for column; `POST { label, color? }` add; `PATCH { label?, color?, position? }`; `DELETE` archive. Mirror `enrollment_options` CRUD.

- [ ] **Step 1: Implement GET/POST** (mirror option-sets POST: compute next position, insert with `column_id`, validate the column exists and `type='dropdown'`). Reject if column not dropdown → 400.

- [ ] **Step 2: Implement PATCH/DELETE** on `[optionId]` (archive on delete).

- [ ] **Step 3: Manual smoke test** — add 2 options to a dropdown column; GET returns them ordered; DELETE archives.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/config/columns/[id]/options"
git commit -m "feat(config): dropdown option CRUD for custom columns"
```

---

## Task 10: Config Assistant API (role membership)

**Context:** "Config Assistant" = **quản lý ai giữ role assistant** (đã chốt: quản lý danh sách người, KHÔNG phải cấu hình quyền). Role `assistant` đã tồn tại trong RBAC (xem Background). Task này chỉ list/add/remove membership bằng CÁCH tái dùng cơ chế gán role sẵn có ở `src/lib/rbac/` — Bước 1 bắt buộc là đi tìm cơ chế đó trước, TUYỆT ĐỐI không tạo bảng roles mới. Admin-only.

**Files:**
- Create: `src/app/api/config/assistants/route.ts`

**Interfaces:**
- Consumes: existing RBAC — inspect `@/lib/rbac/system-roles` and how roles are assigned (grep for where `assistant` role membership is stored/updated; reuse the same table/mutation).
- Produces: `GET` → `{ members: {email,name}[], candidates: {email,name}[] }`; `POST { email }` add assistant role; `DELETE ?email=` remove.

- [ ] **Step 1: Locate role-assignment mechanism**

Run: `grep -rniE "assistant" src/lib/rbac src/lib/tasks/access.ts` and follow to the accounts/roles table used by `buildTaskActor`. Reuse it — do NOT invent a new roles table.

- [ ] **Step 2: Implement GET/POST/DELETE** guarded by `loadConfigAdmin`, calling the existing role-assignment helper.

- [ ] **Step 3: Manual smoke test** — add an email as assistant, GET shows it in members, DELETE removes.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/config/assistants/route.ts
git commit -m "feat(config): assistant membership API"
```

---

## Task 11: /config page shell (admin-only) + tabs

**Context:** Trang admin mới `/config` — chưa tồn tại. Theo đúng pattern route `(authed)` + client component trong `_components/` mà `/enrollment` và `/tasks` đang dùng (server `page.tsx` load data + gate quyền, rồi render 1 client component). Shell này chỉ là khung 3 tab (Table/Value/Assistant); nội dung từng tab ở Task 12–14. Non-admin phải bị chặn (redirect/404).

**Files:**
- Create: `src/app/(authed)/config/page.tsx`, `_components/ConfigClient.tsx`

**Interfaces:**
- Consumes: `loadConfigAdmin`, `fetchTableColumns`, `fetchTableColumnOptions`.
- Produces: server page redirects non-admins; renders `ConfigClient` with 3 tabs (Table / Value / Assistant).

- [ ] **Step 1: Server page** — call `loadConfigAdmin()`; if `!ok` → `notFound()` or redirect. Pass initial scope columns/options to client.

- [ ] **Step 2: ConfigClient** — a tab shell (`useState<"table"|"value"|"assistant">`) rendering the three section components (Tasks 12–14). Follow the styling/idiom of existing `_components` (e.g. `TaskToolbar`, modals).

- [ ] **Step 3: Manual check** — `/config` loads for admin, 404/redirect for agent.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/config"
git commit -m "feat(config): admin config page shell with tabs"
```

---

## Task 12: Config Table section UI

**Context:** Màn hình "admin thiết kế bảng" — trái tim của Phase 1, nối hết API Task 7/8/9. Admin chọn bảng (CS/ACA/Medicare) rồi thấy danh sách cột kéo-thả đổi thứ tự, đổi tên, ẩn/hiện, thêm cột (chọn 1 trong 7 kiểu), xoá cột custom. Cột system hiện badge khoá + vô hiệu nút đổi-kiểu/xoá (phản ánh luật `canEditColumnField`). Nếu repo đã có util drag-drop thì tái dùng (Bước 1 grep tìm); không thì dùng HTML5 drag.

**Files:**
- Create: `src/app/(authed)/config/_components/ConfigTableSection.tsx`

- [ ] **Step 1: Build** — scope switcher (CS/ACA/Medicare); list columns (from `GET /api/config/columns?scope=`); drag-reorder writes `position` via PATCH; inline rename (`label`) via PATCH; hide toggle (`hidden_default`); "+ Thêm cột" dialog (label + type select) → POST; delete (archive) for custom columns only; system columns show a lock badge and disable type/delete controls. Reuse existing drag pattern if present (grep for `dnd`/drag in `_components`); otherwise HTML5 drag.

- [ ] **Step 2: Manual check** — add a `date` custom column to ACA; reorder; rename a system column; verify system column type/delete disabled.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/config/_components/ConfigTableSection.tsx"
git commit -m "feat(config): Config Table section UI"
```

---

## Task 13: Config Value section UI

**Context:** Quản lý lựa chọn cho các cột dropdown. Có 2 nguồn cần gộp trên cùng UI: cột dropdown **custom** (qua `table_column_option`, API Task 9) và các set dropdown **system của ACA** (qua `enrollment_option_sets`/`enrollment_options` sẵn có). Nếu repo đã có component sửa option-set trong enrollment `_components` (Bước 1 grep tìm), tái dùng và cho nó trỏ thêm tới `/api/config/columns/[id]/options`.

**Files:**
- Create: `src/app/(authed)/config/_components/ConfigValueSection.tsx`

- [ ] **Step 1: Build** — list dropdown columns for the scope (custom via `table_column_option`, plus system ACA sets via existing `enrollment_option_sets`); per column, list/add/edit/delete options (label + color). Reuse the existing enrollment option editor component if one exists (grep `_components` for an option-set modal) and adapt it to also target `/api/config/columns/[id]/options`.

- [ ] **Step 2: Manual check** — add options to the custom `dropdown` column; edit color; delete.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/config/_components/ConfigValueSection.tsx"
git commit -m "feat(config): Config Value section UI"
```

---

## Task 14: Config Assistant section UI

**Context:** UI đơn giản nhất trong 3 tab: hiện danh sách assistant hiện tại (GET Task 10), thêm bằng person-picker trên danh sách candidate, xoá có xác nhận. Không có logic phức tạp — chỉ gọi API Task 10.

**Files:**
- Create: `src/app/(authed)/config/_components/ConfigAssistantSection.tsx`

- [ ] **Step 1: Build** — list current assistants (`GET /api/config/assistants`); add via a person picker over candidates; remove with confirm.

- [ ] **Step 2: Manual check** — add/remove an assistant; changes persist across reload.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/config/_components/ConfigAssistantSection.tsx"
git commit -m "feat(config): Config Assistant section UI"
```

---

## Task 15: Render custom columns + values in the enrollment table (read path)

**Context:** Đây là lúc "cột động" thật sự hiển thị. Hiện `EnrollmentClient.tsx` render từ mảng cứng `ACA_ENROLLMENT_COLUMNS`. Task này thay nguồn cột bằng danh sách từ `table_column` (scope aca/medicare). Ô của cột **system** giữ nguyên renderer cũ (switch theo `column.key` — Stage select, người, ngày...); ô của cột **custom** render qua `formatCustomValue(type, record.custom_values[key], ctx)`. Phải thêm `custom_values` vào type + `.select()` của query (nếu chưa). Sau task này bảng ACA hiện đúng thứ tự cấu hình + cột custom có giá trị; cột `hidden_default` bắt đầu ẩn.

**Files:**
- Modify: `src/lib/enrollment/types.ts`, `src/lib/enrollment/queries.ts`, `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

**Interfaces:**
- Consumes: `fetchTableColumns`, `fetchTableColumnOptions`, `formatCustomValue`, `custom_values` on records.

- [ ] **Step 1:** Add `custom_values: Record<string, unknown>` to `EnrollmentRecord`; add `custom_values` to the `.select(...)` in `queries.ts`.

- [ ] **Step 2:** In `EnrollmentClient`, replace the hardcoded `ACA_ENROLLMENT_COLUMNS` source with columns loaded from `table_column` for the scope (system columns keep their existing cell renderers keyed by `key`; custom columns render `formatCustomValue(type, record.custom_values[key], ctx)`). Keep system cell renderers switching on `column.key`; add a default branch for custom columns.

- [ ] **Step 3: Manual check** — the ACA table now shows the seeded system columns in configured order + any custom column with its values; hidden_default columns start hidden.

- [ ] **Step 4: Commit**

```bash
git add src/lib/enrollment/types.ts src/lib/enrollment/queries.ts "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "feat(config): render DB-defined columns + custom values in enrollment table"
```

---

## Task 16: Render custom columns + values in the CS task table (read path)

**Context:** Y như Task 15 nhưng cho bảng CS (view List ở `TaskListView.tsx`, cột hardcode ở `task-list-columns.ts`, dữ liệu `tasks`). Đổi nguồn cột sang `table_column` scope `cs`; renderer system giữ theo `key`, custom qua `formatCustomValue`. Chỉ đụng view List — Kanban không liên quan.

**Files:**
- Modify: `src/lib/tasks/types.ts`, `src/lib/tasks/queries.ts`, `src/app/(authed)/tasks/_components/TaskListView.tsx` (+ `task-list-columns.ts` consumers).

- [ ] **Step 1:** Add `custom_values` to `TaskRow` + task queries select.
- [ ] **Step 2:** Drive the CS list columns from `table_column` scope `cs` (system renderers keyed by `key`; custom via `formatCustomValue`).
- [ ] **Step 3: Manual check** — CS list shows configured columns + custom values.
- [ ] **Step 4: Commit**

```bash
git add src/lib/tasks/types.ts src/lib/tasks/queries.ts "src/app/(authed)/tasks/_components"
git commit -m "feat(config): render DB-defined columns in CS task list"
```

---

## Task 17: Write custom values (inline edit)

**Context:** Cho phép user sửa giá trị ô custom ngay trên bảng, giống cách bảng đang inline-edit Stage/Assignee qua hàm `patchRecord(id, patch)` (đã có trong `EnrollmentClient.tsx`) + route PATCH `src/app/api/enrollment/[id]/route.ts`. Điểm mới: khi patch chứa `custom_values`, route phải load def cột rồi `coerceCustomValue` theo kiểu (kèm ctx optionIds/emails) trước khi merge vào jsonb — sai kiểu thì trả lỗi. UI đổi ô custom thành control theo kiểu (input/number/date/select/checkbox/link/person). CS làm tương tự route PATCH của tasks.

**Files:**
- Modify: `EnrollmentClient.tsx` (`patchRecord`), add `PATCH` handling for `custom_values` in `src/app/api/enrollment/[id]/route.ts` (+ CS equivalent).

**Interfaces:**
- Consumes: `coerceCustomValue`, `fetchTableColumns`, `fetchTableColumnOptions`.

- [ ] **Step 1:** API — when body includes `custom_values: { key: rawValue }`, load the column def, `coerceCustomValue` per type (with optionIds/emails ctx), merge into the record's existing `custom_values` jsonb, reject with the coercion error on invalid.
- [ ] **Step 2:** UI — custom cells become editable per type (text input, number, date picker, dropdown select over options, checkbox, link input, person picker), calling `patchRecord(id, { custom_values: { [key]: value } })`.
- [ ] **Step 3: Manual check** — edit a custom `date`/`dropdown` cell; reload shows persisted value; invalid value rejected.
- [ ] **Step 4: Commit**

```bash
git add "src/app/api/enrollment/[id]/route.ts" "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "feat(config): inline edit of custom values with type coercion"
```

---

## Self-Review (checklist đã chạy)

**Spec coverage:** Config page (Task 11) ✓; Config Table incl. 7 types + add/edit/delete + system-column rules (Tasks 2,7,8,12) ✓; Config Value / dropdown options (Tasks 9,13) ✓; Config Assistant (Tasks 10,14) ✓; JSONB storage + coercion (Tasks 1,4,17) ✓; render on both enrollment + CS (Tasks 15,16) ✓; system columns editable only label/order/hidden, custom full (Task 3/8) ✓; delete = archive (Task 8) ✓.

**Placeholder scan:** Tasks 9,10,12,13,14 mô tả UI/CRUD theo pattern đã trỏ rõ (option-sets route + existing `_components`) thay vì lặp lại code — cố ý, vì code y hệt Task 7/8 và các component sẵn có; các pure-logic task (3,4) có code + test đầy đủ.

**Type consistency:** `TableColumn`/`TableColumnOption`/`ColumnType`/`TableScope` dùng nhất quán; `coerceCustomValue`/`formatCustomValue`/`slugifyColumnKey`/`canEditColumnField`/`nextPosition`/`sortColumns` khớp giữa các task.

**Câu hỏi mở còn lại** (chốt khi execute): person picker phạm vi (toàn agent?); audit log cho thao tác thiết kế cột.
