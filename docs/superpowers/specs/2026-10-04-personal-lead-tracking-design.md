# Theo dõi gọi / nhắn cho Lead + Import danh sách Personal lead — Thiết kế

Ngày: 2026-10-04 · Trạng thái: **chờ duyệt** · Mẫu thật: sheet "Foreign" (Personal lead
của agent, ~100 khách)

## 1. Bài toán

Event lead đến từ form nên file luôn đúng mẫu cột cố định — Import hiện tại xử lý tốt.
Personal lead là danh sách agent tự giữ trong Google Sheet, theo kiểu của họ. File
"Foreign" có các cột:

`First name · Last name · Phone · Secondary Phone · Email · Attempt # · Call Status ·
Last Call · Next Follow-up · Message/Email Status · Outcome · FUB`

Bốn cột dropdown trong sheet có bộ giá trị cố định:

| Cột | Giá trị |
|---|---|
| Call Status | Not Called · No Answer · Left Voicemail · Spoke to Client · Call Back Requested · Busy · Failed / Invalid Contact · Wrong Number · Completed |
| Message/Email Status | Not Sent · Sent · Delivered · Replied · Follow-up Sent · Failed / Invalid Contact |
| Attempt # | 0 - Not Called · 1 · 2 · 3 · 4+ |
| Outcome | Follow Up Later · Thinking About It · Already Covered · … |

Hệ thống hiện **không có chỗ chứa** Call Status, Message/Email Status, Outcome; luật
follow-up và luật chống trùng số chặn dữ liệu thật của file này.

## 2. Quyết định đã chốt (user, 2026-10-04)

1. Call Status / Last Call / Message Status lưu thành **lịch sử liên hệ**, mỗi lần liên
   hệ có **kết quả**; bảng hiện **Last Call Status** và **Message/Email Status**.
2. **Outcome** là cột riêng (dropdown), tách khỏi Status.
3. **Không** làm trường List / nguồn.
4. Cho **trùng số điện thoại nếu khác tên** (người nhà dùng chung số).
5. **Next Follow-up không bắt buộc status "Need to call back"** — mọi lead còn mở đều có
   ngày follow-up được.
6. Có cột **Attempt**.

## 3. Bốn khái niệm, không chồng nhau

Đây là chỗ dễ sai nhất. Hiện ô "Result" trong form ghi interaction **chính là Status của
lead** (`lead_interactions.status_id`), và bộ status mới (Called but no response, Can't
contact…) đang kiêm luôn vai "kết quả cuộc gọi". Thêm Last Call Status mà không tách
nghĩa thì người dùng phải chọn ba thứ gần giống nhau mỗi lần gọi.

| Khái niệm | Trả lời câu hỏi | Ai đổi | Ví dụ |
|---|---|---|---|
| **Status** (có sẵn) | Lead đang ở đâu trong quy trình? | Agent chọn | New, Called but no response, Quoted, Closed/Purchased |
| **Last Call Status** (mới) | Cuộc gọi gần nhất ra sao? | Tự cập nhật khi ghi một cuộc gọi | No Answer, Spoke to Client, Wrong Number |
| **Message/Email Status** (mới) | Tin nhắn/email gần nhất ra sao? | Tự cập nhật khi ghi một tin nhắn/email | Sent, Delivered, Replied |
| **Outcome** (mới) | Khách quyết định gì? | Agent chọn | Thinking About It, Already Covered |

Form ghi interaction đổi nhãn "Result" → **"Status"** (đúng bản chất) và thêm ô
**"Call result"** / **"Message result"** tuỳ loại interaction.

## 4. Mô hình dữ liệu

### 4.1 Bảng mới `lead_contact_results` — danh sách kết quả

Giống `lead_statuses`: admin sửa nhãn/màu/thứ tự, archive chứ không xoá.

```sql
create table lead_contact_results (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('call', 'message')),
  label text not null,
  color text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
-- nhãn không trùng trong cùng kênh
create unique index lead_contact_results_label_unique_idx
  on lead_contact_results (channel, lower(label)) where archived_at is null;
```

