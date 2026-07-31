# Health Table Phase 2 — Per-User Layout & Excel Sort/Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi user tự sắp xếp cột (kéo thứ tự, giãn rộng, ẩn/hiện — không pin) lưu DB theo user & bảng; và mỗi header cột có menu Sort/Filter kiểu Excel AutoFilter, áp cho mọi cột kể cả custom.

**Architecture:** Bảng `user_table_layout` (jsonb layout per user+scope). Pure logic `resolveLayout` (merge default + user override) và Excel filter/sort (`distinctColumnValues`, `applyExcelFilters`, `compareByType`) tách ra test được, chạy client-side đúng như filter/sort hiện tại. Quick-filter phái sinh (overdue/attention/QC/unowned/due-range) giữ nguyên dạng toggle song song.

**Tech Stack:** Next.js (fork — đọc `node_modules/next/dist/docs/`), Supabase Postgres, TypeScript, vitest, Tailwind.

## Global Constraints

- **Phụ thuộc Phase 1:** cần bảng `table_column` + type `TableColumn`/`TableScope` (Phase 1). Không chạy trước Phase 1.
- **Next.js fork:** đọc `node_modules/next/dist/docs/` trước khi viết route/component.
- **Filter/sort client-side:** áp trên record đã load (giữ kiến trúc `filterRecords`/`sortRecords` hiện tại), KHÔNG chuyển sang server-side.
- **Không pin:** Phase này không thêm tính năng pin; Key/Client giữ sticky mặc định sản phẩm như cũ.
- **Scope enum:** `'cs'|'aca'|'medicare'`.
- **Test:** pure logic ở `src/lib/table-config/*.test.ts`, chạy `npx vitest run <file>`.

---

## Background & Existing Codebase Context

> Đọc mục này + mục "Background" của plan Phase 1 (`2026-07-31-health-table-phase1-config.md`) trước khi làm. Phase 2 xây TRÊN Phase 1.

### Phụ thuộc Phase 1 (bắt buộc có trước)
Phase 1 đã biến cột thành dữ liệu DB: bảng `table_column` (mỗi bảng CS/aca/medicare một danh sách cột, có `key/label/type/is_system/position/hidden_default`), type `TableColumn`/`TableScope`/`ColumnType` ở `src/lib/table-config/types.ts`, helper `sortColumns` ở `src/lib/table-config/columns.ts`, và `formatCustomValue(type, value, ctx)` ở `src/lib/table-config/values.ts`. Bảng enrollment/CS đã render cột từ `table_column` thay vì mảng hardcode. Phase 2 dùng lại toàn bộ những thứ này.

### Filter/Sort hiện tại chạy CLIENT-SIDE (điểm cốt lõi)
Trong `EnrollmentClient.tsx`, toàn bộ record được load về client rồi lọc/sắp bằng JS trong 1 `useMemo`:
```ts
const filteredRecords = useMemo(
  () => sortRecords(filterRecords(records, filters, optionsById), sort),
  [records, filters, optionsById, sort]
);
```
`filters` là object cứng (`type Filters = { query; stage[]; caller[]; responsible[]; carrier[]; payment[]; attention; overdue; qcNeeded; unowned; dueFrom; dueTo }`) render ra 1 thanh filter riêng phía trên bảng. `sort` là 1 cột + hướng. **Excel-style filter/sort của Phase 2 KHÔNG thay thế cái này ở tầng kiến trúc** — vẫn client-side, chỉ thêm 1 lớp lọc theo từng cột (menu ở header) rồi AND với các quick-filter phái sinh (attention/overdue/qcNeeded/unowned/due-range) vốn là trạng thái suy ra chứ không phải giá trị 1 cột, nên giữ nguyên dạng toggle.

### Column-visibility hiện tại (sẽ được thay bằng layout DB)
Hiện việc ẩn/hiện cột lưu ở **localStorage** (`src/lib/enrollment/column-visibility.ts`, key `enrollment.columns.<program>`). Phase 2 thay cơ chế này bằng `user_table_layout` (DB, per user+scope) gộp cả thứ tự + độ rộng + ẩn/hiện. Cột `key`/`client`/`qc` hiện `sticky:true` (ghim mép) — Phase 2 **không** đụng, giữ làm mặc định sản phẩm (đã chốt "không cần pin").

