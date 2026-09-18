# Provider List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans. Các bước dùng checkbox (`- [ ]`).

**Goal:** Một màn **Provider List** trong Automation Tool, dùng đúng lối bảng của Health CS List: cột cấu hình được ở `/config`, ẩn/ghim/đổi thứ tự/đổi độ rộng nhớ theo từng người, tìm kiếm, sắp xếp, sửa ô tại chỗ, và **Add address** như Add task — để portal dần thay chỗ luồng sync từ Google Sheet.

**Architecture:** Giữ nguyên bảng `provider_address` làm nơi lưu. Thêm cho nó khoá `id uuid`, `custom_values`, và cột kiểm toán. Dòng thêm tay mang **phân vùng nguồn riêng** (`source_sheet_id = 'portal'`, `source_gid = 'manual'`) nên lượt sync — vốn xoá theo đúng cặp (sheet, gid) rồi chèn lại — không thể chạm tới. Thêm scope `provider` vào hệ table-config sẵn có, và dựng màn hình theo khuôn **Leads** (bảng config-driven cho thực thể không phải task), không đụng `TaskRowItem` vốn dính chặt SLA/assignee/overdue.

**Tech Stack:** Next.js 16.2.4 (App Router), React 19, TypeScript 5.9.3, Supabase (PostgREST + PL/pgSQL), vitest 2.1.9, Tailwind v4.

## Global Constraints

- **Thư mục làm việc:** `/Users/vothuongbao/Project/Web/agent-portal`.
- **Node 22:** mọi lệnh npm/npx chạy sau `export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"`.
- **Nhánh:** `provider-list`, tách từ `main`. **KHÔNG push, KHÔNG merge** — người dùng review trước.
- **Test:** vitest `environment: "node"`, `include: ["src/**/*.test.ts"]`. **`.tsx` KHÔNG được thu thập** — luật nào cần test thì tách ra file `.ts` thuần.
- **Kiểm tra trước mỗi commit:** `npm run typecheck`, `npm run lint`, test của task đó. Task cuối chạy `npm run test:run` và `npm run build` (build trong worktree riêng nếu dev server đang chạy).
- **SQL:** đặt ở `supabase/rollouts/`, idempotent. **Người dùng tự chạy**; agent không chạy migration. Task 1 phải DỪNG chờ xác nhận đã chạy xong rồi mới làm tiếp.
- **Changelog bắt buộc:** thêm mục vào `changelog.md`, mới nhất trên cùng.
- **Ngôn ngữ:** comment giải thích *tại sao* viết tiếng Việt; chuỗi hiển thị cho người dùng cuối viết **tiếng Anh**.
- **Commit:** mỗi task một commit, kết thúc bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Quyết định đã chốt với người dùng (16/09/2026)

| Câu hỏi | Chốt | Hệ quả |
| --- | --- | --- |
| Lưu ở đâu | **Giữ `provider_address`** | Không dựng hệ bảng mới; bản nháp `2026-09-18-provider-directory-cleanup.md` (Doctor Directory; đã đổi tên và viết lại toàn bộ ngày 2026-09-18) **không** được thực hiện trong plan này. |
| Mục đích | **Để bỏ luồng sync từ Sheet** | Portal thành nguồn dữ liệu chính. Sync vẫn chạy song song cho tới khi người dùng tắt. |
| Chức năng | **Add address như Add task**, cộng sửa ô tại chỗ | Cần `custom_values`, cần khoá `id` ổn định. |
| UI | **Giống List của Health CS** | Cột cấu hình ở `/config`, layout theo từng người, tìm kiếm, sắp xếp. |
| Vị trí | `/automation/provider-list`, nhóm Automation Tool | Dùng lại quyền `automation.provider_finder`. |

### Sự thật kỹ thuật quyết định thiết kế (đã đối chiếu source + production)

1. **Sync xoá theo phân vùng.** `promote_sheet_sync_run` (`supabase/rollouts/2026-08-18-install-sheet-sync-staging.sql`) chạy
   `delete from public.provider_address where source_sheet_id = $1 and source_gid = $2` rồi chèn lại từ staging.
   → Dòng mang `source_sheet_id = 'portal'` **không nằm trong vùng bị xoá**, nên sống sót qua mọi lượt sync.
   → Ngược lại, **sửa một dòng đến từ Sheet sẽ bị ghi đè lúc 02:01 hôm sau**, cho tới khi tắt sync. Màn hình phải nói rõ điều này.
2. **`provider_address` chưa có khoá ổn định.** Chỉ có `unique (source_sheet_id, source_gid, source_row_number)`; `source_row_number` là **vị trí dòng trong Sheet**. Production: 889 dòng, **474 dòng trống NPI**, một NPI lặp **19 lần** → NPI không dùng làm khoá được. Vì vậy Task 1 thêm `id uuid`.
3. **Dữ liệu hiện thưa** (tỉ lệ có giá trị): doctors 51%, facility 46%, city 49%, state 51%, phone 49%, practices_as 38%, date 21%, verified_by 1%. Bảng sẽ trông trống ở nhiều cột — đó là dữ liệu thật, không phải lỗi hiển thị.
4. **Chỉ hai nơi đụng bảng này**: `promote_sheet_sync_run` (ghi) và `src/lib/provider-finder/search.ts` (đọc, phân trang 889 dòng). Provider Finder **không** đổi trong plan này; nó vẫn đọc cùng bảng nên tự thấy dòng thêm tay.

### Ngoài phạm vi plan này

- Tắt luồng sync (người dùng quyết thời điểm; là một dòng cấu hình ở job datasync, không phải code trong repo này).
- Chuẩn hoá bác sĩ/cơ sở/mạng lưới bảo hiểm (bản nháp Doctor Directory).
- Đổi Provider Finder sang dữ liệu mới, gộp dòng trùng, geocode.
- Xoá dòng vĩnh viễn: plan này chỉ **archive**.

---

## Bối cảnh: khuôn mẫu phải bám theo (đã đối chiếu source)

**Leads là thực thể không-phải-task đã chạy đúng khuôn này.** Bám sát nó:

