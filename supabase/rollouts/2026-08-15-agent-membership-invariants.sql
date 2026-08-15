-- Apply after the base schema has agent_members.is_assistant.
-- This rollout is additive and safe to run more than once.
begin;

create or replace function create_agent_membership_atomic(
  p_agent_email text,
  p_cs_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_agent text := nullif(lower(btrim(p_agent_email)), '');
  normalized_assistant text := nullif(lower(btrim(p_cs_email)), '');
  existing_is_assistant boolean;
begin
  if normalized_agent is null or normalized_assistant is null then
    raise exception using message = 'ASSISTANT_EMAIL_REQUIRED';
  end if;
  if normalized_agent = normalized_assistant then
    raise exception using message = 'ASSISTANT_SELF_MEMBERSHIP';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('assistant-memberships', 0));
  if not exists (
    select 1
    from task_agents agent
    join portal_account account
      on lower(btrim(account.email)) = normalized_agent
     and account.is_active
    where lower(btrim(agent.email)) = normalized_agent
  ) then
    raise exception using message = 'ASSISTANT_AGENT_INELIGIBLE';
  end if;
  if not exists (
    select 1 from portal_account account
    where lower(btrim(account.email)) = normalized_assistant
      and account.is_active
  ) then
    raise exception using message = 'ASSISTANT_ACCOUNT_INELIGIBLE';
  end if;
  select is_assistant into existing_is_assistant
  from agent_members
  where lower(btrim(agent_email)) = normalized_agent
    and lower(btrim(cs_email)) = normalized_assistant
  for update;
  if coalesce(existing_is_assistant, false) then
    raise exception using message = 'ASSISTANT_DUPLICATE_MEMBERSHIP';
  end if;
  if exists (
    with recursive reachable(email) as (
      select lower(btrim(member.cs_email))
      from agent_members member
      where lower(btrim(member.agent_email)) = normalized_assistant
        and member.is_assistant
      union
      select lower(btrim(member.cs_email))
      from agent_members member
      join reachable parent on lower(btrim(member.agent_email)) = parent.email
      where member.is_assistant
    )
    select 1 from reachable where email = normalized_agent
  ) then
    raise exception using message = 'ASSISTANT_MEMBERSHIP_CYCLE';
  end if;
  if existing_is_assistant is not null then
    update agent_members
    set agent_email = normalized_agent,
        cs_email = normalized_assistant,
        is_assistant = true
    where lower(btrim(agent_email)) = normalized_agent
      and lower(btrim(cs_email)) = normalized_assistant;
  else
    insert into agent_members (agent_email, cs_email, is_assistant)
    values (normalized_agent, normalized_assistant, true)
    on conflict (agent_email, cs_email)
    do update set is_assistant = true;
  end if;
  return jsonb_build_object(
    'agent_email', normalized_agent,
    'cs_email', normalized_assistant,
    'is_assistant', true
  );
end;
$$;

revoke all on function create_agent_membership_atomic(text, text) from public, anon, authenticated;
grant execute on function create_agent_membership_atomic(text, text) to service_role;
commit;
