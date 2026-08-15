# Thứ tự chạy migration — 2026-08-15

Chạy **lần lượt từ 01 đến 12**. Mỗi file dán nguyên vào Supabase Studio → SQL Editor → Run.

Mỗi file đã tự bọc `begin; ... commit;` nên lỗi giữa chừng sẽ tự rollback trọn file.

---

## Vì sao cần chạy

Code trên `main` đang gọi **8 function mà database không có**. Kết quả: 8 endpoint trả lỗi.

Nặng nhất là `table_config_write_context` — nó được gọi **vô điều kiện** ở đầu 4 route lõi
(`src/app/api/tasks/route.ts:197`), nên hiện tại **mọi thao tác tạo/sửa task và enrollment đều trả 503**.

Function này **không có rollout file riêng** (thiếu sót ở commit `ae2ca0d`), chỉ nằm trong
`schema.sql:3780-3943` — nên file `01` được cắt trực tiếp từ đó.

---

## Bảng file

| File | Sửa được gì | Rủi ro |
|---|---|---|
| `01-write-context.sql` | **Tạo/sửa task + enrollment** (đang 503) | Không — chỉ tạo function |
| `02-agent-membership.sql` | Thêm assistant ở `/config` | Không |
| `03-reorder-rpc.sql` | Kéo thả thứ tự cột ở `/config` | Không |
| `04-sla-versioned.sql` | Lưu / xoá luật SLA | Không |
| `05-reminder-partial.sql` | Cài đặt nhắc việc | Không |
| `06-gin-indexes.sql` | Index cho đếm usage | Không |
| `07-usage-functions.sql` | Đếm usage trước khi archive dropdown | Không |
| `08-label-unique.sql` | Chặn trùng tên giá trị dropdown | Không |
| `09-category-guard.sql` | Chặn gán category đã tắt | Không |
| `10-attributed-idx.sql` | Index thiếu trong `schema.sql` | Không |
| `11-stage-setup.sql` | Chuẩn hoá catalog stage ACA/Medicare | ⛔ **KHÔNG ROLLBACK ĐƯỢC** |
| `12-stage-setup-verify.sql` | Kiểm tra bước 11 | Không — chỉ đọc |
| `13-aca-overview-backfill.sql` | Dashboard ACA Overview có số liệu | Thấp — 2 cột đang trống 100% |
| `14-stage-time-backfill.sql` | Thống kê thời gian mỗi stage / dwell | ⚠️ Ghi 667 record, snapshot trước |
| `15-backfill-verify.sql` | Kiểm tra bước 13 + 14 | Không — chỉ đọc |

**File 01 → 10 đều đảo ngược được** bằng `drop function` / `drop index`. Chạy thoải mái.

---

## Studio báo "destructive operations" ở file 01-05, 07, 09 — cảnh báo giả

Supabase Studio quét từ khoá một cách máy móc, **không phân biệt được câu lệnh thật với chữ nằm
trong thân function**. Thân function (giữa `$$ ... $$`) lúc tạo chỉ là một chuỗi văn bản, không chạy.

| File | Studio bắt chữ gì | Thực tế |
|---|---|---|
| 01, 02, 03, 05, 07 | `revoke` | Chỉ thu hồi quyền **trên đúng function vừa tạo trong file đó** |
| 04 | `delete from task_sla_rules` (dòng 33) | Nằm trong thân `delete_task_sla_rule_atomic`, chỉ chạy khi app **gọi** hàm đó về sau |
| 04 | `revoke` (dòng 36-37) | Như trên |
| 09 | `drop trigger if exists` (dòng 29) | Trigger này **chưa tồn tại**, và được tạo lại ngay 2 dòng dưới, trong cùng transaction |

**Chỉ file 11 là phá dữ liệu thật.** Muốn tự kiểm chứng, đếm số dòng trước và sau khi chạy — phải bằng nhau:

```bash
curl -s "$SUPABASE_URL/rest/v1/task_sla_rules?select=priority,duration_minutes" "${H[@]}"
# trước file 04: low/1440, medium/465, urgent/5, high/75  → sau khi chạy phải y hệt
```

---

## ⛔ Trước khi chạy file 11

File 11 **đổi tên label tại chỗ** và **archive mọi stage ngoài catalog chuẩn**. Đã commit là không lùi được.

**Bắt buộc snapshot trước:**

```sql
create table _bk_enrollment_options     as select * from enrollment_options;
create table _bk_enrollment_option_sets as select * from enrollment_option_sets;
create table _bk_enrollment_records     as select id, stage_id, stage_entered_at from enrollment_records;
```