- Trang server `src/app/(authed)/tasks/leads/page.tsx` — gác quyền, `fetchTableColumnsWithOptions("lead", supabase)`, rồi truyền cột + tuỳ chọn + dữ liệu vào client.
- `LeadsClient.tsx:470` đọc layout: `fetch("/api/config/layout?scope=lead")` → `resolveLayout(columns, layout)`; `:925` lưu lại bằng `serializeLayout(...)` + `PUT /api/config/layout`.
- `LeadTable.tsx` render bảng từ `columns: TableColumn[]` + `columnOptions: TableColumnOption[]`, sửa ô gọi `onPatchLead(id, patch)`.
- API `src/app/api/leads/route.ts` — `GET` trả `{ leads, total, truncated }`; `POST` phân tích đầu vào bằng `parseCreateLeadInput` (`src/lib/leads/create.ts`), kiểm bắt buộc bằng `findMissingRequiredFields("lead", …)` rồi `insert`.
- API `src/app/api/leads/[id]/route.ts:43` — `PATCH` dựng patch bằng `buildLeadPatch` (`src/lib/leads/patch.ts`), trong đó `custom_values` phải là object.

**Đường ống table-config cần đụng khi thêm một scope** (bốn nơi trong code, hai nơi trong database):

| Nơi | Việc |
| --- | --- |
| `src/lib/table-config/types.ts:1` | Thêm `"provider"` vào `TABLE_SCOPES`. |
| `src/lib/table-config/queries.ts:11` | Thêm khối `provider:` vào `DEFAULT_TABLE_COLUMNS`. |
| `src/lib/table-config/scope-access.ts` | Ai được cấu hình scope này. |
| `src/lib/table-config/access.ts:65,79` | `loadConfigAdminForScope` / `loadConfigActorForScope` phải biết scope mới. |
| `src/app/(authed)/config/_components/ConfigClient.tsx:130` | `SCOPE_LABEL` — nhãn hiện trong dropdown. |
| DB `is_table_scope()` (`supabase/schema.sql:3895`) | Thêm `'provider'`, nếu không `reorder_table_columns_atomic` và `table_config_write_context` ném lỗi. |
| DB `table_column.scope` CHECK (`supabase/schema.sql:3858`) | Thêm `'provider'`, nếu không không thêm được cột nào. |

---

## File Structure

| File | Trạng thái | Trách nhiệm |
| --- | --- | --- |
| `supabase/rollouts/2026-09-16-provider-list.sql` | **Tạo** | Cột mới cho `provider_address`, scope `provider`, index |
| `src/lib/providers/types.ts` | **Tạo** | `ProviderRow`, hằng phân vùng `portal/manual` |
| `src/lib/providers/create.ts` | **Tạo** | Phân tích đầu vào Add address (thuần) |
| `src/lib/providers/patch.ts` | **Tạo** | Dựng patch cho sửa ô (thuần) |
| `src/lib/providers/search.ts` | **Tạo** | Lọc + sắp xếp danh sách trong bộ nhớ (thuần) |
| `src/lib/table-config/types.ts` · `queries.ts` · `scope-access.ts` · `access.ts` | Sửa | Scope `provider` |
| `src/app/api/automation/provider-list/route.ts` | **Tạo** | `GET` danh sách, `POST` thêm |
| `src/app/api/automation/provider-list/[id]/route.ts` | **Tạo** | `PATCH` sửa ô, archive |
| `src/app/(authed)/automation/provider-list/page.tsx` | **Tạo** | Trang server: gác quyền, nạp cột + dữ liệu |
| `src/app/(authed)/automation/provider-list/_components/ProviderListClient.tsx` | **Tạo** | Layout, tìm kiếm, sắp xếp, gọi API |
| `src/app/(authed)/automation/provider-list/_components/ProviderTable.tsx` | **Tạo** | Bảng config-driven, sửa ô tại chỗ |
| `src/app/(authed)/automation/provider-list/_components/AddProviderDialog.tsx` | **Tạo** | Hộp thoại Add address |
| `src/lib/rbac/routes.ts` · `src/app/(authed)/_components/Sidebar.tsx` | Sửa | Đăng ký route + mục sidebar |
| `src/app/(authed)/config/_components/ConfigClient.tsx` · `src/app/(authed)/config/page.tsx` | Sửa | Nhãn scope + cho phép cấu hình |
| `changelog.md` | Sửa | Mục mới |

Test: `create.test.ts`, `patch.test.ts`, `search.test.ts` (thư mục `src/lib/providers/`), và mở rộng `src/lib/table-config/*.test.ts`.

---

### Task 1: Rollout database

**Files:**
- Create: `supabase/rollouts/2026-09-16-provider-list.sql`
- Modify: `supabase/schema.sql` (bảng `provider_address` ~L526, `is_table_scope` ~L3895, `table_column.scope` CHECK ~L3858)

**Interfaces:**
- Produces: `provider_address.id uuid`, `.custom_values jsonb`, `.created_by_email`, `.updated_by_email`, `.updated_at`, `.archived_at`; `is_table_scope('provider') = true`; `'provider'` nằm trong CHECK của **cả hai** bảng `table_column` và `user_table_layout`.

> **Bẫy:** `user_table_layout.scope` có CHECK cùng danh sách với `table_column.scope`. Quên bảng thứ hai thì màn hình hiện ra bình thường nhưng mọi lần đổi độ rộng / ẩn / kéo thứ tự cột đều bị database từ chối — đúng tính năng "nhớ layout theo từng người" mà màn hình hứa.

- [ ] **Step 1: Tạo nhánh**

```bash
cd /Users/vothuongbao/Project/Web/agent-portal
git switch main && git switch -c provider-list
```

- [ ] **Step 2: Viết rollout**

Tạo `supabase/rollouts/2026-09-16-provider-list.sql`:

