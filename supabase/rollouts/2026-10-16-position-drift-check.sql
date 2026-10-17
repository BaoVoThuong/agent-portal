-- READ ONLY. Accounts whose Position disagrees with task_agents / agent_members
-- (the tables that decide access). Expect zero rows. A row means someone wrote
-- the membership tables outside Edit account (e.g. the old Agent membership
-- tab while old code was still deployed). Fix by setting that account's
-- Position in Edit account to match what they have today.
select a.name, a.email, p.name as position, p.kind,
  exists (select 1 from task_agents t where lower(btrim(t.email)) = lower(btrim(a.email))) as on_agent_list,
  exists (select 1 from agent_members m where lower(btrim(m.cs_email)) = lower(btrim(a.email)) and m.is_assistant) as has_assistant_links
from portal_account a
left join positions p on p.id = a.position_id
where coalesce(p.kind = 'agent', false) is distinct from exists (select 1 from task_agents t where lower(btrim(t.email)) = lower(btrim(a.email)))
   or coalesce(p.kind = 'assistant', false) is distinct from exists (select 1 from agent_members m where lower(btrim(m.cs_email)) = lower(btrim(a.email)) and m.is_assistant)
order by a.email;
