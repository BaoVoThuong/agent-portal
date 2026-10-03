# Lead Import theo mẫu cột cố định — Plan

**Ngày:** 2026-10-03 · **Trạng thái:** ĐÃ CODE (chưa commit) · **Phạm vi:** Event Leads → Import

> **Kết quả Bước 0 (read-only, 2026-10-03):**
> - (a) Lead chưa có cột trùng; cột custom duy nhất là `secondary_phone`, position lớn nhất là 95.
> - (b) Roster có quyền Lead chỉ 5 người. Khang Nguyen, Nam Nguyen khớp. Jennifer Thao Le (tài khoản tên "Jennifer Le"), Linh Le, Ann Strambler, Tami Phan có tài khoản nhưng **chưa có quyền Lead**. Thuy Nguyen **không có tài khoản**.
> - (c) Chạy thử file mẫu với 94 lead đang có: 71/71 dòng đọc được, 1 dòng không phone (dòng 50). Chỉ 1 dòng bị báo khách cũ: "Elizabeth" trùng tên 2 lead thử. 9 khách "Existing client" ghi tay không có trong Lead.
> - **User sửa (2026-10-03):** danh sách Agent là Config → Assistant membership (bảng `task_agents`, 17 người), KHÔNG phải người có quyền Lead. Mục 3.3 dùng `fetchTaskAgents()`. Chạy thử: 52/71 dòng gán được; "Thuy Nguyen" (10 dòng) không có trong danh sách (chỉ có Thuy Mai, Thuy Tien Hoang); 9 dòng không có Agent.
> - Khác plan: dò khách cũ chạy ở Node (không có RPC `find_lead_import_matches`) vì DB không có `unaccent`. Dialog không cần prop `assignees`; preview lấy hết từ route `dry_run`.

## 1. Bối cảnh

Đội gửi lead sau mỗi sự kiện bằng một Google Sheet có **13 cột cố định** (file mẫu:
`Untitled spreadsheet - Trung thu (0926).csv`, 71 dòng):

```
Full Name | Age | Gender | Phone Number | Email | Ticket # | Contact Method |
Best Time to Contact | Insurance Needs | Client's Note | Agent | FUB link | Note
```

Yêu cầu của user:
- Đây là các cột cố định. Import đọc thẳng theo mẫu, không bắt người dùng map từng cột.
- **11 cột chắc chắn có:** Full Name, Age, Gender, Phone Number, Email, Ticket #, Contact Method, Best Time to Contact, Insurance Needs, Client's Note, FUB link.
- **Agent và Note "hên xui":** có file có, có file không.
- Note trong file mẫu ("Existing client, assigned to X") là user **ghi tay**; khi go-live sẽ không có cột đó. Nên **lúc preview hệ thống phải tự dò khách cũ và cảnh báo** (mục 3.6).
- `Client's Note` + `Note` → `description`.
- Làm lại phần Import và phần dữ liệu (các cột để chứa dữ liệu này).

### 1.1 Import hiện tại (đọc từ code)

| Phần | File | Hiện làm gì |
|---|---|---|
| Dialog | `src/app/(authed)/tasks/leads/_components/LeadImportDialog.tsx` (811 dòng) | Chọn Product + Event cho cả file → chọn file → **bảng map cột** (đoán theo tên `guessMappingByName` + gợi ý AI qua `/api/leads/import/suggest-mapping`) → tick auto-assign → Import |
| Route | `src/app/api/leads/import/route.ts` | Nhận `file` + `mapping` JSON + `product` + `event_id` + `auto_assign`; `XLSX.read(..., { type: "array" })`; `parseLeadRows` → `partitionImportRows` → insert → (tuỳ chọn) `autoAssignLeads(ids, product)` |
| Map cột | `src/lib/leads/import-targets.ts`, `import-mapping.ts`, `src/lib/ai/import-mapping-agent.ts` | Đích map chỉ có `name`/`phone`/`email` + cột custom |
| Parse | `src/lib/leads/import-parse.ts` | Bỏ dòng thiếu phone / trùng phone trong file; cột custom giữ giá trị THÔ |
| Validate | `src/lib/leads/import-validate.ts` | `validateCustomValues` + Required |
| Dựng dòng | `buildNewLeadRow` trong `src/lib/leads/create.ts` | `products: [product]` — một product cho cả file |