```sql
-- =====================================================================
-- Provider List: thêm khoá ổn định + cột tuỳ chỉnh cho provider_address,
-- và mở scope `provider` cho hệ table-config.
--
-- Vì sao an toàn với luồng sync: promote_sheet_sync_run xoá theo ĐÚNG cặp
-- (source_sheet_id, source_gid) rồi chèn lại. Dòng thêm tay mang
-- ('portal', 'manual') không nằm trong vùng đó nên không bị xoá. Dòng đến từ
-- Sheet vẫn bị thay mới mỗi đêm — id của chúng vì thế đổi theo, và mọi chỉnh
-- sửa tay trên dòng Sheet sẽ mất cho tới khi luồng sync được tắt.
--
-- Idempotent. Chạy TRƯỚC khi deploy code.
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

alter table provider_address
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists custom_values jsonb not null default '{}'::jsonb,
  add column if not exists created_by_email text,
  add column if not exists updated_by_email text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz;

-- Khoá tra cứu của API. KHÔNG dùng primary key: sync chèn lại toàn bộ phân vùng
-- Sheet mỗi đêm, một unique index thường đủ và không ràng buộc thêm gì vào
-- đường ghi của sync.
create unique index if not exists provider_address_id_idx on provider_address (id);

-- Danh sách luôn lọc dòng đã archive rồi sắp theo thời gian cập nhật.
create index if not exists provider_address_active_idx
  on provider_address (archived_at, updated_at desc);

-- Scope mới cho hệ table-config.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'table_column_scope_check'
      and conrelid = 'public.table_column'::regclass
  ) then
    alter table public.table_column drop constraint table_column_scope_check;
  end if;

  alter table public.table_column
    add constraint table_column_scope_check
    check (scope in ('cs','aca','medicare','medicaid','lead_pc','lead_health','lead','provider'));
end $$;

-- `reorder_table_columns_atomic` và `table_config_write_context` đều gác bằng
-- hàm này; quên nó là kéo đổi thứ tự cột báo "Invalid column order" mà không ai
-- hiểu vì sao.
create or replace function is_table_scope(p_scope text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_scope in ('cs', 'aca', 'medicare', 'medicaid', 'lead', 'provider');
$$;

-- ---------------------------------------------------------------------
-- Kiểm chứng — cả bốn cột phải ra 'ok'.
-- ---------------------------------------------------------------------
select
  case when (select count(*) from information_schema.columns
             where table_schema = 'public' and table_name = 'provider_address'
               and column_name in ('id','custom_values','archived_at','updated_at',
                                   'created_by_email','updated_by_email')) = 6
       then 'ok' else 'FAIL: thiếu cột' end                        as cot_moi,
  case when is_table_scope('provider') then 'ok' else 'FAIL: scope chưa mở' end as scope_provider,
  case when (select count(*) from pg_indexes
             where schemaname = 'public' and indexname = 'provider_address_id_idx') = 1
       then 'ok' else 'FAIL: thiếu index id' end                   as index_id,
  case when (select count(*) from provider_address where id is null) = 0
       then 'ok' else 'FAIL: còn dòng thiếu id' end                as moi_dong_co_id;

-- Số dòng hiện có, để đối chiếu với màn hình sau khi deploy.
select count(*) as tong_dong, count(*) filter (where archived_at is null) as dang_hien
from provider_address;
```

- [ ] **Step 3: Cập nhật `supabase/schema.sql` cho khớp**

Trong định nghĩa `create table if not exists provider_address (` (~L526), thêm trước dòng `unique (...)`:

```sql
  id uuid not null default gen_random_uuid(),
  custom_values jsonb not null default '{}'::jsonb,
  created_by_email text,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
```

Ngay dưới `create index if not exists provider_address_npi_idx …` thêm:

```sql
create unique index if not exists provider_address_id_idx on provider_address (id);

create index if not exists provider_address_active_idx
  on provider_address (archived_at, updated_at desc);
```

Sửa CHECK của `table_column` (~L3858) và thân `is_table_scope` (~L3901) thành đúng hai danh sách trong rollout.

- [ ] **Step 4: DỪNG, chờ người dùng chạy SQL**

Báo người dùng chạy `supabase/rollouts/2026-09-16-provider-list.sql` rồi `notify pgrst, 'reload schema';`. Kỳ vọng 4 cột `ok`. **Không làm tiếp khi chưa có xác nhận** — mọi task sau đều đọc/ghi các cột này.

- [ ] **Step 5: Commit**

```bash
git add supabase/rollouts/2026-09-16-provider-list.sql supabase/schema.sql
git commit -m "feat(providers): rollout khoá id, custom_values và scope provider cho provider_address" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Scope `provider` trong hệ table-config

**Files:**
- Modify: `src/lib/table-config/types.ts` (L1-8), `src/lib/table-config/queries.ts` (`DEFAULT_TABLE_COLUMNS`), `src/lib/table-config/scope-access.ts`, `src/lib/table-config/access.ts`, `src/app/(authed)/config/_components/ConfigClient.tsx` (L130), `src/app/(authed)/config/page.tsx`
- Test: `src/lib/table-config/scope-access.test.ts`, `src/lib/table-config/types.test.ts`

**Interfaces:**
- Produces: `TableScope` có thêm `"provider"`; `configScopesFor({ …, isProviderManager })`.

- [ ] **Step 1: Viết test hỏng cho scope-access**

Thêm vào `src/lib/table-config/scope-access.test.ts`:

```ts
it("người quản provider chỉ cấu hình được bảng provider", () => {
  expect(
    configScopesFor({ isTaskAdmin: false, isLeadManager: false, isProviderManager: true })
  ).toEqual(["provider"]);
});