### "Excel AutoFilter" nghĩa là gì ở đây
Mỗi header cột bấm vào ra 1 popover gồm: **Sort A→Z / Z→A** cho cột đó; và **checklist các giá trị distinct** của cột (tick giá trị nào để giữ), có "Select all" + ô tìm trong menu. Nhiều cột lọc cùng lúc = AND. Vì dữ liệu đã ở client, distinct-values tính thẳng từ mảng record đang có.

### Value accessor: system vs custom
Giá trị 1 ô lấy khác nhau tuỳ cột: cột **system** đọc từ field thật của record (map theo `key`, vd `record.stage_id`), cột **custom** đọc từ `record.custom_values[key]`. Vì vậy các hàm filter/sort thuần nhận vào 1 `accessor(row, columnKey)` do UI cung cấp — logic thuần không cần biết record hình dạng gì (test độc lập được).

### Auth cho layout API
Khác các route config của Phase 1 (admin-only), layout là của **mọi user** nên route `/api/config/layout` chỉ cần `loadEnrollmentActor` (bất kỳ user vào được board), keyed theo `actor.email`. Xem mẫu auth ở Background của Phase 1.

### Next.js fork + test: giống Phase 1
Đọc `node_modules/next/dist/docs/` trước khi viết route/component. Logic thuần test bằng vitest ở `*.test.ts`.

---

## File Structure

**Create:**
- `src/lib/table-config/layout.ts` — `LayoutEntry`, `ResolvedColumn`, `resolveLayout`, `serializeLayout`, `applyLayoutChange`.
- `src/lib/table-config/layout.test.ts`
- `src/lib/table-config/excel-filter.ts` — `distinctColumnValues`, `applyExcelFilters`, `compareByType`, `sortByColumn`.
- `src/lib/table-config/excel-filter.test.ts`
- `src/app/api/config/layout/route.ts` — GET (my layout) / PUT (save) / DELETE (reset), per scope.
- `src/app/(authed)/*/_components/ColumnHeaderMenu.tsx` — reusable Excel-style header menu (sort + filter checklist).
- `src/app/(authed)/*/_components/ColumnLayoutControls.tsx` — reorder/resize/show-hide/reset (shared hook).

**Modify:**
- `supabase/schema.sql` — `user_table_layout` table.
- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` — consume `resolveLayout`, header menu, excel filters, persistence.
- `src/app/(authed)/tasks/_components/TaskListView.tsx` — same for CS.

---

## Task 1: Schema — user_table_layout

**Context:** Nơi lưu layout riêng của từng user cho từng bảng. Hiện ẩn/hiện cột lưu localStorage (xem Background) — không theo user qua nhiều máy. Bảng này gộp thứ tự + width + hidden vào 1 `jsonb layout`, unique theo `(user_email, scope)` để mỗi người mỗi bảng đúng 1 hàng. Chưa ai đọc — Task 4/5 mới dùng. Chỉ sửa `supabase/schema.sql`.

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Add table**

```sql
create table if not exists user_table_layout (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  scope text not null check (scope in ('cs','aca','medicare')),
  layout jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_email, scope)
);
```

- [ ] **Step 2: Apply + verify**

Run: `psql "$DATABASE_URL" -f supabase/schema.sql`
Then: `psql "$DATABASE_URL" -c "\d user_table_layout"`
Expected: unique(user_email, scope) present.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(layout): user_table_layout table"
```

---

## Task 2: resolveLayout — merge defaults with user overrides

**Context:** Logic thuần quan trọng nhất của #1. Nhận danh sách cột mặc định (từ `table_column`, Phase 1) + layout riêng của user (có thể null nếu chưa custom) và trả ra danh sách cột đã sắp đúng thứ tự user, kèm width/hidden đã giải quyết. Phải xử lý: user chưa có layout (dùng mặc định `position`+`hidden_default`); cột mới admin thêm mà layout cũ chưa có (append cuối); key rác trong layout không còn cột (bỏ qua). Tách thuần để test kỹ + tái dùng cho cả enrollment lẫn CS. TDD.

