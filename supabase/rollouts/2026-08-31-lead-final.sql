-- =====================================================================
-- Lead Management — consolidated final state.
--
-- This one file replaces every incremental lead rollout that came before it.
-- It is idempotent and converges from ANY starting point: a database that has
-- never seen Lead Management, or the one currently running with some of the
-- earlier partial rollouts applied. Run it and the lead subsystem is correct.
--
-- Superseded (deleted from supabase/rollouts/):
--   2026-08-27-lead-schema.sql              tables, indexes, seeded vocabulary
--   2026-08-28-lead-permissions.sql        lead.manage / lead.work / lead.export
--   2026-08-28-lead-table-scopes.sql       widened the scope CHECK constraints
--   2026-08-28-lead-rpc.sql                the interaction RPC
--   2026-08-31-lead-detail-columns.sql     show_in_detail + Secondary Phone
--   2026-08-31-lead-event-free-text.sql    Event as typed text + event index
--   2026-08-31-lead-vocabulary-colors.sql  badge colours
--   2026-08-31-table-scope-rpc-guards.sql  is_table_scope + the two write RPCs
--   2026-08-31-merge-lead-scopes.sql       lead_pc + lead_health -> lead
--
-- Still separate, because it is a Task fix and not part of this subsystem:
--   fix/patch-task-atomic-ambiguity branch, 2026-08-27-fix-patch-task-atomic-ambiguity.sql
--
-- Order inside this file matters: tables, then the indexes the seeds rely on
-- to be idempotent, then the seeds, then functions, then the config data.
-- =====================================================================

-- ---------- 1. Email normaliser (used by the tables and the RPC) ----------
create or replace function lead_norm_email(p_email text)
returns text language sql immutable set search_path = public as $$
  select nullif(lower(btrim(coalesce(p_email, ''))), '');
$$;

-- ---------- 2. Tables, indexes and seeded vocabulary ----------
create table if not exists lead_events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  location text,
  notes text,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- kind là thứ máy đọc; label là thứ người đọc. Admin đặt nhãn tiếng Việt hay
