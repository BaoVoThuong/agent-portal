# Migration Report — Tái cấu trúc Agent Portal

> Kế hoạch gốc: `~/.claude/plans/snazzy-drifting-wadler.md` (Conservative / Structure-only).
> Nguyên tắc: KHÔNG đổi business logic, KHÔNG đổi output. Mỗi phase 1 lần + verify + report.

---

## Phase 0 — Lưới an toàn (test domain logic) ✅ HOÀN TẤT

**Ngày:** 2026-06-18
**Mục tiêu:** Dựng golden-master test cho các hàm thuần quan trọng TRƯỚC khi refactor, để mọi thay đổi cấu trúc sau này có thể kiểm chứng "behavior không đổi".

### Thay đổi (chỉ thêm mới, KHÔNG đụng code nguồn)

| Loại | File | Ghi chú |
|---|---|---|
| Thêm | `vitest.config.ts` | node env, alias `@`→`./src` khớp tsconfig, include `src/**/*.test.ts` |
| Sửa | `package.json` | +devDep `vitest@^2.1.9`; +script `test`, `test:run` (không đổi script cũ) |
| Thêm | `src/lib/rbac/client.test.ts` | `can` / `canAny` |
| Thêm | `src/lib/agent-name.test.ts` | `normalizeAgentName`, `buildVisibleEntriesFilter` (cú pháp PostgREST .or) |
| Thêm | `src/lib/health-paid-period.test.ts` | parse đa định dạng ngày + nhãn period |
| Thêm | `src/lib/dashboard-filter-defaults.test.ts` | math thuần (resolve range, normalize, fallback) — truyền `date` cố định |
| Thêm | `src/lib/automation/health-statement/report.test.ts` | reconciliation health: matched/unclaimed/base-policy/lọc carrier/lọc ngày |
| Thêm | `src/lib/automation/pc-statement/report.test.ts` | commission split (TWFG 80%, Fiona 60/40, DP 75%) + 4 flow phân loại + totals/balanced |

### Behavior phát hiện được & khoá lại (golden-master)
- `buildHealthStatementReport`: **mỗi base policy luôn sinh 1 dòng `paymentForProducer`**, kể cả khi không có payment khớp (khi đó `carriers_messer_paid = 0`). (Giả định ban đầu của tôi là "0 dòng" — đã sửa expectation theo behavior thật, KHÔNG sửa code.)
- `buildPcStatementReport`: phân loại flow theo thứ tự policy-mới → additional → unclaimed/fee; fee = `comission_rate >= 0.5`; gộp payment trùng key cộng dồn premium.

### Verify
- `npx vitest run` → **58 pass / 0 fail**.
- `npm run typecheck` → **0 lỗi**.
- `git status` xác nhận: không file nguồn nào bị sửa (chỉ test/config + package.json/lock).

### Rollback
Xoá 7 file `*.test.ts` + `vitest.config.ts`, revert 4 dòng trong `package.json` + `package-lock.json`. Không ảnh hưởng code chạy thật.

### Ghi chú / nợ kỹ thuật mở
- `npm install` báo một số vulnerability (transitive của vitest, môi trường dev). Không ảnh hưởng bundle production. Có thể soát ở phase cleanup nếu cần.
- Chưa cover bằng test: `parser.ts`/`payment-parser.ts` (cần fixture Excel) và `policy-source.ts` (HTTP). Các hàm report đã bọc phần lõi nghiệp vụ; parser sẽ được khoá thêm khi chạm tới ở Phase 2+ nếu cần.

---

## Phase 1 — Tách domain types khỏi `config.ts` ✅ HOÀN TẤT

**Ngày:** 2026-06-18
**Mục tiêu:** Gỡ "mixed concern" trong `lib/config.ts` (domain types + infra constant) mà KHÔNG vỡ import nào.

### Thay đổi

| Loại | File | Ghi chú |
|---|---|---|
| Thêm | `src/lib/domain/entry.types.ts` | `Entry`, `EntryInput` |
| Thêm | `src/lib/domain/pc-entry.types.ts` | `PcEntry`, `PcEntryInput` |
| Thêm | `src/lib/domain/account.types.ts` | `AccountUser`, `UserRole` (+ ghi chú legacy) |
| Sửa | `src/lib/config.ts` | chỉ còn `PORTAL_ACCOUNT_TABLE` + **re-export** types (tương thích ngược) |
| Sửa (chuẩn hoá import) | `(authed)/page.tsx`, `customer-registration/pc/page.tsx`, `customer-registration/pc/PcEntryGrid.tsx`, `account-manager/AccountManagerClient.tsx` | import type trực tiếp từ `@/lib/domain/*` |