**Files:**
- Create: `src/lib/table-config/layout.ts`, `src/lib/table-config/layout.test.ts`

**Interfaces:**
- Consumes: `TableColumn` (Phase 1).
- Produces:
  - `type LayoutEntry = { column_key: string; position: number; width: number | null; hidden: boolean }`
  - `type ResolvedColumn = TableColumn & { width: number | null; hidden: boolean }`
  - `resolveLayout(columns: TableColumn[], layout: LayoutEntry[] | null): ResolvedColumn[]`
  - `serializeLayout(cols: ResolvedColumn[]): LayoutEntry[]`
  - `applyLayoutChange(cols: ResolvedColumn[], change: { key: string; width?: number; hidden?: boolean } | { reorder: string[] }): ResolvedColumn[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { resolveLayout, serializeLayout, applyLayoutChange } from "./layout";
import type { TableColumn } from "./types";

const col = (key: string, position: number, over: Partial<TableColumn> = {}): TableColumn => ({
  id: key, scope: "aca", key, label: key.toUpperCase(), type: "text",
  is_system: false, position, hidden_default: false, required: false,
  archived_at: null, ...over,
});

const cols = [col("a", 10), col("b", 20), col("c", 30, { hidden_default: true })];

describe("resolveLayout", () => {
  it("no layout → column defaults (order + hidden_default)", () => {
    const r = resolveLayout(cols, null);
    expect(r.map((c) => c.key)).toEqual(["a", "b", "c"]);
    expect(r.find((c) => c.key === "c")!.hidden).toBe(true);
    expect(r.find((c) => c.key === "a")!.width).toBeNull();
  });

  it("user layout reorders + overrides width/hidden", () => {
    const r = resolveLayout(cols, [
      { column_key: "b", position: 0, width: 250, hidden: false },
      { column_key: "a", position: 1, width: null, hidden: true },
    ]);
    // b first, a second, then c (not in layout) appended in default order
    expect(r.map((c) => c.key)).toEqual(["b", "a", "c"]);
    expect(r.find((c) => c.key === "b")!.width).toBe(250);
    expect(r.find((c) => c.key === "a")!.hidden).toBe(true);
    expect(r.find((c) => c.key === "c")!.hidden).toBe(true); // fell back to default
  });

  it("ignores stale layout keys not in columns", () => {
    const r = resolveLayout(cols, [{ column_key: "gone", position: 0, width: 100, hidden: false }]);
    expect(r.map((c) => c.key)).toEqual(["a", "b", "c"]);
  });
});

describe("serializeLayout round-trips", () => {
  it("resolve then serialize preserves order/width/hidden", () => {
    const r = resolveLayout(cols, [{ column_key: "b", position: 0, width: 200, hidden: true }]);
    const s = serializeLayout(r);
    expect(s[0]).toMatchObject({ column_key: "b", position: 0, width: 200, hidden: true });
  });
});

describe("applyLayoutChange", () => {
  it("reorder sets new order by key list", () => {
    const r = applyLayoutChange(resolveLayout(cols, null), { reorder: ["c", "a", "b"] });
    expect(r.map((c) => c.key)).toEqual(["c", "a", "b"]);
  });
  it("width/hidden change targets one column", () => {
    const r = applyLayoutChange(resolveLayout(cols, null), { key: "a", width: 300 });
    expect(r.find((c) => c.key === "a")!.width).toBe(300);
    const h = applyLayoutChange(r, { key: "a", hidden: true });
    expect(h.find((c) => c.key === "a")!.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/table-config/layout.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { TableColumn } from "./types";
import { sortColumns } from "./columns";

export type LayoutEntry = { column_key: string; position: number; width: number | null; hidden: boolean };
export type ResolvedColumn = TableColumn & { width: number | null; hidden: boolean };

export function resolveLayout(columns: TableColumn[], layout: LayoutEntry[] | null): ResolvedColumn[] {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const entries = (layout ?? []).filter((e) => byKey.has(e.column_key));
  const ordered: ResolvedColumn[] = [];
  const used = new Set<string>();

  for (const e of [...entries].sort((a, b) => a.position - b.position)) {
    const c = byKey.get(e.column_key)!;
    ordered.push({ ...c, width: e.width, hidden: e.hidden });
    used.add(c.key);
  }
  // Columns without a layout entry: append in default order, using column defaults.
  for (const c of sortColumns(columns)) {
    if (used.has(c.key)) continue;
    ordered.push({ ...c, width: null, hidden: c.hidden_default });
  }
  return ordered;
}

export function serializeLayout(cols: ResolvedColumn[]): LayoutEntry[] {
  return cols.map((c, i) => ({ column_key: c.key, position: i, width: c.width, hidden: c.hidden }));
}

export function applyLayoutChange(
  cols: ResolvedColumn[],
  change: { key: string; width?: number; hidden?: boolean } | { reorder: string[] }
): ResolvedColumn[] {
  if ("reorder" in change) {
    const byKey = new Map(cols.map((c) => [c.key, c]));
    const next = change.reorder.map((k) => byKey.get(k)).filter(Boolean) as ResolvedColumn[];
    for (const c of cols) if (!change.reorder.includes(c.key)) next.push(c);
    return next;
  }
  return cols.map((c) =>
    c.key === change.key
      ? { ...c, width: change.width ?? c.width, hidden: change.hidden ?? c.hidden }
      : c
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/table-config/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-config/layout.ts src/lib/table-config/layout.test.ts
git commit -m "feat(layout): resolveLayout + change helpers with tests"
```

