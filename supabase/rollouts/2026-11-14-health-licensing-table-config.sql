-- =====================================================================
-- Health State Licensing → Table Configuration (2026-11-14, đợt 2)
--
-- User 14/11: mỗi sản phẩm là một ô chọn NHIỀU, hãng là lựa chọn có màu, cả
-- hai quản trong Table Configuration như ACA plans / Medicare plans của
-- Provider List. Mỗi sản phẩm một danh sách hãng riêng.
--
--   scope mới 'licensing' trong table-config
--   sản phẩm      = table_column (scope 'licensing', type 'multiselect')
--   hãng          = table_column_option của cột đó (có màu)
--   appointment   = (bang, option) + trạng thái / ngày / ghi chú / agent như cũ
--
-- Chuyển dữ liệu: 5 sản phẩm → 5 cột, mỗi cặp (sản phẩm, hãng) → 1 option,
-- appointment trỏ option_id. Bỏ licensing_products, licensing_save_products,
-- cột carrier / product_key của appointment (đọc qua option).
--
-- Chạy SAU 2026-11-14-health-licensing.sql + -seed.sql, TRƯỚC khi deploy
-- code đợt 2. Cả file trong một transaction; chạy lại không hỏng gì (các bước
-- chuyển dữ liệu chỉ làm khi cột cũ còn).
-- =====================================================================

begin;

-- 1. Scope mới
alter table table_column drop constraint if exists table_column_scope_check;
alter table table_column add constraint table_column_scope_check check (scope = any (array[
  'cs', 'aca', 'medicare', 'medicaid', 'other_service', 'lead_pc', 'lead_health', 'lead', 'provider', 'licensing']));
alter table user_table_layout drop constraint if exists user_table_layout_scope_check;
alter table user_table_layout add constraint user_table_layout_scope_check check (scope = any (array[
  'cs', 'aca', 'medicare', 'medicaid', 'other_service', 'lead_pc', 'lead_health', 'lead', 'provider', 'licensing']));

create or replace function public.is_table_scope(p_scope text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select p_scope in ('cs', 'aca', 'medicare', 'medicaid', 'other_service', 'lead', 'provider', 'licensing');
$function$;

-- 2. Cột + lựa chọn từ dữ liệu đang có (chỉ khi bảng cũ còn)
do $$
begin
  if to_regclass('public.licensing_products') is null then
    return;
  end if;

  insert into table_column (scope, key, label, type, is_system, position, hidden_default, archived_at)
  select 'licensing', p.key, p.label, 'multiselect', false, p.sort_order / 10, false,
         case when p.is_active then null else now() end
  from licensing_products p
  on conflict (scope, key) do nothing;

  -- Một màu cho mỗi tên hãng, giống nhau ở mọi sản phẩm (bảng màu chung của
  -- table-config, TASK_CATEGORY_COLORS). Thứ tự = thứ tự xuất hiện đầu tiên.
  insert into table_column_option (column_id, label, color, position)
  select c.id, x.carrier,
         (array['#ffab00','#ff7452','#00b8d9','#6554c0','#36b37e','#4c9aff','#5e6c84'])
           [1 + mod(abs(hashtext(lower(btrim(x.carrier)))), 7)],
         row_number() over (partition by c.id order by x.first_order, lower(x.carrier)) * 10
  from (
    select product_key, carrier, min(sort_order) as first_order
    from licensing_appointments
    group by product_key, carrier
  ) x
  join table_column c on c.scope = 'licensing' and c.key = x.product_key
  where not exists (
    select 1 from table_column_option o
    where o.column_id = c.id and o.archived_at is null and lower(btrim(o.label)) = lower(btrim(x.carrier))
  );
end $$;

-- 3. Appointment trỏ option
alter table licensing_appointments add column if not exists option_id uuid references table_column_option(id);

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'licensing_appointments' and column_name = 'carrier') then
    return;
  end if;

  update licensing_appointments a
  set option_id = o.id
  from table_column c
  join table_column_option o on o.column_id = c.id and o.archived_at is null
  where a.option_id is null
    and c.scope = 'licensing' and c.key = a.product_key
    and lower(btrim(o.label)) = lower(btrim(a.carrier));

  if exists (select 1 from licensing_appointments where option_id is null) then
    raise exception 'LICENSING_MIGRATION: % appointments have no matching option',
      (select count(*) from licensing_appointments where option_id is null);
  end if;
