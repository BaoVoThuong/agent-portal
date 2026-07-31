# Health Task — Table Features Design

**Ngày:** 2026-07-31
**Phạm vi:** 3 bảng của Health Task — CS (`/tasks`), Enroll ACA & Enroll Medicare (`/enrollment`).
**Trạng thái:** Design (chờ duyệt) → sau đó tách thành các implementation plan theo phase.

> Ghi chú ngôn ngữ: văn xuôi tiếng Việt, các định danh kỹ thuật (tên bảng, field, type) giữ tiếng Anh để implement.

---

## 1. Mục tiêu

Nâng 3 bảng Health Task từ "table display cố định" thành bảng **cấu hình được, cá nhân hoá được, và trao đổi dữ liệu được**, gồm 3 nhóm tính năng:

1. **Cột nâng cao (per-user layout)** — mỗi user tự sắp xếp cột cho riêng mình.
2. **Export / Import** — xuất Excel; import 2 lớp duyệt để đổ/đồng bộ dữ liệu từ hệ cũ.
3. **Admin thiết kế bảng (custom columns) + Trang Config** — admin định nghĩa cột (lưu DB, áp cho mọi người).

## 2. Hiện trạng (baseline)

Cả 3 bảng đã có: search, filter đa chiều (bar filter riêng), show/hide cột (localStorage), sort 1 cột, sticky cột cố định (Key/Client/QC), inline edit một phần (Stage/Assignee qua `patchRecord`).

- CS = bảng `tasks` (cột hardcode ở `task-list-columns.ts`).
- ACA/Medicare = bảng `enrollment_records` phân biệt bằng `program`; cột hardcode ở `EnrollmentClient.tsx` (`ACA_ENROLLMENT_COLUMNS`), Medicare là bản trimmed.
- Dropdown ACA đã có hệ option-set: `enrollment_option_set` + `enrollment_option` (label, color, position, is_terminal, triggers_qc, archived_at).
- Đã có sẵn: `xlsx` (SheetJS) trong deps; hệ RBAC (`@/lib/rbac/system-roles`, `buildTaskActor`, role admin/agent/assistant).

## 3. Thứ tự build (phân rã theo phase)

3 tính năng xếp tầng, nên chia thành 3 phase, mỗi phase có plan + implement riêng:

```
PHASE 1 — NỀN MÓNG: Trang Config + mô hình cột động (Config Table / Value / Assistant)
   → Biến "cột" từ hardcode thành dữ liệu DB. Không phase nào chạy trước cái này.

PHASE 2 — Per-user layout (#1) + Sort/Filter kiểu Excel (d)
   → Dựa trên danh sách cột động của Phase 1.

PHASE 3 — Export / Import + duyệt 2 lớp (#2)
   → Map cột & giá trị theo mô hình cột động của Phase 1.
```

Khuyến nghị làm **Phase 1 trước**. Spec này mô tả cả 3 nhưng khi sang implementation sẽ viết plan cho từng phase.

---

## 4. Mô hình dữ liệu (nền cho cả 3 phase)

### 4.1. `scope` — định danh bảng
Enum `table_scope`: `'cs' | 'aca' | 'medicare'`.
- `cs` → gắn với `tasks`.
- `aca` / `medicare` → gắn với `enrollment_records` (lọc theo `program`).

### 4.2. `table_column` — danh sách cột của mỗi bảng (system + custom chung 1 bảng)
Đây là "bản thiết kế cột" admin chỉnh. Mỗi scope có 1 danh sách cột có thứ tự, trộn cột hệ thống và cột custom.

| cột | kiểu | ghi chú |
|-----|------|---------|
| `id` | uuid | |
| `scope` | table_scope | |
| `key` | text | slug ổn định, unique theo scope. System dùng key gốc (`stage`, `client`…); custom sinh slug. |
| `label` | text | nhãn hiển thị (admin đổi được cho cả system). |
| `type` | column_type | `text\|number\|dropdown\|date\|checkbox\|link\|person`. |
| `is_system` | bool | true = cột lõi (map field thật + có logic riêng). |
| `position` | int | thứ tự mặc định (áp cho user chưa custom layout). |
| `hidden_default` | bool | mặc định ẩn hay hiện. |
| `required` | bool | (dự phòng — mặc định false ở bản đầu). |
| `created_by_email` / `created_at` / `updated_at` | | |
| `archived_at` | timestamptz | xoá = archive (giữ data). |