---

## Task 3: Excel filter/sort pure logic

**Context:** Lõi của tính năng d (AutoFilter). 4 hàm thuần: `distinctColumnValues` (gom giá trị distinct của 1 cột để dựng checklist, có bucket "trống"); `applyExcelFilters` (giữ record có giá trị nằm trong tập đã tick, AND nhiều cột); `compareByType` (so sánh đúng kiểu: số theo số, ngày theo ISO, text collator, null xuống cuối); `sortByColumn`. Tất cả nhận `accessor(row, key)` nên không phụ thuộc hình dạng record (xem Background "value accessor"). Chạy client-side đúng kiến trúc hiện tại. TDD.

**Files:**
- Create: `src/lib/table-config/excel-filter.ts`, `src/lib/table-config/excel-filter.test.ts`

**Interfaces:**
- Consumes: `ColumnType`.
- Produces:
  - `type ValueAccessor<T> = (row: T, columnKey: string) => unknown` (caller maps system vs custom).
  - `distinctColumnValues<T>(rows: T[], columnKey: string, accessor: ValueAccessor<T>, format: (v: unknown) => string): { value: string; label: string }[]`
  - `applyExcelFilters<T>(rows: T[], filters: Map<string, Set<string>>, accessor: ValueAccessor<T>): T[]`
  - `compareByType(type: ColumnType, a: unknown, b: unknown): number`
  - `sortByColumn<T>(rows: T[], columnKey: string, type: ColumnType, dir: "asc"|"desc", accessor: ValueAccessor<T>): T[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { distinctColumnValues, applyExcelFilters, compareByType, sortByColumn } from "./excel-filter";

type Row = { id: string; vals: Record<string, unknown> };
const acc = (r: Row, k: string) => r.vals[k];
const rows: Row[] = [
  { id: "1", vals: { stage: "opt-a", n: 3 } },
  { id: "2", vals: { stage: "opt-b", n: 1 } },
  { id: "3", vals: { stage: "opt-a", n: 2 } },
  { id: "4", vals: { stage: null, n: null } },
];

describe("distinctColumnValues", () => {
  it("returns unique values incl. a blank bucket", () => {
    const d = distinctColumnValues(rows, "stage", acc, (v) => (v == null ? "(trống)" : String(v)));
    expect(d.map((x) => x.value).sort()).toEqual(["", "opt-a", "opt-b"]); // "" = blank
    expect(d.find((x) => x.value === "")!.label).toBe("(trống)");
  });
});

describe("applyExcelFilters", () => {
  it("keeps rows whose value is in the selected set (per column, AND across columns)", () => {
    const f = new Map([["stage", new Set(["opt-a"])]]);
    expect(applyExcelFilters(rows, f, acc).map((r) => r.id)).toEqual(["1", "3"]);
  });
  it("blank selection matches null/empty values", () => {
    const f = new Map([["stage", new Set([""])]]);
    expect(applyExcelFilters(rows, f, acc).map((r) => r.id)).toEqual(["4"]);
  });
  it("empty filter map = no filtering", () => {
    expect(applyExcelFilters(rows, new Map(), acc)).toHaveLength(4);
  });
});

describe("compareByType", () => {
  it("number compares numerically; nulls last", () => {
    expect(compareByType("number", 2, 10)).toBeLessThan(0);
    expect(compareByType("number", null, 1)).toBeGreaterThan(0);
  });
  it("date compares chronologically", () => {
    expect(compareByType("date", "2026-01-01", "2026-12-01")).toBeLessThan(0);
  });
  it("text compares case-insensitively", () => {
    expect(compareByType("text", "apple", "Banana")).toBeLessThan(0);
  });
});

describe("sortByColumn", () => {
  it("desc by number", () => {
    expect(sortByColumn(rows, "n", "number", "desc", acc).map((r) => r.id)).toEqual(["1", "3", "2", "4"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/table-config/excel-filter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { ColumnType } from "./types";

export type ValueAccessor<T> = (row: T, columnKey: string) => unknown;
const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

const norm = (v: unknown): string => (v == null || v === "" ? "" : String(v));

export function distinctColumnValues<T>(
  rows: T[], columnKey: string, accessor: ValueAccessor<T>, format: (v: unknown) => string
): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const raw = accessor(r, columnKey);
    const value = norm(raw);
    if (!seen.has(value)) seen.set(value, value === "" ? format(null) : format(raw));
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => collator.compare(a.label, b.label));
}

export function applyExcelFilters<T>(
  rows: T[], filters: Map<string, Set<string>>, accessor: ValueAccessor<T>
): T[] {
  const active = [...filters.entries()].filter(([, set]) => set.size > 0);
  if (active.length === 0) return rows;
  return rows.filter((r) =>
    active.every(([key, set]) => set.has(norm(accessor(r, key))))
  );
}

export function compareByType(type: ColumnType, a: unknown, b: unknown): number {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;   // nulls last
  if (bEmpty) return -1;
  if (type === "number") return Number(a) - Number(b);
  if (type === "date") return String(a).localeCompare(String(b)); // ISO sorts chronologically
  if (type === "checkbox") return (a ? 1 : 0) - (b ? 1 : 0);
  return collator.compare(String(a), String(b));
}

export function sortByColumn<T>(
  rows: T[], columnKey: string, type: ColumnType, dir: "asc" | "desc", accessor: ValueAccessor<T>
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((x, y) => sign * compareByType(type, accessor(x, columnKey), accessor(y, columnKey)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/table-config/excel-filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-config/excel-filter.ts src/lib/table-config/excel-filter.test.ts
git commit -m "feat(filter): Excel-style distinct/filter/sort pure logic"
```

