-- Rollback for 2026-10-16-positions.sql. Removes the Position catalog and
-- portal_account.position_id. Leaves portal_account.manager_id, its check and
-- its cycle trigger in place: they were on production before this rollout.
-- Deploy the code without Positions FIRST, then run this.

begin;
alter table public.portal_account drop column if exists position_id;
drop function if exists public.update_unused_position(uuid, text, text);
drop table if exists public.positions;
commit;

notify pgrst, 'reload schema';