### Cơ chế an toàn
`config.ts` re-export toàn bộ types cũ ⇒ 12 import `@/lib/config` còn lại **vẫn biên dịch bình thường**. Sẽ chuyển nốt sang `@/lib/domain/*` và bỏ re-export ở Phase 5.

### Verify
- `npm run typecheck` → 0 lỗi.
- `vitest run` → **58 pass / 0 fail** (golden-master không đổi ⇒ behavior giữ nguyên).

### Rollback
Khôi phục nội dung cũ `config.ts`, xoá thư mục `src/lib/domain/`, revert 4 import đã đổi.

---

## Phase 2 — Extract: provider-finder route + EntryGrid dùng chung ✅ HOÀN TẤT

**Ngày:** 2026-06-18

### 2a. Tách `provider-finder/search/route.ts` (846 dòng → 30 dòng)

| Loại | File | Ghi chú |
|---|---|---|
| Thêm | `src/lib/provider-finder/types.ts` | toàn bộ type (di chuyển nguyên văn) |
| Thêm | `src/lib/provider-finder/maps-service.ts` | factory Google + Apps Script, geocode/directions, config getters, error classifiers |
| Thêm | `src/lib/provider-finder/search.ts` | lõi thuần: scoring/candidate/fetch DB/toProviderResult + `runProviderSearch()` trả `{status, body}` |
| Thêm | `src/lib/provider-finder/search.test.ts` | golden-master nhánh validation (400) |
| Sửa | `route.ts` | chỉ còn auth + parse + gọi `runProviderSearch` + map status |

**Behavior giữ nguyên:** mọi nhánh status (400/200/502/500), nội dung `logs`, `origin: undefined` khi không có address (JSON tự bỏ key). Parse JSON body bọc try → giữ đúng nhánh 500 cũ.

### 2b. EntryGrid — trích phần dùng chung an toàn (theo quyết định của user)

> User chọn **"trích phần chung an toàn"** thay vì full `GenericEntryGrid<T>` (rủi ro lệch UI cao khi chưa có test UI).

| Loại | File | Ghi chú |
|---|---|---|
| Thêm | `(authed)/customer-registration/_shared/entry-grid-shared.ts` | `gridTheme`, `rowNumberCellStyle`, `actionCellStyle`, `makeDraftKey`, `parseCsvLine`, `normalizeLink` |
| Sửa | `(authed)/EntryGrid.tsx` | dùng module shared; bỏ định nghĩa trùng; import type từ `@/lib/domain/entry.types` |
| Sửa | `(authed)/customer-registration/pc/PcEntryGrid.tsx` | tương tự (không import `normalizeLink` vì P&C không có FUB link) |

**Phần KHÔNG hợp nhất (cố ý giữ riêng):** column defs, modal edit (field khác nhau), payload, endpoint, validation field-specific → tránh lệch UI.

### Verify
- `npm run typecheck` → 0 lỗi.
- `npm run lint` → 0 error (3 warning **pre-existing** ở dashboard, không thuộc file đã sửa).
- `vitest run` → **61 pass / 0 fail** (thêm 3 test provider-finder).

### Rollback
- 2a: khôi phục route.ts cũ, xoá `src/lib/provider-finder/`.
- 2b: khôi phục định nghĩa cục bộ trong 2 EntryGrid, xoá `_shared/entry-grid-shared.ts`.

---

## Phase 3 — Tách 4 dashboard khổng lồ (chỉ tách types, KHÔNG gộp chéo) ✅ HOÀN TẤT

**Ngày:** 2026-06-18

> **Phát hiện quan trọng → quyết định của user:** các formatter "tưởng giống nhau" giữa 4 dashboard đã **phân kỳ** (vd `formatCurrency` của PcSales làm tròn khác AgentPc). Gộp chéo sẽ ĐỔI output hiển thị. Vì chưa có test UI, user chọn **"tách trong từng file, KHÔNG gộp chéo"**. Mỗi dashboard tách khối **types + constants** của chính nó sang `*.types.ts` (di chuyển nguyên văn) — file component nhỏ lại, không rủi ro đổi output.