---

## Task 4: Layout persistence API

**Context:** Lưu/đọc/reset layout của user hiện tại. Khác route config Phase 1 (admin-only) — layout là của MỌI user nên chỉ cần `loadEnrollmentActor` (bất kỳ user vào board), keyed theo `actor.email`. GET đọc, PUT upsert (onConflict user_email,scope), DELETE = reset về mặc định. Không có logic phức tạp, chỉ CRUD 1 hàng.

**Files:**
- Create: `src/app/api/config/layout/route.ts`

**Interfaces:**
- Consumes: `loadEnrollmentActor` (any authed user — not admin-only), `toTableScope`, `LayoutEntry`.
- Produces: `GET ?scope=` → `{ layout: LayoutEntry[] | null }`; `PUT { scope, layout }` upsert; `DELETE ?scope=` reset.

- [ ] **Step 1: Implement** (auth = any board user; keyed by `actor.email`)

```ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { toTableScope } from "@/lib/table-config/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const a = await loadEnrollmentActor();
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const scope = toTableScope(new URL(request.url).searchParams.get("scope"));
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("user_table_layout").select("layout")
    .eq("user_email", a.actor.email).eq("scope", scope).maybeSingle();
  return NextResponse.json({ layout: (data as { layout?: unknown } | null)?.layout ?? null });
}

export async function PUT(request: Request) {
  const a = await loadEnrollmentActor();
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const body = await request.json().catch(() => null);
  const scope = toTableScope(body?.scope);
  const layout = Array.isArray(body?.layout) ? body.layout : [];
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("user_table_layout")
    .upsert({ user_email: a.actor.email, scope, layout, updated_at: new Date().toISOString() },
            { onConflict: "user_email,scope" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const a = await loadEnrollmentActor();
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const scope = toTableScope(new URL(request.url).searchParams.get("scope"));
  const supabase = getSupabaseAdmin();
  await supabase.from("user_table_layout").delete().eq("user_email", a.actor.email).eq("scope", scope);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Manual smoke test** — PUT a layout, GET returns it; different user gets null; DELETE resets to null.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/config/layout/route.ts
git commit -m "feat(layout): per-user layout persistence API"
```

