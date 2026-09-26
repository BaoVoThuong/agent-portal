-- =====================================================================
-- Authz Phase C (plan final §I.4): role mang grant {action, scope}, quản trị
-- role/account qua RPC nguyên tử có bất biến, và audit.
--
-- 1. roles.system_key — định danh bất biến cho role hệ thống (thay cho so tên):
--      super_admin          = role "Admin" (bảo vệ, admin khôi phục)
--      default_new_account  = role "Agent" (role mặc định cho account mới)
-- 2. roles.grants_managed + role_grants — role đã chuyển sang grant tường minh.
--    Role chưa chuyển vẫn được suy tương thích trong code (không đổi hành vi).
-- 3. access_audit — ai đổi quyền gì, khi nào.
-- 4. RPC: upsert_role_atomic, delete_role_atomic, assign_account_access_atomic,
--    delete_account_atomic. Bất biến "còn ≥ 1 admin khôi phục" nằm TRONG RPC,
--    có advisory lock, nên không lùi được bằng cách đổi route (audit C18).
--
-- Idempotent. Chạy SAU 2026-09-27-authz-phase-b.sql (cần access_version).
-- =====================================================================
begin;

alter table roles add column if not exists system_key text;
alter table roles add column if not exists grants_managed boolean not null default false;
create unique index if not exists roles_system_key_key on roles (system_key) where system_key is not null;

update roles set system_key = 'super_admin'
where name = 'Admin' and system_key is null
  and not exists (select 1 from roles where system_key = 'super_admin');
update roles set system_key = 'default_new_account'
where name = 'Agent' and system_key is null
  and not exists (select 1 from roles where system_key = 'default_new_account');

-- Backfill theo TÊN chỉ đúng khi production còn đúng hai tên này (review C
-- P2-02). Thiếu role nào thì DỪNG rollout (rollback cả transaction): gắn
-- system_key bằng tay theo id role đúng rồi chạy lại, ví dụ
--   update roles set system_key = 'super_admin' where id = '<id role admin>';
do $$
begin
  if not exists (select 1 from roles where system_key = 'super_admin' and is_active) then
    raise exception 'Không tìm thấy role admin khôi phục (system_key = super_admin, đang hoạt động). Gắn system_key theo id rồi chạy lại.';
  end if;
  if not exists (select 1 from roles where system_key = 'default_new_account' and is_active) then
    raise exception 'Không tìm thấy role mặc định cho account mới (system_key = default_new_account, đang hoạt động). Gắn system_key theo id rồi chạy lại.';
  end if;
end $$;

create table if not exists role_grants (
  role_id uuid not null references roles(id) on delete cascade,
  action text not null,
  scope text not null,
  created_at timestamptz not null default now(),
  primary key (role_id, action, scope)
);
create index if not exists role_grants_action_idx on role_grants (action, scope);

create table if not exists access_audit (
  id uuid primary key default gen_random_uuid(),
  actor_account_id uuid,
  actor_email text,
  event text not null,
  target_type text not null,
  target_id text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index if not exists access_audit_target_idx
  on access_audit (target_type, target_id, created_at desc);

alter table role_grants enable row level security;
revoke all on table role_grants from anon, authenticated;
alter table access_audit enable row level security;
revoke all on table access_audit from anon, authenticated;

-- Còn ít nhất một account ACTIVE giữ role ACTIVE có system_key = super_admin.
create or replace function assert_recovery_admin_exists()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from portal_account account
    join user_roles ur on ur.user_id = account.id
    join roles role on role.id = ur.role_id
    where account.is_active and role.is_active and role.system_key = 'super_admin'
  ) then
    raise exception using message = 'LAST_RECOVERY_ADMIN';
  end if;
end;
$$;

