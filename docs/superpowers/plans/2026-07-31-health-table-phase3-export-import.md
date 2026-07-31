# Health Table Phase 3 — Export / Import with 2-Layer Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export bảng ra Excel `.xlsx` (theo view đang lọc + xuất toàn bộ); Import file để vừa thêm mới vừa cập nhật record, có map cột + khoá khớp admin chọn lúc import, qua **duyệt 2 lớp** (người import ≠ người duyệt). Chỉ Admin + Agent dùng; Assistant bị chặn.

**Architecture:** Export/Import dùng lib `xlsx` (SheetJS) đã có sẵn. Import KHÔNG ghi thẳng: parse + phân loại (add/update/error) → lưu `import_request` (pending) + staging rows → admin duyệt → apply transactionally. Logic phân loại/validate/khoá-khớp và dựng ma trận export tách thành hàm thuần test được (`src/lib/table-config/import.ts`, `export.ts`). Validate giá trị dùng lại `coerceCustomValue` (Phase 1).

**Tech Stack:** Next.js (fork — đọc `node_modules/next/dist/docs/`), Supabase Postgres, TypeScript, vitest, `xlsx@^0.18.5`.

## Global Constraints

- **Phụ thuộc Phase 1:** cần `table_column`/`TableColumn`/`ColumnType`, `coerceCustomValue`, `formatCustomValue`, `custom_values` trên record. Không chạy trước Phase 1. (Không phụ thuộc Phase 2.)
- **Next.js fork:** đọc `node_modules/next/dist/docs/` trước khi viết route/component.
- **Quyền:** Export + Import (submit) = Admin + Agent, **KHÔNG Assistant**. Duyệt = Admin, và **người duyệt phải khác người import** (kể cả admin tự import).
- **Import an toàn:** không bao giờ ghi DB trước khi admin duyệt. Apply chạy trong 1 transaction.
- **Scope enum:** `'cs'|'aca'|'medicare'`.
- **Test:** logic thuần ở `src/lib/table-config/*.test.ts`, chạy `npx vitest run <file>`.

---

## Background & Existing Codebase Context

> Đọc mục này + "Background" của Phase 1 (`2026-07-31-health-table-phase1-config.md`) trước khi làm.

### Bối cảnh nghiệp vụ import
User có dữ liệu ở **hệ thống cũ, schema na ná** (cùng ý nghĩa cột nhưng không trùng 100%). Lần đầu: đổ toàn bộ vào (thêm mới). Về sau: import file mà dòng nào trùng record đã có thì cập nhật, chưa có thì thêm. Vì đến từ hệ khác nên `id`/`Key` nội bộ KHÔNG trùng — phải khớp theo **một cột nghiệp vụ do admin chọn lúc import** (vd FUB Link, mã KH, phone). Đây là lý do có bước "map cột" (cột trong file → cột trong bảng) và "chọn khoá khớp".

### Duyệt 2 lớp (đã chốt)
Import ghi thẳng DB rất rủi ro, nên: người import (admin/agent) tải file → hệ thống parse + kiểm tra → tạo **yêu cầu import** trạng thái `pending` kèm bản xem trước (thêm mấy dòng / sửa mấy dòng / lỗi ở đâu) → **một admin khác** xem rồi Duyệt/Từ chối → duyệt xong mới apply. **Người duyệt phải khác người submit** — kể cả admin tự import cũng cần admin khác duyệt (đã chốt: không tự duyệt). Edge case chỉ có 1 admin và chính họ import: chặn, báo "cần thêm 1 admin để duyệt".

### Thư viện Excel đã có
`package.json` đã có `"xlsx": "^0.18.5"` (SheetJS). Dùng cho cả:
- Export: `XLSX.utils.aoa_to_sheet(matrix)` + `XLSX.utils.book_new()` + `XLSX.write(wb, { type: "buffer", bookType: "xlsx" })`.
- Import: `XLSX.read(buffer, { type: "buffer" })` rồi `XLSX.utils.sheet_to_json(sheet, { header: 1 })` → mảng-của-mảng (dòng đầu là header). Đọc được cả `.xlsx` lẫn `.csv`.
Tách phần gọi `xlsx` vào 1 file mỏng (`sheet-io.ts`) để logic phân loại/dựng-ma-trận vẫn thuần & test được.

