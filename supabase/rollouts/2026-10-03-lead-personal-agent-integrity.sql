-- ============================================================================
-- Personal leads always have an active Agent and never have an Event pool.
--
-- A Personal lead is a lead with event_id = null. The rollout is safe to rerun:
-- it first retires the legacy "Personal Lead" Event, backfills only the one
-- ownership case that can be established without guessing, then stops before
-- enabling constraints if any active Personal lead still has no valid Agent.
-- ============================================================================

begin;

-- The checks below describe a point-in-time relationship among all three
-- tables. Serialize writes while that relationship is made strict.
lock table public.leads in share row exclusive mode;
lock table public.task_agents in share row exclusive mode;
lock table public.portal_account in share row exclusive mode;

-- Moving a legacy Personal Event to event_id = null would violate the existing
-- no-event phone uniqueness rule if a collision exists. Refuse to guess which
-- customer record should win.
do $$
begin
  if exists (
    select 1
    from public.leads legacy_lead
    join public.lead_events legacy_event on legacy_event.id = legacy_lead.event_id
    join public.leads personal_lead
      on personal_lead.event_id is null
     and personal_lead.archived_at is null
     and legacy_lead.archived_at is null
     and personal_lead.phone is not null
     and personal_lead.phone = legacy_lead.phone
    where legacy_lead.phone is not null
      and lower(regexp_replace(btrim(legacy_event.name), '\s+', ' ', 'g'))
          in ('personal', 'personal lead', 'personal leads')
  ) then
    raise exception 'PERSONAL_EVENT_PHONE_CONFLICT';
  end if;

  if exists (
    select 1
    from public.leads left_lead
    join public.leads right_lead
      on right_lead.event_id = left_lead.event_id
     and right_lead.id > left_lead.id
     and right_lead.archived_at is null
     and left_lead.archived_at is null
     and right_lead.phone is not null
     and right_lead.phone = left_lead.phone
    join public.lead_events legacy_event on legacy_event.id = left_lead.event_id
    where left_lead.phone is not null
      and lower(regexp_replace(btrim(legacy_event.name), '\s+', ' ', 'g'))
          in ('personal', 'personal lead', 'personal leads')
  ) then
    raise exception 'PERSONAL_EVENT_DUPLICATE_PHONE';
  end if;
end $$;

-- Delete a legacy Personal Event's pool before archiving it. These relations
-- are introduced by the Event-pool rollout, so each deletion is conditional.
do $$
begin
  if to_regclass('public.lead_event_assignment_weights') is not null then
    delete from public.lead_event_assignment_weights weights
    using public.lead_events event_row
    where weights.event_id = event_row.id
      and lower(regexp_replace(btrim(event_row.name), '\s+', ' ', 'g'))
          in ('personal', 'personal lead', 'personal leads');
  end if;

  if to_regclass('public.lead_event_assignment_settings') is not null then
    delete from public.lead_event_assignment_settings settings
    using public.lead_events event_row
    where settings.event_id = event_row.id
      and lower(regexp_replace(btrim(event_row.name), '\s+', ' ', 'g'))
          in ('personal', 'personal lead', 'personal leads');
  end if;
end $$;

update public.leads lead_row
set event_id = null,
    updated_at = now()
from public.lead_events event_row
where lead_row.event_id = event_row.id
  and lower(regexp_replace(btrim(event_row.name), '\s+', ' ', 'g'))
      in ('personal', 'personal lead', 'personal leads');

update public.lead_events
set archived_at = coalesce(archived_at, now()),
    updated_at = now()
where lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
    in ('personal', 'personal lead', 'personal leads');

-- A legacy Personal Event must never regain a settings row or a weight row,
-- even through a direct RPC/database write that bypasses the application API.
create or replace function public.reject_personal_lead_event_pool()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_name text;
begin
  select name into event_name from public.lead_events where id = new.event_id;
  if lower(regexp_replace(btrim(coalesce(event_name, '')), '\s+', ' ', 'g'))
      in ('personal', 'personal lead', 'personal leads') then
    raise exception using message = 'LEAD_PERSONAL_EVENT_POOL_FORBIDDEN';
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.lead_event_assignment_settings') is not null then
    execute 'drop trigger if exists lead_personal_event_settings_guard_trg on public.lead_event_assignment_settings';
    execute 'create trigger lead_personal_event_settings_guard_trg before insert or update of event_id on public.lead_event_assignment_settings for each row execute function public.reject_personal_lead_event_pool()';
  end if;
  if to_regclass('public.lead_event_assignment_weights') is not null then
    execute 'drop trigger if exists lead_personal_event_weights_guard_trg on public.lead_event_assignment_weights';
    execute 'create trigger lead_personal_event_weights_guard_trg before insert or update of event_id on public.lead_event_assignment_weights for each row execute function public.reject_personal_lead_event_pool()';
  end if;
