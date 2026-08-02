# Design: Gộp quản lý Dropdown Value (Category + Option Sets) về `/config`

Ngày: 2026-08-03 · Branch: `config`

## Bối cảnh

`/config` → tab "Dropdown Values" (`ConfigValueSection`, `ConfigClient.tsx:789-887`) hiện **chỉ quản lý custom dropdown** (`table_column_option`, cột `is_system=false`). Chính code ghi rõ trong UI (`ConfigClient.tsx:820-823`):
> *"Custom dropdown values live here. System dropdowns stay in Enrollment option sets and Task Categories for now."*

Hai hệ thống "system dropdown" đang **set up ngay tại trang nghiệp vụ**, không phải `/config`:
- **CS**: nút "Categories" trên `/tasks` (`TaskBoardClient.tsx:1247` icon `Tag`) → mở `CategoryManager` modal (`tasks/_components/CategoryManager.tsx`).
- **Enroll**: nút "Option sets" trên `/enrollment` (`EnrollmentClient.tsx:841-842` icon `Settings2`) → mở `OptionSetManager` (định nghĩa trong chính `EnrollmentClient.tsx:3117`).

**Quyết định của user:** dồn **cả 2** vào `/config`, bỏ hẳn nút+modal setup trên `/tasks` và `/enrollment` — `/config` là nơi **duy nhất** để set up mọi dropdown value (system lẫn custom).

## 3 hệ thống hiện tại (đã đọc code + schema thật)

### A. Custom dropdown (đã ở `/config`, giữ nguyên)
- `table_column` (`scope, key, label, type, is_system, position, pinned, hidden_default, show_in_detail, required`) — định nghĩa cột.
- `table_column_option` (`column_id FK, label, color, position, archived_at`) — giá trị.
- API: `/api/config/columns/[id]/options` (POST thêm), `/api/config/columns/[id]/options/[optionId]` (DELETE = archive).
- UI: `ConfigValueSection` — chọn cột dropdown (lọc `!is_system`) → thêm/archive value.

### B. CS Category (`task_categories`, KHÔNG liên kết `table_column`)
```sql
create table task_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text,
  position integer not null default 0,
  is_active boolean not null default true,   -- khác table_column_option (archived_at timestamptz)
  created_by text,
  created_at timestamptz not null default now()
);
```
- API: `GET/POST /api/tasks/categories` (`src/app/api/tasks/categories/route.ts`), `PATCH/DELETE /api/tasks/categories/[id]` (`.../[id]/route.ts`) — DELETE = soft `is_active=false`.
- Quyền: `canManageCategories(actor) = actor.isManager` (`lib/tasks/access.ts:74-76`).
- UI hiện tại: `CategoryManager.tsx` — modal đơn giản (tên + màu + list + xoá), KHÔNG có sửa tên/reorder (dù API PATCH hỗ trợ).
- `table_column` ĐÃ có row hệ thống tương ứng: `col("cs", "category", "Category", "dropdown", 40)` (`lib/table-config/queries.ts:16`) — cột `category` đã là dropdown system column, chỉ là giá trị của nó nằm ở `task_categories` chứ không phải `table_column_option`.

