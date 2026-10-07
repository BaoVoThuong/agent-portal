-- =====================================================================
-- Quyền mới: automation.provider_manage ("Provider List - Manage")
--
-- Hai tầng quyền trên Provider List:
--   automation.provider_finder  — xem bảng, chạy Finder, sửa ô (như cũ)
--   automation.provider_manage  — THÊM / XOÁ address, đổi cột của bảng Provider,
--                                 và Export / Import bảng Provider (không phải
--                                 Export / Import của Task hay Enrollment)
--
-- Quyền manage đứng TRÊN provider_finder: role chỉ có manage mà thiếu finder thì
-- không vào được Provider List. Vì vậy file này chỉ cấp manage cho role ĐÃ có cả
-- provider_finder và task.export (tức role đã được tin với dữ liệu provider):
-- trên production hiện là Admin, Linh Le, Sub Admin. Task CS và Health Agent giữ
-- nguyên xem / tìm / sửa ô nhưng mất nút Add address. Cấp thêm cho role nào khác
-- ở Role Manager.
--
-- ⚠ Lưu ý Import: trước đây chỉ Admin có task.import. Từ nay MỌI role có
-- provider_manage (Linh Le, Sub Admin) đều Import được bảng Provider.
--
-- BẮT BUỘC chạy TRƯỚC khi deploy code, vì `role_permissions.permission_key` có
-- khoá ngoại tới `permissions(key)`: thiếu dòng này thì Role Manager lưu quyền
-- mới sẽ hỏng với lỗi khoá ngoại. Chạy sau cũng không hại gì nhưng trong lúc chờ
-- không ai có nút Add address.
--
-- Idempotent. Chạy lại không nhân đôi gì.
-- =====================================================================

begin;

insert into permissions (key, label, description, group_key, group_label, sort_order)
values (
  'automation.provider_manage',
  'Provider List - Manage',
  'Add and delete provider addresses, change the Provider List columns, and export / import the Provider List. Needs Provider Finder as well.',
  'automation',
  'Automation',
  350
)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  sort_order = excluded.sort_order;

-- Admin vốn có MỌI quyền (schema.sql dựng bằng cross join permissions), nên quyền
-- mới phải được cấp cho nó, nếu không admin cũng mất nút Add address.
insert into role_permissions (role_id, permission_key)
select r.id, 'automation.provider_manage'
from roles r
where r.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

-- Role đã có CẢ provider_finder lẫn task.export.
insert into role_permissions (role_id, permission_key)
select r.id, 'automation.provider_manage'
from roles r
where exists (
        select 1 from role_permissions rp
        where rp.role_id = r.id and rp.permission_key = 'automation.provider_finder'
      )
  and exists (
        select 1 from role_permissions rp
        where rp.role_id = r.id and rp.permission_key = 'task.export'
      )
on conflict (role_id, permission_key) do nothing;

commit;

-- Kiểm chứng: phải thấy đúng 1 dòng quyền...
select key, label, sort_order from permissions where key = 'automation.provider_manage';

-- ...và các role đang được cấp. Mong đợi: Admin, Linh Le, Sub Admin.
select r.name as role,
       (select count(*) from user_roles ur where ur.role_id = r.id) as users
from role_permissions rp
join roles r on r.id = rp.role_id
where rp.permission_key = 'automation.provider_manage'
order by r.name;

-- Không role nào được có manage mà thiếu finder (phải trả 0 dòng).
select r.name as role_missing_finder
from role_permissions rp
join roles r on r.id = rp.role_id
where rp.permission_key = 'automation.provider_manage'
  and not exists (
    select 1 from role_permissions f
    where f.role_id = rp.role_id and f.permission_key = 'automation.provider_finder'
  );

notify pgrst, 'reload schema';