---

## Task 5: Layout controls in enrollment table (reorder/resize/show-hide/reset)

**Context:** Nối logic Task 2 + API Task 4 vào bảng enrollment thật. Hiện bảng dùng `hiddenColumnKeys` từ localStorage — task này thay bằng hook `useColumnLayout` (load layout DB → `resolveLayout` → cột hiển thị + các hàm reorder/setWidth/toggleHidden/reset, mỗi thao tác PUT/DELETE có debounce). UI: thêm tay cầm kéo trên header (đổi thứ tự), grip kéo mép phải header (đổi rộng), nút Reset. Đây là phần đưa #1 ra mặt người dùng.

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`
- Create: `src/app/(authed)/enrollment/_components/useColumnLayout.ts`

**Interfaces:**
- Consumes: `resolveLayout`, `serializeLayout`, `applyLayoutChange`, layout API.

- [ ] **Step 1:** `useColumnLayout(scope, columns)` hook — loads `GET /api/config/layout`, resolves via `resolveLayout`, exposes `visibleColumns`, `reorder(keys)`, `setWidth(key,w)`, `toggleHidden(key)`, `reset()`, each persisting via debounced `PUT`/`DELETE`.
- [ ] **Step 2:** Wire into the table: replace the current `hiddenColumnKeys` localStorage mechanism with the hook; add drag handles on headers (reorder), a resize grip on header right edge (setWidth), the existing column menu drives `toggleHidden`, add a "Reset layout" button.
- [ ] **Step 3: Manual check** — reorder/resize/hide persist across reload; Reset returns to defaults; a second user is unaffected.
- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" "src/app/(authed)/enrollment/_components/useColumnLayout.ts"
git commit -m "feat(layout): per-user reorder/resize/show-hide/reset in enrollment table"
```

---

## Task 6: Excel-style header menu in enrollment table

**Context:** Đưa tính năng d ra bảng enrollment. Dựng `ColumnHeaderMenu` (popover Sort + checklist distinct values từ Task 3). Điểm khó là **định nghĩa accessor**: cột system đọc field thật của record theo `key`, cột custom đọc `record.custom_values[key]`, format bằng `formatCustomValue` (Phase 1) với map option/người đã load. Excel-filter được AND vào memo `filteredRecords` hiện có; các quick-filter phái sinh (attention/overdue/qcNeeded/unowned/due-range) giữ nguyên và AND cùng. Xem Background để biết vì sao không thay kiến trúc filter cũ.

**Files:**
- Create: `src/app/(authed)/enrollment/_components/ColumnHeaderMenu.tsx`
- Modify: `EnrollmentClient.tsx`

**Interfaces:**
- Consumes: `distinctColumnValues`, `applyExcelFilters`, `sortByColumn`, per-column value accessor.

