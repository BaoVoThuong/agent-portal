# Custom Column Value Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép nhập/sửa **giá trị của cột custom** (do admin thêm trong Table Configuration) — vì hiện tại cột custom chỉ hiển thị "—", không có chỗ nào nhập. Hai phần: (1) **sửa inline ngay trên bảng** cho mọi cột custom (CS + ACA + Medicare); (2) thêm toggle **"Hiện trong Task detail"** cho từng cột — tick thì cột đó xuất hiện & sửa được trong drawer chi tiết task/record.

**Execution note (2026-08-02):** Implemented without commits per current workspace instruction. Automated verification passed: `npm run typecheck`, `npm run test:run` (51 files / 416 tests), `npm run lint`, and `git diff --check`. Manual browser checks and applying `supabase/schema.sql` are still pending.

**Architecture:** Backend PATCH đã nhận `custom_values` sẵn (chỉ thiếu UI). Dựng 1 component dùng chung `EditableCustomCell` (edit theo 7 kiểu), cắm vào cell bảng của cả 2 module. Phần 2 thêm 1 field DB `show_in_detail` + toggle trong ConfigClient + khối "Custom fields" trong 2 drawer, tái dùng chính `EditableCustomCell`.

**Tech Stack:** Next.js 16 (đọc `node_modules/next/dist/docs/` trước khi code), React 19, Supabase Postgres, TypeScript, Tailwind, vitest.

## Global Constraints

- **Không đổi API contract sẵn có:** PATCH `custom_values` đã hoạt động — chỉ thêm UI gọi nó. Không đổi cách backend validate.
- **Schema declarative:** field DB mới khai trong `supabase/schema.sql` (`alter table ... add column if not exists`). **User tự chạy schema.sql** — plan chỉ ghi SQL + báo cần chạy.
- **Áp cho cả 3 bảng:** CS (`tasks`) và ACA/Medicare (`enrollment_records`) dùng chung cơ chế custom column, nên mọi thay đổi UI làm cho cả hai module.
- **Next.js fork:** đọc guide trong `node_modules/next/dist/docs/` trước khi viết component/route.
- **Test:** logic thuần (coerce đã có test) + component chính test nhẹ nếu tách được; phần I/O verify thủ công.

---

## Background & Existing Codebase Context

> Đọc kỹ trước khi làm. Mô tả hiện trạng đủ để senior zero-context hiểu.

### Custom column hiện hoạt động thế nào
Admin thêm cột trong Table Configuration (`/config`). Cột lưu ở bảng `table_column` (`id,scope,key,label,type,is_system,position,pinned,hidden_default,required,archived_at`), `type ∈ {text,number,dropdown,date,checkbox,link,person}`. Giá trị mỗi ô lưu trong `custom_values jsonb` trên record (`tasks` / `enrollment_records`), keyed theo `column.key`. Dropdown có options ở `table_column_option`.

### Backend ĐÃ sẵn sàng nhận giá trị (chỉ thiếu UI)
- CS: `src/app/api/tasks/[id]/route.ts:283` — PATCH merge `custom_values`:
```ts
if (isRecord(bodyRecord.custom_values)) {
  resolved.patch.custom_values = {
    ...(isRecord(r.task.custom_values) ? r.task.custom_values : {}),
    ...cleanCustomValues(bodyRecord.custom_values),
  };
}
```
- Enrollment: `src/app/api/enrollment/[id]/route.ts:206` — tương tự với `patchRecord`.
- `cleanCustomValues` (định nghĩa trong mỗi route: tasks:70, enrollment:476) lọc/chuẩn hoá giá trị. `coerceCustomValue(type, raw, ctx)` ở `src/lib/table-config/values.ts:15` validate theo kiểu (đã có test).
→ Gửi `PATCH { custom_values: { [key]: value } }` là **lưu được ngay**. Chỉ cần UI gọi.

### Cell hiện tại: READ-ONLY
- CS: `CustomTaskValueCell` (`TaskRowItem.tsx:855`) chỉ render (checkbox→icon check, dropdown→badge màu, person→initials, link→icon, text→chữ). KHÔNG nhận `onPatch`, KHÔNG có control sửa.
- Enrollment: `EnrollmentCustomValueCell` (`EnrollmentClient.tsx:1778`) — tương tự, read-only.

