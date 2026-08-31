-- =====================================================================
-- Lead RBAC — cấp quyền theo quyết định 2026-09-01.
--
--   "chỉ có admin là lead manage, tất cả còn lại là lead work"
--
-- lead.work  = xem và làm việc trên lead ĐƯỢC GÁN cho mình, cộng lead của
--              agent mà mình là assistant (theo /config -> Assistant
--              membership, tức bảng agent_members với is_assistant = true).
--              KHÔNG kèm quyền gán, import, tạo lead hay sửa cấu hình.
-- lead.manage = toàn quyền: thấy tất cả, gán, import, Overview, Lead Config.
--
-- Trước file này chỉ role 'Admin' có quyền lead, nghĩa là đúng 3 tài khoản
-- dùng được module, và dropdown "gán cho ai" chỉ có 3 lựa chọn.
--
-- Idempotent. Chạy lại lần hai là no-op.
-- =====================================================================

-- ---------- 1. Mọi role không phải Admin đều là worker ----------
-- Cấp theo "trừ Admin" thay vì liệt kê tên role, để một role thêm sau này
-- không âm thầm bị bỏ sót và lại rơi vào đúng tình trạng hiện tại.
insert into role_permissions (role_id, permission_key)
select roles.id, 'lead.work'
from roles
where roles.name <> 'Admin'
on conflict (role_id, permission_key) do nothing;

-- ---------- 2. Admin giữ lead.manage ----------
-- Khẳng định lại cho chắc; Admin đang có sẵn nên đây thường là no-op.
insert into role_permissions (role_id, permission_key)
select roles.id, 'lead.manage'
from roles
where roles.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

-- Admin cũng cần lead.work: isWorker suy ra từ isManager trong code, nhưng
-- fetchLeadAssignees() đọc THẲNG bảng này để dựng danh sách người có thể nhận
-- lead. Thiếu dòng này thì một admin quản lý được lead mà không xuất hiện
-- trong dropdown gán của chính mình.
insert into role_permissions (role_id, permission_key)
select roles.id, 'lead.work'
from roles
where roles.name = 'Admin'
on conflict (role_id, permission_key) do nothing;

-- ---------- 3. Không ai ngoài Admin được giữ lead.manage ----------
-- Nếu trước đây có role nào được cấp nhầm thì thu lại ở đây.
delete from role_permissions rp
using roles
where rp.role_id = roles.id
  and rp.permission_key = 'lead.manage'
  and roles.name <> 'Admin';

-- ---------- Kiểm chứng ----------
-- Một dòng. Cả ba cột phải đọc ok.
select
  case when (select count(*) from role_permissions rp
             join roles r on r.id = rp.role_id
             where rp.permission_key = 'lead.manage' and r.name <> 'Admin') = 0
       then 'ok' else 'FAIL: role khác Admin còn lead.manage' end   as only_admin_manages,
  case when (select count(*) from roles r
             where r.name <> 'Admin'
               and not exists (select 1 from role_permissions rp
                               where rp.role_id = r.id
                                 and rp.permission_key = 'lead.work')) = 0
       then 'ok' else 'FAIL: có role chưa được cấp lead.work' end   as all_others_work,
  case when exists (select 1 from role_permissions rp
                    join roles r on r.id = rp.role_id
                    where r.name = 'Admin' and rp.permission_key = 'lead.manage')
       then 'ok' else 'FAIL: Admin mất lead.manage' end             as admin_manages;

-- ---------- Sau khi chạy: hai truy vấn để tự kiểm ----------
-- (a) Bao nhiêu người có thể nhận lead? Trước khi chạy file này là 3.
--
-- select count(*) as assignable
-- from portal_account pa
-- join user_roles ur on ur.user_id = pa.id
-- join role_permissions rp on rp.role_id = ur.role_id
-- where rp.permission_key in ('lead.work', 'lead.manage') and pa.is_active;
--
-- (b) Assistant nào chưa có role? Họ có membership nhưng sẽ bị chặn ngay ở
--     cổng /leads vì không có permission nào. Phải gán role cho họ trước.
--
-- select am.agent_email, am.cs_email,
--        coalesce(r.name, '(KHÔNG CÓ ROLE — sẽ không vào được)') as assistant_role
-- from agent_members am
-- left join portal_account pa on lower(pa.email) = lower(am.cs_email)
-- left join user_roles ur on ur.user_id = pa.id
-- left join roles r on r.id = ur.role_id
-- where am.is_assistant = true
-- order by (r.name is null) desc, am.agent_email;