| Dashboard | File types mới | Re-export giữ page.tsx |
|---|---|---|
| AgentHealthDashboard (1659) | `AgentHealthDashboard.types.ts` | `HealthMartRow`, `ReportMonthRange` |
| HealthSalesDashboard (2341) | `HealthSalesDashboard.types.ts` | (page chỉ import component) |
| AgentPcDashboard (3361) | `AgentPcDashboard.types.ts` | `UNPAID_PAID_DATE_LABEL`, `AgentPcFilterOptions`, `AgentPcFilterValues`, `AgentPcRow` |
| PcSalesDashboard (4221) | `PcSalesDashboard.types.ts` | `FilterOptions`, `FilterValues`, `PcSalesRow` |

**Nguyên tắc giữ behavior:** chỉ di chuyển khai báo type/constant; mọi hàm thuần + sub-component React + logic giữ NGUYÊN trong `.tsx`. Component tiếp tục import type/constant từ file types mới. Không hàm nào bị sửa.

### Verify
- `npm run typecheck` → 0 lỗi.
- `npm run lint` → 0 error; 3 warning đều **pre-existing** (`dashboard/health/page.tsx` canAny, `AgentPcDashboard.tsx` no-unused-expressions dòng ~2121, `dashboard/pc/page.tsx`) — không phát sinh mới.
- `vitest run` → **61 pass**.
- **`npm run build` → PASS** (tất cả route render, gồm 4 dashboard) — verify mạnh nhất.

### Rollback
Mỗi dashboard: dán lại khối types vào `.tsx`, bỏ import + re-export, xoá file `*.types.ts` tương ứng (4 commit độc lập).

### Ghi chú
Việc tách sâu hơn (aggregation/format ra `_data`/`_utils`) đã được cân nhắc nhưng hoãn lại: rủi ro đổi output do phân kỳ tinh vi + thiếu test UI. Khi cần, nên thêm test render trước (đã ghi ở plan).

---

## Phase 4 — Cô lập legacy-role + tách validation fat controller ✅ HOÀN TẤT

**Ngày:** 2026-06-18

### 4a. Cô lập + tài liệu legacy-role shim
| Loại | File | Ghi chú |
|---|---|---|
| Sửa | `src/lib/rbac/system-roles.ts` | thêm docblock "MIGRATION SHIM" giải thích model legacy `role` vs RBAC tồn tại song song; đổi import `UserRole` sang `@/lib/domain/account.types`. **KHÔNG xoá logic.** |

### 4b. Tách validation khỏi `api/admin/users/route.ts` (POST)
| Loại | File | Ghi chú |
|---|---|---|
| Thêm | `src/lib/admin/user-input.ts` | `parseCreateUserInput()` — chuẩn hoá + validate FORMAT (thuần, không DB), trả `{ ok, error, status }` |
| Thêm | `src/lib/admin/user-input.test.ts` | 6 golden-master cho các nhánh validation |
| Sửa | `route.ts` | dùng `parseCreateUserInput`; giữ NGUYÊN check cần DB (trùng email/agentId, role active), insert, rollback, logging, mọi status code |

**Giữ behavior:** `name` sau parse là `string | null` đã chuẩn hoá → insert dùng thẳng `name` (tương đương tuyệt đối biểu thức cũ). Các kiểm tra cần DB vẫn ở handler vì đan xen status code + transaction (rút ra rủi ro cao hơn lợi ích).

### Nợ kỹ thuật mở (đề xuất cho đợt sau, cần APPROVED riêng)
- Bỏ cột legacy `role` khỏi `portal_account` + migration dữ liệu → đổi behavior + schema.
- `api/admin/users/[id]/route.ts` PATCH (~300 dòng) vẫn là fat controller; có thể tách validation tương tự ở đợt sau.

### Verify
- `npm run typecheck` → 0 lỗi.
- `vitest run` → **67 pass** (thêm 6 test user-input).
- lint route + lib mới: sạch.

### Rollback
Khôi phục khối validation cũ trong route.ts, xoá `src/lib/admin/`, revert docblock + import trong `system-roles.ts`.

---

## Phase 5 — Dọn re-export + chuẩn hoá import + docs ✅ HOÀN TẤT

**Ngày:** 2026-06-18