end $$;

-- Only backfill an unassigned Personal lead when its creator is still an
-- active Account Management Agent. Any other case is left untouched and fails
-- the preflight below instead of assigning a guessed person.
with backfilled as (
  update public.leads lead_row
  set assigned_to_email = lower(btrim(agent.email)),
      assigned_at = coalesce(lead_row.assigned_at, now()),
      assigned_by_email = coalesce(
        public.lead_norm_email(lead_row.assigned_by_email),
        public.lead_norm_email(lead_row.created_by_email)
      ),
      updated_by_email = coalesce(
        public.lead_norm_email(lead_row.updated_by_email),
        public.lead_norm_email(lead_row.created_by_email)
      ),
      updated_at = now()
  from public.task_agents agent
  join public.portal_account account
    on lower(btrim(account.email)) = lower(btrim(agent.email))
   and account.is_active
  where lead_row.event_id is null
    and lead_row.archived_at is null
    and public.lead_norm_email(lead_row.assigned_to_email) is null
    and lower(btrim(agent.email)) = public.lead_norm_email(lead_row.created_by_email)
  returning lead_row.id, lead_row.assigned_to_email, lead_row.assigned_by_email
)
insert into public.lead_assignment_history
  (lead_id, from_email, to_email, reason, actor_email)
select
  id,
  null,
  assigned_to_email,
  'Personal lead agent backfilled',
  assigned_by_email
from backfilled;

-- This makes the rollout atomic: no partial conversion is committed when an
-- old record cannot be safely assigned to a current Agent.
do $$
begin
  if exists (
    select 1
    from public.leads lead_row
    where lead_row.event_id is null
      and lead_row.archived_at is null
      and (
        public.lead_norm_email(lead_row.assigned_to_email) is null
        or not exists (
          select 1
          from public.task_agents agent
          join public.portal_account account
            on lower(btrim(account.email)) = lower(btrim(agent.email))
           and account.is_active
          where lower(btrim(agent.email)) = public.lead_norm_email(lead_row.assigned_to_email)
        )
      )
  ) then
    raise exception 'PERSONAL_LEADS_NEED_ACTIVE_AGENT';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.leads'::regclass
      and conname = 'leads_active_personal_agent_required'
  ) then
    alter table public.leads
      add constraint leads_active_personal_agent_required
      check (
        archived_at is not null
        or event_id is not null
        or assigned_to_email is not null
      ) not valid;
  end if;
end $$;

alter table public.leads
  validate constraint leads_active_personal_agent_required;

create or replace function public.lead_require_personal_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  agent_email text := public.lead_norm_email(new.assigned_to_email);
begin
  if new.event_id is null and new.archived_at is null then
    if agent_email is null then
      raise exception using message = 'LEAD_PERSONAL_AGENT_REQUIRED';
    end if;

    if not exists (
      select 1
      from public.task_agents agent
      join public.portal_account account
        on lower(btrim(account.email)) = lower(btrim(agent.email))
       and account.is_active
      where lower(btrim(agent.email)) = agent_email
    ) then
      raise exception using message = 'LEAD_PERSONAL_AGENT_INVALID';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lead_require_personal_agent_trg on public.leads;
create trigger lead_require_personal_agent_trg
  before insert or update of event_id, assigned_to_email, archived_at
  on public.leads
  for each row execute function public.lead_require_personal_agent();