create or replace function upsert_role_atomic(
  p_role_id uuid,
  p_name text,
  p_description text,
  p_is_active boolean,
  p_grants jsonb,
  p_legacy_keys text[],
  p_actor_account_id uuid,
  p_actor_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role roles%rowtype;
  v_role_id uuid := p_role_id;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_before jsonb;
begin
  if v_name is null then
    raise exception using message = 'ROLE_NAME_REQUIRED';
  end if;

  -- Tên admin cũ vẫn là quyền trong luật tương thích: không cho role khác mang.
  if lower(v_name) in ('admin', 'super admin') then
    raise exception using message = 'ROLE_NAME_RESERVED';
  end if;

  if v_role_id is not null then
    select * into v_role from roles where id = v_role_id for update;
    if not found then
      raise exception using message = 'ROLE_NOT_FOUND';
    end if;
    if v_role.system_key = 'super_admin' then
      raise exception using message = 'ROLE_PROTECTED';
    end if;
    -- Role hệ thống không tắt được: tắt role mặc định là mọi account Google mới
    -- nhận một role không quyền (review C P2-01).
    if v_role.system_key is not null and p_is_active is false then
      raise exception using message = 'ROLE_SYSTEM_MUST_STAY_ACTIVE';
    end if;
    if exists (select 1 from roles where lower(name) = lower(v_name) and id <> v_role_id) then
      raise exception using message = 'ROLE_NAME_TAKEN';
    end if;
    v_before := jsonb_build_object(
      'name', v_role.name,
      'description', v_role.description,
      'is_active', v_role.is_active,
      'grants_managed', v_role.grants_managed,
      'grants', (
        select coalesce(jsonb_agg(g.action || ':' || g.scope order by g.action, g.scope), '[]'::jsonb)
        from role_grants g where g.role_id = v_role_id
      )
    );
    update roles
    set name = v_name,
        description = p_description,
        is_active = coalesce(p_is_active, is_active),
        updated_at = now()
    where id = v_role_id;
  else
    if exists (select 1 from roles where lower(name) = lower(v_name)) then
      raise exception using message = 'ROLE_NAME_TAKEN';
    end if;
    insert into roles (name, description, is_active, is_system)
    values (v_name, p_description, coalesce(p_is_active, true), false)
    returning id into v_role_id;
  end if;

  if p_grants is not null then
    delete from role_grants where role_id = v_role_id;
    insert into role_grants (role_id, action, scope)
    select v_role_id, g ->> 'action', g ->> 'scope'
    from jsonb_array_elements(p_grants) as g
    where coalesce(g ->> 'action', '') <> '' and coalesce(g ->> 'scope', '') <> ''
    on conflict do nothing;
    update roles set grants_managed = true where id = v_role_id;

    -- Bản chiếu permission phẳng cho code/điều hướng chưa chuyển sang grant.
    delete from role_permissions where role_id = v_role_id;
    insert into role_permissions (role_id, permission_key)
    select v_role_id, legacy.permission_key
    from unnest(coalesce(p_legacy_keys, array[]::text[])) as legacy(permission_key)
    where exists (select 1 from permissions p where p.key = legacy.permission_key)
    on conflict do nothing;
  end if;

  update portal_account
  set access_version = access_version + 1
  where id in (select user_id from user_roles where role_id = v_role_id);

  insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
  values (
    p_actor_account_id,
    p_actor_email,
    case when p_role_id is null then 'role.create' else 'role.update' end,
    'role',
    v_role_id::text,
    v_before,
    jsonb_build_object('name', v_name, 'description', p_description, 'is_active', p_is_active, 'grants', p_grants)
  );

  return v_role_id;
end;
$$;

create or replace function delete_role_atomic(
  p_role_id uuid,
  p_actor_account_id uuid,
  p_actor_email text
)
returns void
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
  if v_role.system_key is not null then
    raise exception using message = 'ROLE_PROTECTED';
  end if;
  -- Xoá role còn người là tước quyền cả nhóm trong im lặng (S19).
  if exists (select 1 from user_roles where role_id = p_role_id) then
    raise exception using message = 'ROLE_HAS_MEMBERS';
  end if;

  delete from roles where id = p_role_id;

  insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
  values (p_actor_account_id, p_actor_email, 'role.delete', 'role', p_role_id::text,
          jsonb_build_object('name', v_role.name), null);
end;
$$;

create or replace function assign_account_access_atomic(
  p_account_id uuid,
  p_role_id uuid,
  p_is_active boolean,
  p_actor_account_id uuid,
  p_actor_email text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account portal_account%rowtype;
  v_role roles%rowtype;
  v_before jsonb;
begin
  -- Mọi thao tác có thể làm mất admin khôi phục đi qua một khoá chung.
  perform pg_advisory_xact_lock(hashtextextended('authz-recovery-admin', 0));

  select * into v_account from portal_account where id = p_account_id for update;
  if not found then
    raise exception using message = 'ACCOUNT_NOT_FOUND';
  end if;

  v_before := jsonb_build_object(
    'role_ids', (select coalesce(jsonb_agg(role_id), '[]'::jsonb) from user_roles where user_id = p_account_id),
    'is_active', v_account.is_active
  );

  if p_role_id is not null then
    select * into v_role from roles where id = p_role_id;
    if not found or not v_role.is_active then
      raise exception using message = 'ROLE_INACTIVE';
    end if;
    delete from user_roles where user_id = p_account_id;
    insert into user_roles (user_id, role_id) values (p_account_id, p_role_id);
    -- Cột legacy vẫn là bản chiếu cho code chưa chuyển (gỡ ở Phase H).
    update portal_account
    set role = case when v_role.system_key = 'super_admin' then 'admin' else 'agent' end
    where id = p_account_id;
  end if;

  if p_is_active is not null then
    update portal_account set is_active = p_is_active where id = p_account_id;
  end if;

  update portal_account set access_version = access_version + 1 where id = p_account_id;

  perform assert_recovery_admin_exists();

  insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
  values (p_actor_account_id, p_actor_email, 'account.access', 'account', p_account_id::text, v_before,
          jsonb_build_object('role_id', p_role_id, 'is_active', p_is_active));
end;
$$;

create or replace function delete_account_atomic(
  p_account_id uuid,
  p_actor_account_id uuid,
  p_actor_email text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account portal_account%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('authz-recovery-admin', 0));

  select * into v_account from portal_account where id = p_account_id for update;
  if not found then
    raise exception using message = 'ACCOUNT_NOT_FOUND';
  end if;

  delete from portal_account where id = p_account_id;

  perform assert_recovery_admin_exists();

  insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
  values (p_actor_account_id, p_actor_email, 'account.delete', 'account', p_account_id::text,
          jsonb_build_object('email', v_account.email), null);
end;
$$;

revoke all on function assert_recovery_admin_exists() from public, anon, authenticated;
grant execute on function assert_recovery_admin_exists() to service_role;
revoke all on function upsert_role_atomic(uuid, text, text, boolean, jsonb, text[], uuid, text) from public, anon, authenticated;
grant execute on function upsert_role_atomic(uuid, text, text, boolean, jsonb, text[], uuid, text) to service_role;
revoke all on function delete_role_atomic(uuid, uuid, text) from public, anon, authenticated;
grant execute on function delete_role_atomic(uuid, uuid, text) to service_role;
revoke all on function assign_account_access_atomic(uuid, uuid, boolean, uuid, text) from public, anon, authenticated;
grant execute on function assign_account_access_atomic(uuid, uuid, boolean, uuid, text) to service_role;
revoke all on function delete_account_atomic(uuid, uuid, text) from public, anon, authenticated;
grant execute on function delete_account_atomic(uuid, uuid, text) to service_role;

commit;

-- Kiểm chứng
select
  (select name from roles where system_key = 'super_admin') as super_admin_role,
  (select name from roles where system_key = 'default_new_account') as default_role,
  to_regclass('public.role_grants') is not null as has_role_grants,
  to_regclass('public.access_audit') is not null as has_access_audit;