### Thay đổi
- Chuyển toàn bộ import type còn lại từ `@/lib/config` (và `./config`) sang `@/lib/domain/*`: 13 file (entries/pc-entries routes, admin/users routes, auth.ts, rbac/access.ts, next-auth.d.ts, account-manager, các page.tsx, **sheets.ts** dùng đường tương đối `./config`).
- `src/lib/config.ts`: **bỏ hết re-export types**, chỉ còn `PORTAL_ACCOUNT_TABLE`. Mọi domain type giờ đi qua `@/lib/domain/*`.
- `README.md`: thêm mục **Project structure** + **Testing**, trỏ tới MIGRATION_REPORT.

### Verify cuối (toàn bộ Phase 1–5)
- `npm run typecheck` → **0 lỗi**.
- `npm run lint` → 0 error; **3 warning pre-existing** (không phát sinh mới so với baseline).
- `vitest run` → **67 pass / 0 fail**.
- `npm run build` → **Compiled successfully, 29/29 pages**.

### Rollback
Khôi phục re-export trong `config.ts`; các import `@/lib/domain/*` vẫn hoạt động nên có thể revert từng file độc lập.

---

## TỔNG KẾT

| Phase | Nội dung | Test | Build |
|---|---|---|---|
| 0 | Lưới golden-master (vitest) | 58 | — |
| 1 | Tách domain types khỏi config | 58 | — |
| 2 | provider-finder service + EntryGrid shared | 61 | — |
| 3 | Tách types 4 dashboard (không gộp chéo) | 61 | ✓ |
| 4 | Cô lập legacy-role + tách validate admin/users | 67 | — |
| 5 | Dọn re-export + chuẩn hoá import + docs | 67 | ✓ |

**Bất biến giữ trọn:** không đổi business logic, không đổi output (JSON/Excel/Sheet/UI). Mọi thay đổi là di chuyển/cô lập cấu trúc, có golden-master + typecheck + build bảo vệ.

**Nợ kỹ thuật mở (cần APPROVED riêng cho đợt sau):**
1. Bỏ cột legacy `role` + migration dữ liệu (đổi schema/behavior).
2. Tách sâu aggregation/format trong 4 dashboard (cần test UI trước vì formatter đã phân kỳ).
3. `api/admin/users/[id]/route.ts` PATCH (~300 dòng) còn là fat controller.
4. Full `GenericEntryGrid<T>` (đã chỉ trích phần chung an toàn ở Phase 2).
5. `npm audit`: vulnerability transitive của vitest (chỉ dev).

---

## Phase 6 — Sắp xếp folder structure (chỉ điểm an toàn cao) ✅ HOÀN TẤT

**Ngày:** 2026-06-18

> Quyết định user: chỉ làm các điểm bất hợp lý rõ ràng & **không đổi URL**; verify typecheck+build sau mỗi bước.

| # | Thay đổi | Lý do |
|---|---|---|
| FS-1 | `(authed)/EntryGrid.tsx` → `(authed)/customer-registration/health/EntryGrid.tsx` | Đối xứng với `customer-registration/pc/PcEntryGrid.tsx`; gom theo feature. Trang `page.tsx` (URL `/`) **giữ nguyên** chỗ cũ. |
| FS-2 | `dashboard/{DashboardNavigationState,DashboardViewSwitch,DashboardViewSkeleton}.tsx` → `(authed)/_dashboard-shared/` | **Hết coupling chéo**: `sales-dashboard/` không còn import `../../dashboard/...` (3 component vốn dùng chung 2 feature). |
| FS-3 | `_shared/entry-grid-shared.ts` → `_shared/grid.ts` | Bỏ lặp ngữ nghĩa (folder đã là `_shared` của customer-registration). |

**Cập nhật import:** `(authed)/page.tsx` (1), 2 file `dashboard/*/page.tsx` + `AgentHealthDashboard.tsx` (đổi `../` → `../../_dashboard-shared/`), 2 file `sales-dashboard/*/page.tsx` (đổi `../../dashboard/` → `../../_dashboard-shared/`), 2 EntryGrid (đổi sang `_shared/grid`).

**Giữ nguyên cố ý:** `src/proxy.ts` (đã xác minh là quy ước Next.js 16 thay `middleware.ts` — KHÔNG đổi); URL routing toàn bộ; `(authed)/page.tsx` tại `/`.

### Verify
- `npm run typecheck` → 0 lỗi; xác nhận không còn import cũ `../../dashboard/Dashboard*`.
- `npm run lint` → 3 warning pre-existing (không mới).
- `vitest run` → 67 pass.
- `npm run build` → OK.
