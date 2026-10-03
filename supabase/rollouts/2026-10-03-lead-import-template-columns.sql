-- =====================================================================
-- Lead Import theo mẫu cột cố định (2026-10-03)
-- Plan: docs/superpowers/plans/2026-10-03-lead-import-template.md
--
-- Sáu cột của mẫu không có chỗ trên bảng `leads`, nên thành cột custom của
-- Lead Table Config với KEY CỐ ĐỊNH — Import đọc theo key
-- (src/lib/leads/import-template.ts, LEAD_IMPORT_CUSTOM_FIELDS). Admin vẫn đổi
-- nhãn/màu/ẩn hiện được như mọi cột custom khác.
--
-- Đã kiểm read-only 2026-10-03: scope 'lead' chưa có cột nào trùng key hay
-- nhãn (cột custom duy nhất là secondary_phone); position lớn nhất là 95.
--
-- Lựa chọn khởi tạo = đúng các giá trị trong file mẫu "Trung thu (0926)". File
-- sau có giá trị mới thì Import tự thêm lựa chọn ("có gì ghi nấy").
--
-- `hidden_default = false` cho cả 6: drawer Lead KHÔNG hiện cột ẩn mặc định
-- (LeadDetailDrawer.detailColumns), mà form tạo/drawer phải đủ trường như file.
-- Ai thấy bảng rộng thì ẩn cột bằng nút cài đặt cột.
--
-- Chạy lại an toàn: `on conflict` và `not exists`.
-- =====================================================================

begin;

with base as (
  select coalesce(max(position), 0) as p from public.table_column where scope = 'lead'
)
insert into public.table_column
  (scope, key, label, type, is_system, position, hidden_default, show_in_detail, required)
select 'lead', v.key, v.label, v.type, false, base.p + v.ord, v.hidden, true, false
from base, (values
  ('age',                  'Age',                  'number',      1, false),
  ('gender',               'Gender',               'dropdown',    2, false),
  ('ticket_number',        'Ticket #',             'text',        3, false),
  ('contact_method',       'Contact Method',       'multiselect', 4, false),
  ('best_time_to_contact', 'Best Time to Contact', 'multiselect', 5, false),
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

-- Kiểm sau khi chạy: 6 cột, 15 lựa chọn
-- select c.key, c.label, c.type, c.position, count(o.id) as options
-- from public.table_column c
-- left join public.table_column_option o on o.column_id = c.id and o.archived_at is null
-- where c.scope = 'lead' and c.key in
--   ('age','gender','ticket_number','contact_method','best_time_to_contact','insurance_needs')
-- group by c.key, c.label, c.type, c.position order by c.position;
