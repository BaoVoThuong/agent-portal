-- =====================================================================
-- Quyền mới: task.import
--
-- Vì sao tách khỏi task.export: Export chỉ ĐỌC, Import GHI ĐÈ hàng loạt —
-- một file sai sửa hàng trăm dòng trong một lượt. Cho người ta quyền kéo dữ
-- liệu ra không có nghĩa là cho quyền đẩy dữ liệu vào.
--
-- BẮT BUỘC chạy trước khi deploy code, vì `role_permissions.permission_key`
-- có khoá ngoại tới `permissions(key)`: thiếu dòng này thì màn Role Manager
-- lưu quyền sẽ hỏng với lỗi khoá ngoại.
--
-- Idempotent. Chạy lại không nhân đôi gì.
-- =====================================================================

begin;

insert into permissions (key, label, description, group_key, group_label, sort_order)
values (
  'task.import',
  'Tasks - Import',
  'Import enrollment and provider tables from Excel. Separate from Export because it OVERWRITES rows in bulk — read access is not write access. Required on its own.',
  'tasks',
  'Tasks',
  350
)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  sort_order = excluded.sort_order;

-- Mô tả cũ chỉ nhắc task và enrollment; nay Export có thêm Provider List.
update permissions
set description = 'Export task, enrollment and provider tables to Excel. Required on its own — a manager role alone does not grant export.'
where key = 'task.export';

-- Vai trò Admin vốn có MỌI quyền (schema.sql dựng bằng cross join permissions),
-- nên quyền mới phải được cấp cho nó, nếu không admin cũng không thấy nút Import.
insert into role_permissions (role_id, permission_key)
select r.id, 'task.import'
from roles r
where r.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

commit;

-- Kiểm chứng: phải thấy đúng 1 dòng quyền, và các vai trò đang được cấp.
select key, label, sort_order from permissions where key in ('task.import', 'task.export') order by sort_order;

select r.name as role, rp.permission_key
from role_permissions rp
join roles r on r.id = rp.role_id
where rp.permission_key in ('task.import', 'task.export')
order by rp.permission_key, r.name;

notify pgrst, 'reload schema';