**Quyền chỉnh theo `is_system`** (đã chốt mục a):
- Cột **system**: admin chỉ được đổi `label`, `position`, `hidden_default`. Không xoá, không đổi `type`, không đổi `key`.
- Cột **custom**: admin toàn quyền thêm/sửa/xoá.

Seed: migration tạo sẵn các row system cho mỗi scope từ danh sách cột hardcode hiện tại, để admin reorder/rename/hide được ngay.

### 4.3. `table_column_option` — lựa chọn cho cột dropdown custom
Mirror `enrollment_option`: `id, column_id, label, color, position, archived_at`.
- Cột dropdown **system** của ACA vẫn dùng hệ `enrollment_option_set/option` cũ (không phá vỡ). Config Value hiển thị cả hai nguồn thống nhất trên UI.

### 4.4. Giá trị custom — cột `custom_values jsonb` trên bản ghi
Thêm `custom_values jsonb NOT NULL DEFAULT '{}'` vào `tasks` và `enrollment_records`.
- Key = `table_column.key`; value tuỳ type:
  - text/link → string; number → number; date → ISO date string; checkbox → boolean;
  - dropdown → `option_id` (uuid của `table_column_option`); person → email nhân viên.
- **Lý do chọn JSONB thay vì bảng value riêng (EAV):** filter/sort của app đang chạy **client-side** trên toàn bộ record đã load (`filterRecords`, `sortRecords`). JSONB cho toàn bộ giá trị custom về cùng 1 row khi load → không phát sinh N+1 join, render bảng vẫn 1 query, và filter/sort trong JS là sẵn có. Thêm/xoá cột chỉ là insert/delete definition, không cần DDL/migrate dữ liệu.

### 4.5. `user_table_layout` — layout riêng từng user (Phase 2 / #1)
| cột | kiểu |
|-----|------|
| `id` | uuid |
| `user_email` | text |
| `scope` | table_scope |
| `layout` | jsonb — mảng `{ column_key, position, width, hidden }` |
| `updated_at` | timestamptz |
Unique `(user_email, scope)`. Không có row = dùng mặc định từ `table_column`. Nút Reset = xoá row.

### 4.6. `import_request` (+ staging) — Phase 3 / #2
| cột | kiểu | ghi chú |
|-----|------|---------|
| `id` | uuid | |
| `scope` | table_scope | |
| `submitted_by_email` | text | |
| `status` | enum `pending\|approved\|rejected` | |
| `match_column_key` | text | cột admin chọn làm khoá khớp |
| `column_mapping` | jsonb | map cột file → `table_column.key` |
| `summary` | jsonb | `{ addCount, updateCount, errorCount }` |
| `reviewed_by_email` | text | **BẮT BUỘC khác `submitted_by_email`** (mục c) |
| `reviewed_at` / `reject_reason` | | |
| `created_at` | | |

Row đã parse để staging: `import_request_row(id, request_id, action 'add|update|error', target_record_id, values jsonb, error_text)`. Apply khi duyệt = đọc staging, ghi transactionally.

---

## 5. Phase 1 — Trang Config (admin-only)

Route mới, admin-only (dùng `isTaskViewAdmin`). Làm **3 mục mới trước**; các config cũ (Agent/SLA/Reminder/Category) **gom dần sau** (đã chốt).

### 5.1. Config Table
Chọn bảng (CS / ACA / Medicare) → xem danh sách cột (`table_column` theo scope), kéo đổi `position`, đổi `label`, toggle `hidden_default`.
- Nút **+ Thêm cột**: nhập label, chọn type (7 kiểu). Type=dropdown → mở editor option (mục Value).
- Cột custom: sửa/xoá (archive). Cột system: chỉ label/order/hidden.
- Type=person: value là email agent, dùng lại danh sách agent hiện có.

### 5.2. Config Value
Quản lý option cho các cột dropdown (label + color + position, archive). Hợp nhất nguồn: `table_column_option` (custom) và `enrollment_option` (system ACA) trên cùng UI.

### 5.3. Config Assistant
Quản lý **danh sách ai là Assistant** (thêm/bớt membership) — dùng lại RBAC role sẵn có, không định nghĩa quyền mới ở bản này.

## 6. Phase 2 — Per-user layout (#1) + Sort/Filter kiểu Excel (d)

### 6.1. Per-user layout
- Kéo **đổi thứ tự**, kéo **giãn width**, **ẩn/hiện** cột (gộp luôn show/hide đang có). **Không pin.**
- Lưu `user_table_layout` (DB, per user, per scope). Nút **Reset**.
- Key/Client giữ sticky mép trái làm mặc định sản phẩm (không phải control cho user).
- Danh sách cột khả dụng = `table_column` chưa archive của scope (gồm cả custom).

