-- Sửa theo review Codex các Phase A–C (docs/2026-09-26-authz-phase-*-code-review.md).
--
-- 1. upsert_role_atomic: role hệ thống không tắt được (review C P2-01).
-- 2. create_account_atomic / update_account_atomic: tạo / sửa account trong MỘT
--    transaction (review C P2-04, B P2-01).
--
-- Chạy SAU 2026-09-29-authz-phase-d.sql (cần set_commission_name_atomic). Chạy
-- lại an toàn.

begin;

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

-- Tạo / sửa account trong MỘT transaction: hồ sơ, role + trạng thái (qua
-- assign_account_access_atomic — khoá chung, bất biến admin khôi phục), tên hoa
-- hồng (set_commission_name_atomic), access_version và audit. Trước đây route
-- ghi từng bước rồi bù trừ, nên lỗi ở bước sau để lại trạng thái nửa vời
-- (review C P2-04, B P2-01).
create or replace function create_account_atomic(
  p_email text,
  p_name text,
  p_agent_id text,
  p_password_hash text,
  p_role_id uuid,
  p_commission_name text,
  p_actor_account_id uuid,
  p_actor_email text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_agent_id text := nullif(btrim(coalesce(p_agent_id, '')), '');
  v_role_id uuid := p_role_id;
  v_account_id uuid;
begin
  if v_email is null then
    raise exception using message = 'ACCOUNT_EMAIL_REQUIRED';
  end if;
  if exists (select 1 from portal_account where lower(btrim(email)) = v_email) then
    raise exception using message = 'ACCOUNT_EMAIL_TAKEN';
  end if;
  if v_agent_id is not null and exists (select 1 from portal_account where agent_id = v_agent_id) then
    raise exception using message = 'AGENT_ID_TAKEN';
  end if;
  if v_role_id is null then
    select id into v_role_id from roles where system_key = 'default_new_account' and is_active;
    if v_role_id is null then
      raise exception using message = 'ROLE_INACTIVE';
    end if;
  end if;

  insert into portal_account (email, name, agent_id, password_hash, role, is_active)
  values (v_email, nullif(btrim(coalesce(p_name, '')), ''), v_agent_id, p_password_hash, 'agent', true)
  returning id into v_account_id;

  perform assign_account_access_atomic(v_account_id, v_role_id, null, p_actor_account_id, p_actor_email);
  if nullif(btrim(coalesce(p_commission_name, '')), '') is not null then
    perform set_commission_name_atomic(v_account_id, p_commission_name, p_actor_account_id, p_actor_email);
  end if;

  insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
  values (p_actor_account_id, p_actor_email, 'account.create', 'account', v_account_id::text, null,
          jsonb_build_object('email', v_email, 'role_id', v_role_id));
  return v_account_id;
end;
$$;

-- `p_patch` chỉ chứa khoá cần đổi: email, name, agent_id, password_hash,
-- role_id, is_active, commission_name (có khoá với giá trị null = xoá).
create or replace function update_account_atomic(
  p_account_id uuid,
  p_patch jsonb,
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
  v_email text;
  v_agent_id text;
  v_changed jsonb := '{}'::jsonb;
begin
  select * into v_account from portal_account where id = p_account_id for update;
  if not found then
    raise exception using message = 'ACCOUNT_NOT_FOUND';
  end if;

  if p_patch ? 'email' then
    v_email := nullif(lower(btrim(coalesce(p_patch ->> 'email', ''))), '');
    if v_email is null then
      raise exception using message = 'ACCOUNT_EMAIL_REQUIRED';
    end if;
    if v_email <> lower(btrim(v_account.email)) then
      if exists (select 1 from portal_account where lower(btrim(email)) = v_email and id <> p_account_id) then
        raise exception using message = 'ACCOUNT_EMAIL_TAKEN';
      end if;
      update portal_account set email = v_email where id = p_account_id;
      v_changed := v_changed || jsonb_build_object('email', jsonb_build_object('from', v_account.email, 'to', v_email));
    end if;
  end if;

  if p_patch ? 'name' then
    update portal_account set name = nullif(btrim(coalesce(p_patch ->> 'name', '')), '') where id = p_account_id;
    v_changed := v_changed || jsonb_build_object('name', true);
  end if;

  if p_patch ? 'agent_id' then
    v_agent_id := nullif(btrim(coalesce(p_patch ->> 'agent_id', '')), '');
    if v_agent_id is not null and exists (
      select 1 from portal_account where agent_id = v_agent_id and id <> p_account_id
    ) then
      raise exception using message = 'AGENT_ID_TAKEN';
    end if;
    update portal_account set agent_id = v_agent_id where id = p_account_id;
    v_changed := v_changed || jsonb_build_object('agent_id', true);
  end if;

  if p_patch ? 'password_hash' then
    update portal_account set password_hash = p_patch ->> 'password_hash' where id = p_account_id;
    v_changed := v_changed || jsonb_build_object('password', true);
  end if;

  if p_patch ? 'role_id' or p_patch ? 'is_active' then
    perform assign_account_access_atomic(
      p_account_id,
      nullif(p_patch ->> 'role_id', '')::uuid,
      case when p_patch ? 'is_active' then (p_patch ->> 'is_active')::boolean else null end,
      p_actor_account_id,
      p_actor_email
    );
  end if;

  if p_patch ? 'commission_name' then
    perform set_commission_name_atomic(p_account_id, p_patch ->> 'commission_name', p_actor_account_id, p_actor_email);
  end if;

  -- Đổi email: phiên của người này phải làm mới ngay (cùng transaction).
  if v_changed ? 'email' then
    update portal_account set access_version = access_version + 1 where id = p_account_id;
  end if;

  if v_changed <> '{}'::jsonb then
    insert into access_audit (actor_account_id, actor_email, event, target_type, target_id, before, after)
    values (p_actor_account_id, p_actor_email, 'account.profile', 'account', p_account_id::text, null, v_changed);
  end if;
end;
$$;

revoke all on function create_account_atomic(text, text, text, text, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function create_account_atomic(text, text, text, text, uuid, text, uuid, text) to service_role;
revoke all on function update_account_atomic(uuid, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function update_account_atomic(uuid, jsonb, uuid, text) to service_role;

commit;

select count(*) as account_rpcs
from pg_proc
where proname in ('create_account_atomic', 'update_account_atomic');