**Những gì file 11 sẽ đổi** (số liệu đọc từ DB thật):

- Đổi tên: `5-Ready to enroll` → `5-Ready to Enroll`, `9-Assigned PCP/Get ID Card` → `9-Need ID card`,
  `10-DONE` → `10-ID card done`, `11-Terminated` → `12-Terminated`,
  `Can not get ID card` → `11-ID card unavailable`; Medicare `New` → `1-Need quote`,
  `E- ID Card Unavailable` → `10-ID card unavailable`, `10 - DONE` → `9-ID card done`
- Archive các stage ngoài catalog: **"Need call to renewal"**, **"Can't Contact"**
- Đổi `2-Quoted`: `triggers_qc` từ `true` → `false`
- Sửa lại position `1, 2, 30, 40…` thành `10, 20, 30…`

Record cũ **không mất dữ liệu** — file này tái dùng ID cũ khi đổi tên, và chỉ archive chứ không xoá.

### Đã sửa: gói thành một khối `DO` duy nhất

Bản đầu dùng `create temporary table ... on commit drop` ở cấp cao nhất rồi tham chiếu ở các câu
lệnh sau. Supabase Studio không giữ được temp table giữa các câu lệnh trong cùng script nên báo:

```
ERROR: 42P01: relation "_enrollment_stage_setup" does not exist
```

Gói tất cả vào một khối `DO $mig$ ... $mig$;` thì cả script là **một câu lệnh**: không client nào
tách được, temp table sống trọn thời gian chạy, và bất kỳ lỗi nào cũng rollback toàn bộ. Logic giữ
nguyên. Không dùng `drop table if exists` ở đầu khối — temp table khai báo `on commit drop` nên
không thể tồn tại sẵn, mà `drop table if exists <tên>` không kèm schema lại phân giải theo
`search_path`, có thể xoá nhầm bảng thật cùng tên trong `public`.

Cách này an toàn vì file 01→09 anh đã chạy thành công đều chứa `$$...$$` với hàng chục dấu `;`
bên trong — chứng tỏ Studio xử lý dollar-quote đúng.

File gốc `supabase/rollouts/2026-08-15-enrollment-stage-setup.sql` đã được ghi lại y hệt, để lần
sau không ai dính lại lỗi này.

### Đã sửa thêm so với rollout gốc: stage không map được → NULL

File 11 có thêm một bước (dòng 174, chạy **trước** bước archive): record nào đang trỏ vào stage
sắp bị archive thì đưa `stage_id`, `stage_entered_at`, `stage_entered_source` về `NULL`, thay vì
để nó trỏ vào một stage không còn chọn được trong picker.

Đã kiểm tra trước khi viết:
- `enrollment_records.stage_id` nullable (`schema.sql:4067`)
- `table_column` key `stage` có `required = false` ở cả `aca` và `medicare` → về null không chặn sửa record
- Ràng buộc `enrollment_records_stage_entered_pair_check` chỉ buộc
  `(stage_entered_at is null) = (stage_entered_source is null)` → set cả hai về null là hợp lệ
- Cả 2 record liên quan đã sẵn có `stage_entered_at = null` và `updated_by_email = 'system'`
  → trigger `enrollment_records_overview_timestamps` không ghi nhầm `last_work_activity_at`

**Đo trên data thật — đúng 2 record sẽ về null, đều thuộc ACA:**

| # | Khách | Agent | Stage bị archive |
|---|---|---|---|
| 20 | Tuyet Anh Tran - renewal callback | quin06101@gmail.com | Need call to renewal |
| 15 | Thu Le - cannot contact | tamiphanod.lifeins@gmail.com | Can't Contact |

Medicare: 0 record bị ảnh hưởng.

Sau khi chạy, vào app gán lại stage chuẩn cho 2 record này. File 12 có thêm khối kiểm tra khẳng định
không còn record nào trỏ vào stage đã archive, và in ra số record đang để `stage_id` null.

---

## Sau mỗi file, kiểm tra thế nào

Chạy trong terminal (từ thư mục `agent-portal`):

```bash
set -a && . ./.env.local && set +a
H=(-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json")

# 01 — phải trả về JSON có "columns", KHÔNG phải PGRST202
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/table_config_write_context" "${H[@]}" \
  -d '{"p_scope":"cs","p_mode":"patch","p_touched_system_keys":[],"p_touched_custom_keys":[],"p_submitted_custom_values":{}}'

# 04 — phải trả về SLA_RULE_INVALID (đúng), KHÔNG phải PGRST202 (chưa cài)
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/save_task_sla_rule_atomic" "${H[@]}" \
  -d '{"p_priority":"","p_category_id":null,"p_duration_minutes":0}'
```

