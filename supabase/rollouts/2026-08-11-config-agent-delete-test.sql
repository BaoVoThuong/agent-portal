-- Scratch-only atomic Config agent deletion test.
-- Run with ON_ERROR_STOP=1 after supabase/schema.sql in a disposable database.
begin;

insert into public.task_agents (email) values ('agent-fixture@example.com');
insert into public.agent_members (agent_email, cs_email)
values ('agent-fixture@example.com', 'assistant-fixture@example.com');

select public.delete_task_agent_atomic('agent-fixture@example.com');

do $$
begin
  if exists (select 1 from public.task_agents where email = 'agent-fixture@example.com')
    or exists (select 1 from public.agent_members where agent_email = 'agent-fixture@example.com') then
    raise exception 'agent deletion left an orphaned membership';
  end if;
  if public.delete_task_agent_atomic('agent-fixture@example.com') then
    raise exception 'repeated deletion should be idempotent';
  end if;
end;
$$;

rollback;