### 1.2 Vấn đề tìm thấy khi chạy thử file mẫu (local, không đụng DB)

1. **CSV tiếng Việt bị hỏng chữ.**
   - `XLSX.read(buffer, { type: "array" })` đọc CSV theo latin1, nên `"Bé gái 2.5Y"` thành `"BÃ© gÃ¡i 2.5Y"` và `"đang có insurance"` cũng hỏng.
   - Dialog (đọc ở client) và route (đọc lại ở server) đều dính.
   - Đã thử: thêm `codepage: 65001` sửa được với `xlsx@0.18.5`. Đọc file xlsx thì không bị.
2. **Cột dropdown/multiselect không import được.**
   - `validateCustomValues` (`src/lib/table-config/custom-values.ts:96-108`) đòi giá trị là **option id**, trong khi file chứa **nhãn** ("Female", "Text, Phone").
   - Parse hiện tại không đổi nhãn sang id, nên mọi dòng có giá trị ở cột kiểu đó bị bỏ vì `invalid option`.
   - Hàm đổi sẵn có: `coerceCustomValue` (`src/lib/table-config/values.ts:98-117`) nhận `optionIdByLabel`.
3. Import không ghi `fub_link`, `description`, người nhận theo từng dòng, hay nhiều product — `buildNewLeadRow` có `fubLink`/`description` nhưng route không truyền.

### 1.3 Hồ sơ dữ liệu file mẫu (71 dòng)

| Cột | Có giá trị | Dạng | Ghi chú |
|---|---|---|---|
| Full Name | 71 | chữ | |
| Age | 15 | số | |
| Gender | 15 | `Female`×13, `Male`×2 | |
| Phone Number | 70 | số | **1 dòng chỉ có email** (Nhung Do) |
| Email | 3 | chữ | |
| Ticket # | 71 | số / chữ | `No ticket #`×8; có ô nhiều số `"4753, 4631, 4739"` |
| Contact Method | 8 | `Text`, `Email`, `Phone`, `Phone, Text` | nhiều giá trị |
| Best Time to Contact | 8 | `PM`, `AM`, `AM, PM` | nhiều giá trị |
| Insurance Needs | 34 | 8 nhãn, nhiều giá trị | Health Insurance, Medicare, Medicaid, Obamacare, Auto Insurance, Home Insurance, Life Insurance, College Funding |
| Client's Note | 15 | chữ nhiều dòng, tiếng Việt | |
| Agent | 62 | **tên người**: Khang Nguyen, Thuy Nguyen, Jennifer Thao Le, Linh Le, Ann Strambler, Tami Phan, Nam Nguyen | |
| FUB link | 71 | URL | có cả `http://` |
| Note | 9 | luôn là `Existing client, assigned to X` | **đúng 9 dòng Agent trống** |

Số điện thoại không trùng trong file. Tên khách trùng ("Quan Nguyen", "Phung") nhưng số khác nhau, nên là người khác nhau.

## 2. Quyết định

| # | Câu hỏi | Chốt |
|---|---|---|
| Q1 | Dòng là khách cũ | **User: cột Note do làm tay, go-live không có — preview phải tự dò và cảnh báo.** Không đọc chữ trong Note để đoán; dò trong dữ liệu Lead (mục 3.6). |
| Q6 | Dòng khách cũ thì import thế nào? | **User: preview báo ĐỎ, hiện lên ĐẦU, đề xuất xoá; tick thì xoá (không import dòng đó), không tick thì thôi (vẫn import).** Không tự gán cho người đang giữ khách. |
| Q7 | Dò khách cũ ở đâu, theo gì? | **User: dò trong data Lead; trùng một trong bốn trường — tên, phone, email, FUB link — là báo.** |
| Q2 | Insurance Needs có suy ra Product không? | **User: "thêm 1 cột đúng data Insurance Needs".** Insurance Needs là MỘT cột riêng giữ đúng dữ liệu trong file; **không** suy ra Product. Product của cả file vẫn chọn trong dialog như cũ (mặc định Unknown). |
| Q3 | Dòng không có số điện thoại (chỉ có email) | **User: "có gì ghi nấy".** Vẫn import; thiếu ô nào thì ô đó trống. Cùng tinh thần đó: giá trị lựa chọn chưa có trong danh sách thì **thêm lựa chọn mới**, không bỏ; `No ticket #` ghi nguyên như file. |
| Q4 | "Data" nghĩa là gì | (a) tạo 6 cột mới ở Lead Table Config bằng rollout SQL; (b) sau deploy **user tự Import file** qua màn hình. Không ghi vào production từ máy dev. *(đề xuất)* |
| Q5 | Bỏ hẳn bảng map cột + gợi ý AI? | Bỏ — user nói đây là các cột cố định. |