### Cách cell HỆ THỐNG sửa inline (mẫu để mirror)
Row của CS nhận `onPatch(id, patch)` (`TaskRowItem.tsx:191/218`). Cell hệ thống sửa bằng cách gọi nó:
```ts
// TaskRowItem.tsx — ví dụ hiện có
onChange={(agentEmail) => onPatch(task.id, { agent_email: agentEmail })}   // :407 (person-like)
onChange={(categoryId) => onPatch(task.id, { category_id: categoryId })}   // :447 (dropdown-like)
onChange={(status) => onPatch(task.id, { status })}                        // :813
```
`CustomTaskValueCell` được gọi ở `TaskRowItem.tsx:838` nhưng **chưa được truyền `onPatch`/`task.id`** — Phase 1 sẽ truyền vào.
Bên enrollment, drawer + cell dùng `patchRecord(id, patch)` (đã có; drawer render ở `EnrollmentClient.tsx:843-853` với `onPatch={(patch) => patchRecord(openRecord.id, patch)}`).

### Config Table UI (nơi thêm toggle Phase 2)
`ConfigClient.tsx` render mỗi cột thành 1 hàng (`SortableColumnRow`/`StaticColumnRow`) có sẵn các toggle **Pinned** và **Hidden** (checkbox gọi `onPatch({ pinned })` / `onPatch({ hidden_default })` → `PATCH /api/config/columns/[id]`). Header lưới hiện: `Order | Label | Type | Pinned | Default | Action`.

### Luật sửa field cột: `canEditColumnField`
`src/lib/table-config/columns.ts` — cột system chỉ cho sửa `label|position|pinned|hidden_default`; custom toàn quyền. PATCH `/api/config/columns/[id]/route.ts` kiểm field-by-field bằng hàm này trước khi update, và reset layout mọi user khi đổi `pinned`/`hidden_default` (`resetTableLayoutsForScope`).

### Task detail drawer (nơi render Custom fields Phase 2)
`src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` — có `role="dialog"`, các input title/description/fub (`INPUT_CLASS`), `LABEL_CLASS`, và `onPatch(patch): Promise<void>`. **Chưa render custom field.** Enrollment: drawer render inline trong `EnrollmentClient.tsx:843` (component `record`/`onPatch`).

---

## File Structure

**Create:**
- `src/app/(authed)/_shared/EditableCustomCell.tsx` — component sửa 1 giá trị custom theo kiểu (dùng chung table + drawer, CS + enrollment).
- `src/app/(authed)/_shared/EditableCustomCell.test.tsx` — (tuỳ) test render/save theo kiểu.

**Modify (Phase 1):**
- `src/app/(authed)/tasks/_components/TaskRowItem.tsx` — thay `CustomTaskValueCell` đọc-only bằng `EditableCustomCell`, truyền `onPatch`+task+people+options.
- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` — thay `EnrollmentCustomValueCell` đọc-only bằng `EditableCustomCell`, truyền `patchRecord`+people+options.

**Modify (Phase 2):**
- `supabase/schema.sql` — `show_in_detail` column + seed default.
- `src/lib/table-config/types.ts` — thêm `show_in_detail` vào `TableColumn`.
- `src/lib/table-config/columns.ts` — `canEditColumnField` cho phép `show_in_detail`.
- `src/lib/table-config/queries.ts` — thêm `show_in_detail` vào `TABLE_COLUMN_SELECT` + default columns.
- `src/app/api/config/columns/route.ts` + `[id]/route.ts` — nhận `show_in_detail` (POST/PATCH).
- `src/app/(authed)/config/_components/ConfigClient.tsx` — toggle "In detail".
- `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` — khối Custom fields.
- `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` — khối Custom fields trong drawer.

---

# PHASE 1 — Inline edit trên bảng

## Task 1.1: Component `EditableCustomCell`

**Context:** Đây là lõi tái dùng cho cả bảng CS/enrollment lẫn drawer. Nhận `column` (type + options cho dropdown), giá trị hiện tại, danh sách người (cho person), `canEdit`, và callback `onSave(next)`. Hiển thị giá trị read-only; bấm vào → vào chế độ sửa với control đúng kiểu; blur/Enter/đổi → gọi `onSave`. Parent chịu trách nhiệm map `onSave(next)` → `patch { custom_values: { [key]: next } }`. Dùng control native (input/select/checkbox) cho chắc & tự chứa; có thể nâng cấp sang picker anchored-menu sau.

**Files:** Create `src/app/(authed)/_shared/EditableCustomCell.tsx`

- [x] **Step 1: Implement**
```tsx
"use client";

