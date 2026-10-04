-- Retire Lead Product completely and scope each distribution pool to one Event.
-- Old Product weights cannot be mapped to Events without guessing, so those
-- ratios and cursors are removed. New Event pools start empty and auto-assign
-- off; a rerun preserves Event-specific settings already present.
-- Alert thresholds were per Product; preserve the strictest value for each
-- shared threshold before removing that table shape.

begin;

-- Old functions and trigger refer to the Product columns/tables being removed.
drop function if exists assign_leads_round_robin(uuid[], text, text[], text, text);
drop function if exists save_lead_assignment_weights(text, jsonb, boolean, text);
drop trigger if exists lead_sync_primary_product_trg on leads;
drop function if exists lead_sync_primary_product();

-- Remove stale Product metadata from table configuration and saved user layouts.
delete from table_column
where scope in ('lead', 'lead_pc', 'lead_health')
  and key in ('product', 'products');

update user_table_layout layout_row
set layout = coalesce(
  (
    select jsonb_agg(entry order by entry_order)
    from jsonb_array_elements(layout_row.layout) with ordinality as item(entry, entry_order)
    where entry ->> 'column_key' not in ('product', 'products')
  ),
  '[]'::jsonb
)
where layout_row.scope in ('lead', 'lead_pc', 'lead_health')
  and jsonb_typeof(layout_row.layout) = 'array';

-- Import review rows may still contain the retired mapping from an older draft.
update import_request
set column_mapping = column_mapping - 'product' - 'products',
    summary = summary - 'product' - 'products'
where scope in ('lead', 'lead_pc', 'lead_health')
  and (jsonb_typeof(column_mapping) = 'object' or jsonb_typeof(summary) = 'object');

update import_request_row row_data
set values = values - 'product' - 'products'
from import_request request_row
where row_data.request_id = request_row.id
  and request_row.scope in ('lead', 'lead_pc', 'lead_health')
  and jsonb_typeof(row_data.values) = 'object';

-- Product was a first-class field, not part of the custom schema. Drop any
-- imported copies too so neither direct columns nor JSON retain old values.
update leads
set custom_values = custom_values - 'product' - 'products'
where custom_values ?| array['product', 'products'];

drop index if exists leads_product_active_idx;
drop index if exists leads_assigned_idx;
drop index if exists leads_products_idx;
create index if not exists leads_assigned_idx
  on leads (assigned_to_email, created_at desc) where archived_at is null;
alter table leads drop column if exists product;
alter table leads drop column if exists products;

-- Collapse per-Product thresholds in place. Keeping the existing table avoids
-- depending on a temporary replacement relation during SQL editor execution.
-- MIN preserves the strictest former behavior. Everything is inside this
-- transaction, so the original rows remain intact if a later step fails.
do $$
declare
  keep_product text;
  strict_no_contact_hours integer;
  strict_stale_days integer;
  strict_max_attempts integer;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'lead_alert_settings'
      and column_name = 'product'
  ) then
    select coalesce(min(no_contact_hours), 24),
           coalesce(min(stale_days), 3),
           coalesce(min(max_attempts), 4)
      into strict_no_contact_hours, strict_stale_days, strict_max_attempts
    from public.lead_alert_settings;

    select product into keep_product
    from public.lead_alert_settings
    order by product
    limit 1;

    if keep_product is not null then
      update public.lead_alert_settings
      set no_contact_hours = strict_no_contact_hours,
          stale_days = strict_stale_days,
          max_attempts = strict_max_attempts,
          updated_at = now()
      where product = keep_product;

      delete from public.lead_alert_settings where product <> keep_product;
    end if;

    alter table public.lead_alert_settings drop column product;
    alter table public.lead_alert_settings
      add column id boolean not null default true check (id);
    alter table public.lead_alert_settings
      add constraint lead_alert_settings_pkey primary key (id);
  end if;
end $$;

alter table public.lead_alert_settings
  drop column if exists auto_assign_enabled;
insert into public.lead_alert_settings (id)
values (true)
on conflict (id) do nothing;
alter table public.lead_alert_settings enable row level security;

-- Event-specific distribution switches and smooth weighted round-robin state.
-- These may already exist if a prior run reached this section; retain any
-- Event-scoped settings and weights already stored there.
create table if not exists lead_event_assignment_settings (
  event_id uuid primary key references lead_events(id) on delete cascade,
  auto_assign_enabled boolean not null default false,
  updated_by_email text,
  updated_at timestamptz not null default now()
);

