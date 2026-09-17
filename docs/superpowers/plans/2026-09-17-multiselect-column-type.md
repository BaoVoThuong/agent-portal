# Kiểu cột Multi dropdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans. Các bước dùng checkbox (`- [ ]`).

**Goal:** Thêm kiểu cột **`multiselect`** (Multi dropdown) vào hệ table-config dùng chung, rồi áp cho hai cột **ACA plans** và **Medicare plans** của Provider List: bấm ô là ra danh sách hãng, tick được nhiều hãng, hiện thành chip như trong Google Sheet.

**Architecture:** Một kiểu cột mới đi xuyên suốt sáu lớp đang rẽ nhánh theo `ColumnType`: CHECK trong database → RPC ghi giá trị → API cấu hình → hàm kiểm/ép/định dạng thuần → ô sửa dùng chung → màn `/config`. Trình chọn **không phải dựng mới**: `SearchableListboxPanel` đã có sẵn `multi` và `selectedValues`.

Hai chỗ lưu khác nhau, cố ý:
- **Cột tuỳ chỉnh** (mọi scope): lưu **mảng id** trong `custom_values`, đúng khuôn `dropdown` đang dùng.
- **Hai cột provider**: lưu **chuỗi nhãn ngăn cách bằng dấu phẩy** ngay trong cột text `obamacare` / `medicare` — vì luồng sync đêm ghi thẳng vào hai cột đó dạng `"Oscar HMO, Ambetter EPO, UHC"`. Đổi chỗ lưu là hôm sau sync ghi đè lại thành chuỗi và tính năng vỡ.

**Tech Stack:** Next.js 16.2.4, React 19, TypeScript 5.9.3, Supabase (PostgREST + PL/pgSQL), vitest 2.1.9, Tailwind v4.

## Global Constraints

- **Thư mục làm việc:** `/Users/vothuongbao/Project/Web/agent-portal`.
- **Node 22:** mọi lệnh npm/npx chạy sau `export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"`.
- **Nhánh:** làm tiếp trên `provider-list` (đang có 12 commit chưa push). **KHÔNG push, KHÔNG merge.**
- **Test:** vitest `environment: "node"`, `include: ["src/**/*.test.ts"]`. **`.tsx` KHÔNG được thu thập.**
- **Kiểm tra trước mỗi commit:** `npm run typecheck`, `npm run lint`, test của task đó. Task cuối chạy `npm run test:run` và `npm run build` (build trong worktree riêng nếu dev server đang chạy).
- **SQL** ở `supabase/rollouts/`, idempotent, **người dùng tự chạy**. Task có SQL phải DỪNG chờ xác nhận.
- **Changelog bắt buộc**, mới nhất trên cùng.
- **Ngôn ngữ:** comment giải thích *tại sao* viết tiếng Việt; chuỗi hiển thị viết **tiếng Anh**.
- **Commit:** mỗi task một commit, kết thúc bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Chưa chạy rollout Provider List** (`2026-09-16-provider-list.sql`) thì màn Provider List còn lỗi; plan này thêm rollout thứ hai, chạy sau rollout đó.

---

## Quyết định đã chốt

| Vấn đề | Chốt | Vì sao |
| --- | --- | --- |
| Kiểu mới tên gì | `multiselect`, nhãn UI **Multi dropdown** | Khớp cách người dùng gọi. |
| Cột tuỳ chỉnh lưu gì | Mảng **id** trong `custom_values` | Cùng khuôn `dropdown`: đổi nhãn không làm hỏng dữ liệu cũ. |
| Hai cột provider lưu gì | **Chuỗi nhãn, ngăn bằng dấu phẩy**, ngay trong cột text cũ | Sync đêm ghi đúng định dạng đó. Đây là ràng buộc cứng, không thương lượng được. |
| Giá trị Sheet mang về mà không có trong danh sách | **Vẫn hiện**, đánh dấu là ngoài danh sách | Im lặng nuốt mất dữ liệu thật là tệ hơn nhiều so với một chip lạ. |
| Ai quản danh sách hãng | `/config` → Dropdown Values | Hai cột này là **cột hệ thống**, mà bốn chốt chặn hiện cấm cột hệ thống có giá trị → nới bằng **danh sách cho phép tường minh**, theo đúng tiền lệ `FIXED_VALUE_SET_COLUMN_KEYS` của Leads. |
| Có đổi `is_system` của hai cột thành false không | **Không** | Cột không-hệ-thống lưu vào `custom_values`; hai cột này phải ở lại cột text thật để sync ghi vào. |