## 3. Mapping cố định

| Cột file | Đích | Xử lý |
|---|---|---|
| Full Name | `leads.full_name` | trim |
| Phone Number | `leads.phone` | `normalizePhone` (đã có); thiếu → vẫn import, phone trống (Q3) |
| Email | `leads.email` | lowercase |
| FUB link | `leads.fub_link` | trim, giữ nguyên |
| Client's Note + Note | `leads.description` | xem 3.2 |
| Agent | `leads.assigned_to_email` | khớp tên → email (3.3), gán qua `assign_leads_manual` |
| Insurance Needs | cột custom `insurance_needs` (multiselect) | giữ đúng từng giá trị trong file (Q2); không đụng `products` |
| Age | custom `age` (number) | |
| Gender | custom `gender` (dropdown: Female, Male) | |
| Ticket # | custom `ticket_number` (text) | ghi nguyên như file, kể cả `No ticket #`; số → chuỗi (`4619` → `"4619"`) |
| Contact Method | custom `contact_method` (multiselect: Phone, Text, Email) | |
| Best Time to Contact | custom `best_time_to_contact` (multiselect: AM, PM) | |

So khớp tiêu đề cột không phân biệt hoa thường và ký tự đặc biệt (`normalizeHeader`: lowercase, mọi chuỗi không phải chữ/số → một dấu cách, trim). Ví dụ "Ticket #" → "ticket", "Client's Note" → "client s note".
- Thiếu một trong **11 cột chắc chắn có** → preview hiện **cảnh báo đỏ** ghi tên cột thiếu: file có thể sai mẫu. Vẫn cho import ("có gì ghi nấy"), cột thiếu thì để trống.
- Không có **Agent** hoặc **Note** → bình thường, không cảnh báo. Agent không có thì mọi dòng vào pool (hoặc chia tự động nếu tick).
- Cột lạ → bỏ qua và hiện tên ra.

### 3.1 Product

Không suy ra từ file (Q2). Cả file dùng một product chọn trong dialog, đúng hành vi hiện tại của route (`product` trong form, mặc định `unknown`). Lead đã import thì đổi Product từng dòng trên bảng như bình thường.

### 3.2 Description

```ts
export function buildImportDescription(clientNote: string | null, note: string | null): string | null {
  const parts = [
    clientNote ? `Client's note: ${clientNote}` : null,
    note ? `Note: ${note}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join("\n") : null;
}
```

- Giữ nguyên xuống dòng bên trong ô (ví dụ "H3A1\n100K\nCA…").
- Luôn có nhãn đứng trước, để đọc là biết dòng nào là ghi chú của khách, dòng nào là ghi chú nội bộ.

### 3.3 Agent → email

- Nguồn: `fetchLeadAssignees()` (`src/lib/leads/assignees.ts`), tức người có `lead.work`/`lead.manage` và đang active. Cùng danh sách mà collaborator và Personal lead đang dùng.
- So khớp: bỏ dấu (`normalize("NFD")` + xoá dấu kết hợp), lowercase, gộp khoảng trắng.
- Ô Agent chứa email thì so thẳng với email.
- **Trùng tên** (2 tài khoản cùng tên) hoặc **không khớp** → dòng vẫn import nhưng chưa gán, tên đó vào danh sách `unmatchedAgents` để báo.
- Người nhận theo file **không cần** nằm trong Distribute pool. File nói rõ ai giữ lead, giống gán tay trên bảng.
- Dùng chung một hàm cho preview ở client và route ở server (`resolveImportAgent` trong `import-template.ts`), để preview không nói khác lúc import.

### 3.4 Giá trị lựa chọn — có gì ghi nấy

`validateCustomValues` đòi **option id**, file chứa **nhãn**. Route làm theo thứ tự:

