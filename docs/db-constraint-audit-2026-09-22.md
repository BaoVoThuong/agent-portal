# Rà soát check constraint của database — 22/09/2026

Xuất phát từ một lỗi thật: sửa bình luận trên hồ sơ Enrollment báo
`new row for relation "enrollment_activity" violates check constraint
"enrollment_activity_type_check"` và bình luận không lưu được.

Câu hỏi đặt ra: **còn constraint nào khác đang âm thầm gây lỗi như vậy không?**

## Kết luận ngắn

Rà hết 16 check constraint kiểu danh-sách-giá-trị trên toàn schema.
**Chỉ đúng một chỗ lệch: `enrollment_activity.type`.** Đã có rollout sửa.
15 chỗ còn lại đều nhận đủ mọi giá trị mà `schema.sql` khai.

## Vì sao lệch được

```sql
create table if not exists enrollment_activity (
  type text not null check (type in ( ... ))
);
```

`if not exists` **không đụng tới bảng đã tồn tại**. Thêm một giá trị vào danh
sách trong file không sửa được constraint của database đang chạy. Code đi trước,
constraint ở lại phía sau, và không có gì báo cho ai biết — cho tới khi người
dùng bấm Save và thấy lỗi Postgres thô hiện lên màn hình.

Hai bảng đã tránh được cái bẫy này vì có sẵn khối tự sửa
(`do $$ ... drop constraint ... add constraint ... $$`) đặt SAU câu create:
`task_activity` và `task_notifications`.

## Cách rà

1. Tách mọi khối `create table if not exists` trong `schema.sql`, lấy các check
   dạng `check (col in ('a','b',...))` — được 16 constraint trên 67 bảng.
2. Đối chiếu với `add constraint` ở nơi khác để biết cái nào tự sửa được.
3. Với mỗi constraint, đọc dữ liệu thật: giá trị nào đã có dòng trong bảng thì
   chắc chắn constraint cho phép — không cần dò.
4. Giá trị nào chưa có dòng nào dùng thì chèn thử một dòng rồi xoá ngay.

## Bảng kết quả

| Bảng.cột | Số giá trị | Tự sửa | Kết quả |
| --- | ---: | --- | --- |
| `enrollment_activity.type` | 16 | có¹ | **LỆCH — thiếu `comment_edited`, `comment_deleted`** |
| `task_notifications.type` | 3² | có | đủ |
| `enrollment_notifications.type` | 13 | không | đủ (dò `qc_stale`, `reopened`, `attachment_added`) |
| `user_table_layout.scope` | 8 | không | đủ (dò 6 scope chưa dùng) |
| `task_stage_cycles.stage` | 7 | không | đủ (dò `cancel`) |
| `leads.product` | 2 | không | đủ (dò `health`) |
| `table_column.scope` | 8 | không | đủ — mọi giá trị đã có dòng thật |
| `table_column.type` | 8 | không | đủ — mọi giá trị đã có dòng thật |
| `enrollment_option_sets.key` | 6 | không | đủ — mọi giá trị đã có dòng thật |
| `lead_statuses.kind` | 4 | không | đủ — mọi giá trị đã có dòng thật |
| `lead_alert_settings.product` | 2 | không | đủ — mọi giá trị đã có dòng thật |
| `lead_assignment_weights.product` | 2 | không | đủ — mọi giá trị đã có dòng thật |
| `task_sla_rules.priority` | 4 | không | đủ — mọi giá trị đã có dòng thật |
| `time_off_policies.code` | 4 | không | đủ — mọi giá trị đã có dòng thật |
| `import_request.scope` | 7 | không | **bảng rỗng, code không nơi nào dùng** |
| `import_request_row.action` | 3 | không | **bảng rỗng, code không nơi nào dùng** |

¹ Được thêm khối tự sửa trong chính lượt sửa lỗi này; trước đó là "không".
² Câu `create table` chỉ khai 3 giá trị, nhưng khối tự sửa bên dưới khai đủ —
production đang chạy với 20 giá trị. Không sai lúc chạy, chỉ là câu create đã
lạc hậu và gây hiểu nhầm cho người đọc file.

## Việc cần làm

**1. Chạy rollout sửa lỗi đang có**
`supabase/rollouts/2026-09-22-fix-enrollment-activity-comment-types.sql`

**2. Đã vá nguồn gốc.** `schema.sql` nay có khối tự sửa cho
`enrollment_activity`, nên lần sau thêm một loại hoạt động mới thì schema tự
hội tụ thay vì lệch âm thầm.

**3. Còn 12 constraint chưa có khối tự sửa** (cột "Tự sửa = không" ở trên).
Hiện KHÔNG cái nào sai, nhưng cái nào cũng có thể lệch theo đúng con đường vừa
rồi. Đáng theo dõi nhất là ba cái có khả năng phải thêm giá trị:

- `enrollment_notifications.type` — thêm loại thông báo mới là dính
- `table_column.type` — thêm kiểu cột mới là dính
- `table_column.scope` / `user_table_layout.scope` — thêm một bảng mới vào hệ
  thống cấu hình cột là dính, và **hai cái này phải sửa cùng lúc**

**4. Hai bảng chết.** `import_request` và `import_request_row` rỗng và không
có dòng code nào nhắc tới. Hoặc là tàn dư của một thiết kế bỏ dở, hoặc là phần
chuẩn bị cho tính năng import chưa bao giờ dùng tới — tính năng import thật
(Provider List, Enrollment) không đi qua hai bảng này. Nên xoá, nhưng cần xác
nhận trước.

## Câu SQL để tự kiểm lại bất cứ lúc nào

Cách dò ở trên phải chèn-rồi-xoá vì PostgREST không đọc được `pg_constraint`.
Trong SQL Editor thì một câu là đủ, và đây là nguồn đáng tin hơn:

```sql
select conrelid::regclass as bang,
       conname            as ten_constraint,
       pg_get_constraintdef(oid) as dinh_nghia
from pg_constraint
where contype = 'c'
  and connamespace = 'public'::regnamespace
order by 1, 2;
```

## Điều nên rút ra

`scripts/check-schema-drift.mjs` đang dò bảng, cột, hàm RPC và quyền — nhưng
**không dò check constraint**. Đó đúng là khe hở để lỗi này lọt ra production.
Thêm được thì tốt, nhưng phải có đường đọc `pg_constraint` (một RPC chỉ-đọc),
vì cách chèn-thử không an toàn để chạy tự động trên production.