create table if not exists lead_event_assignment_weights (
  event_id uuid not null references lead_events(id) on delete cascade,
  agent_email text not null,
  weight integer not null default 1 check (weight >= 0),
  current_weight integer not null default 0,
  position integer not null default 0,
  is_active boolean not null default true,
  updated_by_email text,
  updated_at timestamptz not null default now(),
  primary key (event_id, agent_email)
);

insert into lead_event_assignment_settings (event_id)
select id from lead_events where archived_at is null
on conflict (event_id) do nothing;

create or replace function create_lead_event_assignment_settings()
returns trigger
language plpgsql as $$
begin
  insert into lead_event_assignment_settings (event_id)
  values (new.id)
  on conflict (event_id) do nothing;
  return new;
end $$;

drop trigger if exists lead_event_assignment_settings_trg on lead_events;
create trigger lead_event_assignment_settings_trg
  after insert on lead_events
  for each row execute function create_lead_event_assignment_settings();

create index if not exists lead_event_assignment_weights_active_idx
  on lead_event_assignment_weights (event_id, position, agent_email)
  where is_active and weight > 0;

alter table lead_event_assignment_settings enable row level security;
alter table lead_event_assignment_weights enable row level security;

create or replace function assign_leads_round_robin(
  p_lead_ids uuid[],
  p_event_id uuid,
  p_eligible_emails text[],
  p_actor_email text,
  p_reason text default 'auto: weighted round-robin'
) returns table (lead_id uuid, to_email text)
language plpgsql security definer set search_path = public as $$
declare
  target_lead uuid;
  total_weight integer;
  best_email text;
  actor_value text;
  eligible text[];
begin
  actor_value := lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;
  if p_event_id is null then
    raise exception 'LEAD_EVENT_REQUIRED';
  end if;

  -- The Event row is also the mutex. It serializes config saves and assignment
  -- runs even while this Event has no Agent rows yet.
  perform 1
  from lead_events e
  where e.id = p_event_id and e.archived_at is null
  for update;
  if not found then
    raise exception 'LEAD_EVENT_INVALID';
  end if;

  select coalesce(array_agg(lower(btrim(value))), array[]::text[])
  into eligible
  from unnest(coalesce(p_eligible_emails, array[]::text[])) as value
  where btrim(value) <> '';

  perform w.agent_email
  from lead_event_assignment_weights w
  where w.event_id = p_event_id
  order by w.agent_email
  for update;

  select coalesce(sum(w.weight), 0) into total_weight
  from lead_event_assignment_weights w
  where w.event_id = p_event_id
    and w.is_active
    and w.weight > 0
    and lower(w.agent_email) = any (eligible);

  if total_weight <= 0 then
    return;
  end if;

  for target_lead in
    select l.id
    from leads l
    where l.id = any (coalesce(p_lead_ids, array[]::uuid[]))
      and l.event_id = p_event_id
      and l.archived_at is null
      and l.assigned_to_email is null
    order by l.created_at, l.id
    for update
  loop
    update lead_event_assignment_weights w
    set current_weight = w.current_weight + w.weight
    where w.event_id = p_event_id
      and w.is_active
      and w.weight > 0
      and lower(w.agent_email) = any (eligible);

    select w.agent_email into best_email
    from lead_event_assignment_weights w
    where w.event_id = p_event_id
      and w.is_active
      and w.weight > 0
      and lower(w.agent_email) = any (eligible)
    order by w.current_weight desc, w.position asc, w.agent_email asc
    limit 1;

    update lead_event_assignment_weights w
    set current_weight = w.current_weight - total_weight,
        updated_at = now()
    where w.event_id = p_event_id and w.agent_email = best_email;

    update leads l
    set assigned_to_email = best_email,
        assigned_at = now(),
        assigned_by_email = actor_value,
        updated_at = now(),
        updated_by_email = actor_value
    where l.id = target_lead
      and l.event_id = p_event_id
      and l.archived_at is null
      and l.assigned_to_email is null;

    if found then
      insert into lead_assignment_history
        (lead_id, from_email, to_email, reason, actor_email)
      values (target_lead, null, best_email, p_reason, actor_value);
      lead_id := target_lead;
      to_email := best_email;
      return next;
    end if;
  end loop;
end $$;