end $$;

alter table licensing_appointments alter column option_id set not null;
drop index if exists licensing_appointments_cell_carrier_key;
create unique index if not exists licensing_appointments_state_option_key
  on licensing_appointments (state_code, option_id) where deleted_at is null;
create index if not exists licensing_appointments_option_idx on licensing_appointments (option_id);

-- 4. Bỏ đường cũ
drop function if exists public.licensing_save_appointment(uuid, text, text, text, text, date, text, jsonb, uuid);
drop function if exists public.licensing_save_products(jsonb, uuid);
alter table licensing_appointments drop column if exists carrier;
alter table licensing_appointments drop column if exists product_key;
drop table if exists licensing_products;

-- events.action: không còn ghi 'products.update' (cột đổi ở Table Configuration)
-- nhưng dòng cũ vẫn giữ, nên ràng buộc giữ nguyên giá trị đó.

-- 5. Option hợp lệ cho licensing: còn hoạt động, thuộc cột multiselect còn hoạt động.
create or replace function public.licensing_option_column(p_option_id uuid)
returns table_column
language sql stable security definer set search_path = public as $$
  select c.*
  from table_column_option o
  join table_column c on c.id = o.column_id
  where o.id = p_option_id
    and o.archived_at is null
    and c.archived_at is null
    and c.scope = 'licensing'
    and c.type = 'multiselect'
$$;

-- Ảnh chụp cho lịch sử: giữ khoá carrier / product_key như bản cũ để mọi dòng
-- lịch sử (cũ lẫn mới) đọc cùng một cách.
create or replace function public.licensing_appointment_snapshot(p_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'carrier', o.label, 'option_id', a.option_id, 'state_code', a.state_code, 'product_key', c.key,
    'status', a.status, 'appointed_on', a.appointed_on, 'note', a.note,
    'agents', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', x.account_id, 'appointed_on', x.appointed_on)
                       order by x.account_id)
      from licensing_appointment_agents x where x.appointment_id = a.id), '[]'::jsonb))
  from licensing_appointments a
  join table_column_option o on o.id = a.option_id
  join table_column c on c.id = o.column_id
  where a.id = p_id
$$;