### Sự thật đã đối chiếu (source + production 17/09/2026)

1. **Sáu lớp rẽ nhánh theo `ColumnType`:** `COLUMN_TYPES` (`types.ts:10`), `isValueValidForType` (`custom-values.ts:38`), nhánh kiểm option (`custom-values.ts:96`), `coerceCustomValue` + `formatCustomValue` + `normalizedValueEquals` (`values.ts`), `EditableCustomCell` (`isChoiceField`, dòng 66), `ConfigClient` (`COLUMN_TYPE_LABEL:151`, lọc tab Dropdown Values `:1585`).
2. **Bốn chốt chặn cấm giá trị trên cột hệ thống**, cùng một luật:
   - `schema.sql:4236` — RPC tạo giá trị: `if column_row.type <> 'dropdown' or column_row.is_system ... raise 'CUSTOM_DROPDOWN_REQUIRED'`
   - `schema.sql:4464` — `table_column_option_usage_count`: `and not is_system and type = 'dropdown'`
   - `src/app/api/config/columns/[id]/options/route.ts:50`
   - `src/app/api/config/columns/[id]/options/[optionId]/route.ts:23` và `:83`
3. **`table_column.type` có CHECK** liệt kê 7 kiểu (`schema.sql:3879`).
4. **`SearchableListboxPanel` đã hỗ trợ chọn nhiều**: props `multi`, `selectedValues`, `onSelect` bắn từng giá trị một (bên gọi tự bật/tắt trong tập).
5. **`normalizedValueEquals` so bằng `===`** → với mảng luôn khác nhau, nên mọi lần mở menu rồi đóng sẽ ghi một lần vô ích nếu không sửa.
6. **`isRequiredValueFilled` đã xử lý mảng** (`required.ts:18`: `Array.isArray → length > 0`) — không phải sửa.
7. **Dữ liệu production:** ACA **17 hãng** (BCBS Advantage 86 dòng, UHC 75, Ambetter EPO 68…), Medicare **14 hãng** (CHC D-SNP 147, Healthspring/Cigna 30…), **113 dòng đang có nhiều hãng trong một ô**. `other_plans` vẫn 0/889 dòng.

### Ngoài phạm vi

- Không đụng `dropdown` một-giá-trị đang chạy ở Task, Leads, Enrollment.
- Không đổi `other_plans` sang multiselect (chưa có dữ liệu nào).
- Không làm bộ lọc theo hãng ở thanh toolbar trong plan này — ghi vào mục "để sau".

---

## File Structure

| File | Trạng thái | Trách nhiệm |
| --- | --- | --- |
| `src/lib/table-config/types.ts` | Sửa | Thêm `"multiselect"` vào `COLUMN_TYPES` |
| `src/lib/table-config/multiselect.ts` | **Tạo** | Hàm thuần: tách/ghép chuỗi nhãn, chuẩn hoá mảng id, bật/tắt một giá trị |
| `src/lib/table-config/custom-values.ts` | Sửa | Nhận mảng, kiểm từng phần tử là option id hợp lệ |
| `src/lib/table-config/values.ts` | Sửa | `coerceCustomValue`, `formatCustomValue`, `normalizedValueEquals` cho mảng |
| `src/lib/table-config/system-option-columns.ts` | **Tạo** | Danh sách cho phép: cột hệ thống nào được quản lý giá trị |
| `supabase/rollouts/2026-09-17-multiselect-column-type.sql` | **Tạo** | CHECK `type`, nới 2 RPC, seed 31 hãng |
| `src/app/api/config/columns/[id]/options/route.ts` · `[optionId]/route.ts` | Sửa | Nới chốt chặn theo danh sách cho phép |
| `src/app/(authed)/config/_components/ConfigClient.tsx` | Sửa | Nhãn kiểu, tab Dropdown Values nhận multiselect + cột hệ thống trong danh sách |
| `src/app/(authed)/_shared/EditableCustomCell.tsx` | Sửa | Ô sửa chọn-nhiều, hiện chip |
| `src/lib/providers/plans.ts` | **Tạo** | Chuỗi ↔ mảng nhãn cho hai cột provider, giữ giá trị lạ |
| `src/lib/providers/patch.ts` · `create.ts` | Sửa | Nhận mảng cho 2 cột, ghi xuống chuỗi |
| `src/app/(authed)/automation/provider-list/_components/ProviderTable.tsx` | Sửa | Ô ACA/Medicare dùng trình chọn nhiều |
| `src/lib/table-config/queries.ts` | Sửa | Hai cột provider đổi type sang `multiselect` |