it("không cấp chéo: quản lead không mở được bảng provider", () => {
  expect(
    configScopesFor({ isTaskAdmin: false, isLeadManager: true, isProviderManager: false })
  ).toEqual(["lead"]);
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx vitest run src/lib/table-config/scope-access.test.ts`
Expected: FAIL — `isProviderManager` chưa tồn tại, kết quả thiếu `"provider"`.

- [ ] **Step 3: Mở scope**

`src/lib/table-config/types.ts`:

```ts
export const TABLE_SCOPES = [
  "cs",
  "aca",
  "medicare",
  "medicaid",
  "lead",
  "provider",
] as const;
```

`src/lib/table-config/scope-access.ts` — thêm hằng và nhánh:

```ts
const PROVIDER_SCOPES: readonly TableScope[] = ["provider"];

export function configScopesFor(input: {
  isTaskAdmin: boolean;
  isLeadManager: boolean;
  isProviderManager: boolean;
}): TableScope[] {
  const scopes: TableScope[] = [];
  if (input.isTaskAdmin) scopes.push(...TASK_SCOPES);
  if (input.isLeadManager) scopes.push(...LEAD_SCOPES);
  // Bảng provider do quyền Automation quản: người dùng Provider List phải tự
  // thêm/sửa cột của mình, y như người quản lead làm với bảng lead.
  if (input.isProviderManager) scopes.push(...PROVIDER_SCOPES);
  return scopes;
}
```

`src/lib/table-config/access.ts` — thêm cổng gác cho scope mới, ngay trên `loadConfigAdminForScope`:

```ts
async function loadProviderConfigGate(): Promise<ScopeGateResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Unauthorized", status: 401 };
  if (!can(session.user.permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
    return { ok: false, error: "Forbidden", status: 403 };
  }
  return { ok: true, actor: { email } };
}
```

và hai hàm cuối file:

```ts
export async function loadConfigAdminForScope(scope: TableScope): Promise<ScopeGateResult> {
  if (scope === "lead") return loadLeadConfigGate("manage");
  if (scope === "provider") return loadProviderConfigGate();
  return loadConfigAdmin();
}

export async function loadConfigActorForScope(scope: TableScope): Promise<ScopeGateResult> {
  if (scope === "lead") return loadLeadConfigGate("work");
  if (scope === "provider") return loadProviderConfigGate();
  return loadConfigActor();
}
```

Thêm import: `import { can } from "@/lib/rbac/client";` và `import { PERMISSIONS } from "@/lib/rbac/permissions";` — đúng hai dòng mà `src/app/api/automation/provider-finder/search/route.ts` đang dùng. `can` nằm ở `rbac/client`, **không** phải `rbac/access`.

- [ ] **Step 4: Cột mặc định cho scope provider**

Trong `src/lib/table-config/queries.ts`, thêm khối vào `DEFAULT_TABLE_COLUMNS` theo đúng dạng các khối có sẵn (`col(scope, key, label, type, position, hidden_default?, is_system?)` — đọc lại chữ ký `col()` ở đầu file trước khi gõ). Khoá phải trùng tên cột trong `provider_address`:

```ts
  provider: [
    col("provider", "doctors", "Doctor", "text", 10, false, true),
    col("provider", "facility", "Facility", "text", 20, false, true),
    col("provider", "npi", "NPI", "text", 30, false, true),
    col("provider", "practices_as", "Specialty", "text", 40, false, true),
    col("provider", "phone", "Phone", "text", 50, false, true),
    col("provider", "street", "Street", "text", 60, false, true),
    col("provider", "city", "City", "text", 70, false, true),
    col("provider", "state", "State", "text", 80, false, true),
    col("provider", "zip_code", "ZIP", "text", 90, false, true),
    col("provider", "accepting_new_patients", "Accepting new patients", "text", 100, false, true),
    col("provider", "business_hours", "Business hours", "text", 110, true, true),
    col("provider", "obamacare", "ACA plans", "text", 120, true, true),
    col("provider", "medicare", "Medicare plans", "text", 130, true, true),
    col("provider", "other_plans", "Other plans", "text", 140, true, true),
    col("provider", "verified_by", "Verified by", "text", 150, true, true),
    col("provider", "date", "Verified date", "text", 160, true, true),
    col("provider", "source", "Source", "text", 170, false, true),
  ],
```

`source` là cột hệ thống chỉ đọc, hiển thị `Sheet` hay `Manual` — người dùng cần phân biệt dòng nào sẽ bị sync ghi đè.

- [ ] **Step 5: Nhãn scope + trang /config**

`ConfigClient.tsx` (L130):

```ts
const SCOPE_LABEL: Record<TableScope, string> = {
  cs: "Health Customer Service",
  aca: "Health ACA Enrollment",
  medicare: "Health Medicare Enrollment",
  medicaid: "Health Medicaid Enrollment",
  lead: "Event Leads",
  provider: "Provider List",
};
```

`src/app/(authed)/config/page.tsx` (~L70-80) — tính cờ mới rồi truyền vào:

```ts
  const isProviderManager = can(
    session?.user?.permissions,
    PERMISSIONS.AUTOMATION_PROVIDER_FINDER
  );
  const scopes = configScopesFor({ isTaskAdmin: admin.ok, isLeadManager, isProviderManager });
```

Rà tiếp trong file: `needsTaskData` đang là `scopes.some((scope) => scope !== "lead")` — sửa thành `scopes.some((scope) => scope !== "lead" && scope !== "provider")`, nếu không mở `/config` bằng tài khoản chỉ có quyền Automation sẽ kéo cả dữ liệu Health mà nó không có quyền đọc.

- [ ] **Step 6: Chạy test + typecheck**

Run: `npm run typecheck && npx vitest run src/lib/table-config`
Expected: PASS. TypeScript sẽ chỉ ra mọi `Record<TableScope, …>` còn thiếu khoá `provider` — sửa hết trước khi đi tiếp.

- [ ] **Step 7: Commit**

```bash
git add src/lib/table-config "src/app/(authed)/config"
git commit -m "feat(providers): mở scope provider cho hệ table-config" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Luật thuần cho dòng provider

**Files:**
- Create: `src/lib/providers/types.ts`, `src/lib/providers/create.ts`, `src/lib/providers/patch.ts`, `src/lib/providers/search.ts`
- Test: `src/lib/providers/create.test.ts`, `src/lib/providers/patch.test.ts`, `src/lib/providers/search.test.ts`

**Interfaces:**
- Produces:
  - `PORTAL_SOURCE = { sheetId: "portal", gid: "manual" }`
  - `type ProviderRow`
  - `parseCreateProviderInput(body: unknown): { ok: true; value: CreateProviderInput } | { ok: false; error: string }`
  - `buildProviderRow(input: CreateProviderInput, ctx: { actorEmail: string; nextRowNumber: number }): Record<string, unknown>`
  - `buildProviderPatch(body: unknown): { ok: true; patch: Record<string, unknown>; customValues: Record<string, unknown> | null } | { ok: false; error: string }`
  - `filterProviders(rows, query): ProviderRow[]`, `sortProviders(rows, key, dir): ProviderRow[]`

- [ ] **Step 1: Viết test hỏng cho create**

Tạo `src/lib/providers/create.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildProviderRow, parseCreateProviderInput } from "@/lib/providers/create";
import { PORTAL_SOURCE } from "@/lib/providers/types";

describe("parseCreateProviderInput", () => {
  it("đòi ít nhất tên bác sĩ hoặc tên cơ sở", () => {
    expect(parseCreateProviderInput({ city: "Houston" })).toEqual({
      ok: false,
      error: "Doctor or facility is required.",
    });
  });

  it("cắt khoảng trắng và giữ các trường địa chỉ", () => {
    const parsed = parseCreateProviderInput({
      doctors: "  Hoang Anh Phan  ",
      facility: "",
      city: " Houston ",
      state: "tx",
      zip_code: "77036",
      phone: "(713) 555-0123",
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        doctors: "Hoang Anh Phan",
        facility: null,
        city: "Houston",
        state: "TX",
        zip_code: "77036",
        phone: "(713) 555-0123",
      },
    });
  });

  it("từ chối custom_values không phải object", () => {
    expect(
      parseCreateProviderInput({ doctors: "A", custom_values: [1, 2] })
    ).toEqual({ ok: false, error: "custom_values must be an object." });
  });
});

describe("buildProviderRow", () => {
  // Đây là điều giữ cho dòng thêm tay sống sót: sync chỉ xoá đúng phân vùng
  // (source_sheet_id, source_gid) của Sheet.
  it("ghi dòng vào phân vùng riêng của portal, không phải phân vùng Sheet", () => {
    const row = buildProviderRow(
      { doctors: "A", facility: null, npi: null, practices_as: null, phone: null,
        street: null, city: null, state: null, zip_code: null,
        accepting_new_patients: null, business_hours: null,
        obamacare: null, medicare: null, other_plans: null,
        verified_by: null, date: null, customValues: {} },
      { actorEmail: "bao@x.com", nextRowNumber: 5 }
    );
    expect(row).toMatchObject({
      source_sheet_id: PORTAL_SOURCE.sheetId,
      source_gid: PORTAL_SOURCE.gid,
      source_row_number: 5,
      doctors: "A",
      created_by_email: "bao@x.com",
      updated_by_email: "bao@x.com",
    });
    expect(typeof row.source_row_hash).toBe("string");
    expect(row.raw_row).toEqual({});
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận hỏng**

Run: `npx vitest run src/lib/providers/create.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/providers/create"`.

- [ ] **Step 3: Viết `types.ts` và `create.ts`**

`src/lib/providers/types.ts`:

```ts
/**
 * Phân vùng nguồn của dòng thêm tay trong portal.
 *
 * `promote_sheet_sync_run` xoá theo ĐÚNG cặp (source_sheet_id, source_gid) của
 * Sheet rồi chèn lại. Dòng mang cặp này không nằm trong vùng bị xoá, nên không
 * lượt sync nào chạm tới được — đó là toàn bộ lý do nó tồn tại.
 */
export const PORTAL_SOURCE = { sheetId: "portal", gid: "manual" } as const;

/** Các cột văn bản của provider mà màn hình đọc/ghi. Trùng tên cột database. */
export const PROVIDER_TEXT_FIELDS = [
  "doctors",
  "facility",
  "npi",
  "practices_as",
  "phone",
  "street",
  "city",
  "state",
  "zip_code",
  "accepting_new_patients",
  "business_hours",
  "obamacare",
  "medicare",
  "other_plans",
  "verified_by",
  "date",
] as const;

export type ProviderTextField = (typeof PROVIDER_TEXT_FIELDS)[number];

export type ProviderRow = {
  id: string;
  source_sheet_id: string;
  source_gid: string;
  source_row_number: number;
  custom_values: Record<string, unknown>;
  created_by_email: string | null;
  updated_by_email: string | null;
  updated_at: string;
  archived_at: string | null;
} & Record<ProviderTextField, string | null>;

/** Dòng này do người dùng thêm trong portal hay do Sheet đẩy sang. */
export function isPortalRow(row: Pick<ProviderRow, "source_sheet_id">): boolean {
  return row.source_sheet_id === PORTAL_SOURCE.sheetId;
}
```

`src/lib/providers/create.ts`:

```ts
import { PORTAL_SOURCE, PROVIDER_TEXT_FIELDS, type ProviderTextField } from "./types";

const MAX_TEXT_LENGTH = 500;
const MAX_CUSTOM_FIELDS = 100;

export type CreateProviderInput = Record<ProviderTextField, string | null> & {
  customValues: Record<string, unknown>;
};

export type CreateProviderParseResult =
  | { ok: true; value: CreateProviderInput }
  | { ok: false; error: string };

function text(value: unknown, label: string): string | null | { error: string } {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return { error: `${label} must be text.` };
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_TEXT_LENGTH) return { error: `${label} is too long.` };
  return trimmed;
}

export function parseCreateProviderInput(body: unknown): CreateProviderParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body." };
  }
  const raw = body as Record<string, unknown>;
  const value = {} as CreateProviderInput;

  for (const field of PROVIDER_TEXT_FIELDS) {
    const parsed = text(raw[field], field);
    if (parsed && typeof parsed === "object") return { ok: false, error: parsed.error };
    value[field] = parsed;
  }
  // Bang viết hoa để bộ lọc và tìm kiếm không phải so chữ hoa/thường: dữ liệu
  // từ Sheet đang lẫn cả "TX" lẫn "tx".
  if (value.state) value.state = value.state.toUpperCase();

  // Một dòng không có cả tên bác sĩ lẫn tên cơ sở thì không ai tra cứu được.
  if (!value.doctors && !value.facility) {
    return { ok: false, error: "Doctor or facility is required." };
  }

  const customValues = raw.custom_values;
  if (customValues === undefined || customValues === null) {
    value.customValues = {};
  } else if (typeof customValues !== "object" || Array.isArray(customValues)) {
    return { ok: false, error: "custom_values must be an object." };
  } else {
    const entries = Object.entries(customValues as Record<string, unknown>);
    if (entries.length > MAX_CUSTOM_FIELDS) {
      return { ok: false, error: `At most ${MAX_CUSTOM_FIELDS} custom fields.` };
    }
    value.customValues = Object.fromEntries(entries);
  }

  return { ok: true, value };
}

export function buildProviderRow(
  input: CreateProviderInput,
  ctx: { actorEmail: string; nextRowNumber: number }
): Record<string, unknown> {
  const actor = ctx.actorEmail.trim().toLowerCase();
  const row: Record<string, unknown> = {
    source_sheet_id: PORTAL_SOURCE.sheetId,
    source_gid: PORTAL_SOURCE.gid,
    source_row_number: ctx.nextRowNumber,
    // Bảng đòi not null. Dòng thêm tay không đến từ một ô Sheet nào nên băm
    // theo chính nội dung vừa nhập, đủ để phân biệt và không bao giờ đụng hàng
    // với băm của sync.
    source_row_hash: `portal:${ctx.nextRowNumber}:${actor}`,
    raw_row: {},
    custom_values: input.customValues,
    created_by_email: actor,
    updated_by_email: actor,
  };
  for (const field of PROVIDER_TEXT_FIELDS) row[field] = input[field];
  return row;
}
```

- [ ] **Step 4: Chạy test, xác nhận qua**

Run: `npx vitest run src/lib/providers/create.test.ts`
Expected: PASS.

- [ ] **Step 5: Viết test hỏng cho patch và search**

Tạo `src/lib/providers/patch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildProviderPatch } from "@/lib/providers/patch";

describe("buildProviderPatch", () => {
  it("nhận các cột văn bản và cắt khoảng trắng", () => {
    expect(buildProviderPatch({ city: "  Katy  " })).toMatchObject({
      ok: true,
      patch: { city: "Katy" },
    });
  });

  it("ô để trống nghĩa là xoá giá trị, không phải bỏ qua", () => {
    expect(buildProviderPatch({ phone: "" })).toMatchObject({
      ok: true,
      patch: { phone: null },
    });
  });

  it("từ chối cột không nằm trong danh sách sửa được", () => {
    expect(buildProviderPatch({ source_sheet_id: "portal" })).toEqual({
      ok: false,
      error: "source_sheet_id cannot be edited here.",
    });
  });

  it("archive đi qua patch, và chỉ nhận true", () => {
    expect(buildProviderPatch({ archived: true }).ok).toBe(true);
    expect(buildProviderPatch({ archived: "yes" })).toEqual({
      ok: false,
      error: "archived must be true.",
    });
  });

  it("tách custom_values ra khỏi patch cột hệ thống", () => {
    const result = buildProviderPatch({ custom_values: { note: "abc" } });
    expect(result).toMatchObject({ ok: true, customValues: { note: "abc" } });
  });

  it("không nhận patch rỗng", () => {
    expect(buildProviderPatch({})).toEqual({ ok: false, error: "Nothing to update." });
  });
});
```

Tạo `src/lib/providers/search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterProviders, sortProviders } from "@/lib/providers/search";
import type { ProviderRow } from "@/lib/providers/types";

function row(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    id: "p1", source_sheet_id: "sheet", source_gid: "gid", source_row_number: 2,
    custom_values: {}, created_by_email: null, updated_by_email: null,
    updated_at: "2026-09-16T00:00:00.000Z", archived_at: null,
    doctors: "Hoang Anh Phan", facility: "Houston Methodist", npi: "1407020035",
    practices_as: "PCP - Adults", phone: "713-555-0123", street: "1 Main",
    city: "Houston", state: "TX", zip_code: "77036",
    accepting_new_patients: "Yes", business_hours: null,
    obamacare: null, medicare: null, other_plans: null,
    verified_by: null, date: null,
    ...overrides,
  };
}

describe("filterProviders", () => {
  it("tìm không phân biệt hoa thường trên mọi cột văn bản", () => {
    expect(filterProviders([row()], "methodist")).toHaveLength(1);
    expect(filterProviders([row()], "77036")).toHaveLength(1);
    expect(filterProviders([row()], "khong-co")).toHaveLength(0);
  });

  it("chuỗi rỗng trả về nguyên danh sách", () => {
    const rows = [row(), row({ id: "p2" })];
    expect(filterProviders(rows, "   ")).toBe(rows);
  });

  it("tìm được cả trong giá trị cột tuỳ chỉnh", () => {
    expect(filterProviders([row({ custom_values: { note: "Vietnamese" } })], "vietnam"))
      .toHaveLength(1);
  });
});

describe("sortProviders", () => {
  it("sắp theo cột văn bản, ô trống luôn xuống cuối bất kể chiều sắp", () => {
    const rows = [row({ id: "a", city: "Katy" }), row({ id: "b", city: null }), row({ id: "c", city: "Austin" })];
    expect(sortProviders(rows, "city", "asc").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(sortProviders(rows, "city", "desc").map((r) => r.id)).toEqual(["a", "c", "b"]);
  });
});
```

- [ ] **Step 6: Chạy hai test, xác nhận hỏng**

Run: `npx vitest run src/lib/providers`
Expected: FAIL — thiếu `patch.ts` và `search.ts`.

- [ ] **Step 7: Viết `patch.ts` và `search.ts`**

`src/lib/providers/patch.ts`:

```ts
import { PROVIDER_TEXT_FIELDS, type ProviderTextField } from "./types";

const MAX_TEXT_LENGTH = 500;

export type ProviderPatchResult =
  | { ok: true; patch: Record<string, unknown>; customValues: Record<string, unknown> | null }
  | { ok: false; error: string };

export function buildProviderPatch(body: unknown): ProviderPatchResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request body." };
  }
  const patch: Record<string, unknown> = {};
  let customValues: Record<string, unknown> | null = null;

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key === "custom_values") {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, error: "custom_values must be an object." };
      }
      customValues = value as Record<string, unknown>;
      continue;
    }
    if (key === "archived") {
      // Chỉ cho archive, không cho bỏ archive qua đường này: khôi phục một dòng
      // là việc hiếm và cần màn hình riêng, không nên lọt vào patch của ô.
      if (value !== true) return { ok: false, error: "archived must be true." };
      patch.archived_at = new Date().toISOString();
      continue;
    }
    if (!(PROVIDER_TEXT_FIELDS as readonly string[]).includes(key)) {
      return { ok: false, error: `${key} cannot be edited here.` };
    }
    if (value === null || value === "") {
      patch[key] = null;
      continue;
    }
    if (typeof value !== "string") return { ok: false, error: `${key} must be text.` };
    const trimmed = value.trim();
    if (trimmed.length > MAX_TEXT_LENGTH) return { ok: false, error: `${key} is too long.` };
    patch[key] = trimmed === "" ? null : key === "state" ? trimmed.toUpperCase() : trimmed;
  }

  if (Object.keys(patch).length === 0 && customValues === null) {
    return { ok: false, error: "Nothing to update." };
  }
  return { ok: true, patch, customValues };
}

export type EditableProviderField = ProviderTextField;
```

`src/lib/providers/search.ts`:

```ts
import { PROVIDER_TEXT_FIELDS, type ProviderRow } from "./types";

/**
 * Lọc và sắp xếp chạy trong bộ nhớ, không phải trong database.
 *
 * Production đang có 889 dòng và cả bảng được nạp một lần khi mở màn hình; đẩy
 * việc này xuống PostgREST chỉ thêm một vòng mạng cho mỗi lần gõ phím.
 */
export function filterProviders(rows: ProviderRow[], query: string): ProviderRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => {
    for (const field of PROVIDER_TEXT_FIELDS) {
      const value = row[field];
      if (value && value.toLowerCase().includes(needle)) return true;
    }
    for (const value of Object.values(row.custom_values ?? {})) {
      if (value != null && String(value).toLowerCase().includes(needle)) return true;
    }
    return false;
  });
}

export type ProviderSortDir = "asc" | "desc";

export function sortProviders(
  rows: ProviderRow[],
  key: string,
  dir: ProviderSortDir
): ProviderRow[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = readSortValue(a, key);
    const right = readSortValue(b, key);
    // Ô trống luôn xuống cuối ở CẢ hai chiều: đảo chiều sắp xếp để lôi một đống
    // ô trống lên đầu là thứ không ai muốn.
    if (!left && !right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left.localeCompare(right) * factor;
  });
}

function readSortValue(row: ProviderRow, key: string): string {
  if ((PROVIDER_TEXT_FIELDS as readonly string[]).includes(key)) {
    return (row[key as (typeof PROVIDER_TEXT_FIELDS)[number]] ?? "").toLowerCase();
  }
  const custom = row.custom_values?.[key];
  return custom == null ? "" : String(custom).toLowerCase();
}
```

- [ ] **Step 8: Chạy test, xác nhận qua**

Run: `npx vitest run src/lib/providers && npm run typecheck && npm run lint`
Expected: PASS, không lỗi.

- [ ] **Step 9: Commit**

```bash
git add src/lib/providers
git commit -m "feat(providers): luật thuần cho dòng provider — thêm, sửa, lọc, sắp xếp" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: API

**Files:**
- Create: `src/app/api/automation/provider-list/route.ts`, `src/app/api/automation/provider-list/[id]/route.ts`

**Interfaces:**
- Consumes: `parseCreateProviderInput`, `buildProviderRow`, `buildProviderPatch`, `PORTAL_SOURCE`, `findMissingRequiredFields` (`@/lib/table-config/required`), `buildWriteContext` (`@/lib/table-config/write-context` — đọc chữ ký thật trước khi gọi), `validateCustomValues` (`@/lib/table-config/custom-values`).
- Produces: `GET /api/automation/provider-list` → `{ providers: ProviderRow[] }`; `POST` → `{ provider }`; `PATCH /api/automation/provider-list/[id]` → `{ provider }`.

- [ ] **Step 1: Route danh sách + thêm**

Tạo `src/app/api/automation/provider-list/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/access";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildProviderRow, parseCreateProviderInput } from "@/lib/providers/create";
import { PORTAL_SOURCE } from "@/lib/providers/types";
import { findMissingRequiredFields } from "@/lib/table-config/required";

export const dynamic = "force-dynamic";

const PROVIDER_COLUMNS =
  "id,source_sheet_id,source_gid,source_row_number,doctors,facility,npi,practices_as," +
  "phone,street,city,state,zip_code,accepting_new_patients,business_hours," +
  "obamacare,medicare,other_plans,verified_by,date,custom_values," +
  "created_by_email,updated_by_email,updated_at,archived_at";

async function gate() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false as const, status: 401, error: "Unauthorized" };
  if (!can(session.user.permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }
  return { ok: true as const, email };
}

export async function GET() {
  const actor = await gate();
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });

  // 889 dòng: nạp hết một lần, lọc/sắp xếp ở trình duyệt. Thêm phân trang khi
  // bảng thật sự lớn, không phải trước đó.
  const { data, error } = await getSupabaseAdmin()
    .from("provider_address")
    .select(PROVIDER_COLUMNS)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ providers: data ?? [] });
}