Seed theo đúng sheet, **bỏ "Not Called" / "Not Sent"**: hai giá trị đó là *chưa có*
cuộc gọi / tin nhắn nào, không phải kết quả của một lần liên hệ. Ô trống hiện chữ
"Not called" / "Not sent".

- call: No Answer, Left Voicemail, Spoke to Client, Call Back Requested, Busy,
  Failed / Invalid Contact, Wrong Number, Completed
- message: Sent, Delivered, Replied, Follow-up Sent, Failed / Invalid Contact

### 4.2 Loại interaction biết mình thuộc kênh nào

```sql
alter table lead_interaction_types
  add column channel text check (channel in ('call', 'message'));
-- Call → 'call'; Text, Email → 'message'; Note → null (không có kết quả)
```

### 4.3 Mỗi lần liên hệ có kết quả

```sql
alter table lead_interactions
  add column result_id uuid references lead_contact_results(id) on delete restrict;
```

RPC từ chối kết quả sai kênh (ghi Call mà chọn kết quả "Replied").

### 4.4 Lead lưu sẵn "lần gọi / nhắn gần nhất"

Cùng lý do bốn cột đếm hiện có được lưu sẵn (bảng list hàng trăm dòng không aggregate
từng dòng — MEDIUM-09):

```sql
alter table leads
  add column last_call_result_id uuid references lead_contact_results(id),
  add column last_call_at timestamptz,
  add column last_message_result_id uuid references lead_contact_results(id),
  add column last_message_at timestamptz;
```

`log_lead_interaction_atomic` là nơi ghi các cột này (như bốn cột đếm hiện nay), chỉ khi
lần liên hệ mới **không cũ hơn** lần đang lưu (ghi bù một cuộc gọi cũ không đè lần mới).

### 4.5 Outcome

Trường cố định dạng dropdown, giá trị trong `custom_values.outcome` — đúng cách sáu
trường của mẫu Import Event đang làm (`table_column` scope `lead`, `is_system = true`,
thêm `lead:outcome` vào `CUSTOM_VALUE_SYSTEM_COLUMNS` và `ADMIN_MANAGED_SYSTEM_COLUMNS`
trong `src/lib/table-config/system-option-columns.ts`). Admin thêm giá trị ở Table
Configuration; Import gặp giá trị lạ thì tự thêm (cơ chế `createMissingChoiceOptions`
đang có).

### 4.6 Attempt

Cột **Attempts** đã có (`contact_attempt_count`). Hiện nó đếm **mọi** liên hệ (gọi + nhắn
+ email). Trong sheet, "Attempt #" là **số lần gọi** ("0 - Not Called"). Xem quyết định
D1 ở mục 9.

## 5. Đổi luật

### 5.1 Follow-up cho mọi lead còn mở

| Status kind | Trước | Sau |
|---|---|---|
| scheduled (Need to call back) | bắt buộc có ngày | bắt buộc có ngày (giữ) |
| open (New, Called but no response, Quoted…) | **cấm** có ngày | **được** có ngày (tuỳ chọn) |
| won / lost | xoá ngày | xoá ngày (giữ) |

Sửa ở: `checkFollowUpInvariant` (`src/lib/leads/patch.ts`), `log_lead_interaction_atomic`
(bỏ `LEAD_FOLLOW_UP_REQUIRES_SCHEDULED` cho kind open), form ghi interaction (ô ngày
hiện cho mọi status còn mở, chỉ bắt buộc với scheduled), thông báo lỗi ở
`src/app/api/leads/[id]/interactions/route.ts`.

Cảnh báo "Overdue follow-up" **không cần sửa**: `resolveLeadAlerts` vốn đọc
`next_follow_up_at` bất kể status, và đã không báo cho lead won/lost.

### 5.2 Trùng số điện thoại: chỉ chặn khi trùng cả tên

Hai unique index đổi từ `(event, phone)` sang `(event, phone, tên chuẩn hoá)`:

```sql
-- tên chuẩn hoá: lower + gộp khoảng trắng
lower(regexp_replace(btrim(coalesce(full_name, '')), '\s+', ' ', 'g'))
```

- `leads_event_phone_unique_idx` → thêm tên.
- `leads_phone_no_event_unique_idx` (Personal) → thêm tên.