---

### Task 1: Kiểu `multiselect` và luật thuần

**Files:**
- Create: `src/lib/table-config/multiselect.ts`, `src/lib/table-config/multiselect.test.ts`
- Modify: `src/lib/table-config/types.ts` (`COLUMN_TYPES` ~L10), `src/lib/table-config/custom-values.ts` (`isValueValidForType` ~L38, nhánh option ~L96), `src/lib/table-config/values.ts` (`normalizedValueEquals` ~L40, `coerceCustomValue` ~L52, `formatCustomValue` ~L148)
- Test: `src/lib/table-config/values.test.ts`, `src/lib/table-config/custom-values.test.ts`

**Interfaces:**
- Produces: `parseMultiselectValue(raw: unknown): string[]`, `toggleMultiselectValue(current: readonly string[], value: string): string[]`, `multiselectEquals(a: unknown, b: unknown): boolean`

- [ ] **Step 1: Viết test hỏng cho module thuần**

Tạo `src/lib/table-config/multiselect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  multiselectEquals,
  parseMultiselectValue,
  toggleMultiselectValue,
} from "./multiselect";

describe("parseMultiselectValue", () => {
  it("nhận mảng, bỏ phần tử rỗng và trùng, giữ nguyên thứ tự", () => {
    expect(parseMultiselectValue(["a", "", "b", "a", "  "])).toEqual(["a", "b"]);
  });

  it("nhận chuỗi ngăn bằng dấu phẩy hoặc xuống dòng — đúng dạng Google Sheet ghi", () => {
    expect(parseMultiselectValue("Oscar HMO, Ambetter EPO\nUHC")).toEqual([
      "Oscar HMO",
      "Ambetter EPO",
      "UHC",
    ]);
  });

  it("rỗng, null, kiểu lạ đều ra mảng rỗng", () => {
    expect(parseMultiselectValue(null)).toEqual([]);
    expect(parseMultiselectValue("")).toEqual([]);
    expect(parseMultiselectValue(42)).toEqual([]);
  });
});

describe("toggleMultiselectValue", () => {
  it("bật rồi tắt một giá trị", () => {
    const on = toggleMultiselectValue(["a"], "b");
    expect(on).toEqual(["a", "b"]);
    expect(toggleMultiselectValue(on, "a")).toEqual(["b"]);
  });

  it("không sửa mảng gốc", () => {
    const current = ["a"];
    toggleMultiselectValue(current, "b");
    expect(current).toEqual(["a"]);
  });
});

describe("multiselectEquals", () => {
  // normalizedValueEquals so bằng ===, nên mảng luôn "khác nhau" và mỗi lần mở
  // menu rồi đóng sẽ ghi một lần vô ích.
  it("hai mảng cùng nội dung là bằng nhau", () => {
    expect(multiselectEquals(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("khác thứ tự là khác — thứ tự chính là thứ tự người dùng thấy", () => {
    expect(multiselectEquals(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("null và mảng rỗng là một", () => {
    expect(multiselectEquals(null, [])).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx vitest run src/lib/table-config/multiselect.test.ts`
Expected: FAIL — `Failed to resolve import "./multiselect"`.

- [ ] **Step 3: Viết `multiselect.ts`**