export async function POST(request: Request) {
  const actor = await gate();
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });

  const parsed = parseCreateProviderInput(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = getSupabaseAdmin();
  const missing = await findMissingRequiredFields(
    "provider",
    { fieldValues: { ...parsed.value }, customValues: parsed.value.customValues },
    supabase
  );
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `${missing.map((field) => field.label).join(", ")} required.` },
      { status: 400 }
    );
  }

  // Số dòng kế tiếp TRONG phân vùng portal. Không dùng số của Sheet: hai phân
  // vùng độc lập, và unique key chỉ đòi duy nhất trong cùng phân vùng.
  const { data: last, error: lastError } = await supabase
    .from("provider_address")
    .select("source_row_number")
    .eq("source_sheet_id", PORTAL_SOURCE.sheetId)
    .eq("source_gid", PORTAL_SOURCE.gid)
    .order("source_row_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) return NextResponse.json({ error: lastError.message }, { status: 500 });

  const nextRowNumber = ((last as { source_row_number?: number } | null)?.source_row_number ?? 0) + 1;
  const { data: provider, error: insertError } = await supabase
    .from("provider_address")
    .insert(buildProviderRow(parsed.value, { actorEmail: actor.email, nextRowNumber }))
    .select(PROVIDER_COLUMNS)
    .single();
  if (insertError) {
    // 23505: hai người thêm cùng lúc và giành cùng một số dòng. Bảo người dùng
    // thử lại là đủ — lần sau số kế tiếp đã khác.
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "Someone added a row at the same time. Try again." }, { status: 409 });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }
  return NextResponse.json({ provider });
}

