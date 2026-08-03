# Full Codebase Audit & Refactor Roadmap — agent-portal

Ngày: 2026-08-03 · Branch: `config` · HEAD tại thời điểm audit: `a116265`
Phạm vi: toàn repo (`src/`, `supabase/`, `datasync/`, `docs/`, config, CI).

---

## 0. Phương pháp & giới hạn (đọc trước — quan trọng)

### 0.1 Cách audit này được thực hiện
Kế hoạch ban đầu: 10 agent đối kháng chạy song song (Backend, DB, Perf, Clean Code, Architect, Security, DevOps, QA, Domain, Devil's Advocate). **7 agent đã được spawn nhưng CẢ 7 đều chết giữa chừng do hết session limit của tài khoản** (reset 05:30 giờ VN) — không agent nào trả về kết quả. Không có nội dung nào trong báo cáo này đến từ các agent đó.

Vì vậy báo cáo này là **audit của một reviewer (tôi), tự đóng cả vai phản biện**, dựa trên:
- **Số liệu đo trực tiếp** bằng grep/find trên repo (mọi con số trong báo cáo đều đo được lại — xem 0.3).
- **Context làm việc sâu** với `src/lib/tasks/**`, `src/lib/enrollment/**`, `src/lib/table-config/**`, `src/app/api/{tasks,enrollment,config}/**`, `supabase/schema.sql` từ nhiều phiên refactor gần đây (RBAC visibility, Agent/Assistant config, dropdown values consolidation).
- Đọc bổ sung trong phiên này: `src/lib/supabase.ts`, `src/app/api/cron/**`, `tsconfig.json`, `eslint.config.mjs`, `next.config.ts`, `package.json`, `vercel.json`, `.env.local.example`.

### 0.2 Mức độ tin cậy theo vùng — ĐỌC KỸ
| Vùng | Độ sâu đã đọc | Độ tin cậy kết luận |
|---|---|---|
| `lib/tasks`, `lib/enrollment`, `lib/table-config`, `api/{tasks,enrollment,config}` | Rất sâu (đã refactor nhiều lần) | **Cao** |
| `supabase/schema.sql`, RBAC (`lib/rbac`), auth, cron | Đọc trực tiếp phần liên quan | **Cao** |
| Metrics toàn repo (LOC, counts, deps, config) | Đo bằng lệnh | **Cao (số liệu)** |
| `dashboard/**`, `sales-dashboard/**` (4 file, ~11k dòng) | **Chưa đọc chi tiết** | **Thấp — cần verify** |
| `lib/automation/**`, `lib/ai/**`, `lib/provider-finder/**`, `datasync/**` | **Chưa đọc chi tiết** | **Thấp — cần verify** |
| `api/entries`, `api/pc-entries`, `api/admin/**`, `api/automation/**` | **Chưa đọc chi tiết** | **Thấp — cần verify** |

> **Mọi kết luận về vùng "Thấp" trong báo cáo này đều được đánh dấu `[CHƯA VERIFY]`. Không được ra quyết định refactor lớn dựa vào chúng trước khi đọc code thật.** Đặc biệt là câu hỏi lớn nhất — "có nên gộp health và pc không" — hiện **chưa đủ căn cứ** để chốt.

### 0.3 Số liệu nền (đo ngày 2026-08-03)
| Chỉ số | Giá trị |
|---|---|
| File TS/TSX trong `src/` | 336 |
| Tổng dòng trong `src/` | 80,011 |
| API route handlers (`route.ts`) | 74 |
| Bảng trong `schema.sql` | 48 |
| Index / FK reference / function-trigger | 83 / 39 / 13 |
| Dòng có RLS policy | ~1 (gần như không có) |
| `schema.sql` | 2,751 dòng, **không có thư mục migration** |
| Call site `getSupabaseAdmin()` | **174** |
| Nơi trả thẳng `error.message` về client (status 500) | **87** |
| `as unknown as` casts | 59 |
| `: any` / `as any` | 8 |
| `@ts-ignore` / `@ts-expect-error` | **0** ✅ |
| `dangerouslySetInnerHTML` | **0** ✅ |
| `console.*` trong `src/` | 15 |
| File có `export const dynamic = "force-dynamic"` | 65 |
| File test | 50 — **toàn bộ nằm trong `src/lib/`** |
| Test cho `src/app/**` (74 route + mọi component) | **0** |
| GitHub workflow | 1 (`task-reminders.yml`) — **không có CI build/test/lint** |
| `tsconfig.strict` | `true` ✅ |

---

## 1. Executive Summary

**Tình trạng tổng thể: một codebase trẻ, đang tăng trưởng nhanh, chất lượng "phần lõi" tốt hơn mặt bằng chung, nhưng thiếu gần như toàn bộ hạ tầng an toàn (CI, migration, test tầng route, observability).** Đây không phải codebase tệ — nó có những điểm rất tốt (TypeScript strict, 0 `ts-ignore`, 0 XSS sink, comment "why" chất lượng cao, pure-function resolver cho RBAC có test). Vấn đề nằm ở **rủi ro hệ thống**, không phải ở "code xấu".

**Vấn đề số 0 — phát hiện muộn trong audit, nhưng quan trọng hơn tất cả:**

> 🔴 **`next-auth@5.0.0-beta.31` + `@auth/core@0.41.2` dính CVE khiến auth check có thể FAIL OPEN khi cấu hình lỗi** (xác nhận bằng `npm audit`). Toàn bộ bảo mật app dựa trên `auth()` trả null khi chưa đăng nhập; nếu nó fail-open, kết hợp với service-role key + không RLS (S1) thì **toàn bộ DB bị lộ mà không cần đăng nhập**. Tổng cộng `npm audit` báo **16 lỗ hổng (3 Critical, 8 High)**. **Việc đầu tiên phải làm là nâng cấp auth libs, trước mọi refactor.** Chi tiết §7.3.
>
> Đáng chú ý thêm: app đang chạy **bản beta** của thư viện auth (`5.0.0-beta.31`) trên production.

**5 vấn đề lớn tiếp theo, theo thứ tự ưu tiên:**

1. **Không có CI.** Chỉ có 1 workflow và nó là cron job, không phải pipeline. Mọi `typecheck`/`lint`/`test` đều chạy tay. 50 file test tồn tại nhưng **không có gì bắt buộc chúng phải xanh trước khi merge**. → Đây là gốc rễ khiến mọi rủi ro khác trở nên nghiêm trọng hơn.
2. **Không có migration strategy.** 48 bảng sống trong 1 file `schema.sql` 2,751 dòng chạy tay qua Supabase SQL editor. Không version, không rollback, không phát hiện drift, không biết ai đã apply gì lúc nào. **Đã có sự cố thật tuần này**: file fail khi chạy vì một index được khai báo trước cột nó index (`42703`).
3. **Service-role key ở 174 call site + gần như không có RLS.** Toàn bộ phân quyền nằm ở tầng app. Một route quên check = toàn quyền đọc/ghi bảng đó. Không có lớp phòng thủ thứ hai ở DB.
4. **0 test cho 74 API route.** Toàn bộ test là pure-function trong `lib/`. Chính tầng chứa authorization, transaction, và side-effect thì không có test nào. Các đợt refactor RBAC gần đây (mở rộng visibility) đi qua vùng này mà không có lưới an toàn.
5. **Không có transaction & không có observability.** Supabase JS không hỗ trợ transaction đa lệnh; nhiều luồng multi-write (task create → assignees → rotation; import approval; archive + activity) có thể ghi nửa vời. Và với 15 dòng `console.*` cho 80k LOC, **khi cron/import fail lúc 3h sáng sẽ không ai biết**.

**Điểm tốt cần giữ:** `tsconfig strict`, RBAC tách thành pure resolver có test (`lib/tasks/access.ts`), guard bảo mật attachment (magic-byte + allowlist), 2-người duyệt import, CHECK constraint 3 tầng cho Medicare, và văn hoá comment giải thích "tại sao" (hiếm và rất giá trị — xem `lib/tasks/access.ts:18-21`, `lib/enrollment/queries.ts` fallback logic).

**Khuyến nghị chiến lược:** **KHÔNG bắt đầu bằng refactor lớn.** Bắt đầu bằng "lưới an toàn" (Phase 1: CI + migration + logging) vì mọi refactor sau đó đều dựa vào nó. Refactor kiến trúc lớn (gộp health/pc, tách god component) chỉ nên làm **sau khi** có CI + test route.

---

## 2. Overall Architecture Review

### 2.1 Kiến trúc hiện tại — mô tả thực tế
```
Browser
  └── Next.js 16 App Router
        ├── (authed)/**            server component (fetch trực tiếp từ lib/)
        │     └── _components/*.tsx  client component (rất lớn, giữ state + business rule)
        ├── api/**  (74 route)       → gọi thẳng getSupabaseAdmin() (174 call site)
        └── lib/**                   module theo domain: tasks, enrollment, table-config,
                                     rbac, ai, automation, provider-finder, admin, domain(types)
Supabase Postgres (48 bảng, service-role key, ~không RLS)
Google Sheets ──(datasync/, cron 02:00)──> raw/mart tables
```

**Không có tầng Repository, không có tầng Service, không có Domain layer.** `src/lib/domain/` chỉ chứa 3 file `*.types.ts` (account/entry/pc-entry) — là type definitions, **không phải** domain layer (20 import, dùng như types thường). Mô hình thực tế là **2 tầng**: route handler ⇄ Supabase client, với `lib/` đóng vai "helper dùng chung" chứ không phải tầng kiến trúc có ranh giới.

### 2.2 Đánh giá — có phải vấn đề không?
**Phản biện trước (vai Devil's Advocate):** *"App ~50 người dùng nội bộ, team nhỏ. Thêm Repository/Service layer là over-engineering kinh điển. Next.js route handler gọi thẳng DB là pattern được chính Next khuyến khích."*

**Phản hồi:** Đúng một phần. Tôi **không** đề xuất áp dụng Clean Architecture đầy đủ (Entity/UseCase/Gateway) — đó sẽ là gold-plating thật. Nhưng có 2 lý do cụ thể, đo được, khiến trạng thái hiện tại đã vượt ngưỡng chịu đựng:

1. **174 call site `getSupabaseAdmin()`** nghĩa là 174 nơi có thể quên check quyền. Đây không phải lý thuyết: đợt review tuần này đã tìm thấy route thật thiếu check (enrollment detail/comments/attachments) và phải vá từng cái một.
2. **0 test route** là *hệ quả trực tiếp* của kiến trúc này: route import `getSupabaseAdmin()` và `auth()` tĩnh, không inject được → không test được. Đây là **rào cản cấu trúc**, không phải lười viết test.

→ Đề xuất là **mức tối thiểu**: một lớp mỏng `data/` (thay cho "repository") + chuẩn hoá guard, đủ để test được và giảm bề mặt quên-check. Không phải DDD đầy đủ. Chi tiết ở §16.

### 2.3 Findings

| # | Mức | Phát hiện | Bằng chứng | Tác động |
|---|---|---|---|---|
| A1 | **High** | Không có ranh giới tầng; 174 nơi truy cập DB trực tiếp bằng service-role | đo: `grep -rn "getSupabaseAdmin()" src \| wc -l` = 174 | Mỗi route là một điểm có thể quên authz; không test được |
| A2 | **High** | Guard authz không thống nhất — ít nhất 4 biến thể | `loadEnrollmentActor()`, `loadConfigAdmin()`, `auth()`+`buildTaskActor()` inline, `isTaskViewAdmin()` trực tiếp | Khó review, dễ dùng nhầm guard yếu hơn (đã xảy ra: `/api/admin/agent-members` dùng `isTaskViewAdmin` trong khi route anh em dùng `isManager`) |
| A3 | **Medium** | Business rule trùng lặp server↔client | `canMutateEnrollmentRecord` (`lib/enrollment/access.ts`) vs `canEditEnrollmentRecordClient` (trong `EnrollmentClient.tsx`); Medicare field rule ở 3 nơi | Drift risk — sửa 1 nơi quên nơi kia |
| A4 | **Medium** | God component: 7 file > 1,600 dòng | `PcSalesDashboard.tsx` 4,052 · `EnrollmentClient.tsx` 3,693 · `AgentPcDashboard.tsx` 3,248 · `HealthSalesDashboard.tsx` 2,171 · `TaskBoardClient.tsx` 1,829 · `TaskRowItem.tsx` 1,732 · `ConfigClient.tsx` 1,691 | Không ai đọc hết được; merge conflict cao; test bất khả |
| A5 | **Medium** | `lib/enrollment` phụ thuộc `lib/tasks` (hướng phụ thuộc đáng ngờ) | `lib/enrollment/access.ts`: `EnrollmentActor = TaskActor`, dùng `buildTaskActor` | Enrollment không độc lập được; đổi task actor → vỡ enrollment |
| A6 | **Low** | `src/lib/domain/` đặt tên gây hiểu nhầm (chỉ là types) | 3 file `*.types.ts` | Người mới tưởng có domain layer |

> **Đã được giải quyết trong phiên trước (ghi nhận, không cần làm lại):** vòng lặp import khiến `lib/enrollment/access.ts` phải dùng `await import("@/auth")` động — nay đã trả về static import khi revert scope enrollment.

---

## 3. Database Review

### 3.1 Migration Strategy — **Critical**
**Hiện trạng:** 1 file `supabase/schema.sql` (2,751 dòng), viết theo kiểu declarative-idempotent (`create table if not exists`, `alter table ... add column if not exists`, `drop constraint if exists` rồi add lại), **chạy tay** qua Supabase SQL editor. Không có: thư mục migration, version, up/down, bảng lịch sử migration, cơ chế phát hiện drift.

**Bằng chứng rủi ro (sự cố thật, tuần này):** khi thêm cột `enrollment_records.agent_email`, index `enrollment_records_agent_idx` được đặt ở khối index (dòng ~2290) **trước** câu `alter table ... add column agent_email` (dòng ~2301). File chạy top-to-bottom → fail `ERROR: 42703: column "agent_email" does not exist`. Phải sửa thứ tự thủ công. **Đây là bằng chứng cho thấy tính đúng đắn của thứ tự lệnh hoàn toàn không được ràng buộc bởi công cụ nào.**

**Rủi ro cụ thể:**
- Không biết môi trường prod đang ở "phiên bản" nào của file → drift âm thầm giữa local/staging/prod.
- Không rollback được: `drop constraint if exists` + `add constraint` là thao tác một chiều.
- File chỉ *idempotent về mặt cú pháp*, không idempotent về mặt dữ liệu: có khối `update enrollment_records set caller_email = null ... where program = 'medicare'` (backfill) sẽ **chạy lại mỗi lần apply**.
- Khi có nhiều người/nhiều máy, không có nguồn sự thật.

### 3.2 RLS & mô hình bảo mật DB — **High**
48 bảng, gần như không policy nào; app dùng service-role key ở 174 nơi. **Toàn bộ authorization là app-layer.**

**Phản biện (Devil's Advocate):** *"Đây là app nội bộ, không phải multi-tenant SaaS. Bật RLS cho 48 bảng sẽ tốn hàng tuần và có thể phá vỡ mọi query hiện tại. Service-role + app-layer check là lựa chọn hợp lý cho team nhỏ."*

**Phán quyết:** **Đồng ý một phần — KHÔNG khuyến nghị bật RLS toàn bộ.** Chi phí/rủi ro quá cao so với lợi ích ở quy mô này. Nhưng đề xuất **thoả hiệp có chọn lọc**:
- Giữ service-role cho hầu hết bảng.
- **Chỉ bật RLS cho các bảng chứa PII khách hàng** (`enrollment_records`, `health_entries`, `pc_entries`, và các bảng comment/attachment liên quan) như *defense-in-depth*, nếu và chỉ nếu team chấp nhận chi phí test lại.
- Ưu tiên cao hơn và rẻ hơn nhiều: **giảm 174 call site xuống còn ~vài chục qua lớp `data/`**, để bề mặt "có thể quên check" nhỏ lại. Đây mới là fix đúng gốc.

### 3.3 Findings khác

| # | Mức | Phát hiện | Bằng chứng | Ghi chú |
|---|---|---|---|---|
| D1 | **Critical** | Không có migration strategy | `supabase/schema.sql` 2751 dòng, không có `supabase/migrations/` | Xem §12 |
| D2 | **High** | Không có transaction cho luồng multi-write | Supabase JS không hỗ trợ; task create → `task_assignees` insert → rotation update; import approval apply N row; enrollment archive + activity insert | Ghi nửa vời khi lỗi giữa chừng |
| D3 | **High** | Backfill `update` chạy lại mỗi lần apply schema | `schema.sql` khối `update enrollment_records set caller_email=null...` | Idempotent về cú pháp nhưng không về dữ liệu |
| D4 | **High** | 3 cơ chế soft-delete khác nhau cho cùng khái niệm | `task_categories.is_active` (bool) · `table_column_option.archived_at` (ts) · `enrollment_options.archived_at` (ts) · `tasks.archived_at` | Mỗi query phải nhớ dùng đúng kiểu; đã gây nhầm khi gộp UI dropdown |
| D5 | **Medium** | Dữ liệu trùng: `tasks.assignee_email` (legacy) song song `task_assignees` (junction) | Cả 2 được ghi đồng thời ở nhiều route | Nguồn sự thật kép; import từng làm sập multi-assignee (đã chặn) |
| D6 | **Medium** | Email là `text` tự do, không FK về `portal_account.email`, không `citext` | Toàn bộ cột `*_email` trong schema | Không đảm bảo toàn vẹn; case-sensitivity xử lý rải rác bằng `.toLowerCase()` ở app |
| D7 | **Medium** | Enum sống 2 nơi: CHECK constraint (SQL) + union type (TS), không có nguồn chung | vd `import_request.status` CHECK vs type TS; `program in ('aca','medicare')` | Drift khi thêm giá trị (đã xảy ra: thêm `processing`/`failed` phải sửa cả 2) |
| D8 | **Medium** | Fetch-all-rồi-filter-in-app thay vì filter ở SQL | `fetchTasksForActor` (`lib/tasks/queries.ts`), `fetchEnrollmentRecords` | OK ở scale hiện tại, không OK khi lớn — xem §6 |
| D9 | **Low** | `.or()` PostgREST ghép chuỗi từ email | `lib/tasks/queries.ts` (`ors.push(\`assignee_email.eq."${email}"\`)`) | Không phải SQL injection cổ điển, nhưng email chứa ký tự lạ có thể phá cú pháp filter |
| D10 | **Low** | `getSupabaseAdmin()` tạo client MỚI mỗi lần gọi (174 lần) | `lib/supabase.ts:3-12` | Lãng phí object; nên memo hoá per-request |

### 3.4 Điểm tốt của DB (giữ nguyên)
- CHECK constraint có ý nghĩa nghiệp vụ thật: `tasks_backlog_no_assignee` / `tasks_nonbacklog_has_assignee` (bất biến 2 chiều), `enrollment_records_medicare_fields_check`.
- Index có chủ đích cho query pattern thật (83 index cho 48 bảng là hợp lý, không thừa thãi).
- Partial unique index đúng chỗ: `enrollment_options_active_label_key ... where archived_at is null`.

---

## 4. Business Logic Review

### 4.1 Rule mã hoá mong manh — **High**

| # | Mức | Phát hiện | Bằng chứng | Hậu quả nghiệp vụ |
|---|---|---|---|---|
| B1 | **High** | Stage nghiệp vụ khớp bằng **chuỗi label literal** | `api/enrollment/[id]/route.ts`: `KEY_STAGE_NOTIFICATIONS = new Set(["5-Ready to enroll","11-Terminated"])` | Admin đổi tên stage ở `/config` (giờ làm được tự do) → **notification im lặng ngừng chạy**, không lỗi, không log. Đây là bug chờ nổ. |
| B2 | **High** | `EnrollmentConsentToggle` giả định Consent có đúng 2 giá trị | `EnrollmentClient.tsx`: tìm label `"yes"` + "option khác đầu tiên" | Có option thứ 3 → **không chọn được, im lặng**. Đã chặn ở tầng UI config (guard 2 giá trị) nhưng **domain model vẫn chưa mã hoá ràng buộc này** |
| B3 | **Medium** | Rule "Medicare không có Payment/Consent/Platform/AC" nằm ở **3 nơi** | client `MEDICARE_HIDDEN_COLUMNS` · server `MEDICARE_INAPPLICABLE_FIELDS` (`lib/enrollment/program-fields.ts`) · DB CHECK | Defense-in-depth *có chủ đích* — chấp nhận được, nhưng phải có test bảo vệ cả 3 khớp nhau (hiện chỉ server có test) |
| B4 | **Medium** | Vai trò Agent/Assistant không phải first-class | `TASK_ADMIN_ROLE_NAMES` khớp **tên role literal** (`lib/tasks/access.ts:13-16`); Agent = có mặt trong `task_agents`; Assistant = row `agent_members.is_assistant` | Đổi tên role trong Role Manager → mất quyền admin im lặng |

### 4.2 Mô hình quyền — đánh giá
Mô hình hiệu dụng có **4 vai** (Admin / Agent / Assistant / plain-CS) nhưng DB chỉ có **2 permission** (`task.manage`, `task.work`) + khớp tên role + 2 bảng membership. Quyết định gần đây (đã chốt với chủ dự án): plain-CS thấy toàn bộ task công ty; Agent chỉ thấy task `agent_email = mình`; Assistant thấy task của agent mình phụ trách.

**Đánh giá:** implementation *diễn đạt đúng* ý định (`actorSeesAllTasks` trong `lib/tasks/membership.ts`, cờ `seeAll` trong `fetchTasksForActor`), và quan trọng hơn — đợt review trước đã phát hiện và vá đúng cái bẫy chí mạng: mở visibility ở list nhưng **quên mở ở route per-task** (`/detail`, `/comments`, `/attachments`), khiến plain-CS thấy task nhưng mở ra 403. Đây là ví dụ tốt cho thấy **rule phân tán ra nhiều route là rủi ro thật, không phải lý thuyết**.

**Nhưng:** quyền vẫn được suy ra ở **≥6 helper khác nhau** (`canViewTask`, `canMutateTask`, `canChangeTaskStatus`, `canAssignToTask`, `canDeleteTask`, `isAgentOwnerOrAssistant`, `actorSeesAllTasks`) và mỗi route tự lắp ráp flag đầu vào. Đó là chỗ bug tiếp theo sẽ xuất hiện.

### 4.3 Trùng lặp health vs pc — **[CHƯA VERIFY — cần đọc code trước khi quyết]**
Bề mặt trùng lặp *có vẻ* rất lớn: `dashboard/health` ↔ `dashboard/pc`, `sales-dashboard/health` ↔ `sales-dashboard/pc`, `automation/health-statement` ↔ `automation/pc-statement`, `health_raw_data`/`health_mart` ↔ `pc_raw_data`/`pc_mart`, `/api/entries` ↔ `/api/pc-entries`, `lib/ai/health-*` ↔ `lib/ai/pc-*`. Ước tính **~11,000+ dòng** nằm trong 4 file dashboard lớn nhất.

**Tôi KHÔNG kết luận nên gộp hay không** — chưa đọc đủ. Health (ACA/Medicare, commission theo member-month) và P&C (policy/premium) là **hai sản phẩm bảo hiểm khác nhau về bản chất**, rất có thể logic tính toán khác thật chứ không phải copy-paste. Đây là **hạng mục điều tra ưu tiên số 1 của Phase 0**, vì nó quyết định 30-40% khối lượng refactor còn lại.

---

## 5. Clean Code Review

### 5.1 Số liệu chất lượng — thực tế tốt hơn kỳ vọng
`0` `@ts-ignore`, `0` `dangerouslySetInnerHTML`, chỉ `8` chỗ `any`, `tsconfig.strict = true`. **Đây là kỷ luật TypeScript trên mức trung bình.** Không có nợ kiểu ẩn dạng "tắt type checking cho xong".

### 5.2 Findings

| # | Mức | Phát hiện | Bằng chứng | Fix |
|---|---|---|---|---|
| C1 | **High** | **Không có chiến lược logging.** 15 `console.*` cho 80k LOC nghĩa là gần như không log gì | đo trực tiếp | Cron/import fail lúc 3h sáng → không ai biết. Xem §7 |
| C2 | **High** | **87 nơi trả thẳng `error.message` của Postgres về client** | `grep "error.message }, { status: 500" src/app/api` = 87 | Rò rỉ chi tiết schema/constraint ra UI; thông báo lỗi vô nghĩa với người dùng |
| C3 | **Medium** | `59` chỗ `as unknown as` — escape hatch quanh kiểu trả về Supabase | đo trực tiếp | Vô hiệu hoá type safety đúng ở ranh giới nguy hiểm nhất (DB → app). Nên có 1 lớp parse/validate |
| C4 | **Medium** | God file (7 file > 1,600 dòng) | §2.3 A4 | Xem §10 Phase 5 |
| C5 | **Medium** | Không validate request body có cấu trúc; parse thủ công + cast | pattern `const body = await req.json().catch(() => null)` rồi `typeof body?.x === "string"` lặp lại khắp 74 route | Nên dùng schema validation (zod) tại ranh giới |
| C6 | **Medium** | `datasync/**/*.js` **bị loại hoàn toàn khỏi ESLint** | `eslint.config.mjs` globalIgnores | Toàn bộ pipeline dữ liệu không được lint |
| C7 | **Low** | Đặt tên không nhất quán cho cùng khái niệm "người" | `assignee_email`, `agent_email`, `cs_email`, `caller_email`, `responsible_enroll_email`, `reporter_email`, `recipient_email`, `uploaded_by`, `created_by_email`, `changed_by_email` | Cần glossary — xem §14 |
| C8 | **Low** | snake_case (DB) trộn camelCase (TS) trong cùng interface | `TableColumn` có `is_system`, `hidden_default`, `show_in_detail` cạnh code camelCase | Chấp nhận được nếu quy ước rõ ràng; hiện chưa có |
| C9 | **Low** | Magic value nghiệp vụ rải rác | `KEY_STAGE_NOTIFICATIONS`, `TASK_ADMIN_ROLE_NAMES`, `15MB`, `10MB`, `5000 rows`, `300ms`, chunk size 50 | Gom về `constants` theo domain |

### 5.3 Điểm tốt cần giữ làm chuẩn
Codebase có **comment giải thích "tại sao" chất lượng cao bất thường** — ví dụ `lib/tasks/access.ts:18-21` giải thích vì sao `isTaskViewAdmin` cố ý tách khỏi `task.manage`; comment trong `EnrollmentClient.tsx` giải thích `optionUsageCounts` ra đời từ sự cố thật ("this is what silently broke the ACA Payment 'Auto pay' option earlier"); comment trong `use-anchored-menu.ts` giải thích vì sao không đóng menu khi scroll bên trong. **Đây là tài sản — chuẩn hoá thành yêu cầu bắt buộc trong code review.**

---

## 6. Performance Review

**Bối cảnh quy mô: ~50 người dùng nội bộ, dữ liệu task/enrollment cỡ vài nghìn dòng.** Rất nhiều thứ "trông tệ" thực chất không phải vấn đề ở quy mô này. Tôi tách rõ 2 nhóm.

### 6.1 Vấn đề thật (nên xử lý)

| # | Mức | Phát hiện | Bằng chứng | Ngưỡng đau |
|---|---|---|---|---|
| P1 | **Medium** | Realtime refetch amplification | subscribe `TASKS_TOPIC`/`ENROLLMENT_TOPIC`; mỗi broadcast → mọi client refetch tasks **+ categories** (mới thêm) / records **+ option sets** | 1 người sửa → N client × 2-3 query. Với 50 user cùng mở board, 1 thao tác = ~100-150 query |
| P2 | **Medium** | Không có virtualization cho bảng dài | `TaskRowItem.tsx` (1,732 dòng/row component), bảng enrollment, dashboard | Vài trăm dòng → DOM nặng, scroll giật |
| P3 | **Medium** | `/config` fetch **toàn bộ** `enrollment_records` (6 cột FK) chỉ để đếm usage | `config/page.tsx` (thêm trong đợt dropdown consolidation) | Tăng tuyến tính theo số record; nên chuyển sang `count`/aggregate ở SQL |
| P4 | **Low-Med** | `getSupabaseAdmin()` tạo client mới 174 lần | `lib/supabase.ts` | Nhỏ nhưng free để fix (memo per request) |
| P5 | **Low-Med** | 65 file `force-dynamic` — có thể có route cache được nhưng bị ép động | đo trực tiếp | Cần rà từng cái; một số là đúng (auth-dependent) |

### 6.2 **KHÔNG phải vấn đề ở quy mô này** (đừng tốn công)
- `fetchTasksForActor` / `fetchEnrollmentRecords` fetch-rồi-filter-in-JS: với vài nghìn dòng, chi phí không đáng kể. **Chỉ tối ưu khi vượt ~10k dòng.**
- Chunking `attachAssigneesToTasks` (chunk 50): đã là giải pháp đúng cho giới hạn URL length, không phải N+1.
- xlsx build in-memory cho export: với vài nghìn dòng hoàn toàn ổn trên Vercel.
- 83 index cho 48 bảng: hợp lý, không cần cắt.

> **Nguyên tắc:** trước khi tối ưu bất cứ gì ở §6.1, **hãy đo trước** (§10 Phase 6 có bước instrumentation). Không tối ưu theo cảm tính.

---

## 7. Security Review

### 7.1 Findings

> **Cập nhật sau khi chạy `npm audit` (bằng chứng đo được, không phải suy đoán):**
> **16 lỗ hổng: 3 Critical, 8 High, 4 Moderate, 1 Low.** Chi tiết ở §7.3 — trong đó có **1 lỗ nghiêm trọng hơn mọi phát hiện khác trong toàn bộ audit này** (auth fail-open).

| # | Mức | Phát hiện | Bằng chứng | Kịch bản khai thác |
|---|---|---|---|---|
| **S0** | 🔴 **CRITICAL** | **`next-auth@5.0.0-beta.31` + `@auth/core@0.41.2` dính CVE "Configuration errors can cause existence-based auth checks to fail open"** — khi cấu hình lỗi, object `auth` được trả về *kèm error* thay vì null, khiến check kiểu `if (session?.user)` **đi qua được** | `npm audit`; version xác nhận qua `package-lock.json` | **Toàn bộ mô hình bảo mật của app dựa trên `auth()` trả về null khi chưa đăng nhập.** Nếu gặp lỗi cấu hình (thiếu `AUTH_SECRET`, lỗi provider…), guard có thể fail-open → truy cập không cần đăng nhập. Kết hợp với S1 (service-role, không RLS) = lộ toàn bộ DB. **Đây là ưu tiên số 1 của toàn báo cáo.** |
| S1 | **High** | Service-role key + gần như không RLS, 174 call site | `lib/supabase.ts`, đo grep | Một route quên check authz = đọc/ghi toàn bảng. Không có lớp chặn thứ 2. Đã có tiền lệ route thiếu check. **Nhân với S0 → blast radius tối đa** |
| S2 | **High** | **`CRON_SECRET` chấp nhận qua query string URL — cả 3/3 route cron** | `api/cron/{sync-data,check-overdue,check-enrollment-due}/route.ts` (đều có `url.searchParams.get("secret") === cronSecret`) | Secret lọt vào access log, proxy log, browser history, Referer header. Ai đọc được log → chạy được cron tuỳ ý (bao gồm `sync-data` ghi đè dữ liệu) |
| S3 | **Medium** | So sánh secret không constant-time | cùng chỗ, dùng `===` | Timing attack về lý thuyết; rủi ro thấp trong ngữ cảnh này nhưng fix rẻ |
| S4 | **Medium** | `CRON_SECRET` **không có** trong `.env.local.example` | so sánh env inventory vs file example | Deploy mới quên set → route trả 500 "misconfigured" (fail-closed ✅ tốt) nhưng cron im lặng không chạy |
| S5 | **Medium** | 87 nơi rò rỉ `error.message` Postgres về client | đo grep | Lộ tên bảng/cột/constraint cho người dùng nội bộ; hỗ trợ dò schema |
| S6 | **High** (nâng từ Medium sau khi verify) | `xlsx@0.18.5` — **xác nhận qua `npm audit`**: Prototype Pollution + ReDoS. Đây là bản npm cuối cùng, SheetJS đã chuyển sang CDN riêng nên `npm audit fix` **không sửa được** | `npm audit`; `package-lock.json` → `xlsx = 0.18.5` | Import file .xlsx độc hại → DoS/prototype pollution. **App có tính năng import file cho admin** → bề mặt thật, không lý thuyết |
| S7 | **Low-Med** | `.or()` filter ghép chuỗi từ email | `lib/tasks/queries.ts`, `lib/tasks/search.ts` | Email dị dạng (chứa `,` `(` `)`) phá cú pháp filter → lỗi hoặc kết quả sai phạm vi. Không phải SQLi |
| S8 | **[CHƯA VERIFY]** | AI dashboard chat → query builder | `lib/ai/**` (23 file), `/api/ai/dashboard-chat` | **Cần audit riêng**: nếu LLM output điều khiển được truy vấn mà không có allowlist chặt, đây là bề mặt prompt-injection → rò rỉ dữ liệu. Chưa đọc, không kết luận |

### 7.3 Kết quả `npm audit` — 16 lỗ hổng (3 Critical / 8 High / 4 Moderate / 1 Low)

| Package | Mức | Nội dung | Ảnh hưởng tới app này |
|---|---|---|---|
| **`next-auth` 5.0.0-beta.31** | 🔴 Critical | Config error → auth check **fail open** | **Xem S0. Ưu tiên #1 toàn báo cáo.** Cũng lưu ý: đang dùng bản **beta** cho thư viện auth ở production |
| **`@auth/core` 0.41.2** | 🔴 Critical | `getToken()` uncaught exception với Bearer header dị dạng; homoglyph `@` bypass ở email normalizer | Email homoglyph bypass đáng quan tâm vì auth dựa trên domain email (`AUTH_GOOGLE_ALLOWED_DOMAIN`) |
| **`vitest`** | 🔴 Critical | Vitest UI server có thể đọc/chạy file tuỳ ý | Chỉ devDependency — rủi ro thấp nếu không mở Vitest UI ra mạng |
| **`next` 16.2.4** | 🟠 High | DoS qua Server Components; **Middleware/Proxy bypass ở App Router** | App có `src/proxy.ts` → cần kiểm tra có nằm trong diện bypass không |
| **`xlsx` 0.18.5** | 🟠 High | Prototype Pollution + ReDoS | App cho admin upload .xlsx → bề mặt thật |
| **`sharp`** | 🟠 High | Kế thừa CVE libvips (4 CVE) | Kiểm tra có xử lý ảnh không |
| **`postcss`, `js-yaml`, `brace-expansion`, `ws`, `vite`** | 🟠 High | XSS/DoS/path traversal/memory disclosure | Phần lớn là build-time hoặc transitive — đánh giá từng cái |
| `esbuild`, `qs`, `@vitest/mocker`, `vite-node`, `@babel/core` | 🟡 Mod/Low | Chủ yếu dev-time | Ưu tiên thấp |

**Hành động bắt buộc (theo thứ tự):**
1. **Nâng `next-auth`/`@auth/core` lên bản đã vá — NGAY.** Đây là thứ duy nhất trong báo cáo có thể phá vỡ toàn bộ mô hình bảo mật.
2. Nâng `next` (Middleware bypass + DoS).
3. `xlsx`: `npm audit fix` **không** giải quyết được (bản npm cuối cùng đã bị bỏ). Chọn 1 trong 3: (a) chuyển sang CDN chính chủ SheetJS bản mới, (b) đổi lib (vd `exceljs`), (c) chấp nhận rủi ro + giới hạn quyền upload (hiện đã manager-only + caps) và ghi nhận quyết định.
4. Còn lại: chạy `npm audit fix`, cái nào cần major bump thì đánh giá riêng.

> ⚠️ **Cảnh báo phương pháp:** `npm audit` báo theo version range, có thể có false positive (đặc biệt với transitive dev deps). Nhưng **S0 (next-auth fail-open) phải được xác minh và xử lý trước tiên**, không được cho qua.

### 7.2 Điểm bảo mật **làm tốt** (giữ)
- Attachment: allowlist extension **+ kiểm tra magic-byte** + chặn HTML/script + bucket private + signed URL (`lib/tasks/attachments.ts`, `lib/tasks/storage.ts`). Đây là mức trên trung bình.
- Import: 2-người duyệt (`canApproveImport` — người nộp ≠ người duyệt), claim atomic chống double-approve, caps 10MB/5000 dòng.
- `login_attempts` + `lib/auth/rate-limit.ts` được nối thật vào `src/auth.ts` (không phải code chết).
- `.env.local` **không** bị track bởi git ✅.
- `0` `dangerouslySetInnerHTML` ✅.
- Cron fail-closed khi thiếu secret ✅.

---

## 8. Testing Review

### 8.1 Hiện trạng — **đây là điểm yếu lớn thứ 2 sau CI**
- 50 file test, **100% nằm trong `src/lib/`**.
- **0 test cho 74 API route. 0 test cho mọi React component. 0 integration test. 0 E2E.**
- Test hiện có là **pure-function unit test** — chất lượng ổn (RBAC resolver, sla, rotation, transitions, import classify, values coerce, report generator).

### 8.2 Vì sao 0 test route — nguyên nhân cấu trúc, không phải lười
Route import tĩnh `getSupabaseAdmin()` và `auth()`. Không có dependency injection, không có seam để mock. **Muốn test route thì phải đổi cấu trúc trước** — đây chính là lý do §16 đề xuất lớp `data/` mỏng: nó vừa giảm bề mặt authz, vừa mở khoá testability. Một mũi tên hai đích.

### 8.3 Bản đồ rủi ro: vùng **vừa hay đổi vừa không có test**
| Vùng | Churn gần đây | Test | Rủi ro |
|---|---|---|---|
| RBAC visibility (task/enrollment) | **Rất cao** (đổi model 2 lần trong tuần) | Pure resolver có test; **route thì không** | 🔴 Cao nhất |
| Import approval / apply rows | Cao (thêm processing/failed, cấm đổi assignee) | `import.ts` classify có test; **apply/route không** | 🔴 Cao |
| Config dropdown values | **Rất cao** (vừa gộp 2 lần) | **Không có test nào** | 🔴 Cao |
| Cron (overdue, enrollment-due, sync) | Trung bình | **Không** | 🟠 Trung bình-cao (chạy 3h sáng, không log) |
| Statement automation (tiền!) | Thấp | `report.test.ts` có | 🟡 Trung bình |

---

## 9. Technical Debt List (xếp theo ưu tiên)

| # | Mức | Nợ | Chi phí trả | Chi phí KHÔNG trả |
|---|---|---|---|---|
| T1 | 🔴 Critical | Không có CI (typecheck/lint/test không bắt buộc) | 2-4h | Mọi refactor sau đều mù; regression lọt lên prod |
| T2 | 🔴 Critical | Không có migration strategy (`schema.sql` chạy tay) | 1-2 ngày | Drift prod/local; không rollback được; đã fail 1 lần |
| T3 | 🔴 Critical | 0 test cho 74 route (vùng chứa authz + side effect) | 3-5 ngày (sau khi có seam) | Bug RBAC/data lọt âm thầm |
| T4 | 🟠 High | Không có logging/alerting (15 `console.*`/80k LOC) | 1-2 ngày | Cron/import fail im lặng, không ai biết |
| T5 | 🟠 High | `CRON_SECRET` qua query string | 30 phút | Secret vào log → chạy được cron tuỳ ý |
| T6 | 🟠 High | 174 call site service-role, không lớp trung gian | 1-2 tuần (làm dần) | Mỗi route là 1 điểm quên-check |
| T7 | 🟠 High | Không transaction cho multi-write | 3-5 ngày (RPC) | Ghi nửa vời, dữ liệu lệch |
| T8 | 🟠 High | Rule nghiệp vụ khớp bằng string literal (stage label, role name) | 1-2 ngày | Đổi tên ở UI → tính năng chết im lặng |
| T9 | 🟠 High | `xlsx@0.18.5` có CVE, app có import file | 2-4h (đổi lib/pin) | Prototype pollution / DoS qua file upload |
| T10 | 🟡 Medium | 87 nơi rò rỉ `error.message` DB | 3-4h | Lộ schema; UX lỗi kém |
| T11 | 🟡 Medium | 3 cơ chế soft-delete khác nhau | 2-3 ngày | Mỗi query phải nhớ quy ước riêng |
| T12 | 🟡 Medium | God component (7 file >1600 dòng, 2 file >3200) | 1-2 tuần | Không test được, merge conflict, khó onboard |
| T13 | 🟡 Medium | `tasks.assignee_email` legacy song song `task_assignees` | 3-5 ngày | Nguồn sự thật kép |
| T14 | 🟡 Medium | Request body không validate schema (74 route parse tay) | 3-5 ngày (zod) | Input xấu lọt sâu vào logic |
| T15 | 🟡 Medium | 59 `as unknown as` ở ranh giới DB | 2-3 ngày | Type safety mất đúng chỗ nguy hiểm nhất |
| T16 | 🟢 Low | Đặt tên/glossary không nhất quán | 1-2 ngày | Ma sát nhận thức, onboard chậm |
| T17 | 🟢 Low | `datasync/` không được lint | 1h | Lỗi cú pháp/logic không ai bắt |
| T18 | 🟢 Low | `lib/domain/` đặt tên gây hiểu nhầm | 15 phút | Nhầm lẫn kiến trúc |
| T19 | ❓ Chưa rõ | Trùng lặp health/pc (~11k dòng) | **Cần điều tra trước** | Có thể là 30-40% khối lượng maintain |

---

## 10. Refactor Roadmap (Phase-by-Phase)

> **Nguyên tắc xuyên suốt: KHÔNG refactor khi chưa có lưới an toàn.** Phase 1-2 là điều kiện tiên quyết cho mọi thứ sau. Ai đề xuất nhảy thẳng vào Phase 5 (tách god component) là đang đề xuất refactor mù.

### Phase 0 — Điều tra & chốt phạm vi (1-2 ngày)
- **Mục tiêu:** Trả lời dứt điểm 3 câu hỏi chặn: (a) health/pc có nên gộp không; (b) `lib/ai` có lỗ hổng prompt-injection không; (c) dashboard/automation/datasync có nợ nào chưa biết.
- **File ảnh hưởng:** không sửa code — chỉ đọc `dashboard/**`, `sales-dashboard/**`, `lib/automation/**`, `lib/ai/**`, `lib/provider-finder/**`, `datasync/**`, `api/{entries,pc-entries,admin,automation}/**`.
- **Rủi ro:** Thấp · **Breaking:** Không · **Migration:** N/A · **Rollback:** N/A
- **Độ khó:** Thấp · **Thời gian:** 1-2 ngày
- **Phụ thuộc:** Không
- **Checklist:** ☐ Verdict health/pc có bằng chứng · ☐ Audit bảo mật `lib/ai` · ☐ Bổ sung findings vào báo cáo này · ☐ Cập nhật §19

### Phase 1 — Lưới an toàn: CI + Logging + Quick security wins (2-3 ngày)
- **Mục tiêu:** Mọi thay đổi sau đây được máy kiểm tra; sự cố runtime nhìn thấy được.
- **File ảnh hưởng:** `.github/workflows/ci.yml` (mới), `eslint.config.mjs`, `lib/logger.ts` (mới), 3 route `api/cron/**`, `.env.local.example`, `package.json`.
- **Nội dung:**
  1. CI: `typecheck` + `lint` + `test` chạy trên mọi push/PR (§14).
  2. Bỏ `CRON_SECRET` qua query string; chỉ nhận `Authorization: Bearer`; so sánh `timingSafeEqual` (T5).
  3. Thêm `CRON_SECRET`, `AI_DEBUG` vào `.env.local.example` (T5/S4).
  4. Logger tối thiểu (structured JSON, level, request id) + gắn vào 3 cron + import approval (T4).
  5. Bỏ `datasync/**` khỏi eslint ignore (T17).
  6. Xử lý `xlsx` CVE: pin/thay thế/đánh giá (T9).
- **Rủi ro:** Thấp · **Breaking:** Không (trừ cron URL cũ — phải cập nhật GitHub workflow & Vercel cron cùng lúc)
- **Migration:** Cập nhật secret ở Vercel + GH Actions trước khi deploy route mới
- **Rollback:** Revert commit; cron route giữ tương thích ngược 1 nhịp deploy nếu muốn an toàn hơn
- **Độ khó:** Thấp · **Thời gian:** 2-3 ngày
- **Phụ thuộc:** Không (làm ngay được)
- **Checklist:** ☐ CI xanh & chặn merge · ☐ Cron chỉ nhận header · ☐ Log có cấu trúc ở cron/import · ☐ `.env.example` đầy đủ · ☐ datasync được lint

### Phase 2 — Migration strategy cho DB (3-5 ngày)
- **Mục tiêu:** Chuyển từ "1 file chạy tay" sang migration có version, không phá prod hiện tại.
- **File ảnh hưởng:** `supabase/migrations/**` (mới), `supabase/schema.sql` (đóng băng thành baseline), `README.md`, `docs/runbook-db.md` (mới).
- **Chiến lược (chi tiết §12):** baseline snapshot → mọi thay đổi sau là file migration đánh số → CI kiểm tra migration mới có chạy được trên DB rỗng.
- **Rủi ro:** **Trung bình-Cao** (đụng nguồn sự thật của dữ liệu) · **Breaking:** Không đổi schema, chỉ đổi quy trình
- **Rollback:** Baseline giữ nguyên `schema.sql` cũ; nếu hỏng quy trình thì quay lại chạy tay (không mất dữ liệu)
- **Độ khó:** Trung bình · **Thời gian:** 3-5 ngày
- **Phụ thuộc:** Phase 1 (cần CI để chạy kiểm tra migration)
- **Checklist:** ☐ Baseline khớp prod (diff = 0) · ☐ Bỏ khối backfill chạy lặp (D3) · ☐ CI dựng DB rỗng từ migration thành công · ☐ Runbook có hướng dẫn apply/rollback

### Phase 3 — Chuẩn hoá tầng truy cập dữ liệu + guard (1-2 tuần, làm dần)
- **Mục tiêu:** Giảm 174 call site service-role; thống nhất 4 biến thể guard về 1; mở khoá testability.
- **File ảnh hưởng:** `lib/data/**` (mới), toàn bộ `api/**` (làm dần theo domain: tasks → enrollment → config → còn lại), `lib/{tasks,enrollment,table-config}/queries.ts`.
- **Nội dung:** lớp `data/` mỏng (không phải Repository pattern đầy đủ) + `withAuth()` helper chuẩn hoá guard + chuẩn hoá error envelope (T10).
- **Rủi ro:** **Cao** (đụng authz — vùng đã có tiền sử bug) · **Breaking:** Có thể đổi status code (401↔403) → cập nhật client
- **Migration:** Từng domain một, mỗi domain 1 PR, có test route đi kèm (Phase 4 xen kẽ)
- **Rollback:** Per-PR revert; giữ helper cũ song song đến khi domain cuối chuyển xong
- **Độ khó:** Cao · **Thời gian:** 1-2 tuần
- **Phụ thuộc:** Phase 1 (CI) — **bắt buộc**
- **Checklist:** ☐ 1 guard duy nhất · ☐ error envelope thống nhất, 0 rò `error.message` · ☐ call site service-role < 50 · ☐ mỗi domain có test route

### Phase 4 — Test cho route & luồng nghiệp vụ (3-5 ngày, xen kẽ Phase 3)
- **Mục tiêu:** Có lưới cho vùng churn cao nhất (§8.3).
- **File ảnh hưởng:** `src/app/api/**/*.test.ts` (mới), `vitest.config.ts`, `test/helpers/**` (mới).
- **Ưu tiên test:** (1) RBAC visibility per-route (task detail/comments/attachments, enrollment tương ứng); (2) import approval state machine; (3) config dropdown CRUD 3 nguồn; (4) cron guard.
- **Rủi ro:** Thấp · **Breaking:** Không
- **Rollback:** N/A
- **Độ khó:** Trung bình · **Thời gian:** 3-5 ngày
- **Phụ thuộc:** Phase 3 (cần seam để mock)
- **Checklist:** ☐ 4 nhóm ưu tiên có test · ☐ CI chạy · ☐ Test fail khi cố tình bỏ 1 guard

### Phase 5 — Tách god component (1-2 tuần)
- **Mục tiêu:** Đưa 7 file >1,600 dòng về mức đọc được.
- **File ảnh hưởng:** `PcSalesDashboard.tsx`, `EnrollmentClient.tsx`, `AgentPcDashboard.tsx`, `HealthSalesDashboard.tsx`, `TaskBoardClient.tsx`, `TaskRowItem.tsx`, `ConfigClient.tsx`.
- **Rủi ro:** Trung bình (UI regression) · **Breaking:** Không (nội bộ)
- **Migration:** Từng file một, ưu tiên file **đang phải sửa thường xuyên** (`EnrollmentClient`, `ConfigClient`) — không tách file "ổn định, không ai đụng" chỉ vì nó dài
- **Rollback:** Per-PR revert
- **Độ khó:** Trung bình · **Thời gian:** 1-2 tuần
- **Phụ thuộc:** Phase 1; nên có Phase 4 cho vùng tương ứng
- **Checklist:** ☐ Không file nào >800 dòng · ☐ Sub-component ra file riêng · ☐ Business rule ra `lib/` · ☐ Smoke test tay từng trang

### Phase 6 — Performance (3-5 ngày) — **chỉ sau khi đo**
- **Mục tiêu:** Sửa đúng cái đau thật (§6.1), không tối ưu theo cảm tính.
- **File ảnh hưởng:** `config/page.tsx` (P3), realtime subscription trong `TaskBoardClient`/`EnrollmentClient` (P1), `lib/supabase.ts` (P4), bảng danh sách (P2).
- **Bước 1 bắt buộc:** thêm đo (thời gian query, số query/request) rồi mới sửa.
- **Rủi ro:** Thấp-Trung bình · **Breaking:** Không
- **Độ khó:** Trung bình · **Thời gian:** 3-5 ngày
- **Phụ thuộc:** Phase 1 (logging để đo)
- **Checklist:** ☐ Có số đo trước/sau · ☐ P1/P3 xử lý · ☐ Không tối ưu thứ trong §6.2

### Phase 7 — Domain hardening (3-5 ngày)
- **Mục tiêu:** Bỏ rule khớp-bằng-chuỗi (T8); mã hoá invariant vào đúng chỗ.
- **File ảnh hưởng:** `api/enrollment/[id]/route.ts` (KEY_STAGE_NOTIFICATIONS), `lib/tasks/access.ts` (TASK_ADMIN_ROLE_NAMES), `enrollment_option_sets` (thêm cột semantic flag thay vì match label), `lib/enrollment/program-fields.ts`.
- **Rủi ro:** Trung bình · **Breaking:** Có (cần migration thêm cột + backfill)
- **Migration:** Thêm cột cờ (vd `is_ready_to_enroll`, `is_terminated`) → backfill theo label hiện tại → đổi code đọc cờ → bỏ match label
- **Rollback:** Cột mới không phá gì nếu code cũ còn chạy; revert code trước, cột để lại
- **Độ khó:** Trung bình · **Thời gian:** 3-5 ngày
- **Phụ thuộc:** Phase 2 (migration), Phase 4 (test)
- **Checklist:** ☐ 0 chỗ match stage/role bằng literal · ☐ Consent constraint ở domain không chỉ UI · ☐ Test cover cả 3 tầng Medicare rule

### Phase 8 — Transaction & tính toàn vẹn (3-5 ngày)
- **Mục tiêu:** Luồng multi-write trở nên atomic (T7).
- **File ảnh hưởng:** `supabase/migrations/**` (RPC plpgsql mới), `api/tasks/route.ts` (create), `api/config/imports/[id]/route.ts` (apply), `api/enrollment/[id]/route.ts` (archive+activity).
- **Rủi ro:** **Cao** (logic ghi lõi) · **Breaking:** Không với client
- **Migration:** Viết RPC → chạy song song đối chiếu → chuyển sang RPC → bỏ đường cũ
- **Rollback:** Giữ code path cũ sau feature flag 1-2 tuần
- **Độ khó:** Cao · **Thời gian:** 3-5 ngày
- **Phụ thuộc:** Phase 2, Phase 4
- **Checklist:** ☐ 3 luồng dùng RPC · ☐ Test lỗi giữa chừng không để dữ liệu nửa vời · ☐ Import failed/processing recover được

### Phase 9 — Cleanup & chuẩn hoá (2-3 ngày)
- **Mục tiêu:** Trả nợ nhỏ (T11, T15, T16, T18), áp glossary.
- **Rủi ro:** Thấp · **Breaking:** Không
- **Độ khó:** Thấp · **Thời gian:** 2-3 ngày
- **Phụ thuộc:** Sau tất cả
- **Checklist:** ☐ 1 quy ước soft-delete · ☐ glossary áp dụng · ☐ `lib/domain` đổi tên `lib/types`

### Phase 10 — [Có điều kiện] Hợp nhất health/pc
- **Chỉ thực hiện nếu Phase 0 kết luận nên gộp.** Nếu Phase 0 nói "khác biệt thật" → **huỷ phase này**, ghi lý do vào doc.
- **Rủi ro:** **Rất cao** · **Thời gian:** 2-4 tuần · **Phụ thuộc:** toàn bộ phase trước

---

## 11. Risk Assessment

| Rủi ro | Khả năng | Mức tác động | Điểm | Giảm thiểu |
|---|---|---|---|---|
| Refactor gây regression vì không có CI/test | **Cao** | Cao | 🔴 9 | Phase 1+4 TRƯỚC mọi refactor |
| Schema drift prod vs local | Cao | Cao | 🔴 9 | Phase 2 |
| Cron/import fail im lặng | **Cao** | Trung bình | 🟠 6 | Phase 1 (logging + alert) |
| Đổi tên stage/role làm chết tính năng | Trung bình | Cao | 🟠 6 | Phase 7 |
| Một route quên authz → lộ PII nội bộ | Trung bình | Cao | 🟠 6 | Phase 3+4 |
| Ghi nửa vời khi multi-write lỗi | Trung bình | Trung bình | 🟡 4 | Phase 8 |
| CVE `xlsx` bị khai thác qua import | Thấp | Cao | 🟡 4 | Phase 1 |
| Refactor health/pc sai hướng, tốn tuần công | Trung bình | **Rất cao** | 🔴 8 | **Phase 0 bắt buộc trước** |
| Perf sập khi dữ liệu tăng 10x | Thấp (hiện tại) | Trung bình | 🟢 3 | Phase 6, sau khi đo |

---

## 12. Migration Plan (DB)

**Mục tiêu: chuyển sang migration có version mà không đụng dữ liệu prod.**

1. **Chụp baseline.** Dump schema thật từ prod → `supabase/migrations/0000_baseline.sql`. **Đối chiếu với `schema.sql` hiện tại, diff phải = 0.** Nếu khác → prod đã drift, phải hoà giải trước (đây chính là lý do cần bước này).
2. **Đóng băng `schema.sql`.** Đổi tên `schema.legacy.sql` + header ghi rõ "READ ONLY — baseline tính đến 2026-08-03, mọi thay đổi mới đi qua `migrations/`".
3. **Tách phần không idempotent.** Khối `update ... set caller_email = null where program='medicare'` (backfill) phải ra khỏi baseline → thành migration một lần đã-chạy-rồi, để không lặp lại (D3).
4. **Quy ước migration mới:** `NNNN_mo_ta_ngan.sql`, chỉ forward, mỗi file 1 mục đích, kèm comment "vì sao". Nếu cần rollback → viết migration mới đảo ngược (không sửa file cũ).
5. **CI gác cổng:** job dựng Postgres rỗng → chạy toàn bộ migration theo thứ tự → fail nếu lỗi. **Đây là thứ sẽ bắt được đúng loại lỗi đã xảy ra tuần này** (index trước cột).
6. **Runbook** (`docs/runbook-db.md`): ai apply, apply thế nào, kiểm tra gì sau khi apply, làm gì khi fail giữa chừng.

**Nguyên tắc tương thích ngược cho mọi migration về sau:** thêm cột nullable trước → deploy code đọc/ghi cả cũ lẫn mới → backfill → mới siết constraint. Không bao giờ drop cột trong cùng deploy với code đổi.

---

## 13. Rollback Plan

| Loại thay đổi | Cách rollback | Ghi chú |
|---|---|---|
| Code (mọi phase) | `git revert` commit/PR; Vercel rollback về deployment trước | Vercel giữ deployment cũ — rollback tức thì |
| Migration thêm cột nullable | Không cần rollback (vô hại); nếu cần → migration mới `drop column` | An toàn nhất |
| Migration đổi/siết constraint | Migration mới đảo ngược; **phải test trên bản sao DB trước** | Nguy hiểm nhất — không tự ý làm trên prod |
| RPC/transaction (Phase 8) | Giữ code path cũ sau feature flag 1-2 tuần; tắt flag = quay lại đường cũ | Bắt buộc có flag |
| Guard/authz (Phase 3) | Revert PR domain đó; các domain khác không ảnh hưởng vì làm tuần tự | Lý do phải làm từng domain |
| Dữ liệu bị hỏng | **Hiện KHÔNG có quy trình backup/restore được ghi lại** → xem TODO Critical | Lỗ hổng vận hành nghiêm trọng |

> ⚠️ **Phát hiện quan trọng:** không tìm thấy tài liệu nào về backup/restore DB. Supabase có PITR tuỳ gói — **cần xác nhận gói hiện tại có bật không**. Nếu không, mọi rollback dữ liệu là bất khả. Việc này rẻ và phải làm trước Phase 2.

---

## 14. Coding Standards đề xuất

**Enforce được bằng máy (đưa vào CI/lint) — ưu tiên nhóm này:**
1. `typecheck` + `lint` + `test` xanh mới được merge.
2. `no-console` (trừ `lib/logger.ts`) — buộc dùng logger.
3. Giới hạn độ dài file: cảnh báo >500 dòng, chặn >800 (áp cho file **mới**; file cũ vào danh sách nợ Phase 5).
4. Cấm `as any`, cảnh báo `as unknown as` (hiện 59 chỗ → mục tiêu giảm dần, không chặn ngay).
5. `import/no-cycle` để chặn vòng lặp import tái diễn.
6. `datasync/**` phải được lint (bỏ khỏi ignore).

**Quy ước con người (đưa vào PR checklist):**
7. **Error envelope thống nhất:** client luôn nhận `{ error: string }` với thông điệp *người đọc được*; **không bao giờ** trả `error.message` thô từ Postgres; log chi tiết ở server.
8. **Status code:** 401 = chưa đăng nhập; 403 = đã đăng nhập nhưng không đủ quyền; 404 = không tồn tại *hoặc* không được phép biết là tồn tại; 409 = xung đột phiên bản.
9. **Validate ở ranh giới:** mọi request body qua schema (zod), không parse tay.
10. **Comment "tại sao", không "cái gì"** — giữ đúng văn hoá hiện có (§5.3). Bắt buộc comment cho: workaround, quyết định trái trực giác, rule nghiệp vụ.
11. **Business rule sống ở `lib/`, không ở component.** Client được phép *mirror* để hiển thị, nhưng phải import chung module, không viết lại.
12. Đặt tên: file component `PascalCase.tsx`, module `kebab-case.ts`, hàm boolean `is/has/can`, hàm async trả dữ liệu `fetchX`, thao tác ghi `createX/updateX/archiveX`.

---

## 15. Database Standards đề xuất

1. **Migration:** chỉ forward, đánh số, một mục đích/file, không sửa file đã chạy. CI dựng từ rỗng.
2. **Đặt tên:** bảng `snake_case` số nhiều; cột `snake_case`; FK `<bang>_id`; index `<bang>_<cot>_idx`; unique `<bang>_<cot>_key`; constraint `<bang>_<ynghia>_check`. (Hiện đã theo khá sát — giữ.)
3. **Soft delete — CHỌN MỘT:** `archived_at timestamptz null` cho mọi bảng. Bỏ dần `is_active` (`task_categories`) để chấm dứt 3-cơ-chế (T11). Query luôn `where archived_at is null`.
4. **Timestamp:** mọi bảng nghiệp vụ có `created_at`, `updated_at` (mặc định `now()`); bảng có audit thì thêm `created_by_email`, `updated_by_email`.
5. **Email:** cân nhắc `citext` hoặc **bắt buộc lowercase ở tầng ghi**; về lâu dài nên FK về `portal_account(email)` cho các cột định danh nội bộ.
6. **Enum:** CHECK constraint là nguồn sự thật; TS type phải sinh/đối chiếu tự động hoặc có test khẳng định 2 bên khớp (chặn drift D7).
7. **Index:** thêm index cho mọi cột xuất hiện trong `where`/`join` của query thật; review index khi thêm query mới (đưa vào PR checklist).
8. **Transaction:** mọi luồng ghi >1 bảng phải là RPC plpgsql, không ghép nhiều lệnh ở app.
9. **RLS:** không bắt buộc toàn bộ; **bắt buộc cân nhắc** cho bảng chứa PII khách hàng.

---

## 16. Kiến trúc mục tiêu sau refactor

```
src/
├── app/
│   ├── (authed)/<feature>/          page.tsx (server: chỉ orchestrate)
│   │     └── _components/           UI thuần, <800 dòng/file, không chứa business rule
│   └── api/<resource>/route.ts      mỏng: withAuth() → validate(zod) → gọi lib/ → envelope
├── lib/
│   ├── data/                        ★ MỚI: nơi DUY NHẤT chạm Supabase (thay 174 call site)
│   │     ├── tasks.ts  enrollment.ts  config.ts ...
│   ├── <domain>/                    tasks/ enrollment/ table-config/ ...
│   │     ├── access.ts              pure resolver quyền (đã có, giữ nguyên mô hình)
│   │     ├── rules.ts               business rule thuần, dùng chung server+client
│   │     └── types.ts
│   ├── http/                        withAuth(), envelope lỗi, status code chuẩn
│   ├── logger.ts                    ★ MỚI
│   └── types/                       (đổi tên từ lib/domain)
└── supabase/
    ├── migrations/                  ★ MỚI: nguồn sự thật của schema
    └── schema.legacy.sql            đóng băng làm baseline
```

**Quy tắc phụ thuộc:** `app/` → `lib/<domain>` → `lib/data` → Supabase. **Cấm** `lib/data` gọi ngược `lib/<domain>`; **cấm** `lib/enrollment` phụ thuộc `lib/tasks` (tách phần chung ra `lib/shared/actor`).

**Đây KHÔNG phải Clean Architecture đầy đủ** — cố ý. Không có Entity/UseCase/Gateway, không có DI container, không có CQRS. Chỉ thêm **đúng một tầng** (`lib/data`) vì nó giải quyết cùng lúc 3 vấn đề đo được: bề mặt authz (174→~50), testability (có seam để mock), và type safety ở ranh giới DB (một chỗ để parse thay vì 59 chỗ cast).

---

## 17. Quick Wins (rủi ro thấp, hiệu quả cao — làm ngay được)

| # | Việc | Thời gian | Vì sao đáng làm ngay |
|---|---|---|---|
| Q1 | CI chạy typecheck+lint+test | 2-4h | Chặn regression cho **mọi** việc sau |
| Q2 | Bỏ `CRON_SECRET` qua query string + timing-safe compare | 30ph | Lỗ bảo mật thật, fix rẻ |
| Q3 | Thêm `CRON_SECRET`, `AI_DEBUG` vào `.env.local.example` | 5ph | Tránh deploy thiếu config im lặng |
| Q4 | Xác nhận Supabase PITR/backup có bật | 15ph | Không có = mọi rollback dữ liệu bất khả |
| Q5 | Bỏ `datasync/**` khỏi eslint ignore, fix lỗi phát sinh | 1h | Pipeline dữ liệu đang hoàn toàn không được kiểm |
| Q6 | Đổi tên `lib/domain` → `lib/types` | 15ph | Xoá hiểu nhầm kiến trúc |
| Q7 | Memo hoá `getSupabaseAdmin()` per-request | 30ph | 174 lần tạo client → 1 |
| Q8 | Đánh giá & xử lý CVE `xlsx@0.18.5` | 2-4h | App có import file từ người dùng |
| Q9 | Logger tối thiểu + gắn vào 3 cron | 4h | Chấm dứt "fail im lặng lúc 3h sáng" |

**Tổng: ~1.5-2 ngày cho toàn bộ Quick Wins.** Đây là ROI cao nhất trong cả roadmap.

---

## 18. High-Risk Refactors (cần chuẩn bị kỹ)

| Refactor | Vì sao nguy hiểm | Điều kiện tiên quyết |
|---|---|---|
| **Hợp nhất health/pc** (Phase 10) | ~11k dòng, 2 sản phẩm bảo hiểm khác nhau, dính tới tính tiền hoa hồng. Gộp sai = sai tiền | Phase 0 kết luận rõ + test cho `lib/automation` + đối chiếu số liệu trước/sau |
| **Chuẩn hoá guard/authz** (Phase 3) | Vùng đã có tiền sử bug thật (route thiếu check, list mở nhưng detail 403) | CI + test route cho từng domain trước khi đổi |
| **RPC/transaction** (Phase 8) | Đụng đường ghi lõi (task create, import apply) | Feature flag + chạy song song đối chiếu |
| **Bỏ `tasks.assignee_email` legacy** (T13) | Nhiều nơi đọc/ghi; CHECK constraint phụ thuộc nó (`tasks_backlog_no_assignee`) | Map hết consumer + migration nhiều bước |
| **Đổi soft-delete `is_active`→`archived_at`** (T11) | `task_categories` được đọc ở nhiều nơi | Migration 2 chiều + deploy tương thích ngược |
| **Bật RLS cho bảng PII** | Có thể phá mọi query hiện tại nếu policy sai | Chỉ làm sau Phase 3 (khi đã có `lib/data` để kiểm soát) |

---

## 19. TODO theo mức ưu tiên

### 🔴 Critical (làm trong tuần này)
0. **⚡ NÂNG `next-auth` + `@auth/core` lên bản đã vá CVE auth-fail-open. LÀM TRƯỚC MỌI THỨ.** Sau khi nâng: kiểm tra lại luồng đăng nhập + `AUTH_GOOGLE_ALLOWED_DOMAIN` còn hoạt động đúng. Cân nhắc thoát khỏi bản `beta` cho thư viện auth. (S0, §7.3)
0b. **Nâng `next` 16.2.4** (Middleware/Proxy bypass ở App Router + DoS) — app có `src/proxy.ts` nên phải kiểm tra cụ thể. (§7.3)
1. **Xác nhận Supabase backup/PITR đang bật.** Không có = mọi rollback dữ liệu bất khả. (Q4, 15 phút)
2. **Dựng CI** typecheck+lint+test, chặn merge khi đỏ. (Q1, T1). **Thêm `npm audit` vào CI** để không lặp lại tình trạng 16 CVE tích tụ không ai biết.
3. **Sửa `CRON_SECRET`**: bỏ query-string (cả **3/3** route), dùng Bearer + timing-safe. (Q2, T5, S2)
4. **Phase 0 — điều tra** `dashboard/**`, `sales-dashboard/**`, `lib/ai/**`, `lib/automation/**`, `datasync/**`. Không quyết định refactor lớn trước khi xong.
5. **Audit bảo mật `lib/ai` + `/api/ai/dashboard-chat`** (prompt-injection → query builder). (S8)

### 🟠 High (2-4 tuần tới)
6. Migration strategy + baseline + CI dựng DB rỗng. (T2, Phase 2)
7. Logger + alert cho cron/import. (T4, Q9)
8. Xử lý CVE `xlsx`. (T9, Q8)
9. Test route cho 4 vùng churn cao nhất. (T3, Phase 4)
10. Chuẩn hoá guard + error envelope, bỏ 87 chỗ rò `error.message`. (T6, T10, Phase 3)
11. Bỏ rule khớp-bằng-string (stage label, role name). (T8, Phase 7)
12. Transaction/RPC cho 3 luồng multi-write. (T7, Phase 8)

### 🟡 Medium (1-2 tháng)
13. Tách god component, ưu tiên file đang sửa nhiều (`EnrollmentClient`, `ConfigClient`). (T12, Phase 5)
14. Thống nhất soft-delete về `archived_at`. (T11)
15. Validate request body bằng zod. (T14)
16. Giảm `as unknown as` bằng lớp parse ở `lib/data`. (T15)
17. Perf: đo trước, rồi sửa P1 (realtime amplification) và P3 (`/config` fetch toàn bảng). (Phase 6)
18. Bỏ dần `tasks.assignee_email` legacy. (T13)

### 🟢 Low (khi có thời gian)
19. Glossary + đổi tên nhất quán. (T16)
20. `lib/domain` → `lib/types`. (Q6, T18)
21. Rà 65 file `force-dynamic`, mở cache chỗ nào an toàn. (P5)
22. Virtualization cho bảng dài — **chỉ khi** có báo cáo giật thật. (P2)

### ❓ Cần quyết định (chờ Phase 0)
23. **Health/pc: gộp hay giữ riêng?** — quyết định này ảnh hưởng 30-40% khối lượng maintain về sau. Không đoán, phải đọc code.
24. RLS cho bảng PII: làm hay chấp nhận rủi ro app-layer? — quyết định sau Phase 3.

---

## Phụ lục A — Những gì audit này CHƯA làm

Để tránh tạo cảm giác an toàn giả:
- **Chưa đọc**: `dashboard/**`, `sales-dashboard/**` (~11k dòng), `lib/automation/**`, `lib/ai/**` (23 file), `lib/provider-finder/**`, `datasync/**`, `api/{entries,pc-entries,admin,automation}/**`, `apps-script/`.
- **Chưa chạy**: benchmark thật, phân tích bundle size, `EXPLAIN ANALYZE` trên query thật, kiểm thử thâm nhập.
- **Chưa xác minh**: prod schema có khớp `schema.sql` không (drift); trạng thái backup; CVE cụ thể của từng dependency (mới chỉ nhận diện `xlsx` theo phiên bản).
- **Không có** kết quả từ 10-agent debate như kế hoạch ban đầu (session limit) — báo cáo này là single-reviewer + tự phản biện. Khi có quota, **nên chạy lại agent Security và agent Domain** cho 2 vùng chưa đọc.