import { useState } from "react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { formatCustomValue } from "@/lib/table-config/values";

type Person = { email: string; name: string | null };

export function EditableCustomCell({
  column,
  value,
  options,
  people,
  optionLabelById,
  personLabelByEmail,
  canEdit,
  onSave,
  className = "",
}: {
  column: Pick<TableColumn, "type" | "key" | "label">;
  value: unknown;
  options?: readonly TableColumnOption[];
  people?: readonly Person[];
  optionLabelById?: ReadonlyMap<string, string>;
  personLabelByEmail?: ReadonlyMap<string, string>;
  canEdit: boolean;
  onSave: (next: unknown) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const display = formatCustomValue(column.type, value, {
    optionLabelById,
    personLabelByEmail,
  });

  // checkbox: no edit-mode, toggle directly
  if (column.type === "checkbox") {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => onSave(!value)}
        aria-label={column.label}
        className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
          value ? "border-[#00875a] bg-[#00875a] text-white" : "border-[#c1c7d0] bg-white text-transparent"
        } ${className}`}
      >
        ✓
      </button>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => setEditing(true)}
        className={`min-w-0 truncate rounded px-1.5 py-1 text-left text-xs font-semibold text-[#42526e] hover:bg-[#f4f5f7] disabled:hover:bg-transparent ${className}`}
        title={display || column.label}
      >
        {display || <span className="text-[#97a0af]">—</span>}
      </button>
    );
  }

  const commit = (next: unknown) => {
    onSave(next);
    setEditing(false);
  };
  const inputClass =
    "h-8 w-full rounded border border-[#dfe1e6] px-2 text-xs font-semibold text-[#172b4d] outline-none focus:border-[#0c66e4]";

  if (column.type === "dropdown") {
    return (
      <select
        autoFocus
        defaultValue={value == null ? "" : String(value)}
        onBlur={() => setEditing(false)}
        onChange={(e) => commit(e.target.value || null)}
        className={inputClass}
      >
        <option value="">—</option>
        {(options ?? []).map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    );
  }

  if (column.type === "person") {
    return (
      <select
        autoFocus
        defaultValue={value == null ? "" : String(value)}
        onBlur={() => setEditing(false)}
        onChange={(e) => commit(e.target.value || null)}
        className={inputClass}
      >
        <option value="">—</option>
        {(people ?? []).map((p) => (
          <option key={p.email} value={p.email}>{p.name?.trim() || p.email}</option>
        ))}
      </select>
    );
  }

  const inputType =
    column.type === "number" ? "number" : column.type === "date" ? "date" : column.type === "link" ? "url" : "text";
  return (
    <input
      autoFocus
      type={inputType}
      defaultValue={value == null ? "" : String(value)}
      onBlur={(e) => commit(normalizeInput(column.type, e.target.value))}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setEditing(false);
      }}
      className={inputClass}
    />
  );
}

