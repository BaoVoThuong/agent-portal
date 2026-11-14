-- =====================================================================
-- Health State Licensing Map (2026-11-14)
--
-- Thay ảnh poster "Health State Licensing Map" bằng dữ liệu sửa được trên
-- portal (/health/licensing). Một appointment = 1 hãng × 1 sản phẩm × 1 bang.
--
--   licensing_products            cột sản phẩm (Obamacare, Medicare Advantage…)
--   licensing_appointments        hãng × sản phẩm × bang, trạng thái, ngày, ghi chú
--   licensing_appointment_agents  agent nào đã appoint
--   licensing_events              lịch sử; "Last updated" = event mới nhất
--
-- Quyền mới: health_licensing.view, health_licensing.manage (Manage bao gồm
-- View). Cấp Manage cho role Admin như mọi rollout thêm quyền.
--
-- BẮT BUỘC chạy trước khi deploy code (role_permissions có FK tới permissions,
-- và trang đọc các bảng này). Idempotent — chạy lại không nhân đôi gì.
-- Dữ liệu ban đầu ở file riêng 2026-11-14-health-licensing-seed.sql.
-- =====================================================================

begin;

create table if not exists licensing_products (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null check (length(btrim(label)) between 1 and 60),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into licensing_products (key, label, sort_order) values
  ('obamacare', 'Obamacare', 100),
  ('medicare_advantage', 'Medicare Advantage', 200),
  ('medicare_pdp', 'Medicare PDP', 300),
  ('medicare_supplement', 'Medicare Supplement', 400),
  ('uhc', 'UHC', 500)
on conflict (key) do nothing;

create table if not exists licensing_appointments (
  id uuid primary key default gen_random_uuid(),
  state_code text not null check (state_code ~ '^[A-Z]{2}$'),
  product_key text not null references licensing_products(key) on update cascade,
  carrier text not null check (length(btrim(carrier)) between 1 and 80),
  status text not null default 'active' check (status in ('active', 'pending', 'terminated')),
  appointed_on date,
  note text check (note is null or length(note) <= 1000),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references portal_account(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references portal_account(id),
  deleted_at timestamptz
);

create unique index if not exists licensing_appointments_cell_carrier_key
  on licensing_appointments (state_code, product_key, lower(btrim(carrier)))
  where deleted_at is null;
create index if not exists licensing_appointments_state_idx
  on licensing_appointments (state_code) where deleted_at is null;

create table if not exists licensing_appointment_agents (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references licensing_appointments(id) on delete cascade,
  account_id uuid not null references portal_account(id) on delete restrict,
  appointed_on date,
  unique (appointment_id, account_id)
);
create index if not exists licensing_appointment_agents_account_idx
  on licensing_appointment_agents (account_id);

create table if not exists licensing_events (
  id bigint generated always as identity primary key,
  appointment_id uuid references licensing_appointments(id) on delete set null,
  product_key text,
  state_code text,
  action text not null check (action in (
    'appointment.import', 'appointment.create', 'appointment.update', 'appointment.delete',
    'products.update')),
  before jsonb,
  after jsonb,
  actor_id uuid references portal_account(id),
  created_at timestamptz not null default now()
);
create index if not exists licensing_events_state_idx on licensing_events (state_code, id desc);

-- Không policy: chỉ service role (getSupabaseAdmin) đọc/ghi, như các bảng khác.
alter table licensing_products enable row level security;
alter table licensing_appointments enable row level security;
alter table licensing_appointment_agents enable row level security;
alter table licensing_events enable row level security;

-- Ảnh chụp một appointment kèm agent, dùng cho before/after của lịch sử.
create or replace function public.licensing_appointment_snapshot(p_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'carrier', a.carrier, 'state_code', a.state_code, 'product_key', a.product_key,
    'status', a.status, 'appointed_on', a.appointed_on, 'note', a.note,
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', x.account_id, 'appointed_on', x.appointed_on)
                       order by x.account_id)
      from licensing_appointment_agents x where x.appointment_id = a.id), '[]'::jsonb))
  from licensing_appointments a where a.id = p_id
$$;