Phía code phải đổi cùng: khoá chống trùng trong file (`importDedupeKey`), dò trùng với
DB khi import (`findExistingPhones` + lượt thử lại sau lỗi 23505 ở
`src/app/api/leads/import/route.ts`), luật "đã có trong event này" của
`findExistingLeadMatches` (`sameEventBlocked`), câu báo lỗi 409 ở `POST /api/leads`.

Giới hạn đã biết: DB không bỏ dấu (`unaccent` không có), nên "Nguyễn" và "Nguyen" là hai
tên khác với DB nhưng giống với code. Code chặt hơn DB → chỉ dẫn tới một cảnh báo thừa,
không dẫn tới dữ liệu trùng.

## 6. Giao diện

- **Bảng Lead** thêm cột: *Last Call Status* (badge màu + "2 ngày trước"), *Message/Email
  Status*, *Outcome*. *Attempts* và *Next Follow-up* đã có.
- **Bấm ô Last Call Status** trên bảng → chọn kết quả → hệ thống **ghi một cuộc gọi**
  với kết quả đó (giống thao tác đổi dropdown trong sheet, nhưng lịch sử và số lần gọi
  vẫn đúng). Tương tự ô Message/Email Status (ghi một tin nhắn). Xem D3.
- **Drawer**: thêm các ô trên ở phần Lead details; form ghi interaction như mục 3.
- **Table Configuration → Dropdown values**: thêm nhóm *Call results* và *Message
  results* (sửa nhãn, màu, thứ tự, archive) — cùng khuôn nhóm Lead Status đang có.

## 7. Import danh sách Personal lead

### 7.1 Nhận diện định dạng

Có **hai mẫu**: *Event form* (mẫu hiện tại) và *Personal list* (mẫu mới, theo sheet
"Foreign"). Route chấm điểm header với cả hai (cùng cách `readSpreadsheet` đang chọn
sheet) và dùng mẫu khớp hơn; preview ghi "Detected format: Personal list". Nút Download
template cho chọn mẫu nào. Cột "bắt buộc" (chip đỏ ✗) tính theo mẫu đã nhận — Personal
list chỉ cần tên + một cách liên lạc, không đòi Age/Gender/Ticket.

Không làm bước ghép cột tự do (Phase 3).

### 7.2 Ghép cột Personal list

| Cột file | Vào đâu | Ghi chú |
|---|---|---|
| First name + Last name | Full Name | Ghép; tên VIẾT HOA HẾT thì đổi về dạng thường ("HELEN MYERS" → "Helen Myers"); tên gõ thường/hoa lẫn giữ nguyên |
| Phone | Phone | |
| Secondary Phone | `custom_values.secondary_phone` (cột có sẵn) | Bỏ nếu trùng Phone |
| Email | Email | |
| FUB | FUB link | |
| Call Status + Last Call | 1 interaction **Call**, `result_id` = Call Status, ngày = Last Call | "Not Called"/trống → không tạo |
| Message/Email Status | 1 interaction **Text**, `result_id` = giá trị | "Not Sent"/trống → không tạo; ngày = Last Call nếu có, không thì ngày import (D4) |
| Attempt # | Attempts | Quy tắc ở 7.3 |
| Outcome | `custom_values.outcome` | Giá trị lạ tự thêm vào dropdown |
| Next Follow-up | `next_follow_up_at` | Lead won/lost thì bỏ + ghi chú |
| *(không có)* | Status | Suy ra theo 7.4 |

Giá trị Call/Message Status lạ (không có trong danh sách) → **tự thêm** vào
`lead_contact_results` đúng kênh ("có gì ghi nấy").

### 7.3 Attempt

`Attempts = max(số trong file, số cuộc gọi tạo ra từ file)`. "4+" → 4; "0 - Not
Called" → 0. Nhờ `max`, dòng tự mâu thuẫn ("0 - Not Called" mà có Last Call) vẫn ra 1.
Lịch sử chỉ có cuộc gọi *gần nhất* (file không lưu các lần trước) — Attempts có thể lớn
hơn số dòng lịch sử, và đó là đúng.

### 7.4 Status suy ra