function normalizeInput(type: string, raw: string): unknown {
  const v = raw.trim();
  if (v === "") return null;
  if (type === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}
```

- [x] **Step 2: Typecheck** — Run: `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 3: Commit**
```bash
git add "src/app/(authed)/_shared/EditableCustomCell.tsx"
git commit -m "feat(custom-values): reusable EditableCustomCell editor"
```

## Task 1.2: Cắm inline edit vào bảng CS (`TaskRowItem`)

**Context:** Thay `CustomTaskValueCell` (read-only, :855) bằng `EditableCustomCell`. Row đã có `onPatch(task.id, patch)` và có sẵn `labelByEmail`, `optionById`, `options`, `assignees/agents` (danh sách người) trong props — truyền xuống. Quyền sửa dùng `canEditContent` đã có trong row.

**Files:** Modify `src/app/(authed)/tasks/_components/TaskRowItem.tsx`

- [x] **Step 1:** Ở chỗ render custom column (:838), đổi sang:
```tsx
<EditableCustomCell
  key={column.key}
  column={configColumn}
  value={task.custom_values?.[configColumn.key]}
  options={customOptionsByColumnId.get(configColumn.id) ?? []}
  people={assignees}
  optionLabelById={/* map option.id->label from customOptionById */}
  personLabelByEmail={personLabelByEmail}
  canEdit={canEditContent}
  onSave={(next) =>
    onPatch(task.id, { custom_values: { [configColumn.key]: next } })
  }
  className={`${LIST_COL.custom} ${pinnedCellClass(column.key)}`}
/>
```
Giữ `style={columnStyle(column.key)}` ở wrapper cell như cũ (bọc `EditableCustomCell` trong `<span style=... className=...>` nếu cần offset sticky/order).
- [x] **Step 2:** Xoá `CustomTaskValueCell` cũ nếu không còn chỗ dùng (grep trước).
- [ ] **Step 3: Verify** — `npx tsc --noEmit` + mở `/tasks` view List: bấm ô custom (mọi kiểu) → sửa được, reload thấy lưu; ô read-only khi `!canEditContent`.
- [ ] **Step 4: Commit**
```bash
git add "src/app/(authed)/tasks/_components/TaskRowItem.tsx"
git commit -m "feat(custom-values): inline-edit custom cells in CS task list"
```

## Task 1.3: Cắm inline edit vào bảng ACA/Medicare (`EnrollmentClient`)

**Context:** Y hệt 1.2 cho enrollment. `EnrollmentCustomValueCell` (:1778) read-only → thay bằng `EditableCustomCell`. Row/table có `onPatch`/`patchRecord`, `peopleByEmail`, `optionById`, `customOptionsByColumnId`. Quyền: enrollment cho phép sửa (giống cách Stage/Assignee đang sửa inline qua `patchRecord`).

**Files:** Modify `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

- [x] **Step 1:** Tại chỗ render `EnrollmentCustomValueCell` (:1746), đổi sang `EditableCustomCell` với `onSave={(next) => onPatch(record.id, { custom_values: { [configColumn.key]: next } })}` (dùng `patchRecord` mà row đang có), truyền `options`/`people`/label maps tương ứng.
- [x] **Step 2:** Xoá `EnrollmentCustomValueCell` nếu hết dùng.
- [ ] **Step 3: Verify** — `/enrollment` (ACA + Medicare): sửa inline ô custom mọi kiểu, lưu OK.
- [ ] **Step 4: Commit**
```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "feat(custom-values): inline-edit custom cells in enrollment table"
```

---

# PHASE 2 — Toggle "Hiện trong Task detail" + sửa trong drawer

## Task 2.1: Schema — thêm `show_in_detail`

**Context:** Cần 1 cờ per-cột đánh dấu cột nào hiện trong drawer chi tiết. Thêm vào `table_column`, default false (cột hiện có không tự nhảy vào drawer).

**Files:** Modify `supabase/schema.sql`

- [x] **Step 1:** Trong/near định nghĩa `table_column`, thêm:
```sql
alter table table_column
  add column if not exists show_in_detail boolean not null default false;
```
- [ ] **Step 2: User áp schema.sql** rồi verify `\d table_column` có cột `show_in_detail`.
- [ ] **Step 3: Commit**
```bash
git add supabase/schema.sql
git commit -m "feat(custom-values): table_column.show_in_detail flag"
```

## Task 2.2: Types + edit-permission + query select

**Context:** Đồng bộ field mới xuyên type + query + luật sửa.

**Files:** Modify `src/lib/table-config/types.ts`, `columns.ts`, `queries.ts`

- [x] **Step 1:** `types.ts` — thêm `show_in_detail: boolean;` vào `TableColumn`.
- [x] **Step 2:** `columns.ts` — `EditableColumnField` thêm `"show_in_detail"`; `canEditColumnField` cho phép nó ở cả cột system lẫn custom (thêm vào nhánh `SYSTEM_EDITABLE`/điều kiện). Cập nhật test `columns.test.ts` (thêm case `show_in_detail` → true cho system).
- [x] **Step 3:** `queries.ts` — thêm `show_in_detail` vào `TABLE_COLUMN_SELECT` và vào helper `col(...)` + `DEFAULT_TABLE_COLUMNS` (default false; các default không cần hiện detail).
- [x] **Step 4: Verify** — `npx tsc --noEmit` + `npx vitest run src/lib/table-config`.
- [ ] **Step 5: Commit**
```bash
git add src/lib/table-config/types.ts src/lib/table-config/columns.ts src/lib/table-config/columns.test.ts src/lib/table-config/queries.ts
git commit -m "feat(custom-values): thread show_in_detail through types/query/edit-rules"
```

## Task 2.3: API columns nhận `show_in_detail`

**Context:** POST tạo cột + PATCH sửa cột phải chấp nhận field mới. Không như `pinned`/`hidden_default`, đổi `show_in_detail` **không cần** reset layout user (không ảnh hưởng bố cục bảng) — nên không gọi `resetTableLayoutsForScope`.

**Files:** Modify `src/app/api/config/columns/route.ts`, `[id]/route.ts`

- [x] **Step 1:** `route.ts` POST — thêm `show_in_detail: Boolean(body?.show_in_detail)` vào insert + vào chuỗi `.select(...)`.
- [x] **Step 2:** `[id]/route.ts` PATCH — thêm nhánh:
```ts
if ("show_in_detail" in body) {
  if (!canEditColumnField(column, "show_in_detail")) {
    return NextResponse.json({ error: "..." }, { status: 400 });
  }
  patch.show_in_detail = Boolean(body.show_in_detail);
}
```
Thêm `show_in_detail` vào `.select(...)`. **Không** thêm vào điều kiện reset-layout.
- [ ] **Step 3: Verify** — PATCH thử `{ show_in_detail: true }` cho 1 cột → 200, DB cập nhật; layout user KHÔNG bị xoá.
- [ ] **Step 4: Commit**
```bash
git add "src/app/api/config/columns/route.ts" "src/app/api/config/columns/[id]/route.ts"
git commit -m "feat(custom-values): columns API accepts show_in_detail"
```

## Task 2.4: Toggle "In detail" trong Config Table UI

**Context:** Thêm 1 cột toggle cạnh Pinned/Hidden trong `ConfigClient`, mirror y hệt cách 2 toggle đó làm (checkbox → `onPatch({ show_in_detail })`).

**Files:** Modify `src/app/(authed)/config/_components/ConfigClient.tsx`

- [x] **Step 1:** Cập nhật grid header + template cột: thêm cột "In detail" (đổi `grid-cols-[...]` thêm 1 track, cả header row lẫn `SortableColumnRow`/`StaticColumnRow`).
- [x] **Step 2:** Trong mỗi row thêm:
```tsx
<label className="inline-flex items-center gap-2 text-sm font-semibold text-[#44546f]">
  <input
    type="checkbox"
    checked={column.show_in_detail}
    onChange={(e) => onPatch({ show_in_detail: e.target.checked })}
  />
  In detail
</label>
```
`onPatch` ở đây là hàm đã bọc `run()` (Phase config trước) — thông báo "Column updated." (không phải "for everyone" vì không reset layout).
- [ ] **Step 3: Verify** — tick "In detail" cho 1 cột custom → lưu OK, hiện đúng khi reload.
- [ ] **Step 4: Commit**
```bash
git add "src/app/(authed)/config/_components/ConfigClient.tsx"
git commit -m "feat(custom-values): In-detail toggle in Config Table"
```

## Task 2.5: Khối "Custom fields" trong Task detail drawer (CS)

**Context:** Render các cột custom `show_in_detail=true` của scope `cs` trong `TaskDetailDrawer`, sửa được bằng `EditableCustomCell` (tái dùng), lưu qua `onPatch({ custom_values: {...} })` mà drawer đã có. Drawer cần biết danh sách cột + options + people → truyền từ `TaskBoardClient` (đã có `tableColumns`, `tableColumnOptions`, assignees).

**Files:** Modify `src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx` (+ truyền props từ `TaskBoardClient.tsx`)

- [x] **Step 1:** Truyền vào drawer: `detailColumns = tableColumns.filter(c => c.show_in_detail && !c.is_system && !c.archived_at)`, `tableColumnOptions`, `assignees`.
- [x] **Step 2:** Trong drawer thêm section:
```tsx
{detailColumns.length > 0 ? (
  <div className="space-y-2">
    <p className={LABEL_CLASS}>Custom fields</p>
    {detailColumns.map((col) => (
      <div key={col.key} className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-[#44546f]">{col.label}</span>
        <div className="w-1/2">
          <EditableCustomCell
            column={col}
            value={task.custom_values?.[col.key]}
            options={optionsByColumnId.get(col.id) ?? []}
            people={assignees}
            canEdit={canEdit}
            onSave={(next) => void onPatch({ custom_values: { [col.key]: next } })}
          />
        </div>
      </div>
    ))}
  </div>
) : null}
```
- [ ] **Step 3: Verify** — tick "In detail" cho 1 cột → mở 1 task → thấy field đó trong drawer, sửa lưu OK, phản ánh lên bảng.
- [ ] **Step 4: Commit**
```bash
git add "src/app/(authed)/tasks/_components/TaskDetailDrawer.tsx" "src/app/(authed)/tasks/_components/TaskBoardClient.tsx"
git commit -m "feat(custom-values): custom fields in task detail drawer"
```

## Task 2.6: Khối "Custom fields" trong drawer enrollment

**Context:** Y hệt 2.5 cho drawer chi tiết enrollment (render inline ở `EnrollmentClient.tsx:843`). Lọc cột theo scope hiện tại (`program`), `show_in_detail`, custom, chưa archive; sửa qua `patchRecord`.

**Files:** Modify `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`

- [x] **Step 1:** Trong drawer (openRecord), thêm section Custom fields dùng `EditableCustomCell` + `onSave={(next) => patchRecord(openRecord.id, { custom_values: { [col.key]: next } })}`.
- [ ] **Step 2: Verify** — ACA + Medicare: tick In detail → mở record → sửa custom field trong drawer OK.
- [ ] **Step 3: Commit**
```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "feat(custom-values): custom fields in enrollment detail drawer"
```

---

## Self-Review (checklist đã chạy)

**Spec coverage:** inline edit mọi kiểu trên bảng CS + ACA + Medicare (1.1–1.3) ✓; backend PATCH đã sẵn (Background) ✓; toggle "In detail" per-cột lưu DB (2.1–2.4) ✓; render + sửa custom field trong 2 drawer (2.5–2.6) ✓; tái dùng `EditableCustomCell` ở cả bảng lẫn drawer ✓.

**Placeholder scan:** `EditableCustomCell` có code đầy đủ 7 kiểu + `normalizeInput`; các task cắm/config mô tả điểm sửa cụ thể (số dòng thật, mẫu onPatch có sẵn) thay vì "follow pattern".

**Type consistency:** `EditableCustomCell` props (`column/value/options/people/onSave`), `show_in_detail` xuyên suốt types→columns→queries→API→UI, `custom_values` patch shape `{ [key]: value }` đồng nhất.

**Câu hỏi mở (chốt khi execute):** (a) dropdown/person đang dùng `<select>` native cho chắc — có muốn nâng lên picker anchored-menu (badge màu, search) như cột hệ thống không, làm sau; (b) validate phía client trước khi PATCH (hiện dựa `cleanCustomValues`/`coerceCustomValue` ở server) — có cần chặn sớm ở `EditableCustomCell` không.
```