-- p_id null = tạo mới. p_agents = [{"account_id": uuid, "appointed_on": "YYYY-MM-DD"|null}],
-- thay TOÀN BỘ danh sách agent. Thay đổi + dòng lịch sử trong cùng transaction.
create or replace function public.licensing_save_appointment(
  p_id uuid, p_state_code text, p_product_key text, p_carrier text, p_status text,
  p_appointed_on date, p_note text, p_agents jsonb, p_actor uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_before jsonb;
begin
  if not exists (select 1 from licensing_products where key = p_product_key and is_active) then
    raise exception 'LICENSING_PRODUCT_NOT_FOUND';
  end if;

  if p_id is not null then
    perform 1 from licensing_appointments where id = p_id and deleted_at is null for update;
    if not found then raise exception 'LICENSING_NOT_FOUND'; end if;
    v_before := public.licensing_appointment_snapshot(p_id);
    update licensing_appointments set
      state_code = p_state_code, product_key = p_product_key, carrier = btrim(p_carrier),
      status = p_status, appointed_on = p_appointed_on, note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now(), updated_by = p_actor
    where id = p_id
    returning id into v_id;
  else
    insert into licensing_appointments (state_code, product_key, carrier, status, appointed_on, note,
      sort_order, created_by, updated_by)
    values (p_state_code, p_product_key, btrim(p_carrier), p_status, p_appointed_on,
      nullif(btrim(coalesce(p_note, '')), ''),
      coalesce((select max(sort_order) + 1 from licensing_appointments
                where state_code = p_state_code and product_key = p_product_key and deleted_at is null), 0),
      p_actor, p_actor)
    returning id into v_id;
  end if;

  delete from licensing_appointment_agents where appointment_id = v_id;
  insert into licensing_appointment_agents (appointment_id, account_id, appointed_on)
  select v_id, (e->>'account_id')::uuid, nullif(e->>'appointed_on', '')::date
  from jsonb_array_elements(coalesce(p_agents, '[]'::jsonb)) e;

  insert into licensing_events (appointment_id, product_key, state_code, action, before, after, actor_id)
  values (v_id, p_product_key, p_state_code,
          case when p_id is null then 'appointment.create' else 'appointment.update' end,
          v_before, public.licensing_appointment_snapshot(v_id), p_actor);
  return v_id;
exception when unique_violation then
  raise exception 'LICENSING_DUPLICATE_CARRIER';
end $$;

-- Xoá mềm. Lịch sử giữ ảnh chụp lúc xoá.
create or replace function public.licensing_delete_appointment(p_id uuid, p_actor uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row licensing_appointments;
begin
  select * into v_row from licensing_appointments where id = p_id and deleted_at is null for update;
  if not found then raise exception 'LICENSING_NOT_FOUND'; end if;
  insert into licensing_events (appointment_id, product_key, state_code, action, before, actor_id)
  values (p_id, v_row.product_key, v_row.state_code, 'appointment.delete',
          public.licensing_appointment_snapshot(p_id), p_actor);
  update licensing_appointments set deleted_at = now(), updated_at = now(), updated_by = p_actor
  where id = p_id;
end $$;

-- Lưu cả bộ cột một lần: p_products = [{"key","label","is_active"}] theo thứ tự hiển thị.
-- Key chưa có = cột mới. Cột không có trong danh sách giữ nguyên (không xoá cột).
create or replace function public.licensing_save_products(p_products jsonb, p_actor uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'is_active', is_active) order by sort_order, key)
  into v_before from licensing_products;

  insert into licensing_products (key, label, sort_order, is_active)
  select e->>'key', btrim(e->>'label'), (ord * 100)::int, coalesce((e->>'is_active')::boolean, true)
  from jsonb_array_elements(p_products) with ordinality as t(e, ord)
  on conflict (key) do update set
    label = excluded.label, sort_order = excluded.sort_order, is_active = excluded.is_active;

  select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'is_active', is_active) order by sort_order, key)
  into v_after from licensing_products;

  if v_before is distinct from v_after then
    insert into licensing_events (action, before, after, actor_id)
    values ('products.update', v_before, v_after, p_actor);
  end if;
end $$;

revoke all on function public.licensing_appointment_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.licensing_save_appointment(uuid, text, text, text, text, date, text, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.licensing_delete_appointment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.licensing_save_products(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.licensing_save_appointment(uuid, text, text, text, text, date, text, jsonb, uuid)
  to service_role;
grant execute on function public.licensing_delete_appointment(uuid, uuid) to service_role;
grant execute on function public.licensing_save_products(jsonb, uuid) to service_role;

-- Quyền
insert into permissions (key, label, description, group_key, group_label, sort_order) values
  ('health_licensing.manage', 'State Licensing - Manage',
   'Everything in State Licensing - View, plus: add, edit and remove appointments and their agents, and change the product columns.',
   'health_licensing', 'State Licensing', 100),
  ('health_licensing.view', 'State Licensing - View',
   'Open the Health State Licensing Map and see every appointment and its history.',
   'health_licensing', 'State Licensing', 200)
on conflict (key) do update set
  label = excluded.label, description = excluded.description,
  group_key = excluded.group_key, group_label = excluded.group_label, sort_order = excluded.sort_order;

-- Admin giữ mọi quyền (src/lib/rbac/admin-role.ts). Chỉ lưu Manage — Manage bao gồm View.
insert into role_permissions (role_id, permission_key)
select r.id, 'health_licensing.manage' from roles r where lower(btrim(r.name)) = 'admin'
on conflict (role_id, permission_key) do nothing;

commit;

-- Kiểm
select key, label, group_key, sort_order from permissions where group_key = 'health_licensing' order by sort_order;
select r.name, rp.permission_key from role_permissions rp join roles r on r.id = rp.role_id
where rp.permission_key like 'health_licensing.%';
select key, label, sort_order, is_active from licensing_products order by sort_order;

notify pgrst, 'reload schema';