Đọc Outcome trước, rồi Call Status; so theo **nhãn** status hiện có (admin đổi nhãn thì
dòng đó rơi về New kèm cảnh báo trên preview):

| Điều kiện (theo thứ tự) | Status |
|---|---|
| Outcome = Already Covered | *D2* |
| Outcome = Thinking About It, hoặc Call Status = Call Back Requested — **và có Next Follow-up** | Need to call back |
| Call Status = Wrong Number / Failed / Invalid Contact | Can't contact |
| Call Status = No Answer / Left Voicemail / Busy | Called but no response |
| Call Status = Spoke to Client / Completed | Called but no response *(đã nói chuyện, chưa chốt — Outcome nói rõ hơn)* |
| còn lại | New |

### 7.5 Ghi lịch sử hàng loạt

`log_lead_interaction_atomic` khoá từng lead và chạy một lần mỗi interaction: 2.000 dòng
× 2 interaction = 4.000 lượt gọi DB — quá chậm cho một request. Thêm RPC
`import_lead_history(p_rows jsonb)`: chèn mọi interaction trong một câu lệnh và tính
`first/last_contacted_at`, `contact_attempt_count`, `last_call_*`, `last_message_*` cho
các lead **vừa tạo trong cùng lượt import** (chưa có lịch sử nào khác nên không tranh
chấp). Đây là chỗ thứ hai được ghi các cột đếm — phải ghi rõ trong chú thích schema.

Interaction import: `actor_email` = người import, `note` = "Imported from file".

### 7.6 Dòng rác và trùng trong file

- Bỏ dòng không có tên **và** không có phone/email/FUB (~70 dòng cuối file "Foreign").
- Trùng trong file = trùng **số + tên** (theo 5.2). Giữ dòng có Last Call mới nhất; dòng
  còn lại vào "Will be skipped" kèm lý do. ("Samina Nauren" ×2 → giữ dòng 08/19.)
- Người nhà chung số khác tên → import cả hai.

### 7.7 Dò khách cũ

Không đổi luật (phone / email / FUB link), trừ `sameEventBlocked` theo 5.2.

## 8. Chia giai đoạn

| Phase | Nội dung | Ra được gì |
|---|---|---|
| **1. Dữ liệu + giao diện** | Mục 4, 5, 6 | Agent ghi gọi/nhắn có kết quả, thấy Last Call Status / Message Status / Outcome / Attempts trên bảng; follow-up cho mọi lead mở; người nhà chung số |
| **2. Import Personal list** | Mục 7 | Import file "Foreign" giữ đủ lịch sử, status, follow-up |
| 3. (sau) Ghép cột tự do + AI gợi ý | — | File Personal kiểu khác bất kỳ |

Mỗi phase một plan riêng, viết sau khi bản thiết kế này được duyệt.

## 9. Cần quyết

- **D1. Attempts đếm gì?** Đề xuất: **chỉ đếm cuộc gọi** (đúng nghĩa "Attempt #" trong
  sheet). Hệ quả: cảnh báo "Max attempts" thành "gọi tối đa N lần"; tin nhắn/email vẫn
  tính là "đã liên hệ" (cảnh báo Never called / Stale không đổi). Rollout tính lại số đếm
  của lead hiện có từ lịch sử.