Quy tắc chung: **`PGRST202` = chưa cài. Báo lỗi nghiệp vụ (`P0001`) = đã cài đúng.**

Sau file 12, thử trên app: tạo 1 task mới → phải thành công, không còn 503.

---

## Lưu ý

- **Không chạy nguyên `schema.sql`.** Nó chứa các câu ghi đè config admin đã chỉnh tay:
  `delete from role_permissions` cho role Admin/Agent (`:283`),
  `delete from dashboard_filter_defaults` (`:468`),
  và 4 câu `update table_column set pinned/required/show_in_detail` (`:5394+`).
  Hôm nay chúng vô hại, nhưng lần sau anh sửa config qua UI rồi chạy lại là mất.
- **Nếu bắt buộc phải chạy `schema.sql`**, phải chạy **SAU file 11**. Chạy trước thì seed stage
  trong `schema.sql` sẽ chèn stage mới với UUID mới, chặn toàn bộ bước đổi tên của file 11,
  làm **399/667 enrollment record trỏ vào stage đã archive** — mà khối verify vẫn báo pass.
- Đã bỏ `CONCURRENTLY` ở file 06 và 08: Supabase Studio tự bọc transaction nên `CREATE INDEX
  CONCURRENTLY` sẽ lỗi `cannot run inside a transaction block`. Bảng nhỏ (431 / 667 dòng) nên
  build thường chỉ vài mili-giây.

## File 13 + 14 — backfill dữ liệu phân tích

Hai rollout cũ đã tạo cột/trigger nhưng **phần backfill chưa từng chạy**, nên hai màn hình phân tích
đang trống. File 13 và 14 chạy đúng phần backfill đó.

**File 13** — nguồn `2026-08-13-aca-overview-schema.sql` dòng 67-84. Rủi ro thấp: chỉ ghi vào 2 cột
đang trống 100%, chỉ `program='aca'`, cả hai câu đều có guard `is null` nên chạy lại vô hại.

| Cột | Sẽ điền | Nguồn |
|---|---|---|
| `last_work_activity_at` | ~340 record ACA | `enrollment_activity` 1829 dòng |
| `responsible_assigned_at` | 340 record ACA | `created_at` của chính record |

**File 14** — nguồn `2026-08-09-enrollment-stage-time-backfill.sql`. Dựng lại `enrollment_stage_cycles`
từ `enrollment_stage_history` (682 dòng) và điền `stage_entered_at` cho 663 record.
Idempotent: mở đầu xoá sạch dòng `source='backfill'` rồi dựng lại; dòng `source='live'` do app ghi
không bị đụng.

File 14 có **6 invariant cứng**, sai bất kỳ cái nào là abort và rollback toàn bộ. Đã pre-validate
trên DB thật, tất cả đều qua. Chỗ suýt hỏng đáng ghi lại:

> Invariant #2 đòi mọi record active có stage phải có một cycle **mở**. Hai record duy nhất đang có
> `source='live'` cycle (#8 Zoe Nguyen, #23 Anh Nguyen) bị loại khỏi bước dựng cycle, mà cycle live
> của chúng là `entry_marker` **đã đóng**. Nếu hai record đó đang active thì invariant sẽ fail và cả
> file abort. Đã kiểm: **cả hai đều đã có `closed_at`**, nên không thuộc nhóm 527 record mà invariant
> áp dụng. Qua.

Ràng buộc `check ((stage_id is null) = (stage_entered_at is null))` mà file 14 thêm ở cuối cũng đã
kiểm: 2 record file 11 đưa về null có **cả hai cột** null nên thoả.

Trigger `enrollment_records_overview_timestamps` không can thiệp vào file 14: nhánh UPDATE của nó
chỉ bắn khi `updated_at` hoặc `responsible_enroll_email` đổi (`schema.sql:4467-4476`), mà file 14
không đụng hai cột đó.

Cả hai file đều đã `diff` với rollout gốc: **không câu SQL nào lệch**, chỉ khác phần khung `DO`.

---

## Việc riêng, chưa nằm trong thứ tự này

`supabase/rollouts/2026-08-09-enrollment-stage-time-backfill.sql` **chưa từng chạy**:
`enrollment_stage_cycles` chỉ có 2 dòng, và **2/667** enrollment record có `stage_entered_at`
trong khi 667/667 có `stage_id`. Nghĩa là mọi phân tích stage-time/dwell đang chạy trên đúng 2 record.
Chạy `schema.sql` cũng không sửa được. Cần lên lịch riêng, và phải làm **sau file 11**.