-- Direct INSERT is the normal Personal-lead create path. Record its initial
-- ownership without calling assign_leads_manual, which would see the same
-- Agent as both the old and new owner.
create or replace function public.lead_log_personal_assignment_on_create()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_id is null
    and new.archived_at is null
    and public.lead_norm_email(new.assigned_to_email) is not null then
    insert into public.lead_assignment_history
      (lead_id, from_email, to_email, reason, actor_email)
    values (
      new.id,
      null,
      public.lead_norm_email(new.assigned_to_email),
      'Personal lead assigned when created',
      coalesce(
        public.lead_norm_email(new.assigned_by_email),
        public.lead_norm_email(new.created_by_email),
        public.lead_norm_email(new.assigned_to_email)
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists lead_log_personal_assignment_on_create_trg on public.leads;
create trigger lead_log_personal_assignment_on_create_trg
  after insert on public.leads
  for each row execute function public.lead_log_personal_assignment_on_create();

-- Replacing the RPC keeps its atomic history behavior while making a direct
-- unassign of a Personal lead fail with a useful application-level error.
create or replace function public.assign_leads_manual(
  p_lead_ids uuid[],
  p_to_email text,
  p_actor_email text,
  p_reason text
) returns table (lead_id uuid, from_email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_value text;
  target_value text;
  lead_row record;
begin
  actor_value := public.lead_norm_email(p_actor_email);
  if actor_value is null then
    raise exception 'LEAD_ACTOR_REQUIRED';
  end if;
  target_value := public.lead_norm_email(p_to_email);

  for lead_row in
    select lead.id, lead.event_id, lead.assigned_to_email
    from public.leads lead
    where lead.id = any (coalesce(p_lead_ids, array[]::uuid[]))
      and lead.archived_at is null
    order by lead.id
    for update
  loop
    if lead_row.event_id is null and target_value is null then
      raise exception 'LEAD_PERSONAL_AGENT_REQUIRED';
    end if;

    update public.leads
    set assigned_to_email = target_value,
        assigned_at = case when target_value is null then null else now() end,
        assigned_by_email = actor_value,
        updated_at = now(),
        updated_by_email = actor_value
    where id = lead_row.id;

    insert into public.lead_assignment_history
      (lead_id, from_email, to_email, reason, actor_email)
    values (lead_row.id, lead_row.assigned_to_email, target_value, p_reason, actor_value);

    lead_id := lead_row.id;
    from_email := lead_row.assigned_to_email;
    return next;
  end loop;
end;
$$;

revoke all on function public.assign_leads_manual(uuid[], text, text, text)
  from public, anon, authenticated;
grant execute on function public.assign_leads_manual(uuid[], text, text, text)
  to service_role;

-- Do not let Account Management remove or deactivate an Agent while an active
-- Personal lead would still name that person as its owner.
create or replace function public.prevent_personal_lead_agent_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.leads lead_row
    where lead_row.event_id is null
      and lead_row.archived_at is null
      and public.lead_norm_email(lead_row.assigned_to_email)
          = public.lead_norm_email(old.email)
  ) then
    raise exception using message = 'AGENT_HAS_PERSONAL_LEADS';
  end if;
  return old;
end;
$$;

drop trigger if exists task_agent_personal_lead_guard_trg on public.task_agents;
create trigger task_agent_personal_lead_guard_trg
  before delete on public.task_agents
  for each row execute function public.prevent_personal_lead_agent_removal();

create or replace function public.prevent_personal_lead_account_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' or (old.is_active and not new.is_active) then
    if exists (
      select 1
      from public.task_agents agent
      join public.leads lead_row
        on public.lead_norm_email(lead_row.assigned_to_email)
           = public.lead_norm_email(agent.email)
      where public.lead_norm_email(agent.email) = public.lead_norm_email(old.email)
        and lead_row.event_id is null
        and lead_row.archived_at is null
    ) then
      raise exception using message = 'AGENT_HAS_PERSONAL_LEADS';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists portal_account_personal_lead_guard_trg on public.portal_account;
create trigger portal_account_personal_lead_guard_trg
  before delete or update of is_active on public.portal_account
  for each row execute function public.prevent_personal_lead_account_deactivation();

do $$
begin
  if exists (
    select 1
    from public.leads lead_row
    where lead_row.event_id is null
      and lead_row.archived_at is null
      and (
        public.lead_norm_email(lead_row.assigned_to_email) is null
        or not exists (
          select 1
          from public.task_agents agent
          join public.portal_account account
            on lower(btrim(account.email)) = lower(btrim(agent.email))
           and account.is_active
          where lower(btrim(agent.email)) = public.lead_norm_email(lead_row.assigned_to_email)
        )
      )
  ) then
    raise exception 'PERSONAL_LEAD_AGENT_GUARD_INCOMPLETE';
  end if;
end $$;

commit;

-- Post-rollout checks (both must return 0):
-- select count(*) from public.leads where event_id is null and archived_at is null and assigned_to_email is null;
-- select count(*) from public.lead_events where archived_at is null and lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) in ('personal', 'personal lead', 'personal leads');