1. Gom mọi nhãn của 4 cột lựa chọn (Gender, Contact Method, Best Time to Contact, Insurance Needs) trên toàn file. Multiselect tách bằng `parseMultiselectValue` (`src/lib/table-config/multiselect.ts`, tách theo dấu phẩy và xuống dòng).
2. So với `writeContext.options` của cột đó, **không phân biệt hoa thường, bỏ khoảng trắng thừa**.
3. Nhãn chưa có → tạo option mới bằng RPC có sẵn `create_table_column_option(p_column_id, p_label, p_color, p_position)` (đang dùng ở `src/app/api/config/columns/[id]/options/route.ts:79`). Lỗi trùng (`isUniqueViolation`) thì nghĩa là người khác vừa tạo cùng nhãn: đọc lại option là xong.
4. Đọc lại options → dựng `optionIdByLabel` → `coerceCustomValue(type, raw, { optionIdByLabel, optionIds })` (`src/lib/table-config/values.ts:98-117`) cho từng dòng → `partitionImportRows`.
5. Có tạo option mới thì gọi `broadcastTableConfigInvalidation(["lead"])` và trả `createdOptions: { column: string; label: string }[]` để màn hình nói ra.

Lý do tạo mới thay vì bỏ: user muốn dữ liệu đúng như file. Admin muốn gộp nhãn gõ sai thì sửa ở Lead Table Configuration như mọi option khác.

### 3.5 Dòng thiếu số điện thoại

- `phone` không còn là điều kiện để giữ dòng khi import. Chỉ bỏ dòng **trống hoàn toàn** (dòng thừa cuối CSV).
- Cờ Required của cột Phone trong Table Config **không áp cho import**. Các cột Required khác giữ luật cũ (6 cột mới không Required).
- Chặn trùng:
  - Dòng có phone: giữ luật cũ (cùng event + cùng số, có index DB).
  - Dòng không có phone: không có index nào chặn, nên route tự kiểm. Trong cùng event mà đã có lead **cùng FUB link**, hoặc (không có FUB link) **cùng email**, thì báo duplicate.
  - Không làm vậy thì import lại cùng file sẽ nhân đôi đúng những dòng này.
- Trùng trong chính file cũng theo khoá đó: phone, rồi FUB link, rồi email.

### 3.6 Dò khách cũ (chỉ trong Lead)

**Nguồn:** mọi lead **chưa archive**, ở mọi event, kể cả Personal lead.

**Bốn khoá — trùng MỘT khoá là báo (Q7):**

| Khoá | Chuẩn hoá trước khi so |
|---|---|
| Tên | bỏ dấu (`normalize("NFD")` + xoá dấu kết hợp, `đ`→`d`), lowercase, gộp khoảng trắng, bỏ dấu câu. So **nguyên tên**, không so một phần. |
| Phone | `normalizePhone` (đã có) |
| Email | trim + lowercase |
| FUB link | lấy **số id** trong `/people/view/<id>`; không có id thì so cả URL đã trim, bỏ `http(s)://` và `/` cuối |

- Tên ngắn kiểu "Phung", "Mai", "Chris" sẽ khớp nhầm khá nhiều. Đó là lý do mặc định **không tick** và preview ghi rõ khớp theo trường nào, để người import tự quyết.
- DB không có extension `unaccent`, nên so ở Node chứ không ở SQL. Route đọc các lead đang hoạt động, chỉ lấy `id, display_number, full_name, phone, email, fub_link, assigned_to_email, event_id, lead_events(name)`:
  - đọc theo trang 1.000 dòng, cùng cách `fetchAllLeads` (`src/lib/leads/queries.ts`) chia trang;
  - trần 20.000 dòng (`LEAD_MAX_ROWS`).
- Không cần hàm SQL mới.
- Hàm thuần `findExistingLeadMatches(fileRows, existingLeads)` trong `src/lib/leads/import-existing.ts`, trả về theo từng dòng file:
  ```ts
  type ExistingLeadMatch = {
    row: number;                       // số dòng Excel
    name: string | null;               // tên trong file
    matches: {
      leadId: string;
      label: string;                   // leadDisplayKey(display_number), vd "LD227"
      leadName: string | null;
      eventName: string | null;        // null = Personal lead
      owner: string | null;            // assigned_to_email
      on: ("name" | "phone" | "email" | "fub")[];
    }[];
    sameEventBlocked: boolean;         // xem dưới
  };
  ```
