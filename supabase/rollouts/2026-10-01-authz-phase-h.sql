-- Authz Phase H — chuyển mọi role sang grant tường minh.
--
-- File này CHỈ tạo hàm `convert_role_to_grants_atomic`. Việc chuyển dữ liệu do
-- script làm (grant tương thích được suy trong TypeScript, không phải SQL):
--
--   1. chạy file này;
--   2. npx vite-node -c vitest.config.ts scripts/authz-migrate-role-grants.ts
--      (dry-run: in account nào sẽ đổi quyết định — kỳ vọng 0);
--   3. thêm --apply để ghi;
--   4. RỒI MỚI deploy code Phase H (code Phase H không suy tương thích nữa:
--      role chưa chuyển = không có quyền).
--
-- Chạy SAU 2026-09-28-authz-phase-c.sql. Chạy lại an toàn.

begin;

-- Chuyển MỘT role sang grant tường minh (authz Phase H). Dùng bởi
-- scripts/authz-migrate-role-grants.ts. Không đổi tên, không đụng
-- role_permissions (giữ bản chiếu để có thể quay về code cũ). Role super_admin
-- và role đã chuyển: bỏ qua (trả false).
create or replace function convert_role_to_grants_atomic(
  p_role_id uuid,
  p_grants jsonb,
  p_actor_email text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role roles%rowtype;
begin
  select * into v_role from roles where id = p_role_id for update;
  if not found then
    raise exception using message = 'ROLE_NOT_FOUND';
  end if;
  if v_role.system_key = 'super_admin' or coalesce(v_role.grants_managed, false) then
    return false;
  end if;

  delete from role_grants where role_id = p_role_id;
  insert into role_grants (role_id, action, scope)
  select p_role_id, g ->> 'action', g ->> 'scope'
  from jsonb_array_elements(coalesce(p_grants, '[]'::jsonb)) as g
  where coalesce(g ->> 'action', '') <> '' and coalesce(g ->> 'scope', '') <> ''
  on conflict do nothing;
  update roles set grants_managed = true, updated_at = now() where id = p_role_id;

  update portal_account
  set access_version = access_version + 1
  where id in (select user_id from user_roles where role_id = p_role_id);

  insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
  values (null, p_actor_email, 'role.convert_to_grants', 'role', p_role_id::text,
          jsonb_build_object('name', v_role.name, 'grants_managed', false),
          jsonb_build_object('grants', p_grants));
  return true;
end;
$$;

revoke all on function convert_role_to_grants_atomic(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function convert_role_to_grants_atomic(uuid, jsonb, text) to service_role;

commit;

-- Kiểm chứng: số role chưa chuyển (ngoài super_admin). Sau bước 3 phải = 0.
select count(*) as roles_not_converted
from roles
where coalesce(system_key, '') <> 'super_admin' and not coalesce(grants_managed, false);