### Dữ liệu record + cột (từ Phase 1)
- Record enrollment ở table `enrollment_records` (phân biệt `program`), CS ở `tasks`. Cả hai đã có `custom_values jsonb` (Phase 1).
- Danh sách cột mỗi bảng lấy từ `table_column` (Phase 1) qua `fetchTableColumns(scope)`; cột dropdown có options ở `table_column_option` (custom) / `enrollment_options` (system) qua `fetchTableColumnOptions(scope)`.
- Giá trị: cột **system** map field thật (theo `key`), cột **custom** ở `custom_values[key]`.
- `coerceCustomValue(type, raw, ctx)` (ở `src/lib/table-config/values.ts`) validate + chuẩn hoá 1 giá trị theo kiểu, trả `{ ok, value }` hoặc `{ ok:false, error }`. `formatCustomValue(type, value, ctx)` render ngược ra chuỗi (dropdown→label, person→tên...). Import dùng `coerce`, export dùng `format`.

### Auth + chặn Assistant
Mẫu auth: `loadEnrollmentActor()` → `{ ok, actor:{ email, isManager, isWorker } }` (xem Background Phase 1). `isManager===true` = admin. Role `assistant` là role RBAC riêng. Hiện **chưa có** helper "user này có phải assistant không" cho mục đích chặn export/import — Task 11 sẽ thêm `canExportImport(actor)` (true nếu admin hoặc agent-không-phải-assistant). Cần xác định "assistant" từ session role (tìm ở `src/lib/rbac/` + `session.user.role/roles` như `isTaskViewAdmin` đang đọc).

### schema.sql + route + test: quy ước giống Phase 1
`create table if not exists`, lowercase snake_case, route `[id]` dùng `params: Promise<{...}>` phải `await`. Route mutation gọi `broadcastEnrollmentChanged()`. Logic thuần test bằng vitest.

---

## File Structure

**Create:**
- `src/lib/table-config/sheet-io.ts` — vỏ mỏng quanh `xlsx`: `readSheetRows(buffer)`, `writeXlsx(header, rows)`.
- `src/lib/table-config/export.ts` — `buildExportMatrix` (thuần).
- `src/lib/table-config/export.test.ts`
- `src/lib/table-config/import.ts` — `classifyImportRows`, `canApproveImport`, types (thuần).
- `src/lib/table-config/import.test.ts`
- `src/app/api/enrollment/export/route.ts` (+ CS `src/app/api/tasks/export/route.ts`) — trả file .xlsx.
- `src/app/api/config/imports/route.ts` — POST submit (parse+classify+lưu pending), GET list pending.
- `src/app/api/config/imports/[id]/route.ts` — GET detail (preview), POST approve, DELETE reject.
- `src/app/(authed)/enrollment/_components/ImportDialog.tsx` — upload + mapping + match-key + preview.
- `src/app/(authed)/config/_components/ImportReviewSection.tsx` — danh sách pending + duyệt/từ chối (thêm tab vào /config).
- `src/lib/table-config/permissions.ts` — `canExportImport(actor, isAssistant)`.