### 6.2. Sort/Filter kiểu Excel (AutoFilter)
Mỗi header cột có menu:
- **Sort** tăng/giảm (theo type: number/date so sánh đúng kiểu; text theo alphabet).
- **Filter**: checklist các giá trị distinct của cột (tính từ record đã load), có "Select all" + ô tìm trong menu; tick để giữ giá trị.
- Áp cho **mọi cột kể cả custom**. Tất cả chạy client-side (đúng kiến trúc filter/sort hiện tại).
- **Quick-filter phái sinh giữ nguyên** dạng toggle riêng (overdue / attention / QC needed / unowned / due-range) vì đó là trạng thái suy ra, không phải 1 giá trị cột.

## 7. Phase 3 — Export / Import (#2)

**Quyền:** Admin + Agent. **Assistant không được.**

### 7.1. Export
- Định dạng **Excel (.xlsx)** (dùng `xlsx` sẵn có).
- Mặc định xuất **theo view đang lọc** (respect filter + cột đang hiện + thứ tự sort). Có nút **Xuất toàn bộ**.
- Cột custom xuất theo label; giá trị render người-đọc-được (dropdown → label, person → tên, date → ngày).

### 7.2. Import (thêm mới + cập nhật, duyệt 2 lớp)
Luồng:
1. Người import (admin/agent) tải file (.xlsx/.csv qua `xlsx`).
2. **Map cột**: file column → `table_column.key`. Chọn **cột khoá khớp** (admin chọn lúc import — mục đã chốt).
3. Hệ thống parse + validate → **bản xem trước**: bao nhiêu dòng *thêm*, bao nhiêu *cập nhật* (khớp khoá), bao nhiêu *lỗi* (giá trị dropdown không tồn tại, date sai định dạng, person không tìm thấy…). Ghi vào `import_request` (status=pending) + staging rows.
4. **Admin duyệt** ở Trang Config (hoặc trang Import Requests): xem summary/preview → **Duyệt / Từ chối**.
   - **Người duyệt phải khác người import** (mục c) — kể cả admin tự import cũng cần admin khác duyệt.
5. Duyệt → apply transactionally (add + update). Từ chối → huỷ, không đụng DB.

**Edge case đơn admin:** nếu chỉ có 1 admin và chính họ import → không có người duyệt hợp lệ. Bản đầu: chặn + báo "cần thêm 1 admin để duyệt" (không tự nới lỏng quy tắc). Có thể xem lại sau.

## 8. Permissions (tổng hợp)

| Hành động | Admin | Agent | Assistant |
|-----------|:-----:|:-----:|:---------:|
| Xem bảng | ✓ | ✓ | ✓ |
| Per-user layout (#1) | ✓ | ✓ | ✓ |
| Sort/Filter Excel | ✓ | ✓ | ✓ |
| Export | ✓ | ✓ | ✗ |
| Import (submit) | ✓ | ✓ | ✗ |
| **Duyệt** import | ✓ (khác người submit) | ✗ | ✗ |
| Trang Config (Table/Value/Assistant) | ✓ | ✗ | ✗ |

## 9. Kiểm thử (điểm chính)

- Data model: seed system columns đúng cho 3 scope; archive cột không mất `custom_values`.
- JSONB read/write per type; dropdown value = option_id còn sống; person = email hợp lệ.
- Per-user layout tách biệt giữa các user & scope; reset trả về mặc định.
- Excel filter: distinct values đúng theo type; quick-filter phái sinh vẫn hoạt động song song.
- Import: khớp khoá đúng (add vs update); validate lỗi hiển thị đúng; **chặn self-approve**; apply transactional (một dòng lỗi không làm hỏng cả mẻ — hoặc all-or-nothing, chốt ở plan).
- Export: view đang lọc vs toàn bộ; Assistant bị chặn.

## 10. Câu hỏi mở (chốt ở giai đoạn plan)

1. Import apply là **all-or-nothing** hay **bỏ qua dòng lỗi, ghi phần còn lại**?
2. Custom column có cho **inline edit** trên bảng ngay không, hay chỉ sửa trong drawer? (mặc định đề xuất: có inline theo type, làm sau Phase 1).
3. `person` type: chọn từ toàn bộ agent hay giới hạn theo nhóm?
4. Có cần **audit log** riêng cho thao tác admin thiết kế cột không?
