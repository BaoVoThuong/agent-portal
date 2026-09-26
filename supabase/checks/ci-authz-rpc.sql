-- Cổng CI: kịch bản RPC quản trị role/account (authz Phase C) trên DB dùng một lần.
-- Chạy trong .github/workflows/db-persistence-gate.yml sau schema.sql + rollout.
-- Tạo account giả rồi ROLLBACK ở cuối, nên chạy nhầm cũng không để lại dữ liệu.
begin;

do $$
declare
  v_admin_role uuid := (select id from roles where system_key = 'super_admin');
  v_agent_role uuid := (select id from roles where system_key = 'default_new_account');
  v_role uuid;
  v_version int;
  v_failed boolean;
  v_account uuid;
begin
  if v_admin_role is null or v_agent_role is null then raise exception 'system_key backfill thiếu'; end if;

  insert into portal_account (id, email, name, role) values
    ('00000000-0000-0000-0000-0000000000a1', 'admin1@x.com', 'Admin 1', 'admin'),
    ('00000000-0000-0000-0000-0000000000a2', 'admin2@x.com', 'Admin 2', 'admin'),
    ('00000000-0000-0000-0000-0000000000c1', 'cs1@x.com', 'CS 1', 'agent');
  delete from user_roles where user_id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000c1');
  insert into user_roles (user_id, role_id) values
    ('00000000-0000-0000-0000-0000000000a1', v_admin_role),
    ('00000000-0000-0000-0000-0000000000a2', v_admin_role),
    ('00000000-0000-0000-0000-0000000000c1', v_agent_role);

  -- Tạo role mới có grant + bản chiếu
  v_role := upsert_role_atomic(null, 'Senior CS', 'test', true,
    '[{"action":"task.read","scope":"all"},{"action":"task.assign","scope":"agent_owned"}]'::jsonb,
    array['task.work','task.manage','khong.ton.tai'], null, 'admin1@x.com');
  if (select count(*) from role_grants where role_id = v_role) <> 2 then raise exception 'grant không lưu đủ'; end if;
  if not (select grants_managed from roles where id = v_role) then raise exception 'grants_managed chưa bật'; end if;
  if (select count(*) from role_permissions where role_id = v_role) <> 2 then raise exception 'bản chiếu sai (key lạ phải bị bỏ)'; end if;

  -- Tên dành riêng / trùng / role bảo vệ
  v_failed := false; begin perform upsert_role_atomic(null, 'Super Admin', null, true, null, null, null, null); exception when others then v_failed := sqlerrm = 'ROLE_NAME_RESERVED'; end;
  if not v_failed then raise exception 'tên Super Admin phải bị chặn'; end if;
  v_failed := false; begin perform upsert_role_atomic(null, 'senior cs', null, true, null, null, null, null); exception when others then v_failed := sqlerrm = 'ROLE_NAME_TAKEN'; end;
  if not v_failed then raise exception 'trùng tên (không phân biệt hoa thường) phải bị chặn'; end if;
  v_failed := false; begin perform upsert_role_atomic(v_admin_role, 'Admin 2', null, true, null, null, null, null); exception when others then v_failed := sqlerrm in ('ROLE_PROTECTED','ROLE_NAME_RESERVED'); end;
  if not v_failed then raise exception 'role Admin phải được bảo vệ'; end if;

  -- Gán role cho CS → version tăng, cột legacy theo system_key
  select access_version into v_version from portal_account where id = '00000000-0000-0000-0000-0000000000c1';
  perform assign_account_access_atomic('00000000-0000-0000-0000-0000000000c1', v_role, null, null, 'admin1@x.com');
  if (select access_version from portal_account where id = '00000000-0000-0000-0000-0000000000c1') <> v_version + 1 then raise exception 'version không tăng'; end if;
  if (select role from portal_account where id = '00000000-0000-0000-0000-0000000000c1') <> 'agent' then raise exception 'cột legacy sai'; end if;

  -- Sửa grant role → version thành viên tăng
  select access_version into v_version from portal_account where id = '00000000-0000-0000-0000-0000000000c1';
  perform upsert_role_atomic(v_role, 'Senior CS', 'test', true, '[{"action":"task.read","scope":"assigned"}]'::jsonb, array['task.work'], null, 'admin1@x.com');
  if (select access_version from portal_account where id = '00000000-0000-0000-0000-0000000000c1') <> v_version + 1 then raise exception 'version thành viên không tăng khi sửa role'; end if;

  -- Xoá role còn người → chặn
  v_failed := false; begin perform delete_role_atomic(v_role, null, null); exception when others then v_failed := sqlerrm = 'ROLE_HAS_MEMBERS'; end;
  if not v_failed then raise exception 'xoá role còn người phải bị chặn'; end if;
  v_failed := false; begin perform delete_role_atomic(v_agent_role, null, null); exception when others then v_failed := sqlerrm = 'ROLE_PROTECTED'; end;
  if not v_failed then raise exception 'role mặc định phải được bảo vệ khỏi xoá'; end if;
  v_failed := false; begin perform upsert_role_atomic(v_agent_role, 'Agent', null, false, null, null, null, null); exception when others then v_failed := sqlerrm = 'ROLE_SYSTEM_MUST_STAY_ACTIVE'; end;
  if not v_failed then raise exception 'role hệ thống không được tắt'; end if;

  -- Admin khôi phục: khoá admin2 được (còn admin1), khoá admin1 thì chặn
  perform assign_account_access_atomic('00000000-0000-0000-0000-0000000000a2', null, false, null, null);
  v_failed := false; begin perform assign_account_access_atomic('00000000-0000-0000-0000-0000000000a1', null, false, null, null); exception when others then v_failed := sqlerrm = 'LAST_RECOVERY_ADMIN'; end;
  if not v_failed then raise exception 'khoá admin cuối phải bị chặn'; end if;
  if not (select is_active from portal_account where id = '00000000-0000-0000-0000-0000000000a1') then raise exception 'transaction không rollback'; end if;
  v_failed := false; begin perform assign_account_access_atomic('00000000-0000-0000-0000-0000000000a1', v_agent_role, null, null, null); exception when others then v_failed := sqlerrm = 'LAST_RECOVERY_ADMIN'; end;
  if not v_failed then raise exception 'hạ role admin cuối phải bị chặn'; end if;
  v_failed := false; begin perform delete_account_atomic('00000000-0000-0000-0000-0000000000a1', null, null); exception when others then v_failed := sqlerrm = 'LAST_RECOVERY_ADMIN'; end;
  if not v_failed then raise exception 'xoá admin cuối phải bị chặn'; end if;

  if (select count(*) from access_audit) < 4 then raise exception 'thiếu audit'; end if;

  -- Định danh hoa hồng (Phase D): chuẩn hoá, duy nhất, xoá bằng null, có audit.
  if set_commission_name_atomic('00000000-0000-0000-0000-0000000000c1', '  jane   doe ', null, 'admin1@x.com') <> 'JANE DOE' then
    raise exception 'tên hoa hồng không được chuẩn hoá';
  end if;
  v_failed := false; begin perform set_commission_name_atomic('00000000-0000-0000-0000-0000000000a1', 'Jane Doe', null, null); exception when others then v_failed := sqlerrm = 'COMMISSION_NAME_TAKEN'; end;
  if not v_failed then raise exception 'tên hoa hồng trùng phải bị chặn'; end if;
  perform set_commission_name_atomic('00000000-0000-0000-0000-0000000000c1', null, null, null);
  if exists (select 1 from agent_commission_names where account_id = '00000000-0000-0000-0000-0000000000c1') then
    raise exception 'null phải xoá tên hoa hồng';
  end if;
  if (select count(*) from access_audit where event = 'account.commission_name') <> 2 then
    raise exception 'thiếu audit tên hoa hồng';
  end if;

  -- Roster / uỷ quyền (Phase G): ghi audit cùng transaction.
  if not add_task_agent_atomic('cs1@x.com', null, 'admin1@x.com') then raise exception 'thêm roster thất bại'; end if;
  if add_task_agent_atomic('cs1@x.com', null, 'admin1@x.com') then raise exception 'thêm roster lần hai phải là no-op'; end if;
  perform add_assistant_delegation_atomic('cs1@x.com', 'admin1@x.com', null, 'admin1@x.com');
  if not remove_assistant_delegation_atomic('cs1@x.com', 'admin1@x.com', null, 'admin1@x.com') then
    raise exception 'bỏ uỷ quyền thất bại';
  end if;
  perform add_assistant_delegation_atomic('cs1@x.com', 'admin1@x.com', null, 'admin1@x.com');
  if not remove_task_agent_atomic('cs1@x.com', null, 'admin1@x.com') then raise exception 'bỏ roster thất bại'; end if;
  if exists (select 1 from agent_members where agent_email = 'cs1@x.com') then
    raise exception 'bỏ roster phải xoá uỷ quyền của agent';
  end if;
  if (select count(*) from access_audit where event like 'org.%') <> 5 then
    raise exception 'thiếu audit roster/uỷ quyền: %', (select count(*) from access_audit where event like 'org.%');
  end if;
  v_failed := false; begin perform add_task_agent_atomic('ghost@x.com', null, null); exception when others then v_failed := sqlerrm = 'AGENT_ACCOUNT_INELIGIBLE'; end;
  if not v_failed then raise exception 'account không tồn tại không vào roster được'; end if;

  -- Chuyển role sang grant (Phase H): role Agent chuyển được đúng một lần; super_admin bỏ qua.
  if not convert_role_to_grants_atomic(v_agent_role, '[{"action":"task.read","scope":"assigned"}]'::jsonb, 'migration') then
    raise exception 'chuyển role Agent thất bại';
  end if;
  if convert_role_to_grants_atomic(v_agent_role, '[]'::jsonb, 'migration') then
    raise exception 'chuyển lần hai phải là no-op';
  end if;
  if convert_role_to_grants_atomic(v_admin_role, '[]'::jsonb, 'migration') then
    raise exception 'super_admin không được chuyển';
  end if;
  if not (select grants_managed from roles where id = v_agent_role) then raise exception 'grants_managed chưa bật'; end if;

  -- Tạo / sửa account nguyên tử (review C P2-04): lỗi ở bước sau thì KHÔNG còn gì.
  v_failed := false;
  begin
    perform create_account_atomic('new@x.com', 'New', 'EPS-NEW', 'hash', v_agent_role, 'Jane Doe', null, 'admin1@x.com');
    perform create_account_atomic('new2@x.com', 'New 2', 'EPS-NEW2', 'hash', v_agent_role, 'jane doe', null, 'admin1@x.com');
  exception when others then v_failed := sqlerrm = 'COMMISSION_NAME_TAKEN';
  end;
  if not v_failed then raise exception 'tên hoa hồng trùng khi tạo phải bị chặn'; end if;
  if exists (select 1 from portal_account where email = 'new2@x.com') then
    raise exception 'tạo account lỗi giữa chừng phải rollback';
  end if;
  v_account := create_account_atomic('new3@x.com', 'New 3', 'EPS-NEW3', 'hash', null, null, null, 'admin1@x.com');
  if not exists (select 1 from user_roles where user_id = v_account and role_id = v_agent_role) then
    raise exception 'tạo account không truyền role phải nhận role mặc định';
  end if;
  v_version := (select access_version from portal_account where id = v_account);
  v_failed := false;
  begin
    perform update_account_atomic(v_account, '{"name":"Renamed","agent_id":"EPS-NEW3"}'::jsonb, null, 'admin1@x.com');
    perform update_account_atomic(v_account, '{"name":"Nope","role_id":"00000000-0000-0000-0000-00000000dead"}'::jsonb, null, 'admin1@x.com');
  exception when others then v_failed := sqlerrm = 'ROLE_INACTIVE';
  end;
  if not v_failed then raise exception 'role không tồn tại phải bị chặn'; end if;
  if (select name from portal_account where id = v_account) <> 'New 3' then
    raise exception 'sửa account lỗi giữa chừng phải rollback cả tên';
  end if;
  perform update_account_atomic(v_account, '{"email":"new3b@x.com"}'::jsonb, null, 'admin1@x.com');
  if (select access_version from portal_account where id = v_account) <> v_version + 1 then
    raise exception 'đổi email phải tăng access_version';
  end if;
end $$;

select 'authz rpc gate: ok' as result;

rollback;