- **Cùng event + trùng phone** (hoặc dòng không phone mà trùng FUB/email, mục 3.5): import đằng nào cũng không ghi được, vì DB chặn hoặc luật 3.5 chặn. Nên ô tick **bị khoá ở trạng thái đã tick**, ghi chú "Already in this event".
- Mọi trường hợp khác (trùng tên, trùng ở event khác…): ô tick để người dùng chọn, **mặc định không tick**.

## 4. Các bước

### Bước 0 — Kiểm trước (CHỈ ĐỌC; cần user cho phép, hoặc user tự chạy)

```sql
-- a) Cột custom của Lead đang có — tránh tạo cột trùng nhãn với cột admin đã tạo tay
select key, label, type, archived_at from table_column where scope = 'lead' order by position;
-- b) Tên Agent trong file có khớp tài khoản không
select email, name, is_active from portal_account
where lower(name) in ('khang nguyen','thuy nguyen','jennifer thao le','linh le','ann strambler','tami phan','nam nguyen');
```

Bước 0c không cần SQL: viết xong `findExistingLeadMatches` thì chạy một script đọc trong scratchpad. Script lấy lead đang hoạt động (chỉ SELECT) rồi so với file mẫu, để biết 9 dòng "Existing client" có khớp lead nào không, và tên ngắn khớp nhầm bao nhiêu.

- Kết quả (a) quyết định rollout ở Bước 1: nếu đã có cột trùng nhãn thì dùng key của cột đó thay vì tạo mới.
- Kết quả (b) chưa khớp thì nói user trước khi import.
- Kết quả (c): 9 khách cũ đó có thể chưa từng là lead trong portal (Note của user nói họ là khách trong FUB). Không khớp thì vẫn đúng thiết kế, nhưng phải báo user rằng cảnh báo chỉ bắt được khách **đã có trong Lead**.

### Bước 1 — Rollout `supabase/rollouts/2026-10-03-lead-import-template-columns.sql`

- Thêm 6 cột custom với **key cố định**, `is_system = false` (admin vẫn đổi nhãn/màu được; import đọc theo key).
- Đặt sau cột cuối hiện có.
- `insurance_needs` hiện ở bảng. Năm cột còn lại `hidden_default = true` (bật lại được bằng nút cài đặt cột) và `show_in_detail = true`.

```sql
begin;
with base as (
  select coalesce(max(position), 0) as p from public.table_column where scope = 'lead'
)
insert into public.table_column
  (scope, key, label, type, is_system, position, hidden_default, show_in_detail, required)
select 'lead', v.key, v.label, v.type, false, base.p + v.ord, v.hidden, true, false
from base, (values
  ('age',                  'Age',                  'number',      1, true),
  ('gender',               'Gender',               'dropdown',    2, true),
  ('ticket_number',        'Ticket #',             'text',        3, true),
  ('contact_method',       'Contact Method',       'multiselect', 4, true),
  ('best_time_to_contact', 'Best Time to Contact', 'multiselect', 5, true),
  ('insurance_needs',      'Insurance Needs',      'multiselect', 6, false)
) as v(key, label, type, ord, hidden)
on conflict (scope, key) do nothing;

insert into public.table_column_option (column_id, label, position)
select c.id, o.label, o.position
from public.table_column c
join (values
  ('gender', 'Female', 0), ('gender', 'Male', 1),
  ('contact_method', 'Phone', 0), ('contact_method', 'Text', 1), ('contact_method', 'Email', 2),
  ('best_time_to_contact', 'AM', 0), ('best_time_to_contact', 'PM', 1),
  ('insurance_needs', 'Health Insurance', 0), ('insurance_needs', 'Medicare', 1),
  ('insurance_needs', 'Medicaid', 2), ('insurance_needs', 'Obamacare', 3),
  ('insurance_needs', 'Auto Insurance', 4), ('insurance_needs', 'Home Insurance', 5),
  ('insurance_needs', 'Life Insurance', 6), ('insurance_needs', 'College Funding', 7)
) as o(key, label, position) on o.key = c.key
where c.scope = 'lead' and c.archived_at is null
  and not exists (
    select 1 from public.table_column_option x
    where x.column_id = c.id and x.archived_at is null and lower(x.label) = lower(o.label)
  );
commit;
```