-- tiếng Anh tuỳ ý, engine cảnh báo chỉ nhìn kind.
create table if not exists lead_statuses (
  id uuid primary key default gen_random_uuid(),
  product text not null check (product in ('pc', 'health')),
  label text not null,
  color text,
  position integer not null default 0,
  kind text not null check (kind in ('open', 'scheduled', 'won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

-- counts_as_contact quyết định loại này có tắt đèn đỏ hay không.
-- Call/Text/Email = true, Note = false.
create table if not exists lead_interaction_types (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  color text,
  position integer not null default 0,
  counts_as_contact boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create sequence if not exists leads_display_number_seq;

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  display_number bigint not null default nextval('leads_display_number_seq'),
  product text not null check (product in ('pc', 'health')),
  event_id uuid references lead_events(id) on delete set null,
  full_name text,
  phone text,
  email text,
  assigned_to_email text,
  assigned_at timestamptz,
  assigned_by_email text,
  status_id uuid references lead_statuses(id) on delete restrict,
  -- Bốn cột dưới suy ra được từ lead_interactions nhưng cố tình lưu sẵn: bảng
  -- List phải hiện "3 lần thử, lần cuối 2 ngày trước" cho vài trăm dòng cùng
  -- lúc, aggregate cho từng dòng là đúng lỗi MEDIUM-09 trong review 23/08.
  -- log_lead_interaction_atomic là nơi DUY NHẤT được ghi bốn cột này.
  first_contacted_at timestamptz,
  last_contacted_at timestamptz,
  contact_attempt_count integer not null default 0,
  next_follow_up_at timestamptz,
  closed_at timestamptz,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  updated_by_email text,
  updated_at timestamptz not null default now(),
  custom_values jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  client_request_id uuid
);

create table if not exists lead_interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  type_id uuid not null references lead_interaction_types(id) on delete restrict,
  status_id uuid references lead_statuses(id) on delete restrict,
  note text,
  actor_email text not null,
  occurred_at timestamptz not null default now(),
  follow_up_at timestamptz,
  client_request_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists lead_assignment_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  from_email text,
  to_email text,
  reason text,
  actor_email text not null,
  created_at timestamptz not null default now()
);

create table if not exists lead_alert_settings (
  product text primary key check (product in ('pc', 'health')),
  no_contact_hours integer not null default 24 check (no_contact_hours > 0),
  stale_days integer not null default 3 check (stale_days > 0),
  max_attempts integer not null default 4 check (max_attempts > 0),
  updated_by_email text,
  updated_at timestamptz not null default now()
);

insert into lead_alert_settings (product) values ('pc'), ('health')
on conflict (product) do nothing;



-- Index bám đúng cách bảng được đọc: luôn lọc archived_at is null, rồi lọc
-- theo product, rồi sắp theo created_at.
-- Bắt buộc phải có trước phần seed bên trên: `on conflict do nothing` không có
-- unique index nào để bấu vào thì nó im lặng không làm gì cả, và chạy lại
-- rollout lần hai sẽ nhân đôi toàn bộ từ vựng.
create unique index if not exists lead_interaction_types_label_unique_idx
  on lead_interaction_types (label) where archived_at is null;
create unique index if not exists lead_statuses_label_unique_idx
  on lead_statuses (product, label) where archived_at is null;

create index if not exists leads_product_active_idx
  on leads (product, created_at desc) where archived_at is null;
create index if not exists leads_assigned_idx
  on leads (assigned_to_email, product) where archived_at is null;
create index if not exists leads_event_idx on leads (event_id);
create index if not exists lead_interactions_lead_idx
  on lead_interactions (lead_id, occurred_at desc);
create index if not exists lead_assignment_history_lead_idx
  on lead_assignment_history (lead_id, created_at desc);

-- Chống import trùng: cùng một sự kiện không được có hai lead trùng số.
create unique index if not exists leads_event_phone_unique_idx
  on leads (event_id, phone) where phone is not null and archived_at is null;

-- Từ vựng mặc định. Admin sửa/xoá/thêm thoải mái sau, nhưng phải có sẵn thứ gì
-- đó ngay từ đầu: không có status và loại tương tác thì form ghi nhật ký chỉ
-- là hai dropdown rỗng và cả module không dùng được.
insert into lead_interaction_types (label, position, counts_as_contact) values
  ('Call',  10, true),
  ('Text',  20, true),
  ('Email', 30, true),
  ('Note',  40, false)
on conflict do nothing;

do $$
declare
  product_value text;
begin
  foreach product_value in array array['pc', 'health'] loop
    insert into lead_statuses (product, label, position, kind) values
      (product_value, 'New',             10, 'open'),
      (product_value, 'Working',         20, 'open'),
      (product_value, 'No answer',       30, 'open'),
      (product_value, 'Call back',       40, 'scheduled'),
      (product_value, 'Won',             50, 'won'),
      (product_value, 'Not interested',  60, 'lost'),
      (product_value, 'Wrong number',    70, 'lost')
    on conflict do nothing;
  end loop;
end $$;

-- No public policies are defined for lead tables. The application uses the
-- service-role client after its own auth checks, while RLS keeps a leaked
-- anon/authenticated key from reading or mutating lead data directly.
alter table lead_events enable row level security;
alter table lead_statuses enable row level security;
alter table lead_interaction_types enable row level security;
alter table leads enable row level security;
alter table lead_interactions enable row level security;
alter table lead_assignment_history enable row level security;
alter table lead_alert_settings enable row level security;

-- ---------- 3. Event names are unique, case- and space-insensitively ----------
-- This is what makes the create dialog's find-or-create safe: without it two
-- people naming the same event at the same moment each insert a row, and the
-- per-event report splits one event in two.
-- Fold any duplicates that predate the index into the earliest row first.
with ranked as (
  select id, lower(btrim(name)) as norm,
         row_number() over (partition by lower(btrim(name)) order by created_at, id) as rn
  from lead_events where archived_at is null
),
keeper as (select norm, id from ranked where rn = 1)
update leads
set event_id = keeper.id
from ranked join keeper on keeper.norm = ranked.norm
where leads.event_id = ranked.id and ranked.rn > 1;

update lead_events set archived_at = now()
where id in (
  select id from (
    select id, row_number() over (partition by lower(btrim(name)) order by created_at, id) as rn
    from lead_events where archived_at is null
  ) as dupes where rn > 1
);

create unique index if not exists lead_events_name_unique_idx
  on lead_events (lower(btrim(name))) where archived_at is null;

-- ---------- 4. Interaction log RPC ----------
create or replace function log_lead_interaction_atomic(
  p_lead_id uuid,
  p_type_id uuid,
  p_status_id uuid default null,
  p_note text default null,
  p_actor_email text default null,
  p_follow_up_at timestamptz default null,
  p_client_request_id uuid default null,
  p_now timestamptz default now()
) returns table (interaction jsonb, lead jsonb, was_created boolean)
language plpgsql security definer set search_path = public as $$
declare
  lead_value leads%rowtype;
  interaction_value lead_interactions%rowtype;
  type_value lead_interaction_types%rowtype;
  status_kind_value text;
  actor_value text;
begin
  actor_value := lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;

  -- Alias `l`, not `lead`: `lead` is also the name of this function's OUT
  -- parameter. It happens to resolve today only because that parameter is
  -- jsonb and therefore not composite, so `lead.id` cannot be field access.
  -- This repo already lost a day to SQLSTATE 42702 from a local shadowing a
  -- column (patch_task_atomic, 08/08) — do not leave the same trap set.
  select * into lead_value from leads as l
  where l.id = p_lead_id and l.archived_at is null
  for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND';
  end if;

  select * into type_value from lead_interaction_types as itype
  where itype.id = p_type_id and itype.archived_at is null;
  if not found then
    raise exception 'LEAD_TYPE_NOT_FOUND';
  end if;

  -- A retry with the same client request id returns the original snapshot and
  -- never increments the contact counter again.
  if p_client_request_id is not null then
    select * into interaction_value from lead_interactions as li
    where li.lead_id = p_lead_id
      and li.client_request_id = p_client_request_id;
    if found then
      interaction := to_jsonb(interaction_value);
      lead := to_jsonb(lead_value);
      was_created := false;
      return next;
      return;
    end if;
  end if;

  if p_status_id is not null then
    select st.kind into status_kind_value from lead_statuses as st
    where st.id = p_status_id
      and st.product = lead_value.product
      and st.archived_at is null;
    if status_kind_value is null then
      raise exception 'LEAD_STATUS_NOT_FOUND';
    end if;
    if status_kind_value <> 'scheduled' and p_follow_up_at is not null then
      raise exception 'LEAD_FOLLOW_UP_REQUIRES_SCHEDULED';
    end if;
    if status_kind_value = 'scheduled' and p_follow_up_at is null then
      raise exception 'LEAD_FOLLOW_UP_REQUIRED';
    end if;
  elsif p_follow_up_at is not null then
    raise exception 'LEAD_FOLLOW_UP_REQUIRES_SCHEDULED';
  end if;

  insert into lead_interactions (
    lead_id, type_id, status_id, note, actor_email,
    occurred_at, follow_up_at, client_request_id
  ) values (
    p_lead_id, p_type_id, p_status_id, nullif(btrim(coalesce(p_note, '')), ''),
    actor_value, p_now, p_follow_up_at, p_client_request_id
  ) returning * into interaction_value;

  update leads as l set
    first_contacted_at = case
      when type_value.counts_as_contact and l.first_contacted_at is null
      then p_now else l.first_contacted_at end,
    last_contacted_at = case
      when type_value.counts_as_contact then p_now
      else l.last_contacted_at end,
    contact_attempt_count = l.contact_attempt_count
      + case when type_value.counts_as_contact then 1 else 0 end,
    next_follow_up_at = case
      when p_follow_up_at is not null then p_follow_up_at
      when status_kind_value in ('won', 'lost') then null
      else l.next_follow_up_at end,
    status_id = coalesce(p_status_id, l.status_id),
    closed_at = case
      when status_kind_value in ('won', 'lost') then p_now
      when status_kind_value is not null then null
      else l.closed_at end,
    updated_at = p_now,
    updated_by_email = actor_value
  where l.id = p_lead_id
  returning * into lead_value;

  interaction := to_jsonb(interaction_value);
  lead := to_jsonb(lead_value);
  was_created := true;
  return next;
end;
$$;

revoke all on function log_lead_interaction_atomic(uuid, uuid, uuid, text, text, timestamptz, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function log_lead_interaction_atomic(uuid, uuid, uuid, text, text, timestamptz, uuid, timestamptz)
  to service_role;

-- ---------- 5. Table-config scopes ----------
-- One definition of what a scope is. Two write RPCs used to carry private
-- copies, which is how adding the lead scopes updated three CHECK constraints
-- and still left column reordering failing with "Invalid column order".
create or replace function is_table_scope(p_scope text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_scope in ('cs', 'aca', 'medicare', 'lead');
$$;

-- The constraints keep the retired lead_pc / lead_health values so rows archived
-- below stay legal. Only the application and is_table_scope stop offering them.
alter table table_column drop constraint if exists table_column_scope_check;
alter table table_column add constraint table_column_scope_check
  check (scope in ('cs','aca','medicare','lead_pc','lead_health','lead'));
alter table user_table_layout drop constraint if exists user_table_layout_scope_check;
alter table user_table_layout add constraint user_table_layout_scope_check
  check (scope in ('cs','aca','medicare','lead_pc','lead_health','lead'));
alter table import_request drop constraint if exists import_request_scope_check;
alter table import_request add constraint import_request_scope_check
  check (scope in ('cs','aca','medicare','lead_pc','lead_health','lead'));

-- ---------- 6. The two write RPCs that validate a scope ----------
create or replace function reorder_table_columns_atomic(
  p_scope text,
  p_expected_column_keys text[],
  p_column_keys text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_keys text[] := array[]::text[];
  active_count integer := 0;
  duplicate_count integer := 0;
begin
  if not is_table_scope(p_scope)
    or p_expected_column_keys is null
    or p_column_keys is null then
    raise exception 'COLUMN_ORDER_INVALID';
  end if;

  if exists (
    select 1
    from unnest(p_expected_column_keys) as requested(value)
    where requested.value is null or btrim(requested.value) = ''
  ) or exists (
    select 1
    from unnest(p_column_keys) as requested(value)
    where requested.value is null or btrim(requested.value) = ''
  ) then
    raise exception 'COLUMN_ORDER_INVALID';
  end if;

  select count(*) into duplicate_count
  from (
    select value
    from unnest(p_column_keys) as requested(value)
    group by value
    having count(*) > 1
  ) duplicates;
  if duplicate_count > 0 then raise exception 'COLUMN_ORDER_INVALID'; end if;

  -- Lock in a deterministic order before reading current positions.
  perform 1
  from table_column column_row
  where column_row.scope = p_scope
    and column_row.archived_at is null
  order by column_row.id
  for update;

  select count(*) into active_count
  from table_column column_row
  where column_row.scope = p_scope
    and column_row.archived_at is null;

  if cardinality(p_column_keys) <> active_count
    or cardinality(p_expected_column_keys) <> active_count
    or exists (
      select 1
      from unnest(p_column_keys) as requested(value)
      where not exists (
        select 1
        from table_column column_row
        where column_row.scope = p_scope
          and column_row.archived_at is null
          and column_row.key = requested.value
      )
    ) then
    raise exception 'COLUMN_ORDER_INVALID';
  end if;

  select coalesce(
    array_agg(column_row.key order by column_row.position, column_row.label, column_row.key),
    array[]::text[]
  )
  into current_keys
  from table_column column_row
  where column_row.scope = p_scope
    and column_row.archived_at is null;

  if current_keys is distinct from p_expected_column_keys then
    raise exception 'COLUMN_ORDER_STALE';
  end if;

  update table_column column_row
  set position = desired.position,
      updated_at = clock_timestamp()
  from unnest(p_column_keys) with ordinality as desired(key, position)
  where column_row.scope = p_scope
    and column_row.archived_at is null
    and column_row.key = desired.key;

  return jsonb_build_object(
    'scope', p_scope,
    'column_keys', coalesce(
      (select jsonb_agg(column_row.key order by column_row.position, column_row.label, column_row.key)
       from table_column column_row
       where column_row.scope = p_scope and column_row.archived_at is null),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function reorder_table_columns_atomic(text, text[], text[]) from public, anon, authenticated;
grant execute on function reorder_table_columns_atomic(text, text[], text[]) to service_role;

create or replace function table_config_write_context(
  p_scope text,
  p_mode text,
  p_touched_system_keys text[] default array[]::text[],
  p_touched_custom_keys text[] default array[]::text[],
  p_submitted_custom_values jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  requested_keys text[] := array[]::text[];
  candidate_ids uuid[] := array[]::uuid[];
  columns_json jsonb := '[]'::jsonb;
  options_json jsonb := '[]'::jsonb;
  matched_people jsonb := '[]'::jsonb;
  person_emails text[] := array[]::text[];
begin
  if not is_table_scope(p_scope) then
    raise exception 'WRITE_CONTEXT_SCOPE_INVALID';
  end if;
  if p_mode not in ('create', 'patch') then
    raise exception 'WRITE_CONTEXT_MODE_INVALID';
  end if;
  if cardinality(coalesce(p_touched_system_keys, array[]::text[])) > 100
    or cardinality(coalesce(p_touched_custom_keys, array[]::text[])) > 100
    or exists (
      select 1
      from unnest(array_cat(
        coalesce(p_touched_system_keys, array[]::text[]),
        coalesce(p_touched_custom_keys, array[]::text[])
      )) as requested(value)
      where length(requested.value) > 128
    ) then
    raise exception 'WRITE_CONTEXT_INPUT_TOO_LARGE';
  end if;
  -- These two guards MUST stay separate. PostgreSQL does not promise
  -- left-to-right short-circuiting of OR, so folding them into one condition
  -- lets jsonb_object_keys() run against a non-object and raise 22023 before
  -- the type check can reject it.
  if jsonb_typeof(coalesce(p_submitted_custom_values, '{}'::jsonb)) <> 'object' then
    raise exception 'WRITE_CONTEXT_VALUES_INVALID';
  end if;
  -- There is no jsonb_object_length() in PostgreSQL. The earlier call to it
  -- parsed fine (plpgsql bodies are not resolved at CREATE time) and then
  -- failed at 42883 on every single invocation, which the client mapped to
  -- "Table configuration is temporarily unavailable" and hid the real cause.
  if (select count(*)
      from jsonb_object_keys(coalesce(p_submitted_custom_values, '{}'::jsonb))) > 100 then
    raise exception 'WRITE_CONTEXT_VALUES_INVALID';
  end if;

  select coalesce(array_agg(distinct btrim(value)), array[]::text[])
  into requested_keys
  from unnest(array_cat(
    coalesce(p_touched_system_keys, array[]::text[]),
    coalesce(p_touched_custom_keys, array[]::text[])
  )) as requested(value)
  where nullif(btrim(value), '') is not null;

  select coalesce(array_agg(column_row.id), array[]::uuid[])
  into candidate_ids
  from table_column column_row
  where column_row.scope = p_scope
    and column_row.archived_at is null
    and (
      (p_mode = 'create' and (column_row.required or column_row.key = any(requested_keys)))
      or (p_mode = 'patch' and column_row.key = any(requested_keys))
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', column_row.id,
        'scope', column_row.scope,
        'key', column_row.key,
        'label', column_row.label,
        'type', column_row.type,
        'is_system', column_row.is_system,
        'position', column_row.position,
        'pinned', column_row.pinned,
        'hidden_default', column_row.hidden_default,
        'show_in_detail', column_row.show_in_detail,
        'required', column_row.required,
        'created_by_email', column_row.created_by_email,
        'created_at', column_row.created_at,
        'updated_at', column_row.updated_at,
        'archived_at', column_row.archived_at
      )
      order by column_row.position, column_row.label, column_row.key
    ),
    '[]'::jsonb
  )
  into columns_json
  from table_column column_row
  where column_row.id = any(candidate_ids);

  if cardinality(candidate_ids) > 0 then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', option_row.id,
          'column_id', option_row.column_id,
          'label', option_row.label,
          'color', option_row.color,
          'position', option_row.position,
          'created_at', option_row.created_at,
          'updated_at', option_row.updated_at,
          'archived_at', option_row.archived_at
        )
        order by option_row.column_id, option_row.position, option_row.label, option_row.id
      ),
      '[]'::jsonb
    )
    into options_json
    from table_column_option option_row
    where option_row.column_id = any(candidate_ids)
      and option_row.archived_at is null;
  end if;

  -- This block is deliberately conditional.  Non-Person writes never touch
  -- the account/role tables, keeping the common dropdown/text path cheap.
  select coalesce(array_agg(distinct lower(btrim(entry.value))), array[]::text[])
  into person_emails
  from table_column column_row
  cross join lateral jsonb_each_text(coalesce(p_submitted_custom_values, '{}'::jsonb)) entry
  where cardinality(candidate_ids) > 0
    and column_row.id = any(candidate_ids)
    and column_row.is_system = false
    and column_row.type = 'person'
    and entry.key = column_row.key
    and nullif(btrim(entry.value), '') is not null;

  if cardinality(person_emails) > 0 then
    if p_scope = 'cs' then
      select coalesce(jsonb_agg(lower(btrim(account.email)) order by lower(btrim(account.email))), '[]'::jsonb)
      into matched_people
      from portal_account account
      where account.is_active
        and lower(btrim(account.email)) = any(person_emails)
        and exists (
          select 1
          from user_roles user_role
          join role_permissions permission on permission.role_id = user_role.role_id
          where user_role.user_id = account.id
            and permission.permission_key in ('task.work', 'task.manage')
        );
    else
      select coalesce(jsonb_agg(lower(btrim(account.email)) order by lower(btrim(account.email))), '[]'::jsonb)
      into matched_people
      from portal_account account
      where account.is_active
        and lower(btrim(account.email)) = any(person_emails);
    end if;
  end if;

  return jsonb_build_object(
    'columns', columns_json,
    'options', options_json,
    'matched_person_emails', matched_people
  );
end;
$$;

revoke all on function table_config_write_context(text, text, text[], text[], jsonb)
  from public, anon, authenticated;
grant execute on function table_config_write_context(text, text, text[], text[], jsonb)
  to service_role;

-- ---------- 7. Retire the split lead scopes ----------
-- Health Leads and P&C Leads merged into one Event Leads list with Product as a
-- column. Column CONFIGURATION is per-scope, so the old rows are archived rather
-- than deleted: they record how those screens were set up, and nothing reads an
-- archived column. Lead DATA is untouched, and custom_values keys are
-- scope-independent, so a value entered under lead_pc still reads back.
update table_column
set archived_at = now(), updated_at = now()
where scope in ('lead_pc', 'lead_health') and archived_at is null;

update user_table_layout
set scope = 'lead'
where scope in ('lead_pc', 'lead_health')
  and not exists (
    select 1 from user_table_layout as existing
    where existing.scope = 'lead' and existing.user_email = user_table_layout.user_email
  );
delete from user_table_layout where scope in ('lead_pc', 'lead_health');

-- ---------- 8a. Seed the merged scope's columns ----------
-- ensureTableColumns() would create these on the first page load, but a
-- database should not depend on someone opening a screen to become correct.
-- Kept in step with DEFAULT_TABLE_COLUMNS.lead in
-- src/lib/table-config/queries.ts.
insert into table_column
  (scope, key, label, type, is_system, position, pinned, hidden_default, show_in_detail, required)
values
  ('lead', 'key', 'Key', 'text', true, 10, true, false, false, false),
  ('lead', 'name', 'Name', 'text', true, 20, true, false, true, false),
  ('lead', 'product', 'Product', 'dropdown', true, 25, false, false, true, false),
  ('lead', 'phone', 'Phone', 'text', true, 30, false, false, true, false),
  ('lead', 'secondary_phone', 'Secondary Phone', 'text', false, 35, false, false, true, false),
  ('lead', 'email', 'Email', 'text', true, 40, false, false, true, false),
  ('lead', 'assignee', 'Assigned to', 'person', true, 50, false, false, true, false),
  ('lead', 'status', 'Status', 'dropdown', true, 60, false, false, true, false),
  ('lead', 'interactionHistory', 'Interaction history', 'text', true, 65, false, false, false, false),
  ('lead', 'attempts', 'Attempts', 'number', true, 70, false, false, false, false),
  ('lead', 'lastContact', 'Last contact', 'date', true, 80, false, false, false, false),
  ('lead', 'followUp', 'Follow up', 'date', true, 90, false, false, true, false),
  ('lead', 'event', 'Event', 'text', true, 100, false, false, true, false),
  ('lead', 'createdAt', 'Imported', 'date', true, 110, false, true, false, false)
on conflict (scope, key) do nothing;

-- ---------- 8. Column behaviour on the merged scope ----------
-- ensureTableColumns() inserts missing default columns on first page load but
-- never rewrites an existing row, so these flags have to be set here.
update table_column
set show_in_detail = true, updated_at = now()
where scope = 'lead'
  and key in ('name','product','phone','email','assignee','status','followUp','event')
  and show_in_detail is distinct from true;

-- Event is typed, not chosen: the create dialog takes a name and the route
-- finds or creates the event, so a lead never waits on someone registering it.
update table_column
set type = 'text', updated_at = now()
where scope = 'lead' and key = 'event' and type is distinct from 'text';

-- Secondary Phone is non-system on purpose: its value lives in custom_values
-- like any admin-added column, an admin may rename or archive it, and the
-- create dialog only offers non-system columns. The key must stay
-- secondary_phone -- slugifyColumnKey('Secondary Phone') -- because that is the
-- key the spreadsheet importer writes and every screen reads back.


-- ---------- 9. Permissions ----------
insert into permissions (key, label, description, group_key, group_label, sort_order)
values
  ('lead.manage', 'Manage Leads', 'Import leads, assign them, and see every agent''s queue.', 'leads', 'Lead Management', 100),
  ('lead.work', 'Work Leads', 'See and log interactions on leads assigned to you.', 'leads', 'Lead Management', 200),
  ('lead.export', 'Export Leads', 'Download the lead table as a spreadsheet.', 'leads', 'Lead Management', 300)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  group_key = excluded.group_key,
  group_label = excluded.group_label,
  sort_order = excluded.sort_order;

insert into role_permissions (role_id, permission_key)
select roles.id, permissions.key
from roles
cross join permissions
where roles.name = 'Admin'
  and permissions.key in ('lead.manage', 'lead.work', 'lead.export')
on conflict (role_id, permission_key) do nothing;

-- ---------- 10. Badge colours ----------
-- Both vocabularies were seeded NULL, which sends every badge down the fallback
-- that hashes the row's uuid: stable but arbitrary, so two types can collide and
-- Note can end up louder than Call. Note is grey deliberately -- it is the one
-- type that does not count as contact and should not look like work that moved a
-- lead forward. Only fills colours still NULL, so an admin's choice survives.
update lead_interaction_types set color = '#4c9aff' where label = 'Call'  and color is null;
update lead_interaction_types set color = '#36b37e' where label = 'Text'  and color is null;
update lead_interaction_types set color = '#6554c0' where label = 'Email' and color is null;
update lead_interaction_types set color = '#5e6c84' where label = 'Note'  and color is null;

update lead_statuses set color = '#4c9aff' where label = 'New'            and color is null;
update lead_statuses set color = '#00b8d9' where label = 'Working'        and color is null;
update lead_statuses set color = '#5e6c84' where label = 'No answer'      and color is null;
update lead_statuses set color = '#ffab00' where label = 'Call back'      and color is null;
update lead_statuses set color = '#36b37e' where label = 'Won'            and color is null;
update lead_statuses set color = '#ff7452' where label = 'Not interested' and color is null;
update lead_statuses set color = '#ff7452' where label = 'Wrong number'   and color is null;

-- ---------- Verification ----------
-- One row. Every column must read ok.
select
  case when (select count(*) from lead_statuses) >= 14
       then 'ok' else 'FAIL: statuses missing' end                      as statuses,
  case when (select count(*) from lead_interaction_types) >= 4
       then 'ok' else 'FAIL: interaction types missing' end             as interaction_types,
  case when (select count(*) from lead_interaction_types where color is null) = 0
        and (select count(*) from lead_statuses where color is null) = 0
       then 'ok' else 'FAIL: uncoloured vocabulary' end                 as colours,
  case when is_table_scope('lead')
        and not is_table_scope('lead_pc')
       then 'ok' else 'FAIL: scope list wrong' end                      as scopes,
  case when (select count(*) from table_column
             where scope in ('lead_pc','lead_health') and archived_at is null) = 0
       then 'ok' else 'FAIL: old scope still active' end                as merged,
  case when exists (select 1 from pg_indexes
                    where indexname = 'lead_events_name_unique_idx')
       then 'ok' else 'FAIL: event name index missing' end              as event_index,
  case when (select count(*) from table_column
             where scope = 'lead' and key = 'event' and type = 'text') = 1
       then 'ok' else 'FAIL: event column type' end                     as event_column,
  case when (select count(*) from permissions
             where key in ('lead.manage','lead.work','lead.export')) = 3
       then 'ok' else 'FAIL: permissions missing' end                   as permissions;