export { PROVIDER_COLUMNS };
```

- [ ] **Step 2: Route sửa ô**

Tạo `src/app/api/automation/provider-list/[id]/route.ts` — cùng cổng gác, dựng patch bằng `buildProviderPatch`, hợp nhất `custom_values` với giá trị đang có (patch từng khoá, không ghi đè cả object), rồi `update … .eq("id", id)` kèm `updated_at` và `updated_by_email`. Với `custom_values`, kiểm bằng `buildWriteContext({ scope: "provider", mode: "patch", … })` + `validateCustomValues` đúng như đường lead/task làm — **đọc chữ ký thật của hai hàm này trong `src/lib/table-config/write-context.ts` và `custom-values.ts` trước khi gõ**, đừng đoán.

Điểm bắt buộc: khi dòng đang sửa **không** thuộc phân vùng portal (`source_sheet_id !== "portal"`), phản hồi vẫn thành công nhưng kèm cảnh báo:

```ts
    warning: isPortalRow(current)
      ? undefined
      : "This row comes from the Google Sheet. The nightly sync will overwrite this edit until the sync is turned off.",
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/automation/provider-list
git commit -m "feat(providers): API danh sách, thêm và sửa provider" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Màn hình Provider List

**Files:**
- Create: `src/app/(authed)/automation/provider-list/page.tsx`, `_components/ProviderListClient.tsx`, `_components/ProviderTable.tsx`, `_components/AddProviderDialog.tsx`
- Modify: `src/lib/rbac/routes.ts`, `src/app/(authed)/_components/Sidebar.tsx`