Không đổi `schema.sql`, vì đây là dữ liệu cấu hình chứ không phải cấu trúc bảng. Chạy lại an toàn nhờ `on conflict` và `not exists`.

### Bước 2 — Đọc bảng tính đúng UTF-8

File mới `src/lib/leads/import-read.ts`, dùng chung cho client và server:

```ts
import * as XLSX from "xlsx";

/** CSV từ Google Sheets là UTF-8; không có codepage thì SheetJS đọc latin1 và tiếng Việt vỡ. */
export function readFirstSheet(data: ArrayBuffer): {
  headers: string[];
  records: Record<string, unknown>[];
} {
  const workbook = XLSX.read(data, { type: "array", codepage: 65001 });
  // ... sheet đầu, headers = dòng 1 (trim, bỏ rỗng), records = sheet_to_json({ defval: null })
}
```

Thay hai chỗ đọc hiện tại: `LeadImportDialog.tsx` trong `handleFile`, và `import/route.ts` ngay sau `form.get("file")`.

### Bước 3 — `src/lib/leads/import-template.ts` (lib thuần, có test)

- `LEAD_IMPORT_TEMPLATE`: danh sách 13 cột theo đúng thứ tự file. Mỗi phần tử gồm `{ header, field }`, trong đó `field` là `"full_name" | "phone" | … | { customKey }`.
- `matchTemplateHeaders(headers)` → `{ byField, missingRequired, unknownHeaders }`.
- `parseTemplateRows(records, headerMatch)` → `{ rows: TemplateLead[], skipped }`. Trong đó:
  ```ts
  type TemplateLead = {
    row: number;                 // số dòng Excel (header = 1)
    full_name: string | null;
    phone: string | null;        // Q3: có thể trống
    email: string | null;
    fub_link: string | null;
    description: string | null;
    agentName: string | null;    // thô; route/preview tự resolve
    customLabels: Record<string, unknown>; // NHÃN, chưa đổi sang id
  };
  ```
  - Chỉ bỏ dòng trống hoàn toàn, và dòng trùng trong file theo khoá ở 3.5.
  - Giá trị ghi nguyên (trim), kể cả `No ticket #`.
- `buildImportDescription`, `resolveImportAgent(name, roster)`.
- `collectChoiceLabels(rows, columns)` → nhãn cần có theo từng cột; `toCustomValues(customLabels, columns, options)` → custom_values dạng id (mục 3.4).

**Test** (`import-template.test.ts`) dùng dữ liệu **tự bịa**, cùng hình dạng file mẫu. KHÔNG đưa file thật vào repo vì có tên, số điện thoại, email khách thật. Phải phủ các trường hợp:
- ô nhiều dòng;
- tiếng Việt có dấu;
- `"4753, 4631, 4739"`;
- `No ticket #`;
- `AM, PM`;
- Insurance Needs nhiều giá trị → mảng id đúng thứ tự;
- dòng chỉ có email;
- Agent trống + Note;
- tên Agent không dấu khớp với tên có dấu;
- tên trùng;
- tiêu đề viết khác hoa thường;
- nhãn lựa chọn chưa có, nên phải nằm trong danh sách cần tạo;
- trùng trong file theo FUB link khi dòng không có phone.

Test riêng `import-existing.test.ts`:
- khớp theo từng khoá trong 4 khoá;
- tên có dấu khớp tên không dấu;
- FUB `http://` khớp `https://`;
- một dòng khớp nhiều lead;
- cùng event + trùng phone thì `sameEventBlocked`;
- lead đã archive thì không tính.

### Bước 4 — Route `POST /api/leads/import`

Route nhận thêm `dry_run=true`.
- **Preview** gọi route với cờ này: chạy đủ mọi bước trừ ghi (không tạo option, không insert, không gán), rồi trả kế hoạch.
- **Import** gọi lại với `dry_run=false`.
- Một nguồn sự thật: preview nói gì thì import làm đúng vậy, không có bản tính lại ở client.
- `MAX_BYTES` hạ từ 5 MB xuống **4 MB**: Vercel chặn body trên 4.5 MB trước khi tới route (cùng lý do commit `7d729ec` hạ trần đính kèm). Một file 2.000 dòng CSV chỉ khoảng 300 KB.