**Modify:**
- `supabase/schema.sql` — `import_request` + `import_request_row`.
- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` — nút Export + nút Import (mở dialog), ẩn với Assistant.
- `src/app/(authed)/config/_components/ConfigClient.tsx` — thêm tab "Import Review".

---

## Task 1: Schema — import_request + staging rows

**Context:** Nơi giữ yêu cầu import ở trạng thái chờ duyệt + các dòng đã parse (staging) để không đụng DB thật cho tới khi duyệt. `import_request` giữ meta (ai submit, scope, cột khoá, map cột, summary đếm) và trạng thái pending/approved/rejected + ai duyệt. `import_request_row` giữ từng dòng đã phân loại (add/update/error) + giá trị đã chuẩn hoá + lỗi. Chưa ai đọc — task sau dùng. Chỉ sửa `supabase/schema.sql`.

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Step 1: Add tables**

```sql
create table if not exists import_request (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('cs','aca','medicare')),
  submitted_by_email text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  match_column_key text not null,
  column_mapping jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  reviewed_by_email text,
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);
create table if not exists import_request_row (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references import_request(id) on delete cascade,
  action text not null check (action in ('add','update','error')),
  target_record_id uuid,
  values jsonb not null default '{}'::jsonb,
  error_text text,
  created_at timestamptz not null default now()
);
create index if not exists import_request_row_req_idx on import_request_row(request_id);
create index if not exists import_request_pending_idx on import_request(scope, status);
```

- [ ] **Step 2: Apply + verify**

Run: `psql "$DATABASE_URL" -f supabase/schema.sql`
Then: `psql "$DATABASE_URL" -c "\d import_request"`
Expected: cột `status` có check pending/approved/rejected.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat(import): import_request + staging tables"
```

---

## Task 2: Export matrix pure logic

**Context:** Export = biến danh sách record + danh sách cột hiển thị thành ma trận chữ (header + các dòng) để `xlsx` ghi. Tách thuần để test: nhận `accessor(row,key)` (cột system đọc field thật, custom đọc `custom_values[key]` — do caller cấp) + `formatValue(column, rawValue)` (bọc `formatCustomValue`), trả `{ header, rows }`. Không đụng `xlsx` ở đây. TDD.

**Files:**
- Create: `src/lib/table-config/export.ts`, `src/lib/table-config/export.test.ts`

**Interfaces:**
- Consumes: `TableColumn` (Phase 1).
- Produces: `buildExportMatrix<T>(records: T[], columns: TableColumn[], accessor: (row: T, key: string) => unknown, formatValue: (col: TableColumn, raw: unknown) => string): { header: string[]; rows: string[][] }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildExportMatrix } from "./export";
import type { TableColumn } from "./types";

const col = (key: string, label: string): TableColumn => ({
  id: key, scope: "aca", key, label, type: "text", is_system: true,
  position: 0, hidden_default: false, required: false, archived_at: null,
});

type Row = { client: string; note: unknown };
const cols = [col("client", "Client Name"), col("note", "Note")];
const rows: Row[] = [{ client: "An", note: 5 }, { client: "Bình", note: null }];

describe("buildExportMatrix", () => {
  it("header = column labels; rows = formatted values in column order", () => {
    const m = buildExportMatrix(
      rows, cols,
      (r, k) => (r as Record<string, unknown>)[k],
      (_c, raw) => (raw == null ? "" : String(raw))
    );
    expect(m.header).toEqual(["Client Name", "Note"]);
    expect(m.rows).toEqual([["An", "5"], ["Bình", ""]]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/lib/table-config/export.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { TableColumn } from "./types";

export function buildExportMatrix<T>(
  records: T[],
  columns: TableColumn[],
  accessor: (row: T, key: string) => unknown,
  formatValue: (col: TableColumn, raw: unknown) => string
): { header: string[]; rows: string[][] } {
  const header = columns.map((c) => c.label);
  const rows = records.map((r) => columns.map((c) => formatValue(c, accessor(r, c.key))));
  return { header, rows };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/table-config/export.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-config/export.ts src/lib/table-config/export.test.ts
git commit -m "feat(export): pure export matrix builder"
```

---

## Task 3: Sheet I/O wrapper (xlsx)

**Context:** Bọc `xlsx` vào 1 chỗ để phần còn lại không phụ thuộc trực tiếp thư viện (dễ đổi/dễ test). `writeXlsx` biến header+rows thành buffer .xlsx; `readSheetRows` biến buffer file upload thành mảng-của-mảng (dòng đầu header). Không unit-test (I/O thư viện) — smoke test ở task dùng nó.

**Files:**
- Create: `src/lib/table-config/sheet-io.ts`

- [ ] **Step 1: Implement**