**Interfaces:**
- Consumes: `fetchTableColumnsWithOptions("provider", supabase)`, `resolveLayout` / `serializeLayout` / `applyLayoutChange`, `formatCustomValue`, `filterProviders`, `sortProviders`.

- [ ] **Step 1: Trang server**

Tạo `page.tsx` theo đúng khuôn `src/app/(authed)/tasks/leads/page.tsx`:

```tsx
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTableColumnsWithOptions } from "@/lib/table-config/queries";
import { ProviderListClient } from "./_components/ProviderListClient";

export const dynamic = "force-dynamic";

export default async function ProviderListPage() {
  await requireAnyPermission([PERMISSIONS.AUTOMATION_PROVIDER_FINDER]);
  const supabase = getSupabaseAdmin();
  const [{ columns, options }, { data }] = await Promise.all([
    fetchTableColumnsWithOptions("provider", supabase),
    supabase
      .from("provider_address")
      .select(
        "id,source_sheet_id,source_gid,source_row_number,doctors,facility,npi,practices_as," +
          "phone,street,city,state,zip_code,accepting_new_patients,business_hours," +
          "obamacare,medicare,other_plans,verified_by,date,custom_values," +
          "created_by_email,updated_by_email,updated_at,archived_at"
      )
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(5000),
  ]);

  return (
    <ProviderListClient
      initialProviders={data ?? []}
      columns={columns}
      columnOptions={options}
    />
  );
}
```

