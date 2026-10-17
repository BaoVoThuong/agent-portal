-- =====================================================================
-- Drop the "CS Manager needs Task Manage" guard (user decision 2026-10-17).
-- Position CS Manager becomes a job label like every other Position: Role
-- Manager and Account Manager may untick Task Manage, disable a role or move
-- people between roles exactly as production allowed before 2026-10-16.
--
-- update_account_atomic is re-created without its call to the guard; the rest
-- of its body is unchanged from 2026-10-16-account-position-write.sql.
-- No data is written.
-- =====================================================================

begin;

create or replace function public.update_account_atomic(
  p_user_id uuid,
  p_patch jsonb,
  p_role_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
  v_email text;
  v_old_position uuid;
  v_old_manager uuid;
  v_old_kind text;
  v_new_position uuid;
  v_new_kind text;
  v_final_kind text;
  v_old_assists text[];
  v_desired text[];
  v_expected jsonb;
  v_manager uuid;
  v_membership_change boolean;
begin
  -- Every write that can remove an Admin takes this lock, so two concurrent
  -- demotions cannot both see "another Admin remains".
  perform pg_advisory_xact_lock(hashtextextended('portal_account:admin_invariant', 0));

  p_patch := coalesce(p_patch, '{}'::jsonb);
  v_membership_change := p_patch ?| array['position_id', 'assisted_agent_emails'];
  if v_membership_change then
    -- Same lock as create_agent_membership_atomic.
    perform pg_advisory_xact_lock(hashtextextended('assistant-memberships', 0));
  end if;

  select lower(btrim(a.email)), a.position_id, a.manager_id
    into v_email, v_old_position, v_old_manager
  from public.portal_account a
  where a.id = p_user_id
  for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  select kind into v_old_kind from public.positions where id = v_old_position;
  v_old_assists := array(
    select distinct lower(btrim(m.agent_email))
    from public.agent_members m
    where lower(btrim(m.cs_email)) = v_email and m.is_assistant
    order by 1
  );

  if p_patch ? 'expected' then
    v_expected := p_patch->'expected';
    if nullif(v_expected->>'position_id', '')::uuid is distinct from v_old_position
      or nullif(v_expected->>'manager_id', '')::uuid is distinct from v_old_manager
      or array(
           select distinct lower(btrim(x))
           from jsonb_array_elements_text(coalesce(v_expected->'assisted_agent_emails', '[]'::jsonb)) x
           order by 1
         ) is distinct from v_old_assists
    then
      raise exception 'ACCOUNT_CONFIG_CONFLICT';
    end if;
  end if;

  if p_patch ? 'manager_id' then
    v_manager := nullif(p_patch->>'manager_id', '')::uuid;
    if v_manager is distinct from v_old_manager and v_manager is not null
      and not exists (select 1 from public.portal_account where id = v_manager and is_active)
    then
      raise exception 'MANAGER_INVALID';
    end if;
  end if;

  update public.portal_account set
    email = case when p_patch ? 'email' then p_patch->>'email' else email end,
    name = case when p_patch ? 'name' then p_patch->>'name' else name end,
    agent_id = case when p_patch ? 'agent_id' then p_patch->>'agent_id' else agent_id end,
    is_active = case when p_patch ? 'is_active' then (p_patch->>'is_active')::boolean else is_active end,
    password_hash = case when p_patch ? 'password_hash' then p_patch->>'password_hash' else password_hash end,
    manager_id = case when p_patch ? 'manager_id' then nullif(p_patch->>'manager_id', '')::uuid else manager_id end
  where id = p_user_id;

  if p_role_id is not null then
    perform public.replace_user_roles(p_user_id, array[p_role_id]);
  end if;

  v_final_kind := v_old_kind;
  if p_patch ? 'position_id' then
    v_new_position := nullif(p_patch->>'position_id', '')::uuid;
    if v_new_position is not null then
      select kind into v_new_kind from public.positions where id = v_new_position;
      if not found then
        raise exception 'POSITION_NOT_FOUND';
      end if;
    end if;

    if v_new_position is distinct from v_old_position then
      -- Leaving the Agent group: exactly delete_task_agent_atomic.
      if v_old_kind = 'agent' and v_new_kind is distinct from 'agent' then
        delete from public.agent_members where lower(btrim(agent_email)) = v_email;
        delete from public.task_agents where lower(btrim(email)) = v_email;
      end if;
      -- Leaving the Assistant group: drop this person's Assistant links.
      if v_old_kind = 'assistant' and v_new_kind is distinct from 'assistant' then
        delete from public.agent_members
        where lower(btrim(cs_email)) = v_email and is_assistant;
      end if;
      -- Joining the Agent group: the old "Add Agent".
      if v_new_kind = 'agent' and v_old_kind is distinct from 'agent' then
        if exists (
          select 1 from public.agent_members
          where lower(btrim(cs_email)) = v_email and is_assistant
        ) then
          raise exception 'AGENT_ASSISTANT_CONFLICT';
        end if;
        insert into public.task_agents (email) values (v_email)
        on conflict (email) do nothing;
      end if;

      update public.portal_account set position_id = v_new_position where id = p_user_id;
    end if;
    v_final_kind := v_new_kind;
  end if;

  if p_patch ? 'assisted_agent_emails' then
    v_desired := array(
      select distinct lower(btrim(x))
      from jsonb_array_elements_text(p_patch->'assisted_agent_emails') x
      where btrim(x) <> ''
      order by 1
    );
    if v_final_kind is distinct from 'assistant' then
      if cardinality(v_desired) > 0 then
        raise exception 'ASSISTANT_AGENTS_NEED_ASSISTANT_POSITION';
      end if;
    else
      if cardinality(v_desired) = 0 then
        raise exception 'ASSISTANT_NEEDS_AGENT';
      end if;
      if v_email = any(v_desired) then
        raise exception 'ASSISTANT_SELF_MEMBERSHIP';
      end if;
      if exists (select 1 from public.task_agents where lower(btrim(email)) = v_email) then
        raise exception 'AGENT_ASSISTANT_CONFLICT';
      end if;
      -- Same eligibility create_agent_membership_atomic checked: an Agent on
      -- the roster with an active account, and an active Assistant account.
      if exists (
        select 1 from unnest(v_desired) d
        where d <> all(v_old_assists)
          and not exists (
            select 1
            from public.task_agents t
            join public.portal_account acc on lower(btrim(acc.email)) = d and acc.is_active
            where lower(btrim(t.email)) = d
          )
      ) then
        raise exception 'ASSISTANT_AGENT_INELIGIBLE';
      end if;
      if v_desired is distinct from v_old_assists and not exists (
        select 1 from public.portal_account where id = p_user_id and is_active
      ) then
        raise exception 'ASSISTANT_ACCOUNT_INELIGIBLE';
      end if;

      delete from public.agent_members
      where lower(btrim(cs_email)) = v_email and is_assistant
        and lower(btrim(agent_email)) <> all(v_desired);

      -- A legacy non-Assistant row for the same pair is promoted in place,
      -- as create_agent_membership_atomic did.
      update public.agent_members set is_assistant = true
      where lower(btrim(cs_email)) = v_email and not is_assistant
        and lower(btrim(agent_email)) = any(v_desired);

      insert into public.agent_members (agent_email, cs_email, is_assistant)
      select d, v_email, true
      from unnest(v_desired) d
      where not exists (
        select 1 from public.agent_members m
        where lower(btrim(m.agent_email)) = d and lower(btrim(m.cs_email)) = v_email
      );
    end if;
  elsif v_final_kind = 'assistant' and v_old_kind is distinct from 'assistant' then
    raise exception 'ASSISTANT_NEEDS_AGENT';
  end if;

  perform public.assert_active_admin_remains();

  select jsonb_build_object(
           'id', a.id, 'email', a.email, 'name', a.name, 'agent_id', a.agent_id,
           'is_active', a.is_active, 'created_at', a.created_at,
           'position_id', a.position_id, 'manager_id', a.manager_id)
    into result
  from public.portal_account a
  where a.id = p_user_id;
  return result;
end;
$$;

revoke all on function public.update_account_atomic(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.update_account_atomic(uuid, jsonb, uuid) to service_role;

drop trigger if exists cs_manager_guard_role_permissions on public.role_permissions;
drop trigger if exists cs_manager_guard_roles on public.roles;
drop trigger if exists cs_manager_guard_user_roles on public.user_roles;
drop trigger if exists cs_manager_guard_portal_account on public.portal_account;
drop function if exists public.cs_manager_task_manage_guard();
drop function if exists public.assert_cs_managers_have_task_manage();

commit;

notify pgrst, 'reload schema';