```ts
import * as XLSX from "xlsx";

export function writeXlsx(header: string[], rows: string[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function readSheetRows(buffer: Buffer): string[][] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false, defval: "" });
  return rows.map((r) => r.map((c) => (c == null ? "" : String(c))));
}
```

- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit`. Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/table-config/sheet-io.ts
git commit -m "feat(export): xlsx read/write wrapper"
```

---

## Task 4: Export API + button (enrollment; CS analogous)

**Context:** Endpoint trả file .xlsx cho bảng đang xem. Nhận filter đang áp (để "xuất theo view") hoặc cờ `all=1` (xuất toàn bộ). Server load record theo scope, dựng ma trận (`buildExportMatrix`, format bằng `formatCustomValue` với map option/người), ghi `writeXlsx`, trả `Response` với `Content-Type` xlsx + `Content-Disposition`. Chặn Assistant (Task 11). Nút Export ở toolbar bảng gọi endpoint này.

**Files:**
- Create: `src/app/api/enrollment/export/route.ts`
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

- [ ] **Step 1:** Route GET: auth `loadEnrollmentActor` + `canExportImport` (Task 11); đọc `scope`/`all`/các filter param; load records (dùng lại query loader enrollment hiện có); `columns = await fetchTableColumns(scope)` (lọc theo layout hiển thị nếu client gửi danh sách cột); build matrix; `const buf = writeXlsx(header, rows)`; trả:

```ts
return new Response(buf, {
  headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="enrollment-${scope}-${Date.now()}.xlsx"`,
  },
});
```

- [ ] **Step 2:** UI: nút "Export" (và tuỳ chọn "Xuất toàn bộ") trong toolbar, mở link tới endpoint với query = filter hiện tại + danh sách cột đang hiện.
- [ ] **Step 3: Manual check** — Export tải về file mở được bằng Excel; đúng cột đang hiện; "Xuất toàn bộ" bỏ qua filter; Assistant không thấy nút / bị 403.
- [ ] **Step 4:** Lặp cho CS: `src/app/api/tasks/export/route.ts` + nút trong `TaskListView`.
- [ ] **Step 5: Commit**

```bash
git add src/app/api/enrollment/export/route.ts src/app/api/tasks/export/route.ts "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" "src/app/(authed)/tasks/_components/TaskListView.tsx"
git commit -m "feat(export): xlsx export API + toolbar button"
```

---

## Task 5: Import classification pure logic (core)

**Context:** Trái tim của import — thuần, test kỹ. Nhận: các dòng file (đã map sang key cột), `matchColumnKey`, tập giá trị khoá của record hiện có (`existingByMatchValue: Map<matchValue, recordId>`), danh sách cột + ctx (optionIds theo cột dropdown, emails cho person). Với mỗi dòng: chuẩn hoá từng giá trị bằng `coerceCustomValue` theo kiểu cột; nếu có lỗi → `action:'error'` kèm mô tả; nếu giá trị khoá đã tồn tại → `action:'update'` + `target_record_id`; nếu chưa → `action:'add'`. Trả `{ rows: ImportClassifiedRow[], summary:{addCount,updateCount,errorCount} }`. Đây là cái dựng "bản xem trước". TDD.

**Files:**
- Create: `src/lib/table-config/import.ts`, `src/lib/table-config/import.test.ts`

**Interfaces:**
- Consumes: `TableColumn`, `ColumnType`, `coerceCustomValue` (Phase 1).
- Produces:
  - `type ImportClassifiedRow = { action: "add"|"update"|"error"; targetRecordId: string | null; values: Record<string, unknown>; errors: string[] }`
  - `classifyImportRows(fileRows: Record<string,string>[], opts: { matchColumnKey: string; existingByMatchValue: Map<string,string>; columns: TableColumn[]; ctxByKey: Map<string, { optionIds?: Set<string>; emails?: Set<string> }> }): { rows: ImportClassifiedRow[]; summary: { addCount: number; updateCount: number; errorCount: number } }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { classifyImportRows } from "./import";
import type { TableColumn } from "./types";