- **D2. "Already Covered" → Status nào?** Bộ status hiện không có nghĩa này ("Do not
  contact" = khách yêu cầu đừng liên hệ). Đề xuất thêm status đóng **"Not interested"**
  (kind lost); Outcome vẫn ghi "Already Covered".
- **D3. Đổi ô Last Call Status trên bảng = ghi một cuộc gọi mới?** Đề xuất **có**. Nếu
  không, ô chỉ đọc và phải mở drawer để ghi.
- **D4. Tin nhắn không có ngày** dùng ngày Last Call, không có thì ngày import — đúng ý
  bạn? (vd. Zaid Naman: Call Status trống, Last Call 08/06, Message Sent → tin nhắn ngày
  08/06.)

---

## 10. Review của agent kiến trúc (2026-10-04) — CHƯA đưa vào các mục trên

Tạm dừng ở đây, làm tiếp tuần sau. Các điểm dưới đã được kiểm lại trong code; user
chưa duyệt, nên các mục 1–9 phía trên CHƯA sửa theo.

### Lỗi đang có sẵn (độc lập với thiết kế mới)
- **Đổi Status sang won/lost từ ô bảng không ghi `closed_at`**: ô Status gọi PATCH
  `src/app/api/leads/[id]/route.ts`, mà đường đó không bao giờ ghi `closed_at`; chỉ
  `log_lead_interaction_atomic` ghi. Báo cáo "đã đóng" sai.
- **Tạo lead tay chọn được status scheduled mà không có ngày**: `POST /api/leads`
  (`src/app/api/leads/route.ts` ~130-143) chỉ kiểm status tồn tại.
- Đề xuất sửa gốc: trigger DB `lead_status_invariants` (BEFORE INSERT/UPDATE OF
  status_id, next_follow_up_at): won/lost ⇒ follow-up null + closed_at; open/scheduled
  ⇒ closed_at null; scheduled không ngày ⇒ lỗi.

### Sửa thiết kế được đề xuất
- Thêm status open **"Contacted"** (đã nói chuyện, chưa chốt) và lost **"Not
  interested"** (cho Already Covered; nếu dòng có Next Follow-up thì Need to call back).
- Thứ tự suy Status khi import: Already Covered → Not interested · có follow-up → Need
  to call back · Wrong Number/Failed → Can't contact · No Answer/Voicemail/Busy hoặc chỉ
  có tin nhắn chưa trả lời → Called but no response · Spoke/Completed/Call Back
  Requested/Replied → Contacted · không có bằng chứng liên hệ → New.
- `lead_statuses.system_key` (unique) để code đọc theo mã, không theo nhãn/position
  (`fetchDefaultLeadStatusId` hiện lấy theo position).
- `leads.prior_call_attempts` (chỉ import ghi): Attempts = prior + số interaction Call
  → tính lại từ lịch sử luôn đúng. Đổi nhãn cột thành "Call attempts".
- Bằng chứng cụ thể thắng con số: có Call Status ≠ trống/Not Called, hoặc Attempt ≥ 1,
  hoặc có Last Call mà không có message ⇒ tạo đúng 1 interaction Call.
- Follow-up không tự hết: khi log liên hệ sau ngày hẹn phải đặt ngày mới hoặc xoá
  (RPC). Nhánh `elsif p_follow_up_at is not null` của RPC phải xét kind hiện tại của
  lead.
- RPC: `first/last_contacted_at` dùng least/greatest (import có ngày lùi).
- `channel` thay cho `counts_as_contact` (gộp một cờ); khoá channel khi type đã có
  interaction.
- Import Personal chạy trong MỘT RPC/transaction `import_personal_leads` (insert lead +
  lịch sử cùng lúc). `actor_email` của interaction import = Agent sở hữu.
- Bỏ dòng import khi không có tên VÀ không có phone/email/FUB (hiện chỉ bỏ dòng trắng
  hoàn toàn — `import-template.ts` ~206).
- Secondary Phone nâng thành cột hệ thống (hiện custom, archive được), chuẩn hoá số.
- Thêm `lead:outcome` phải sửa cả hàm SQL `is_admin_managed_system_column`
  (schema.sql ~4235), không chỉ Set trong TS.
- Giá trị Call/Message result lạ từ file: so không phân biệt hoa thường, liệt kê
  trước trên preview (như `optionsToCreate`).
- D3: ô Last Call Status trên bảng là nút "Log call" (popover: result → status gợi ý →
  follow-up tuỳ chọn), không sửa giá trị trực tiếp; ô Message hỏi Text hay Email.
- D4: ngày message = Last Call; không có ⇒ ngày import + note "original date unknown"
  + cảnh báo preview.

### Còn chờ user quyết
1. Thêm status "Contacted" và "Not interested"?
2. Agent muốn bỏ Outcome "Follow Up Later" (trùng Status + ngày) và gộp message
   "Delivered" vào "Sent"; Claude muốn giữ cả hai. User chọn.
3. Sửa ngay 2 lỗi có sẵn (closed_at, scheduled không ngày) tách khỏi thiết kế lớn?
4. Sau khi chốt: cập nhật mục 1–9 rồi viết plan Phase 1.