Thứ tự mới:
1. Đọc `file`, `event_id`, `product`, `auto_assign`, `exclude_rows` (JSON mảng số dòng Excel mà người dùng tick xoá), `dry_run`. Bỏ `mapping`.
2. Đọc file bằng `readFirstSheet` → `matchTemplateHeaders` → thiếu cột bắt buộc thì trả 400 kèm tên cột.
3. `parseTemplateRows`.
4. `fetchWriteValidationContext` (giữ nguyên) → tạo option còn thiếu (3.4) → `toCustomValues` cho từng dòng → `partitionImportRows`. Hàm này đổi để nhận `TemplateLead` đã có `custom_values` là id, và bỏ qua Required của Phone (3.5).
5. `fetchLeadAssignees()` → `resolveImportAgent` cho từng dòng.
5b. Đọc lead đang hoạt động → `findExistingLeadMatches` (3.6). Dòng nằm trong `exclude_rows` hoặc `sameEventBlocked` thì bỏ, đếm vào `excludedRows`. Dòng khớp mà không tick thì import bình thường (Q6).
   - Server **kiểm lại** `exclude_rows` với chính kết quả dò. Số dòng lạ (không phải khách cũ) bị bỏ qua, để một request méo không xoá được dòng bất kỳ.
6. Kiểm trùng với DB:
   - dòng có phone: `findExistingPhones` (giữ nguyên);
   - dòng không phone: hàm mới `findExistingContacts(eventId, fubLinks, emails)`, cũng chia lô 200 như `findExistingPhones`.

   Sau đó insert bằng `buildNewLeadRow`, truyền thêm `fubLink` và `description`. Hai tham số này hàm đã nhận, chỉ là route chưa truyền. `NewLeadRowInput.phone` đổi từ `string` sang `string | null`; cột `leads.phone` trong DB vốn cho null, form Add lead vẫn bắt buộc phone như cũ.
7. Gán theo file: gom id theo email agent → mỗi agent gọi `assign_leads_manual(ids, email, actor, 'Imported: Agent column')` một lần.
8. Dòng chưa có agent:
   - Nếu tick auto-assign: `autoAssignLeads(ids, product)` như cũ, vì cả file một product.
   - Không tick: để ở pool.
9. Response thêm:
   - `assignedFromFile: number`;
   - `unmatchedAgents: { name: string; rows: number[] }[]`;
   - `createdOptions: { column: string; label: string }[]` (khi dry run: `optionsToCreate`);
   - `existingClients: ExistingLeadMatch[]` (mục 3.6), luôn có, kể cả khi dry run;
   - `excludedRows: number` (khi import thật);
   - `previewRows` (chỉ khi dry run): 10 dòng đầu đã xử lý xong, để vẽ bảng;
   - `missingHeaders: string[]` (cột tuỳ chọn không có trong file).

   Các trường cũ giữ nguyên tên.

Lead type: event chọn trong dialog thì là Event lead; không chọn event thì là Personal lead (`lead-type.ts`). Dòng không có Agent **không** tự gán cho người import — một file 70 lead không phải lead cá nhân của người bấm nút.

### Bước 5 — Dialog

- **Bỏ** bảng map cột, nhãn "AI", `aiState`/`aiFilled`, lệnh gọi `suggest-mapping`.
- Thêm khối **"Template"**:
  - liệt kê 13 cột;
  - nút **Download template** (tạo CSV chỉ có dòng tiêu đề bằng `Blob`, không gọi server);
  - sau khi chọn file: dấu ✓/✗ từng cột, cột lạ thì hiện "ignored".