- [ ] **Step 2: Client**

`ProviderListClient.tsx` giữ state và nối dây, bám sát `LeadsClient`:

- Nạp layout: `fetch("/api/config/layout?scope=provider")` → `resolveLayout(columns, layout)` (xem `LeadsClient.tsx:470-490`).
- Lưu layout khi đổi độ rộng/ẩn/đổi thứ tự: `serializeLayout` + `PUT /api/config/layout` với `{ scope: "provider", layout, expected_updated_at }` (xem `LeadsClient.tsx:925-940`).
- Ô tìm kiếm → `filterProviders`; bấm tiêu đề cột → `sortProviders`.
- Sửa ô: `PATCH /api/automation/provider-list/{id}` rồi vá đúng dòng trong state; lỗi thì trả ô về giá trị cũ và hiện thông báo.
- Nút **Add address** mở `AddProviderDialog`; thêm xong thì chèn dòng mới lên đầu danh sách.
- Hiện `warning` từ API dưới dạng thông báo nhẹ, không phải lỗi.
- Đầu trang: một dòng nói rõ có bao nhiêu dòng đến từ Sheet và bao nhiêu dòng thêm tay, kèm câu "Rows from the Google Sheet are replaced every night at 02:00 CT." — người dùng phải biết sửa gì sẽ mất trước khi sửa.

- [ ] **Step 3: Bảng**

`ProviderTable.tsx` — dựng theo `LeadTable.tsx`: header dính, cột theo `ResolvedColumn[]`, ô chỉ đọc dùng `formatCustomValue`, ô sửa được là input bật khi bấm. Cột hệ thống `source` hiện `Sheet` hoặc `Manual` dựa trên `isPortalRow(row)` và **không** sửa được.

- [ ] **Step 4: Hộp thoại Add**

`AddProviderDialog.tsx` — form các trường văn bản, cộng ô cho từng cột tuỳ chỉnh không bị archive, submit `POST /api/automation/provider-list`. Trường bắt buộc lấy từ `columns` (`column.required`), đúng luật `findMissingRequiredFields` server đang kiểm — nếu không người dùng sẽ bị server từ chối vì một ô mà form không hề đánh dấu.

- [ ] **Step 5: Sidebar + route registry**

`src/lib/rbac/routes.ts`, thêm ngay sau mục provider-finder:

```ts
  {
    href: "/automation/provider-list",
    permission: PERMISSIONS.AUTOMATION_PROVIDER_FINDER,
  },
```

`src/app/(authed)/_components/Sidebar.tsx`, trong `children` của nhóm Automation Tool, ngay sau Provider Finder:

```tsx
      {
        href: "/automation/provider-list",
        label: "Provider List",
        permission: PERMISSIONS.AUTOMATION_PROVIDER_FINDER,
      },
```

- [ ] **Step 6: Kiểm tra bằng tay trên dev**

Mở `/automation/provider-list`. Kỳ vọng: bảng hiện 889 dòng, tìm kiếm chạy, bấm tiêu đề cột sắp xếp được, đổi độ rộng rồi tải lại trang vẫn giữ nguyên, thêm một dòng mới thấy ngay với nhãn `Manual`.

- [ ] **Step 7: Typecheck, lint, commit**

```bash
npm run typecheck && npm run lint
git add "src/app/(authed)/automation/provider-list" src/lib/rbac/routes.ts "src/app/(authed)/_components/Sidebar.tsx"
git commit -m "feat(providers): màn Provider List với bảng cấu hình được và Add address" \
  -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Changelog và kiểm tra cuối

- [ ] **Step 1: Changelog**

Thêm mục mới lên đầu `changelog.md`: màn Provider List, scope `provider`, dòng thêm tay nằm ở phân vùng `portal/manual` nên sync không xoá được, dòng từ Sheet vẫn bị ghi đè cho tới khi tắt sync, rollout phải chạy, và những gì chưa làm (tắt sync, chuẩn hoá dữ liệu, Provider Finder chưa đổi).

- [ ] **Step 2: Kiểm tra đầy đủ**

```bash
npm run typecheck && npm run lint && npm run test:run
```

Build: nếu `lsof -nP -iTCP:3000 -sTCP:LISTEN` có kết quả thì build trong worktree tách riêng; nếu không thì `npm run build`.

- [ ] **Step 3: Commit và bàn giao**

Báo người dùng: tên nhánh, danh sách commit, kết quả kiểm tra, và nhắc rằng rollout ở Task 1 phải chạy trước khi deploy.

---

## Rủi ro đã biết

| Rủi ro | Cách xử |
| --- | --- |
| Sửa dòng đến từ Sheet bị ghi đè lúc 02:00 CT | Màn hình nói rõ, API trả `warning`. Hết hẳn khi tắt sync. |
| `id` của dòng Sheet đổi mỗi đêm | Không dùng `id` làm đường dẫn chia sẻ trong v1. Dòng thêm tay thì `id` ổn định. |
| Hai người thêm cùng lúc giành một `source_row_number` | Unique index chặn, API trả 409 kèm lời nhắn thử lại. |
| Người chỉ có quyền Automation mở `/config` | `needsTaskData` phải loại scope `provider`, nếu không trang kéo dữ liệu Health mà họ không có quyền. |
| Bản nháp Doctor Directory sau này chạy | Lớp dữ liệu sẽ phải làm lại; plan này cố ý chọn nhanh trước, đã ghi rõ ở phần phạm vi. |