```ts
/**
 * Luật cho kiểu cột `multiselect`.
 *
 * Hai chỗ lưu khác nhau dùng chung những hàm này:
 *   • cột tuỳ chỉnh  → mảng **id** trong `custom_values`;
 *   • hai cột provider → chuỗi **nhãn** ngăn bằng dấu phẩy trong cột text,
 *     vì luồng sync đêm ghi đúng định dạng đó.
 * Vì vậy `parseMultiselectValue` nhận cả mảng lẫn chuỗi.
 */

const SEPARATOR = /[,\n]/;

export function parseMultiselectValue(raw: unknown): string[] {
  const parts =
    Array.isArray(raw)
      ? raw
      : typeof raw === "string"
        ? raw.split(SEPARATOR)
        : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (typeof part !== "string") continue;
    const value = part.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Ghép lại đúng dạng Google Sheet đang dùng. */
export function serializeMultiselectValue(values: readonly string[]): string | null {
  const parsed = parseMultiselectValue(values);
  return parsed.length > 0 ? parsed.join(", ") : null;
}

export function toggleMultiselectValue(
  current: readonly string[],
  value: string
): string[] {
  const parsed = parseMultiselectValue(current);
  return parsed.includes(value)
    ? parsed.filter((candidate) => candidate !== value)
    : [...parsed, value];
}

/**
 * So sánh theo NỘI DUNG. `normalizedValueEquals` so bằng `===`, mà hai mảng
 * cùng nội dung không bao giờ `===` nhau — không có hàm này thì mỗi lần mở menu
 * rồi đóng lại là một lượt ghi vô ích.
 *
 * Thứ tự có nghĩa: đó là thứ tự chip người dùng nhìn thấy.
 */
export function multiselectEquals(a: unknown, b: unknown): boolean {
  const left = parseMultiselectValue(a);
  const right = parseMultiselectValue(b);
  return left.length === right.length && left.every((value, i) => value === right[i]);
}
```

- [ ] **Step 4: Chạy test, xác nhận qua**

Run: `npx vitest run src/lib/table-config/multiselect.test.ts`
Expected: PASS.

- [ ] **Step 5: Mở kiểu mới trong `types.ts`**

```ts
export const COLUMN_TYPES = [
  "text",
  "number",
  "dropdown",
  // Chọn nhiều giá trị từ cùng một danh sách. Xem lib/table-config/multiselect.ts
  // để biết hai chỗ lưu (mảng id trong custom_values, hoặc chuỗi nhãn ở cột text).
  "multiselect",
  "date",
  "checkbox",
  "link",
  "person",
] as const;
```

- [ ] **Step 6: Kiểm giá trị — `custom-values.ts`**

Trong `isValueValidForType`, thêm nhánh trước `default`:

```ts
    case "multiselect":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
```

Thay nhánh kiểm option (đang chỉ xét `dropdown`):

```ts
    if (value !== null && column.type === "dropdown") {
      const optionIds = optionsByColumn.get(column.id);
      if (!optionIds?.has(value as string)) {
        issues.push({ key, label: column.label, reason: "invalid-option" });
        continue;
      }
    }
    if (value !== null && column.type === "multiselect") {
      const optionIds = optionsByColumn.get(column.id);
      // MỌI phần tử phải là một option còn sống. Bỏ qua phần tử lạ ở đây thì
      // một id đã archive sẽ nằm lại trong dữ liệu mà không màn nào hiện được.
      const invalid = (value as string[]).some((item) => !optionIds?.has(item));
      if (invalid) {
        issues.push({ key, label: column.label, reason: "invalid-option" });
        continue;
      }
    }
```

- [ ] **Step 7: Ép và định dạng — `values.ts`**

Đầu file thêm `import { multiselectEquals, parseMultiselectValue } from "./multiselect";`

`normalizedValueEquals`, chèn ngay sau nhánh `person`:

```ts
  if (type === "multiselect") return multiselectEquals(current, next);
```

`coerceCustomValue`, thêm nhánh:

```ts
    case "multiselect": {
      const parsed = parseMultiselectValue(raw);
      const ids = parsed.map(
        (item) => ctx.optionIdByLabel?.get(item.toLowerCase()) ?? item
      );
      if (ctx.optionIds && ids.some((id) => !ctx.optionIds!.has(id))) {
        return { ok: false, error: "Select valid options." };
      }
      return { ok: true, value: ids };
    }
```

`formatCustomValue`, thêm nhánh:

```ts
    case "multiselect": {
      const parsed = parseMultiselectValue(value);
      return parsed
        .map((item) => ctx.optionLabelById?.get(item) ?? item)
        .join(", ");
    }
```