- **Event**: giữ picker và nút tạo event mới như cũ; thêm lựa chọn rõ ràng "No event — Personal lead".
- **Product**: giữ như cũ, một product cho cả file.
- **Preview** lấy từ route với `dry_run=true`. Gọi ngay khi chọn file, và gọi lại khi đổi event (vì `sameEventBlocked` phụ thuộc event). Tick/bỏ tick khách cũ **không** gọi lại server: chỉ đổi số "sẽ import" ở client.
- **Khối ĐỎ ở ĐẦU preview — "Existing clients (N)"** (Q6):
  - Nền/viền đỏ (`border-[#ffbdad] bg-[#ffebe6] text-[#bf2600]`, cùng bảng màu lỗi đang dùng trong module).
  - Câu dẫn: "These rows match leads already in the system. Tick a row to remove it from this import."
  - Mỗi dòng file một hàng: ô tick **"Remove"** · số dòng Excel · tên trong file · danh sách lead khớp, mỗi lead một dòng: `LD227 · Anh Nguyen · Event: Trung thu · Agent: Ann Strambler · matched on phone, FUB`.
  - Dòng `sameEventBlocked`: ô tick bị khoá ở trạng thái đã tick, kèm "Already in this event".
  - Nút **"Tick all"** / **"Clear"** cho nhanh khi danh sách dài.
  - Ô tick gửi lên server qua `exclude_rows` lúc bấm Import.
- **Các cảnh báo khác** (bên dưới khối đỏ, tính trên toàn file):
  - 🔴 thiếu cột trong 11 cột chắc chắn có;
  - tên Agent không khớp;
  - số dòng không có phone (vẫn import);
  - nhãn lựa chọn sẽ được thêm mới vào cột nào.
- **Bảng preview** 10 dòng đầu: Name, Phone, Insurance Needs, Agent (đã resolve: tên người, hoặc "Unassigned", hoặc "⚠ not found"), Description rút gọn. Dòng khách cũ tô nền đỏ nhạt; dòng đã tick xoá thì gạch ngang.
- Nút Import ghi số thật: "Import 68 leads" (tổng trừ số dòng đang tick xoá).
- **Auto-assign**: đổi chữ thành "Distribute leads without an Agent".
- **Kết quả**: thêm "Assigned from file: N", danh sách Agent không khớp kèm số dòng, và các lựa chọn vừa tạo.
- `LeadsClient.onImported`: sau `reload()` gọi thêm `router.refresh()`. Trang Lead không nghe kênh cấu hình bảng (chỉ Task và Enrollment nghe), nên nếu không refresh thì option vừa tạo hiện ra dưới dạng id thô.
- Dialog cần danh sách người để preview khớp Agent: truyền thêm prop `assignees` từ `LeadsClient.tsx` (đã có sẵn ở đó). Import chỉ dành cho manager nên prop luôn là roster đầy đủ.

### Bước 6 — Xoá code chết (sau khi bước 4–5 xong)

- `src/app/api/leads/import/suggest-mapping/route.ts`
- `src/lib/ai/import-mapping-agent.ts` (và prompt riêng của nó trong `src/lib/ai/prompts/` nếu có; grep trước)
- `src/lib/leads/import-targets.ts` + test
- `src/lib/leads/import-mapping.ts` + test
- `parseLeadRows` trong `import-parse.ts` + test của nó. Giữ `normalizePhone`, vì `create.ts` và `patch.ts` dùng.

### Bước 7 — Kiểm tra

- `npx tsc --noEmit`, `npx vitest run`, `npx eslint`, `npm run build`.
- **KHÔNG chạy import thử ở local**: `.env.local` trỏ vào DB production, dev server import là ghi thật.
- Thử parser với file mẫu bằng script trong scratchpad, chỉ đọc file và in kết quả parse, không gọi Supabase. Kỳ vọng:
  - 71 dòng đều import, Nhung Do không có phone;
  - 62 dòng có Agent khớp (sau Bước 0b);
  - số dòng bị đánh dấu khách cũ, theo từng khoá, ghi vào đây sau Bước 0c;
  - không tạo option mới, vì rollout đã có đủ nhãn của file này;
  - không có chữ tiếng Việt nào bị vỡ.
- `changelog.md`: một entry.

### Bước 8 — Đưa lên (user làm)

1. Chạy rollout Bước 1 trên Supabase.
2. Deploy.
3. Mở Lead → Import → tạo event "Trung thu" (ngày 2026-09-26) → chọn file → xem preview → Import.

## 5. Không làm trong plan này

- Không cập nhật lead đã có (import chỉ TẠO). Số trùng trong cùng event vẫn báo "duplicate".
- Không suy ra Product từ Insurance Needs (Q2).
- Không đổi luật chặn trùng số.