const col = (key: string, type: TableColumn["type"]): TableColumn => ({
  id: key, scope: "aca", key, label: key, type, is_system: false,
  position: 0, hidden_default: false, required: false, archived_at: null,
});
const columns = [col("fub", "link"), col("age", "number"), col("stage", "dropdown")];
const ctxByKey = new Map([["stage", { optionIds: new Set(["opt1"]) }]]);

describe("classifyImportRows", () => {
  it("new match value → add; existing → update with target id", () => {
    const existing = new Map([["https://a.io", "rec-1"]]);
    const out = classifyImportRows(
      [
        { fub: "https://a.io", age: "30", stage: "opt1" }, // update rec-1
        { fub: "https://b.io", age: "40", stage: "opt1" }, // add
      ],
      { matchColumnKey: "fub", existingByMatchValue: existing, columns, ctxByKey }
    );
    expect(out.summary).toEqual({ addCount: 1, updateCount: 1, errorCount: 0 });
    expect(out.rows[0]).toMatchObject({ action: "update", targetRecordId: "rec-1" });
    expect(out.rows[1]).toMatchObject({ action: "add", targetRecordId: null });
    expect(out.rows[0].values).toMatchObject({ age: 30, stage: "opt1" });
  });

  it("invalid value → error row with message, not counted as add/update", () => {
    const out = classifyImportRows(
      [{ fub: "not-a-link", age: "abc", stage: "ghost" }],
      { matchColumnKey: "fub", existingByMatchValue: new Map(), columns, ctxByKey }
    );
    expect(out.summary).toEqual({ addCount: 0, updateCount: 0, errorCount: 1 });
    expect(out.rows[0].action).toBe("error");
    expect(out.rows[0].errors.length).toBeGreaterThan(0);
  });

  it("missing match value → error", () => {
    const out = classifyImportRows(
      [{ fub: "", age: "1", stage: "opt1" }],
      { matchColumnKey: "fub", existingByMatchValue: new Map(), columns, ctxByKey }
    );
    expect(out.rows[0].action).toBe("error");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/lib/table-config/import.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { TableColumn } from "./types";
import { coerceCustomValue } from "./values";

export type ImportClassifiedRow = {
  action: "add" | "update" | "error";
  targetRecordId: string | null;
  values: Record<string, unknown>;
  errors: string[];
};

export function classifyImportRows(
  fileRows: Record<string, string>[],
  opts: {
    matchColumnKey: string;
    existingByMatchValue: Map<string, string>;
    columns: TableColumn[];
    ctxByKey: Map<string, { optionIds?: Set<string>; emails?: Set<string> }>;
  }
): { rows: ImportClassifiedRow[]; summary: { addCount: number; updateCount: number; errorCount: number } } {
  const colByKey = new Map(opts.columns.map((c) => [c.key, c]));
  const rows: ImportClassifiedRow[] = [];
  let addCount = 0, updateCount = 0, errorCount = 0;

  for (const fileRow of fileRows) {
    const values: Record<string, unknown> = {};
    const errors: string[] = [];

    for (const [key, raw] of Object.entries(fileRow)) {
      const col = colByKey.get(key);
      if (!col) continue; // cột không map — bỏ qua
      const ctx = opts.ctxByKey.get(key) ?? {};
      const res = coerceCustomValue(col.type, raw, ctx);
      if (res.ok) values[key] = res.value;
      else errors.push(`${col.label}: ${res.error}`);
    }

    const matchRaw = (fileRow[opts.matchColumnKey] ?? "").trim();
    if (!matchRaw) errors.push("Thiếu giá trị cột khoá khớp");

    if (errors.length > 0) {
      rows.push({ action: "error", targetRecordId: null, values, errors });
      errorCount += 1;
      continue;
    }

    const target = opts.existingByMatchValue.get(matchRaw) ?? null;
    if (target) {
      rows.push({ action: "update", targetRecordId: target, values, errors: [] });
      updateCount += 1;
    } else {
      rows.push({ action: "add", targetRecordId: null, values, errors: [] });
      addCount += 1;
    }
  }

  return { rows, summary: { addCount, updateCount, errorCount } };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/table-config/import.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-config/import.ts src/lib/table-config/import.test.ts
git commit -m "feat(import): row classification pure logic"
```

---

## Task 6: Approval guard pure logic (reviewer ≠ submitter)

**Context:** Hiện thực luật đã chốt: người duyệt phải khác người import. Hàm thuần để test + dùng ở route approve (Task 9). Thêm vào cùng `import.ts`.

**Files:**
- Modify: `src/lib/table-config/import.ts`, `src/lib/table-config/import.test.ts`

**Interfaces:**
- Produces: `canApproveImport(req: { submitted_by_email: string; status: string }, reviewerEmail: string): { ok: true } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing tests**

```ts
import { canApproveImport } from "./import";

describe("canApproveImport", () => {
  it("rejects self-approval", () => {
    expect(canApproveImport({ submitted_by_email: "a@x.io", status: "pending" }, "a@x.io").ok).toBe(false);
  });
  it("allows a different admin", () => {
    expect(canApproveImport({ submitted_by_email: "a@x.io", status: "pending" }, "b@x.io").ok).toBe(true);
  });
  it("rejects if not pending", () => {
    expect(canApproveImport({ submitted_by_email: "a@x.io", status: "approved" }, "b@x.io").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail** — Run: `npx vitest run src/lib/table-config/import.test.ts`. Expected: FAIL (new fn).

- [ ] **Step 3: Implement (append to import.ts)**

```ts
export function canApproveImport(
  req: { submitted_by_email: string; status: string },
  reviewerEmail: string
): { ok: true } | { ok: false; error: string } {
  if (req.status !== "pending") return { ok: false, error: "Yêu cầu không còn ở trạng thái chờ duyệt." };
  if (req.submitted_by_email.toLowerCase() === reviewerEmail.toLowerCase()) {
    return { ok: false, error: "Người import không được tự duyệt — cần một admin khác." };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run to verify pass** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-config/import.ts src/lib/table-config/import.test.ts
git commit -m "feat(import): reviewer-not-submitter approval guard"
```

---

## Task 7: Import submit API (parse → classify → store pending)

**Context:** Nhận file + mapping + khoá khớp từ dialog, KHÔNG ghi record thật. Đọc file (`readSheetRows`), đổi mảng-của-mảng thành `Record<key,string>[]` theo `column_mapping` (header file → column key), load record hiện có để dựng `existingByMatchValue` (đọc giá trị cột khoá của mọi record chưa archive trong scope), load cột + options/emails để dựng `ctxByKey`, gọi `classifyImportRows`, rồi lưu `import_request` (pending) + `import_request_row[]`. Trả `requestId` + summary. Chặn Assistant (Task 11).

**Files:**
- Create: `src/app/api/config/imports/route.ts`

- [ ] **Step 1:** POST (multipart form: file + `scope` + `matchColumnKey` + `columnMapping` JSON). Auth `loadEnrollmentActor` + `canExportImport`. Đọc buffer → `readSheetRows` → tách header row → map từng dòng thành `Record<columnKey,string>` qua `columnMapping`. Load `columns = fetchTableColumns(scope)`, options/emails → `ctxByKey`. Load existing match values:

```ts
// ví dụ khoá là cột system 'fub' → đọc fub_link; nếu là custom → đọc custom_values[key]
const existingByMatchValue = new Map<string, string>();
// ...select id + (field khoá) từ enrollment_records where program=scope and archived_at is null
```

Gọi `classifyImportRows`, insert `import_request` + rows, trả `{ requestId, summary }`.

- [ ] **Step 2:** GET (list): trả các `import_request` `pending` theo scope cho màn duyệt.
- [ ] **Step 3: Manual smoke test** — POST 1 file 3 dòng (1 update, 1 add, 1 lỗi) → 200, summary `{add:1,update:1,error:1}`; DB có 1 `import_request` pending + 3 rows; record thật CHƯA đổi.
- [ ] **Step 4: Commit**

```bash
git add src/app/api/config/imports/route.ts
git commit -m "feat(import): submit endpoint (parse, classify, stage pending)"
```

---

## Task 8: Approve/Reject API (apply transactionally)

**Context:** Admin duyệt → apply staging vào record thật trong 1 transaction; từ chối → chỉ đổi trạng thái. Phải `canApproveImport` (Task 6) chặn tự-duyệt + chặn không-pending. Apply: với mỗi row `add` → insert record mới (map values → field system + custom_values); `update` → update record theo `target_record_id`; `error` → bỏ qua. Đổi `import_request.status='approved'`, set `reviewed_by_email/at`.

**Files:**
- Create: `src/app/api/config/imports/[id]/route.ts`

- [ ] **Step 1:** GET detail: trả request + rows (cho preview màn duyệt).
- [ ] **Step 2:** POST approve: `loadConfigAdmin` (admin); load request; `canApproveImport(req, actor.email)` — fail → 403 kèm message; áp rows trong transaction (dùng RPC/`supabase` batch; nếu không có transaction helper, apply tuần tự và ghi lại lỗi — chốt all-or-nothing vs bỏ-qua-lỗi ở đây, mặc định: bỏ qua row lỗi đã loại từ trước nên các row add/update đều hợp lệ). Cập nhật status.

> Quyết định (câu hỏi mở #1 của spec): vì row `error` đã bị loại khỏi add/update ở Task 5, phần apply chỉ gồm row hợp lệ. Chốt: apply toàn bộ; nếu 1 insert/update lỗi hạ tầng → rollback cả mẻ (all-or-nothing) và trả 500, giữ status `pending` để duyệt lại.

- [ ] **Step 3:** DELETE (hoặc POST reject) với `reject_reason`: set status `rejected`, không đụng record.
- [ ] **Step 4: Manual smoke test** — approve bằng admin KHÁC người submit → record thật thay đổi đúng (1 add + 1 update); approve bằng chính người submit → 403; reject → record không đổi.
- [ ] **Step 5: Commit**

```bash
git add "src/app/api/config/imports/[id]/route.ts"
git commit -m "feat(import): approve/reject apply with reviewer guard"
```

---

## Task 9: Import dialog UI (upload → map → match-key → preview)

**Context:** Chỗ người import thao tác. Mở từ nút "Import" trên toolbar bảng (ẩn với Assistant). Bước: (1) chọn file .xlsx/.csv; (2) hệ đọc header file, hiện form map từng cột file → cột bảng (`table_column`); (3) chọn cột khoá khớp; (4) bấm "Xem trước" → POST tới `/api/config/imports` → hiện summary (thêm/sửa/lỗi) + list lỗi; (5) "Gửi duyệt" (thực ra submit đã tạo pending; nút xác nhận đóng dialog + báo "đã gửi cho admin duyệt"). KHÔNG có nút apply trực tiếp.

**Files:**
- Create: `src/app/(authed)/enrollment/_components/ImportDialog.tsx`
- Modify: `EnrollmentClient.tsx` (nút Import)

- [ ] **Step 1:** Build dialog theo các bước trên; đọc header file phía client bằng `readSheetRows` (hoặc để server trả header ở 1 call preview riêng — chọn 1, mô tả rõ trong code).
- [ ] **Step 2: Manual check** — upload file, map cột, chọn khoá, xem preview đúng số; sau khi gửi thấy xuất hiện ở màn duyệt (Task 10).
- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/ImportDialog.tsx" "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "feat(import): upload/map/preview dialog"
```

---

## Task 10: Import review UI (admin duyệt)

**Context:** Lớp 2 của quy trình. Thêm 1 tab "Import Review" vào Trang Config (Phase 1). Liệt kê các yêu cầu `pending` (GET `/api/config/imports`), bấm vào xem chi tiết (summary + vài dòng mẫu + danh sách lỗi), nút Duyệt (POST approve) / Từ chối (nhập lý do). Nút Duyệt phải mờ đi nếu người xem chính là người submit (khớp `canApproveImport`); server vẫn chặn lần nữa.

**Files:**
- Create: `src/app/(authed)/config/_components/ImportReviewSection.tsx`
- Modify: `src/app/(authed)/config/_components/ConfigClient.tsx` (thêm tab)

- [ ] **Step 1:** Build danh sách + chi tiết + duyệt/từ chối.
- [ ] **Step 2: Manual check** — admin khác duyệt → áp dụng; tự duyệt → nút mờ + server 403; từ chối kèm lý do.
- [ ] **Step 3: Commit**

```bash
git add "src/app/(authed)/config/_components/ImportReviewSection.tsx" "src/app/(authed)/config/_components/ConfigClient.tsx"
git commit -m "feat(import): admin review & approve UI"
```

---

## Task 11: Permission gating — block Assistant from export/import

**Context:** Export + Import (submit) chỉ cho Admin + Agent, KHÔNG Assistant (đã chốt). Hiện chưa có helper phân biệt assistant cho mục đích này (xem Background). Task này thêm `canExportImport(actor, isAssistant)` và xác định `isAssistant` từ session role (theo cách `isTaskViewAdmin` đọc role), rồi gate cả API (Task 4, 7) lẫn UI (ẩn nút Export/Import).

**Files:**
- Create: `src/lib/table-config/permissions.ts`
- Modify: các route export/import + toolbar bảng.

**Interfaces:**
- Produces: `canExportImport(actor: { isManager: boolean }, isAssistant: boolean): boolean` (admin luôn được; agent được nếu không phải assistant).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { canExportImport } from "./permissions";

describe("canExportImport", () => {
  it("admin always allowed", () => {
    expect(canExportImport({ isManager: true }, true)).toBe(true);
  });
  it("agent (not assistant) allowed", () => {
    expect(canExportImport({ isManager: false }, false)).toBe(true);
  });
  it("assistant (non-admin) blocked", () => {
    expect(canExportImport({ isManager: false }, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail** — Run: `npx vitest run src/lib/table-config/permissions.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
export function canExportImport(actor: { isManager: boolean }, isAssistant: boolean): boolean {
  if (actor.isManager) return true;   // admin
  return !isAssistant;                // agent yes, assistant no
}
```

- [ ] **Step 4: Run to verify pass** — Expected: PASS.

- [ ] **Step 5:** Xác định `isAssistant` từ session (grep `src/lib/rbac/` + cách `isTaskViewAdmin` đọc `session.user.role/roles`); gate route Task 4 & 7 (403 nếu không được) và ẩn nút ở toolbar.
- [ ] **Step 6: Commit**

```bash
git add src/lib/table-config/permissions.ts src/lib/table-config/permissions.test.ts
git commit -m "feat(import): gate export/import away from assistant role"
```

---

## Self-Review (checklist đã chạy)

**Spec coverage (#2):** Export xlsx theo view + toàn bộ (Tasks 2,3,4) ✓; Import thêm mới + cập nhật (Task 5) ✓; map cột + khoá khớp admin chọn lúc import (Tasks 7,9) ✓; duyệt 2 lớp, người duyệt ≠ người import kể cả admin (Tasks 6,8,10) ✓; không ghi DB trước khi duyệt (Tasks 7,8) ✓; chặn Assistant (Task 11) ✓; edge case đơn-admin (Task 8/6 message) ✓.

**Placeholder scan:** logic thuần (2,5,6,11) có code + test đầy đủ; task API/UI (4,7,8,9,10) mô tả cụ thể input/output + điểm nối, dựa mẫu `xlsx`/route/auth đã trích trong Background — cố ý, không lặp code khung.

**Type consistency:** `buildExportMatrix`/`classifyImportRows`/`ImportClassifiedRow`/`canApproveImport`/`canExportImport`/`readSheetRows`/`writeXlsx` dùng nhất quán; `coerceCustomValue`/`formatCustomValue`/`fetchTableColumns`/`TableColumn`/`ColumnType` nhập từ Phase 1.

**Câu hỏi mở** (chốt khi execute): all-or-nothing khi apply (Task 8 đã đề xuất all-or-nothing); đọc header file ở client hay server (Task 9); cột khoá khớp là system hay custom ảnh hưởng cách đọc existing match values (Task 7).