- [ ] **Step 8: Typecheck — TypeScript sẽ chỉ ra mọi `switch` còn thiếu nhánh**

Run: `npm run typecheck`
Expected: mọi `Record<ColumnType, …>` và `switch` exhaustive thiếu `multiselect` đều báo lỗi. Sửa hết; **đừng** thêm `default` để bịt miệng — chính tính exhaustive này là thứ chỉ ra sáu lớp cần đụng.

- [ ] **Step 9: Chạy test liên quan + lint, rồi commit**

```bash
npx vitest run src/lib/table-config && npm run lint
git add src/lib/table-config
git commit -m "feat(table-config): thêm kiểu cột multiselect và luật thuần của nó" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Rollout database

**Files:**
- Create: `supabase/rollouts/2026-09-17-multiselect-column-type.sql`
- Modify: `supabase/schema.sql` (CHECK `type` ~L3879, RPC tạo giá trị ~L4236, `table_column_option_usage_count` ~L4464)

- [ ] **Step 1: Viết rollout**

```sql
-- =====================================================================
-- Kiểu cột `multiselect` (Multi dropdown).
--
-- Bốn chốt chặn hiện cấm giá trị trên cột hệ thống và cấm mọi kiểu khác
-- 'dropdown'. Hai cột ACA plans / Medicare plans của Provider List LÀ cột hệ
-- thống (chúng lưu vào cột text thật để luồng sync ghi vào được), nên nới bằng
-- một DANH SÁCH CHO PHÉP tường minh: chỉ đúng hai cột đó, không phải mọi cột
-- hệ thống.
--
-- Idempotent. Chạy SAU 2026-09-16-provider-list.sql.
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

-- 1. Kiểu mới
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'table_column_type_check') then
    alter table public.table_column drop constraint table_column_type_check;
  end if;
  alter table public.table_column
    add constraint table_column_type_check
    check (type in ('text','number','dropdown','multiselect','date','checkbox','link','person'));
end $$;