revoke all on function assign_leads_round_robin(uuid[], uuid, text[], text, text)
  from public, anon, authenticated;
grant execute on function assign_leads_round_robin(uuid[], uuid, text[], text, text)
  to service_role;

create or replace function save_lead_event_assignment_weights(
  p_event_id uuid,
  p_rows jsonb,
  p_enabled boolean,
  p_actor_email text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  actor_value text;
  keep text[];
begin
  actor_value := lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;
  if p_event_id is null then
    raise exception 'LEAD_EVENT_REQUIRED';
  end if;

  perform 1
  from lead_events e
  where e.id = p_event_id and e.archived_at is null
  for update;
  if not found then
    raise exception 'LEAD_EVENT_INVALID';
  end if;

  select coalesce(array_agg(lower(btrim(value ->> 'agent_email'))), array[]::text[])
  into keep
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as value
  where btrim(coalesce(value ->> 'agent_email', '')) <> '';

  delete from lead_event_assignment_weights w
  where w.event_id = p_event_id
    and lower(w.agent_email) <> all (keep);

  insert into lead_event_assignment_weights
    (event_id, agent_email, weight, position, is_active, updated_by_email, updated_at)
  select
    p_event_id,
    lower(btrim(value ->> 'agent_email')),
    greatest(coalesce((value ->> 'weight')::int, 0), 0),
    coalesce((value ->> 'position')::int, 0),
    coalesce((value ->> 'is_active')::boolean, true),
    actor_value,
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as value
  where btrim(coalesce(value ->> 'agent_email', '')) <> ''
  on conflict (event_id, agent_email) do update
  set weight = excluded.weight,
      position = excluded.position,
      is_active = excluded.is_active,
      updated_by_email = excluded.updated_by_email,
      updated_at = excluded.updated_at;

  insert into lead_event_assignment_settings
    (event_id, auto_assign_enabled, updated_by_email, updated_at)
  values (p_event_id, coalesce(p_enabled, false), actor_value, now())
  on conflict (event_id) do update
  set auto_assign_enabled = coalesce(p_enabled, lead_event_assignment_settings.auto_assign_enabled),
      updated_by_email = actor_value,
      updated_at = now();
end $$;

revoke all on function save_lead_event_assignment_weights(uuid, jsonb, boolean, text)
  from public, anon, authenticated;
grant execute on function save_lead_event_assignment_weights(uuid, jsonb, boolean, text)
  to service_role;

drop table if exists lead_assignment_weights;

-- Fail before COMMIT if the rollout stopped short or left Product schema behind.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads'
      and column_name in ('product', 'products')
  ) then
    raise exception 'LEAD_PRODUCT_COLUMNS_REMAIN';
  end if;

  if to_regclass('public.lead_assignment_weights') is not null then
    raise exception 'LEAD_PRODUCT_WEIGHTS_REMAIN';
  end if;

  if (select count(*) from public.lead_alert_settings) <> 1 then
    raise exception 'LEAD_ALERT_SETTINGS_NOT_SINGLETON';
  end if;

  if exists (
    select 1
    from public.lead_events e
    left join public.lead_event_assignment_settings s on s.event_id = e.id
    where e.archived_at is null and s.event_id is null
  ) then
    raise exception 'LEAD_EVENT_ASSIGNMENT_SETTINGS_INCOMPLETE';
  end if;

  if to_regprocedure('public.assign_leads_round_robin(uuid[],uuid,text[],text,text)') is null
    or to_regprocedure('public.save_lead_event_assignment_weights(uuid,jsonb,boolean,text)') is null then
    raise exception 'LEAD_EVENT_ASSIGNMENT_RPCS_MISSING';
  end if;

  if to_regprocedure('public.assign_leads_round_robin(uuid[],text,text[],text,text)') is not null
    or to_regprocedure('public.save_lead_assignment_weights(text,jsonb,boolean,text)') is not null then
    raise exception 'LEAD_PRODUCT_ASSIGNMENT_RPCS_REMAIN';
  end if;
end $$;

commit;

-- Post-rollout checks:
-- select column_name from information_schema.columns where table_name = 'leads'
--   and column_name in ('product', 'products'); -- must return no rows
-- select to_regclass('public.lead_assignment_weights') is null; -- must be true
-- select count(*) from lead_event_assignment_weights; -- Event-specific rows, if any
-- select count(*) from lead_event_assignment_settings; -- every active Event has a row