### C. Enrollment Option Sets (`enrollment_option_sets` + `enrollment_options`, program-scoped)
```sql
create table enrollment_option_sets (
  id uuid primary key default gen_random_uuid(),
  program text not null check (program in ('aca','medicare')),
  key text not null check (key in ('stage','carrier','platform','consent','payment_status','aca_status')),
  label text not null,
  is_stage boolean not null default false,
  ...
);
create table enrollment_options (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references enrollment_option_sets(id) on delete restrict,
  label text not null,
  color text,
  position integer not null default 0,
  is_terminal boolean not null default false,   -- CHỈ có ý nghĩa với set "stage"
  triggers_qc boolean not null default false,   -- CHỈ có ý nghĩa với set "stage"
  archived_at timestamptz
);
```
- 6 set key: `stage, carrier, platform, consent, payment_status, aca_status`. Medicare chỉ có 2/6 (`stage, carrier`) — `ENROLLMENT_OPTION_SET_KEYS_BY_PROGRAM` (`lib/enrollment/types.ts:28-34`).
- `is_terminal`/`triggers_qc` là **logic nghiệp vụ thật** (đóng hồ sơ tự động, trigger QC review) — chỉ áp dụng cho set "stage", đọc trong `EnrollmentClient.tsx` (`getReopenStage`, các chỗ check `stage?.is_terminal`/`triggers_qc`) và API tạo/patch record.
- API: `GET/POST /api/enrollment/option-sets` (`fetchEnrollmentOptionData`), `PATCH/DELETE /api/enrollment/option-sets/[id]`.
- Quyền: `canManageEnrollmentOptions(actor) = actor.isManager` (giống hệt B).
- UI hiện tại: `OptionSetManager` — modal 2-pane (danh sách set bên trái, bảng value bên phải: label/color/rules(terminal,QC)/archive), có inline-edit trên blur, đã khá đầy đủ.
- `table_column` ĐÃ có row hệ thống tương ứng cho 5/6 set (không có `consent` — cột `consent` trong `table_column` là `type: "checkbox"`, không phải `dropdown`, vì UI nhập liệu dùng `EnrollmentConsentToggle` 2-trạng-thái chứ không phải picklist):
  - `col("aca","stage","Stage","dropdown",30)`, `col("aca","payment","Payment status","dropdown",60)`, `col("aca","carrier","Carrier","dropdown",70)`, `col("aca","aca","AC","dropdown",80)`, `col("aca","platform","Platform","dropdown",100)`.
  - Medicare: `col("medicare","stage",...)`, `col("medicare","carrier",...)`.
  - **Lệch tên khoá**: `table_column.key` dùng `"aca"`/`"payment"`, còn `enrollment_option_sets.key` dùng `"aca_status"`/`"payment_status"`. Mapping này **đã tồn tại sẵn** trong codebase cho mục đích khác (`enrollmentOptionColumnKey()` trong `api/config/imports/route.ts`): `payment_status→payment, aca_status→aca, default→setKey`. Dùng lại đúng hàm này, không viết lại.

## Kết quả review đối kháng (2 agent độc lập, 2026-08-03)

Đã cho 2 agent đọc thật toàn bộ code (không dựa bản tóm tắt này) và tranh biện: 1 bảo vệ hướng "1 picker chung cho mọi dropdown" (bản nháp ban đầu bên dưới), 1 phản biện độc lập tự đề xuất kiến trúc riêng.

**Kết luận: đổi từ "1 picker chung" sang "3 khối riêng trong cùng `/config`"**, vì bằng chứng cụ thể:
- Option Sets hiện có: màu tự do, sửa tên/màu inline (blur), và **cảnh báo archive dựa trên usage-count** — xuất phát từ sự cố thật (comment code: *"this is what silently broke the ACA Payment 'Auto pay' option earlier"*, `EnrollmentClient.tsx:566-579`). Custom dropdown (`ConfigValueSection`) hiện **không có** màu, không sửa tên, không cảnh báo — dù API `/api/config/columns/[id]/options/[optionId]` đã hỗ trợ PATCH label+color.
- Ép chung 1 "adapter" vẫn phải rò rỉ (field `is_terminal`/`triggers_qc` chỉ áp dụng stage → UI vẫn phải biết đang là adapter nào), và cần 1 hàm map-ngược-key hand-maintained (`aca↔aca_status`, `payment↔payment_status`) không ai enforce lúc compile — dễ vỡ khi thêm set mới sau này.
- 1 picker chung sẽ làm **Stage** (giá trị quan trọng nghiệp vụ nhất — QC, đóng hồ sơ) chìm thành "1 dòng" thay vì có khu riêng rõ ràng như hiện tại.