- [ ] **Step 1:** Build `ColumnHeaderMenu` — click header → popover with: Sort A→Z / Z→A (calls `sortByColumn`); a searchable checklist of `distinctColumnValues` (Select all + per-value checkbox); Apply/Clear. Selected sets live in `Map<columnKey, Set<string>>` state.
- [ ] **Step 2:** Define the value accessor: for system columns reuse existing cell value getters (map `key`→field); for custom columns read `record.custom_values[key]`; format via `formatCustomValue` (Phase 1) using the loaded options/people maps. Apply `applyExcelFilters` in the existing `filteredRecords` memo, then existing sort → `sortByColumn` when an Excel sort is active.
- [ ] **Step 3:** Keep the derived quick-filters (attention/overdue/qcNeeded/unowned/due-range) as-is, ANDed with the Excel filters.
- [ ] **Step 4: Manual check** — filter Stage to 2 values via header checklist; combine with a Carrier header filter (AND); sort a custom `number` column desc; quick-filter "overdue" still narrows further.
- [ ] **Step 5: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/ColumnHeaderMenu.tsx" "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "feat(filter): Excel-style header sort/filter menu in enrollment table"
```

---

## Task 7: Bring layout + header menu to the CS task list

**Context:** Lặp lại Task 5+6 cho bảng CS (view List `TaskListView.tsx`). Vì hook `useColumnLayout` và `ColumnHeaderMenu` đã viết cho enrollment, task này trước hết **tách phần dùng chung** ra chỗ shared (hook thuần có thể để `src/lib/table-config/`, component vào `_shared/`) rồi cắm vào CS với accessor riêng của CS (field task theo `key` + `custom_values`). Kanban không đụng.

**Files:**
- Modify: `src/app/(authed)/tasks/_components/TaskListView.tsx`
- Reuse: `useColumnLayout` (generalize import path — move hook to `src/lib/table-config/useColumnLayout.ts` if it has no enrollment-specific deps), `ColumnHeaderMenu`.

- [ ] **Step 1:** If `useColumnLayout`/`ColumnHeaderMenu` are enrollment-specific, extract the shared parts to `src/app/(authed)/_shared/` (or `src/lib/table-config/` for pure hook). Follow existing shared-component conventions (grep for cross-feature imports).
- [ ] **Step 2:** Wire scope `cs` columns (from Phase 1) through `resolveLayout` + header menu in `TaskListView`; define the CS value accessor (system task fields by `key` + `custom_values`).
- [ ] **Step 3: Manual check** — CS list supports reorder/resize/hide/reset per user and Excel header sort/filter; Kanban view unaffected.
- [ ] **Step 4: Commit**

```bash
git add "src/app/(authed)/tasks/_components" src/app/(authed)/_shared 2>/dev/null
git commit -m "feat(layout+filter): per-user layout + Excel header menu in CS task list"
```

---

## Self-Review (checklist đã chạy)

**Spec coverage (#1 + d):** reorder/resize/show-hide per-user DB (Tasks 1,4,5,7) ✓; reset (Task 5) ✓; no pin, Key/Client sticky default kept (constraint) ✓; Excel sort/filter mọi cột kể cả custom (Tasks 3,6,7) ✓; quick-filter phái sinh giữ song song (Task 6) ✓; per-table (scope) tách biệt (Task 4 unique(user,scope)) ✓.

**Placeholder scan:** pure-logic tasks (2,3) đủ code+test; UI tasks (5,6,7) mô tả cụ thể điểm nối + accessor, dựa component/pattern hiện có thay vì lặp code table 3000-dòng — cố ý.

**Type consistency:** `LayoutEntry`/`ResolvedColumn`/`ValueAccessor`/`resolveLayout`/`serializeLayout`/`applyLayoutChange`/`distinctColumnValues`/`applyExcelFilters`/`compareByType`/`sortByColumn` dùng nhất quán giữa các task; `formatCustomValue`/`TableColumn`/`TableScope` nhập từ Phase 1.

**Câu hỏi mở** (chốt khi execute): resize grip UX (min/max width); có nên nhớ trạng thái Excel-filter theo user không (mặc định: session-only, không lưu — chỉ layout mới lưu DB).