-- 2. Cột hệ thống được phép có danh sách giá trị
create or replace function is_admin_managed_system_column(p_scope text, p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select (p_scope, p_key) in (('provider', 'obamacare'), ('provider', 'medicare'));
$$;

-- 3. RPC tạo giá trị: nhận thêm multiselect và cột hệ thống trong danh sách
--    (chép nguyên hàm hiện có, chỉ đổi đúng mệnh đề gác — xem schema.sql:4236)
--    …create or replace function create_table_column_option(...)…
--    Thay:
--      if column_row.type <> 'dropdown' or column_row.is_system or column_row.archived_at is not null then
--    Bằng:
--      if column_row.type not in ('dropdown', 'multiselect')
--        or (column_row.is_system
--            and not is_admin_managed_system_column(column_row.scope, column_row.key))
--        or column_row.archived_at is not null then

-- 4. table_column_option_usage_count: cùng một nới lỏng (schema.sql:4464)

-- 5. Seed 31 hãng lấy từ dữ liệu thật, chỉ chèn khi chưa có
--    ACA 17 hãng: BCBS Advantage, UHC, Ambetter EPO, Oscar HMO, Oscar EPO,
--      BCBS MyBlue Health, Ambetter HMO, CHC Premier, CHC Select, Wellpoint,
--      Molina, Cigna, Imperial, UHC Sanitas, Christus, BSW, UHC Kelsey Seybold
--    Medicare 14 hãng: CHC D-SNP, Healthspring/Cigna, Aetna, Humana, UHC,
--      Wellcare, BCBS, Molina, Verda, CHC Dualcare, Devoted, Wellmed,
--      All Medicare Plans, Wellpoint
--    Nhãn phải TRÙNG TỪNG KÝ TỰ với dữ liệu trong cột text, nếu không chip đang
--    có sẽ thành "ngoài danh sách".

-- Kiểm chứng: cả bốn cột phải ra 'ok'
select
  case when (select count(*) from pg_constraint
             where conname = 'table_column_type_check'
               and pg_get_constraintdef(oid) like '%multiselect%') = 1
       then 'ok' else 'FAIL: CHECK chưa nhận multiselect' end as kieu_moi,
  case when is_admin_managed_system_column('provider','obamacare')
        and not is_admin_managed_system_column('cs','status')
       then 'ok' else 'FAIL: danh sách cho phép sai' end      as danh_sach,
  case when (select count(*) from table_column_option o
             join table_column c on c.id = o.column_id
             where c.scope = 'provider' and c.key = 'obamacare'
               and o.archived_at is null) >= 17
       then 'ok' else 'FAIL: thiếu hãng ACA' end              as seed_aca,
  case when (select count(*) from table_column_option o
             join table_column c on c.id = o.column_id
             where c.scope = 'provider' and c.key = 'medicare'
               and o.archived_at is null) >= 14
       then 'ok' else 'FAIL: thiếu hãng Medicare' end         as seed_medicare;
```

Viết đầy đủ thân hai RPC trong file thật — chép nguyên bản hiện có trong `schema.sql` rồi đổi đúng mệnh đề gác, **không** rút gọn như phần ghi chú ở trên.

- [ ] **Step 2: Cập nhật `schema.sql` cho khớp** (CHECK, hai RPC, thêm `is_admin_managed_system_column`).

- [ ] **Step 3: DỪNG, chờ người dùng chạy SQL.** Kỳ vọng 4 cột `ok`. Seed cần hai cột provider đã tồn tại trong `table_column`, tức trang Provider List phải được mở ít nhất một lần sau rollout trước (`ensureTableColumns` chèn defaults).

- [ ] **Step 4: Commit**

---

### Task 3: Mở đường cấu hình cho cột hệ thống trong danh sách

**Files:**
- Create: `src/lib/table-config/system-option-columns.ts` + test
- Modify: `src/app/api/config/columns/[id]/options/route.ts` (~L50), `.../[optionId]/route.ts` (~L23, ~L83), `src/app/(authed)/config/_components/ConfigClient.tsx` (`COLUMN_TYPE_LABEL` ~L151, lọc tab ~L1585)

- [ ] **Step 1: Test hỏng cho danh sách cho phép**

```ts
import { describe, expect, it } from "vitest";
import { canManageColumnOptions } from "./system-option-columns";

describe("canManageColumnOptions", () => {
  it("cột tuỳ chỉnh kiểu chọn thì quản lý được", () => {
    for (const type of ["dropdown", "multiselect"] as const) {
      expect(canManageColumnOptions({ scope: "cs", key: "x", type, is_system: false })).toBe(true);
    }
  });

  it("cột hệ thống chỉ mở cho ĐÚNG hai cột plan của provider", () => {
    expect(canManageColumnOptions({ scope: "provider", key: "obamacare", type: "multiselect", is_system: true })).toBe(true);
    expect(canManageColumnOptions({ scope: "provider", key: "city", type: "text", is_system: true })).toBe(false);
    // Status của CS cũng là dropdown hệ thống, nhưng giá trị nằm trong enum TS.
    expect(canManageColumnOptions({ scope: "cs", key: "status", type: "dropdown", is_system: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Viết module, giữ MỘT nguồn sự thật**

```ts
/**
 * Cột hệ thống được phép có danh sách giá trị do admin quản.
 *
 * Phải khớp TỪNG DÒNG với `is_admin_managed_system_column` trong database —
 * database là chốt chặn cuối, cái này chỉ để màn hình không mời một việc mà
 * server sẽ từ chối.
 */
const ADMIN_MANAGED_SYSTEM_COLUMNS = new Set(["provider:obamacare", "provider:medicare"]);

export function canManageColumnOptions(column: {
  scope: string;
  key: string;
  type: string;
  is_system: boolean;
}): boolean {
  if (column.type !== "dropdown" && column.type !== "multiselect") return false;
  if (!column.is_system) return true;
  return ADMIN_MANAGED_SYSTEM_COLUMNS.has(`${column.scope}:${column.key}`);
}
```

- [ ] **Step 3: Thay ba chốt chặn trong API** bằng `canManageColumnOptions(column)`, giữ nguyên thông điệp lỗi.

- [ ] **Step 4: `/config`** — `COLUMN_TYPE_LABEL` thêm `multiselect: "Multi dropdown"`; đổi `customDropdownColumns` (dòng 1585) sang lọc bằng `canManageColumnOptions`.

- [ ] **Step 5: Test + typecheck + lint + commit.**

---

### Task 4: Ô sửa chọn nhiều

**Files:** Modify `src/app/(authed)/_shared/EditableCustomCell.tsx`

- [ ] **Step 1:** `isChoiceField` nhận thêm `multiselect`.
- [ ] **Step 2:** Khi `column.type === "multiselect"`: truyền `multi` và `selectedValues={parseMultiselectValue(value)}` cho `SearchableListboxPanel`; `onSelect` gọi `toggleMultiselectValue` rồi `commit(next)`; **menu không đóng** sau mỗi lần tick — tick nhiều hãng là việc chính ở đây.
- [ ] **Step 3:** Nút hiện **chip** cho từng giá trị, màu lấy từ `tableColumnOptionBadgePalette` như `dropdown`; quá 3 chip thì hiện `+N`. Giá trị không khớp option nào vẫn hiện, viền xám, `title="Not in the list"` — dữ liệu Sheet mang về phải nhìn thấy được.
- [ ] **Step 4:** Kiểm tay trên dev ở một cột tuỳ chỉnh multiselect của Task hoặc Leads, rồi commit.

---

### Task 5: Áp cho ACA plans và Medicare plans

**Files:**
- Create: `src/lib/providers/plans.ts` + test
- Modify: `src/lib/table-config/queries.ts` (hai cột provider), `src/lib/providers/patch.ts`, `src/lib/providers/create.ts`, `ProviderTable.tsx`

**Interfaces:** `PROVIDER_PLAN_FIELDS = ["obamacare", "medicare"]`, `parsePlanCell(raw)`, `serializePlanCell(values)`

- [ ] **Step 1: Test hỏng** — mảng ↔ chuỗi, giữ giá trị lạ, ô rỗng thành `null`, không nhân đôi khi lưu lại.
- [ ] **Step 2:** `plans.ts` bọc `parseMultiselectValue`/`serializeMultiselectValue` cho hai cột này (lưu **nhãn**, không phải id).
- [ ] **Step 3:** `queries.ts` — hai cột đổi `"text"` → `"multiselect"`.
- [ ] **Step 4:** `patch.ts` — nhận mảng cho hai khoá đó, ghi xuống `serializePlanCell`; vẫn nhận chuỗi để không vỡ đường cũ.
- [ ] **Step 5:** `ProviderTable.tsx` — hai cột này dùng `EditableCustomCell` với `options` của chính cột đó, `value` là `parsePlanCell(row[key])`, `onSave` gửi mảng.
- [ ] **Step 6: Kiểm tay** — tick 3 hãng, tải lại trang phải còn đủ 3; mở Google Sheet đối chiếu định dạng chuỗi; sửa một dòng **Manual** thì không có cảnh báo, sửa dòng **Sheet** thì vẫn cảnh báo bị ghi đè.
- [ ] **Step 7:** Test + typecheck + lint + commit.

---

### Task 6: Changelog và kiểm tra cuối

- [ ] Changelog: kiểu cột mới, hai chỗ lưu và lý do, danh sách cho phép cho cột hệ thống, rollout phải chạy, và phần để sau (bộ lọc theo hãng trên toolbar, `other_plans`).
- [ ] `npm run typecheck && npm run lint && npm run test:run`, build trong worktree riêng nếu dev server đang chạy.
- [ ] Bàn giao: tên nhánh, danh sách commit, nhắc **hai** rollout phải chạy theo thứ tự.

---

## Rủi ro đã biết

| Rủi ro | Cách xử |
| --- | --- |
| Nhãn seed lệch một ký tự với dữ liệu Sheet | Chip thành "ngoài danh sách". Seed lấy trực tiếp từ truy vấn dữ liệu thật, không gõ tay. |
| Sync đêm ghi đè ô vừa sửa trên dòng từ Sheet | Đã có cảnh báo sẵn ở API; hết hẳn khi tắt sync. |
| Kiểu mới rơi về text ở một bảng chưa sửa | `switch` exhaustive trên `ColumnType` làm typecheck chỉ ra từng chỗ; **không** thêm `default`. |
| Cột hệ thống khác vô tình mở quản lý giá trị | Danh sách cho phép tường minh ở **cả** database lẫn TS, test khoá hai chiều. |
| Mảng luôn "khác" khiến ghi vô ích mỗi lần đóng menu | `multiselectEquals` nối vào `normalizedValueEquals`, có test. |