**3 phát hiện phụ, giá trị độc lập với quyết định kiến trúc trên** (giữ lại dù chọn hướng nào):
1. **CS Status + Priority** cũng là `table_column` dạng dropdown (`is_system=true`), nhưng giá trị hardcode trong `TASK_STATUSES`/`TASK_PRIORITIES` (TS enum) — KHÔNG có bảng lưu để admin sửa. Phải loại khỏi mọi danh sách cột ở `/config` (dù có gộp picker hay không), kèm comment giải thích rõ lý do.
2. **Bug có sẵn** trong `EnrollmentConsentToggle` (`EnrollmentClient.tsx:1898-1953`): logic chỉ hiểu đúng 2 giá trị (option label="yes" case-insensitive + "option khác đầu tiên trong mảng"). Nếu Consent có ≥3 option active, option thứ 3 trở đi **âm thầm không chọn được** trong lúc nhập liệu — không có fallback nào bắt trường hợp này. Bug KHÔNG do đợt này gây ra (đã tồn tại), nhưng đáng sửa nhân tiện.
3. **Bug có sẵn**: `POST/PATCH/DELETE /api/tasks/categories*` KHÔNG gọi broadcast realtime (mọi route sửa task khác đều có) — sau khi dời UI sang `/config` (trang khác hẳn `/tasks`), tab CS đang mở của đồng nghiệp sẽ dễ bị stale category hơn trước. Đáng sửa nhân tiện.
4. `optionUsageCounts` (cảnh báo an toàn #1) hiện tính từ `records` đã load sẵn ở client `/enrollment`. `/config` hiện KHÔNG load enrollment records. Khi port Option Sets section sang `/config`, cần thêm 1 query đếm gọn ở server (`select stage_id,carrier_id,...` rồi group), **KHÔNG** load nguyên `records` — tránh phình data không cần thiết.

RBAC (`isManager` cho cả 3 hệ thống) và "không migrate schema" (do `is_terminal`/`triggers_qc` có ~14 chỗ dùng thật trong logic QC/đóng hồ sơ) — cả 2 agent xác nhận độc lập, giữ nguyên quyết định.

## Quyết định kiến trúc (ĐÃ CHỐT sau review đối kháng — thay thế bản nháp "1 picker chung" bên dưới)

**KHÔNG migrate schema. KHÔNG làm 1 picker chung.** Làm **3 khối trong cùng tab "Dropdown Values"** của `/config`, chọn hiện khối nào theo scope đang chọn (cs/aca/medicare) — vẫn là "1 trang duy nhất để set up", chỉ là trong trang đó chia khu rõ ràng thay vì gộp phẳng:

- **Khối "Dropdown values"** (đổi tên/mở rộng `ConfigValueSection` hiện tại): gộp Custom dropdown + CS Category vào CHUNG 1 form/list (2 shape này đủ giống nhau: label+color+archive) — kèm **nâng cấp thêm màu + sửa tên inline** cho Custom (đóng lỗ hổng tính năng đang có, không chỉ là "giữ nguyên"). Category route API vẫn `/api/tasks/categories*`.
- **Khối "Option sets"** (component mới, port gần như nguyên vẹn từ `OptionSetManager`): giữ đủ 2-pane nav, sửa inline, checkbox Terminal/QC (chỉ hiện khi set là "stage"), và **bắt buộc giữ** cảnh báo archive theo usage-count — tính qua query mới ở server, không load nguyên `records`.
- Loại **Status + Priority** (CS) khỏi cả 2 khối — không có nơi lưu để sửa, giữ hardcode enum như cũ.

**Việc cần user quyết (2 câu, xem mục dưới)**: có sửa luôn 2 bug có sẵn (#2 Consent, #3 broadcast category) trong đợt này không, hay để riêng.

## Việc cần làm (mức cao — bản CHỐT, chi tiết ở plan implementation)

1. **Mở rộng `ConfigValueSection`**: bỏ filter `!column.is_system` nhưng CHỈ nhận thêm cột `key==="category"` (scope cs) — KHÔNG nhận Status/Priority (không có adapter). Thêm route-theo-nguồn: custom → API cũ; category → `/api/tasks/categories*`. Thêm UI màu (`type="color"` input) + sửa tên inline (onBlur) cho MỌI row trong khối này (custom lẫn category) — nâng cấp thật, không chỉ port.
2. **Component mới `ConfigOptionSetSection`**: port gần như nguyên khối JSX/logic từ `OptionSetManager` (`EnrollmentClient.tsx:3117-3374`) — bỏ wrapper modal `fixed inset-0`, nhúng thẳng vào tab Dropdown Values khi `scope !== "cs"`. Giữ đủ: 2-pane set nav, inline edit, checkbox Terminal/QC (disabled trừ khi set="stage"), confirm-dialog archive kèm usage-count.
3. **`/config/page.tsx`**: thêm fetch `task_categories`, `fetchEnrollmentOptionData("aca")`, `fetchEnrollmentOptionData("medicare")`, và 1 query đếm usage gọn (không load nguyên `records`) — ví dụ `select stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id from enrollment_records where archived_at is null` rồi đếm ở JS, tách riêng cho từng program.
4. Xoá nút "Categories" (`TaskBoardClient.tsx`) + `<CategoryManager>` render; xoá file `CategoryManager.tsx` sau khi verify hết caller.
5. Xoá nút "Option sets" (`EnrollmentClient.tsx`) + `<OptionSetManager>` render + hàm `OptionSetManager` (~260 dòng) sau khi verify hết caller.
6. **Không đổi** `/api/tasks/categories*`, `/api/enrollment/option-sets*` (trừ khi Q2 dưới chọn sửa broadcast).
7. *(Tuỳ Q1/Q2)* Thêm guard 2-giá-trị cho Consent trong Option Sets section (disable Add khi đã có 2 active, disable Archive nếu sẽ còn <2) — khớp giả định `EnrollmentConsentToggle`. *(Tuỳ Q2)* thêm `broadcastTasksChanged()` vào 3 route `/api/tasks/categories*`.

---

## (Lưu trữ) Bản nháp ban đầu trước review đối kháng — không còn dùng, giữ lại để đối chiếu

### Quyết định kiến trúc: KHÔNG migrate schema, chỉ dời UI

**Không** gộp B và C vào `table_column`/`table_column_option`. Lý do:
1. `is_terminal`/`triggers_qc` là field đặc thù nghiệp vụ của "stage" — nhét vào `table_column_option` (schema dùng chung cho MỌI dropdown, kể cả custom) sẽ làm bẩn schema chung cho lợi ích không ai cần.
2. `task_categories.is_active` (boolean) vs `archived_at` (timestamp) — đổi sang shape khác nghĩa là sửa lại toàn bộ nơi đọc `task_categories` trong CS (task list filter, category badge, category palette, task creation) — rủi ro cao, không phải điều user yêu cầu.
3. User chỉ nói "đem hết nó về bên config để set up" — yêu cầu là **1 nơi bấm để cấu hình**, không phải "1 bảng dữ liệu duy nhất". Migrate schema là over-engineering so với yêu cầu thật.

**Hướng làm:** giữ nguyên 100% bảng + API của B và C (đúng lý do ở trên). Nhưng ở tầng UI, **KHÔNG** làm 3 khối tách biệt (Custom / Category / Option Sets) — mà mở rộng dropdown "chọn cột" đã có sẵn trong `ConfigValueSection` (`dropdownColumnOptions`, hiện lọc `!column.is_system`) thành **1 picker duy nhất liệt kê MỌI cột type=dropdown của scope đang chọn — cả system lẫn custom**. Người dùng chọn 1 cột (vd "Category", "Stage", hay 1 custom dropdown bất kỳ) → cùng 1 khu vực bên dưới hiện value + form thêm + nút archive, KHÔNG cần biết/quan tâm cột đó backend là bảng nào.

**Cơ chế phía sau (ẩn với user):**
- Mỗi `TableColumn` (system hay custom) được gắn 1 "value adapter" xác định lúc chọn cột:
  - `is_system=false` → adapter cũ, gọi `/api/config/columns/[id]/options` (KHÔNG đổi).
  - `is_system=true, scope="cs", key="category"` → adapter gọi `/api/tasks/categories` (+ `[id]`).
  - `is_system=true, scope∈{aca,medicare}, key∈{stage,payment,carrier,aca,platform}` → adapter gọi `/api/enrollment/option-sets` (+ `[id]`), cần **map ngược** `table_column.key → enrollment_option_sets.key` (`aca→aca_status`, `payment→payment_status`, còn lại giữ nguyên tên — đảo ngược của `enrollmentOptionColumnKey()` đã có sẵn trong `api/config/imports/route.ts`, viết 1 hàm `columnKeyToEnrollmentSetKey()` cạnh đó hoặc trong `lib/enrollment/types.ts`).
  - `is_system=true` nhưng cột không có adapter tương ứng (vd `consent` — type checkbox, không phải dropdown, nên không lọt vào danh sách dropdown ngay từ đầu) → không xuất hiện trong picker.
- Field khác nhau giữa các adapter (`is_terminal`/`triggers_qc` chỉ có ở set "stage") → form thêm/value-row render **có điều kiện** thêm 2 checkbox đó chỉ khi cột đang chọn resolve về set "stage".
- Nút Add/Archive dùng chung 1 layout, chỉ đổi `fetch(url, ...)` theo adapter.

**Vì sao chọn hướng này thay vì 3 khối:** đúng yêu cầu "tính cả đường cho system value và custom value" — nghĩa là 1 luồng thao tác duy nhất cho MỌI dropdown, không phải 2-3 khu vực na ná nhau mà user phải nhớ "category thì tìm ở đây, stage thì tìm ở kia". Giữ đúng tinh thần "1 nơi duy nhất để set up".

## Việc cần làm (mức cao — chi tiết ở plan)

1. **Định nghĩa "value adapter"**: 1 hàm/type xác định, với 1 `TableColumn` cho trước, adapter nào xử lý nó + shape API tương ứng (list/add/archive endpoint, field đặc thù nếu có).
2. **Mở rộng `ConfigValueSection`**: bỏ filter `!column.is_system` khỏi `dropdownColumns`; với mỗi cột trong picker, xác định adapter; render value-list/form dùng chung nhưng field động theo adapter (đặc biệt stage's `is_terminal`/`triggers_qc`).
3. **`/config` `page.tsx`**: fetch thêm dữ liệu cần cho 2 adapter mới — `task_categories` (cho cs) + `fetchEnrollmentOptionData("aca")` + `fetchEnrollmentOptionData("medicare")` (cho option sets, cả 2 program vì scope switch là client-side).
4. **Map ngược key**: viết `columnKeyToEnrollmentSetKey(scope, key): EnrollmentOptionSetKey | null` (đảo ngược `enrollmentOptionColumnKey`).
5. Xoá nút "Categories" + `<CategoryManager>` khỏi `TaskBoardClient.tsx`; xoá nút "Option sets" + `<OptionSetManager>` khỏi `EnrollmentClient.tsx`; xoá 2 file/hàm đó sau khi verify hết caller.
6. Giữ nguyên 100% các API route B, C (`/api/tasks/categories*`, `/api/enrollment/option-sets*`) — chỉ đổi CALLER (từ modal cũ sang `ConfigValueSection`).

## Vấn đề còn hở cần user quyết định: "Consent"

`enrollment_options` set `consent` có value thật (vd "Yes"/"Not Yet") và ĐANG quản lý được qua `OptionSetManager` cũ. Nhưng trong `table_column`, cột `consent` có `type: "checkbox"` (không phải `"dropdown"`) — vì UI nhập liệu dùng `EnrollmentConsentToggle` 2-trạng-thái, không phải picklist. Picker mới ở mục trên chỉ liệt kê cột `type==="dropdown"` → **consent sẽ không lọt vào picker, mất hẳn chỗ set up value cho nó** nếu xoá `OptionSetManager` như 5 set kia.

3 lựa chọn:
- **(a)** Đặc cách thêm "Consent" vào picker dù `table_column` của nó là checkbox — picker match theo set-key thay vì chỉ theo `table_column.type`, tức là với scope aca/medicare, liệt kê thêm cả các `enrollment_option_sets` KHÔNG có `table_column` dropdown tương ứng (hiện chỉ có consent) như 1 mục riêng trong cùng picker.
- **(b)** Giữ nguyên hiện trạng: consent's values hiếm khi đổi (bản chất là toggle 2 trạng thái) → chấp nhận **không** di chuyển, để 1 đường set up rất nhỏ/hiếm dùng lại ở đâu đó (vd giữ 1 phần rút gọn của `OptionSetManager` chỉ cho consent, hoặc chấp nhận sửa thẳng DB khi cần).
- **(c)** Đổi `consent` trong `table_column` từ `checkbox` sang `dropdown` để nó tự động lọt vào picker như các set khác — nhưng ảnh hưởng UI nhập liệu (`EnrollmentConsentToggle`) đang cố tình dùng toggle nhanh hơn dropdown, cần cân nhắc có đáng đổi không.

**Cần bạn chọn (a)/(b)/(c) trước khi viết plan implementation.**

## Ngoài phạm vi
- Không đổi schema DB (không thêm/xoá cột nào ở `task_categories`/`enrollment_option_sets`/`enrollment_options`).
- Không đổi API route nào (giữ nguyên `/api/tasks/categories`, `/api/enrollment/option-sets`).
- Không đổi RBAC (`isManager` đã nhất quán cả 3 hệ thống).
- Không đụng cách CS/Enrollment **đọc** category/option (filter, badge, task creation dropdown, enrollment field picker) — chỉ đụng nơi **set up** chúng.
- Không đổi UI nhập liệu consent (`EnrollmentConsentToggle` 2-trạng-thái) trừ khi chọn phương án (c) ở trên.
