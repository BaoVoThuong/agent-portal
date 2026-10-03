-- =====================================================================
-- Sáu trường của mẫu Import Lead thành TRƯỜNG CỐ ĐỊNH (2026-10-03)
--
-- Chạy SAU 2026-10-03-lead-import-template-columns.sql (đã chạy).
--
-- User: Age, Gender, Ticket #, Contact Method, Best Time to Contact, Insurance
-- Needs là trường cố định của Lead, không phải cột custom — Config không được
-- cho archive. Giá trị VẪN nằm trong `leads.custom_values` dưới key cũ, nên
-- không phải chuyển dữ liệu; code đọc chúng qua `storesInCustomValues`
-- (src/lib/table-config/system-option-columns.ts).
--
-- 1. Đánh dấu 6 cột `is_system = true` — Config hiện "System", ẩn Archive.
-- 2. Cho admin tiếp tục thêm/sửa lựa chọn của 4 cột lựa chọn (giống cột hệ
--    thống của Provider list). Danh sách provider giữ nguyên như rollout
--    2026-09-18-provider-specialty-multiselect.sql.
--
-- Chạy lại an toàn.
-- =====================================================================

begin;

update public.table_column
set is_system = true,
    updated_at = now()
where scope = 'lead'
  and key in ('age', 'gender', 'ticket_number', 'contact_method',
              'best_time_to_contact', 'insurance_needs')
  and archived_at is null;

create or replace function public.is_admin_managed_system_column(p_scope text, p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select (p_scope, p_key) in (
    ('provider', 'practices_as'),
    ('provider', 'obamacare'),
    ('provider', 'medicare'),
    ('lead', 'gender'),
    ('lead', 'contact_method'),
    ('lead', 'best_time_to_contact'),
    ('lead', 'insurance_needs')
  );
$$;

commit;

-- Kiểm sau khi chạy: 6 dòng, is_system = true
-- select key, label, type, is_system, position
-- from public.table_column
-- where scope = 'lead' and key in ('age','gender','ticket_number','contact_method',
--   'best_time_to_contact','insurance_needs')
-- order by position;
