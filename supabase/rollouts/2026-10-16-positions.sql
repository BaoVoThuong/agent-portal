-- =====================================================================
-- Position catalog + portal_account.position_id (plan
-- docs/superpowers/plans/2026-10-16-account-position-unification.md, S1).
--
-- Additive only. Nothing that decides access reads these columns:
-- permissions still come from user_roles → roles → role_permissions, and the
-- Agent / Assistant scope still comes from task_agents and agent_members.
-- This file never writes those tables, user_roles, the CS queue or Time Off.
--
-- portal_account.manager_id already exists on production (org-chart branch,
-- 2026-09-12, never merged). Its DDL below is guarded so it is a no-op there
-- and only creates it on a fresh database.
--
-- Run BEFORE deploying the code that reads positions.
-- After running: notify pgrst, 'reload schema';
-- =====================================================================

begin;

-- 1. Catalog. `kind` says which Agent/Assistant facts a Position stands for;
--    it is not a source of permissions. System rows are found by system_key,
--    never by name, and cannot be edited or deleted.
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('agent', 'assistant', 'cs', 'other')),
  system_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists positions_name_key
  on public.positions (lower(btrim(name)));

alter table public.positions enable row level security;

insert into public.positions (name, kind, system_key) values
  ('Agent', 'agent', 'agent'),
  ('Assistant', 'assistant', 'assistant'),
  ('Customer Service', 'cs', 'cs'),
  ('CS Manager', 'cs', 'cs_manager')
on conflict (system_key) do nothing;

-- Rename / re-kind a Position only while nobody holds it. FOR UPDATE on the
-- row blocks the FOR KEY SHARE lock that assigning it to an account takes, so
-- an assignment either commits first (and is seen below) or waits.
create or replace function public.update_unused_position(
  p_id uuid,
  p_name text,
  p_kind text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_system_key text;
begin
  select system_key into current_system_key
  from public.positions
  where id = p_id
  for update;
  if not found then
    raise exception 'POSITION_NOT_FOUND';
  end if;
  if current_system_key is not null then
    raise exception 'POSITION_SYSTEM';
  end if;
  if exists (select 1 from public.portal_account where position_id = p_id) then
    raise exception 'POSITION_IN_USE';
  end if;

  update public.positions
  set name = btrim(p_name), kind = p_kind, updated_at = now()
  where id = p_id;
end;
$$;

revoke all on function public.update_unused_position(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_unused_position(uuid, text, text) to service_role;

-- 2. One primary Position per account. A Position in use cannot be deleted.
alter table public.portal_account
  add column if not exists position_id uuid references public.positions(id) on delete restrict;
create index if not exists portal_account_position_idx
  on public.portal_account (position_id);

-- 3. Direct manager (already on production; guarded).
alter table public.portal_account
  add column if not exists manager_id uuid references public.portal_account(id) on delete set null;
create index if not exists portal_account_manager_idx
  on public.portal_account (manager_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'portal_account_manager_not_self'
      and conrelid = 'public.portal_account'::regclass
  ) then
    alter table public.portal_account
      add constraint portal_account_manager_not_self
      check (manager_id is null or manager_id <> id);
  end if;
end $$;

-- Same body as the function already on production (read 2026-10-16).
create or replace function public.portal_account_manager_no_cycle()
returns trigger
language plpgsql
as $$
declare
  walker uuid;
  hops integer := 0;
begin
  if new.manager_id is null then return new; end if;

  -- Đi ngược lên từ manager mới. Nếu gặp lại chính mình thì phép gán này đóng
  -- một vòng.
  walker := new.manager_id;
  while walker is not null loop
    if walker = new.id then
      raise exception 'PORTAL_ACCOUNT_MANAGER_CYCLE'
        using hint = 'Không thể đặt người này làm manager: sẽ tạo thành vòng lặp trong sơ đồ tổ chức.';
    end if;

    -- Chốt chặn cuối: nếu dữ liệu ĐANG có sẵn một vòng từ trước (do lỗi nào đó
    -- lọt qua), vòng while này sẽ không bao giờ dừng. 100 cấp là quá thừa cho
    -- một tổ chức vài chục người, nên chạm tới ngưỡng nghĩa là dữ liệu đã hỏng.
    hops := hops + 1;
    if hops > 100 then
      raise exception 'PORTAL_ACCOUNT_MANAGER_CHAIN_TOO_DEEP'
        using hint = 'Chuỗi manager quá sâu hoặc đã có vòng lặp sẵn trong dữ liệu.';
    end if;

    select manager_id into walker from portal_account where id = walker;
  end loop;

  return new;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'portal_account_manager_no_cycle'
      and tgrelid = 'public.portal_account'::regclass
  ) then
    create trigger portal_account_manager_no_cycle
      before insert or update of manager_id on public.portal_account
      for each row
      when (new.manager_id is not null)
      execute function public.portal_account_manager_no_cycle();
  end if;
end $$;

-- 4. Backfill only what the current tables already say. Old data → new
--    column, never the other way. Everyone else stays without a Position.
--    The 2026-10-16 audit found no account that is both; if one appears,
--    stop instead of picking one.
do $$
begin
  if exists (
    select 1
    from public.portal_account a
    where exists (select 1 from public.task_agents t
                  where lower(btrim(t.email)) = lower(btrim(a.email)))
      and exists (select 1 from public.agent_members m
                  where lower(btrim(m.cs_email)) = lower(btrim(a.email))
                    and m.is_assistant)
  ) then
    raise exception 'POSITION_BACKFILL_AGENT_AND_ASSISTANT';
  end if;
end $$;

update public.portal_account a
set position_id = (select id from public.positions where system_key = 'agent')
where a.position_id is null
  and exists (select 1 from public.task_agents t
              where lower(btrim(t.email)) = lower(btrim(a.email)));

update public.portal_account a
set position_id = (select id from public.positions where system_key = 'assistant')
where a.position_id is null
  and exists (select 1 from public.agent_members m
              where lower(btrim(m.cs_email)) = lower(btrim(a.email))
                and m.is_assistant);

commit;

notify pgrst, 'reload schema';

-- Verify (read only). Expect: 4 system positions; agents = task_agents rows
-- with an account; assistants = distinct is_assistant cs_email with an account.
select
  (select count(*) from public.positions where system_key is not null) as system_positions,
  (select count(*) from public.portal_account a join public.positions p on p.id = a.position_id
    where p.system_key = 'agent') as agents_with_position,
  (select count(*) from public.task_agents) as task_agents_rows,
  (select count(*) from public.portal_account a join public.positions p on p.id = a.position_id
    where p.system_key = 'assistant') as assistants_with_position,
  (select count(distinct lower(btrim(cs_email))) from public.agent_members where is_assistant) as assistant_emails,
  (select count(*) from public.portal_account where position_id is null) as without_position;