-- Thêm / sửa chi tiết một appointment. p_id null = thêm (cần p_state_code + p_option_id).
-- Sửa thì bang và hãng giữ nguyên: đổi hãng = bỏ chọn ở ô sản phẩm rồi chọn hãng khác.
create or replace function public.licensing_save_appointment(
  p_id uuid, p_state_code text, p_option_id uuid, p_status text,
  p_appointed_on date, p_note text, p_agents jsonb, p_actor uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_before jsonb;
  v_column table_column;
begin
  if p_id is not null then
    perform 1 from licensing_appointments where id = p_id and deleted_at is null for update;
    if not found then raise exception 'LICENSING_NOT_FOUND'; end if;
    v_before := public.licensing_appointment_snapshot(p_id);
    update licensing_appointments set
      status = p_status, appointed_on = p_appointed_on, note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now(), updated_by = p_actor
    where id = p_id
    returning id into v_id;
  else
    select * into v_column from public.licensing_option_column(p_option_id);
    if v_column.id is null then raise exception 'LICENSING_OPTION_NOT_FOUND'; end if;
    insert into licensing_appointments (state_code, option_id, status, appointed_on, note, created_by, updated_by)
    values (p_state_code, p_option_id, p_status, p_appointed_on, nullif(btrim(coalesce(p_note, '')), ''),
            p_actor, p_actor)
    returning id into v_id;
  end if;

  delete from licensing_appointment_agents where appointment_id = v_id;
  insert into licensing_appointment_agents (appointment_id, account_id, appointed_on)
  select v_id, (e->>'account_id')::uuid, nullif(e->>'appointed_on', '')::date
  from jsonb_array_elements(coalesce(p_agents, '[]'::jsonb)) e;

  insert into licensing_events (appointment_id, product_key, state_code, action, before, after, actor_id)
  select v_id, s->>'product_key', s->>'state_code',
         case when p_id is null then 'appointment.create' else 'appointment.update' end,
         v_before, s, p_actor
  from (select public.licensing_appointment_snapshot(v_id) as s) t;
  return v_id;
exception when unique_violation then
  raise exception 'LICENSING_DUPLICATE_CARRIER';
end $$;

-- Lưu các ô chọn nhiều của một bang: p_selection = {"<column_id>": ["<option_id>", …], …}.
-- Chỉ đụng các cột có trong p_selection. Hãng mới → appointment Active; hãng bỏ
-- chọn → xoá mềm (giữ lịch sử). Trả về số dòng thêm / bỏ.
create or replace function public.licensing_save_state(p_state_code text, p_selection jsonb, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_column_id uuid;
  v_ids uuid[];
  v_row record;
  v_new uuid;
  v_added int := 0;
  v_removed int := 0;
begin
  for v_column_id, v_ids in
    select key::uuid, coalesce(array(select jsonb_array_elements_text(value)::uuid), '{}')
    from jsonb_each(coalesce(p_selection, '{}'::jsonb))
  loop
    if not exists (select 1 from table_column where id = v_column_id and scope = 'licensing'
                   and type = 'multiselect' and archived_at is null) then
      raise exception 'LICENSING_PRODUCT_NOT_FOUND';
    end if;
    -- Kiểm trước khi đổi gì: mọi option phải còn hoạt động và thuộc đúng cột này.
    if exists (select 1 from unnest(v_ids) as want(option_id)
               where not exists (select 1 from table_column_option o
                                 where o.id = want.option_id and o.column_id = v_column_id
                                   and o.archived_at is null)) then
      raise exception 'LICENSING_OPTION_NOT_FOUND';
    end if;

    -- bỏ chọn
    for v_row in
      select a.id from licensing_appointments a
      join table_column_option o on o.id = a.option_id
      where a.state_code = p_state_code and a.deleted_at is null
        and o.column_id = v_column_id and not (a.option_id = any(v_ids))
      for update of a
    loop
      insert into licensing_events (appointment_id, product_key, state_code, action, before, actor_id)
      select v_row.id, s->>'product_key', p_state_code, 'appointment.delete', s, p_actor
      from (select public.licensing_appointment_snapshot(v_row.id) as s) t;
      update licensing_appointments set deleted_at = now(), updated_at = now(), updated_by = p_actor
      where id = v_row.id;
      v_removed := v_removed + 1;
    end loop;

    -- chọn thêm
    for v_row in
      select o.id as option_id from table_column_option o
      where o.column_id = v_column_id and o.archived_at is null and o.id = any(v_ids)
        and not exists (select 1 from licensing_appointments a
                        where a.state_code = p_state_code and a.option_id = o.id and a.deleted_at is null)
    loop
      insert into licensing_appointments (state_code, option_id, status, created_by, updated_by)
      values (p_state_code, v_row.option_id, 'active', p_actor, p_actor)
      returning id into v_new;
      insert into licensing_events (appointment_id, product_key, state_code, action, after, actor_id)
      select v_new, s->>'product_key', p_state_code, 'appointment.create', s, p_actor
      from (select public.licensing_appointment_snapshot(v_new) as s) t;
      v_added := v_added + 1;
    end loop;

  end loop;
  return jsonb_build_object('added', v_added, 'removed', v_removed);
end $$;

-- Xoá mềm một appointment (từ dialog chi tiết). Snapshot đã có carrier / product_key.
create or replace function public.licensing_delete_appointment(p_id uuid, p_actor uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_snap jsonb;
begin
  perform 1 from licensing_appointments where id = p_id and deleted_at is null for update;
  if not found then raise exception 'LICENSING_NOT_FOUND'; end if;
  v_snap := public.licensing_appointment_snapshot(p_id);
  insert into licensing_events (appointment_id, product_key, state_code, action, before, actor_id)
  values (p_id, v_snap->>'product_key', v_snap->>'state_code', 'appointment.delete', v_snap, p_actor);
  update licensing_appointments set deleted_at = now(), updated_at = now(), updated_by = p_actor where id = p_id;
end $$;

revoke all on function public.licensing_option_column(uuid) from public, anon, authenticated;
revoke all on function public.licensing_appointment_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.licensing_save_appointment(uuid, text, uuid, text, date, text, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.licensing_save_state(text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.licensing_delete_appointment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.licensing_save_appointment(uuid, text, uuid, text, date, text, jsonb, uuid) to service_role;
grant execute on function public.licensing_save_state(text, jsonb, uuid) to service_role;
grant execute on function public.licensing_delete_appointment(uuid, uuid) to service_role;

-- 6. Table Configuration: đếm chỗ dùng một hãng trước khi archive nó.
create or replace function public.table_column_option_usage_count(p_column_id uuid, p_option_id uuid)
 returns bigint
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  column_row public.table_column%rowtype;
  option_label text;
  usage_count bigint;
begin
  select * into column_row
  from public.table_column
  where id = p_column_id
    and archived_at is null
    and type in ('dropdown', 'multiselect')
    and (not is_system or public.is_admin_managed_system_column(scope, key));
  if not found then raise exception 'CONFIG_OPTION_NOT_FOUND'; end if;

  select option_row.label into option_label
  from public.table_column_option option_row
  where option_row.id = p_option_id
    and option_row.column_id = p_column_id
    and option_row.archived_at is null;
  if not found then raise exception 'CONFIG_OPTION_NOT_FOUND'; end if;

  if column_row.scope = 'licensing' then
    select count(*)::bigint into usage_count
    from public.licensing_appointments a
    where a.option_id = p_option_id and a.deleted_at is null;
  elsif column_row.scope = 'provider' then
    select count(*)::bigint into usage_count
    from public.provider_directory provider_row
    where provider_row.archived_at is null
      and exists (
        select 1
        from unnest(
          string_to_array(
            coalesce(
              case column_row.key
                when 'practices_as' then provider_row.practices_as
                when 'obamacare' then provider_row.obamacare
                when 'medicare' then provider_row.medicare
              end,
              ''
            ),
            ','
          )
        ) as item
        where lower(btrim(item)) = lower(btrim(option_label))
      );
  elsif column_row.scope = 'cs' then
    select count(*)::bigint into usage_count
    from public.tasks task_row
    where task_row.archived_at is null
      and task_row.custom_values @> jsonb_build_object(
        column_row.key,
        case
          when column_row.type = 'multiselect' then jsonb_build_array(p_option_id::text)
          else to_jsonb(p_option_id::text)
        end
      );
  else
    select count(*)::bigint into usage_count
    from public.enrollment_records record_row
    where record_row.archived_at is null
      and record_row.program = column_row.scope
      and record_row.custom_values @> jsonb_build_object(
        column_row.key,
        case
          when column_row.type = 'multiselect' then jsonb_build_array(p_option_id::text)
          else to_jsonb(p_option_id::text)
        end
      );
  end if;
  return usage_count;
end;
$function$;

commit;

-- Kiểm
select c.key, c.label, c.position, count(o.id) as carriers
from table_column c left join table_column_option o on o.column_id = c.id and o.archived_at is null
where c.scope = 'licensing' group by c.key, c.label, c.position order by c.position;
select count(*) as appointments, count(distinct option_id) as options_used
from licensing_appointments where deleted_at is null;

notify pgrst, 'reload schema';
