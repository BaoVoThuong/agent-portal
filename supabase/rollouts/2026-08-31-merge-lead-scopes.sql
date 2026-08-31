-- Merge the two lead table-config scopes into one.
--
-- Health Leads and P&C Leads were separate screens backed by separate scopes.
-- They are now a single Event Leads list with Product as a column, because an
-- event's intake arrives as one batch and gets split across agents from one
-- place. leads.product never changed — only the screens were split.
--
-- Column CONFIGURATION is per-scope, so the old rows are archived rather than
-- deleted: they are the record of how the two screens were set up, and nothing
-- reads an archived column. Lead DATA is untouched, and custom_values keys are
-- scope-independent, so a value entered under lead_pc still reads back under
-- the merged scope.
--
-- Forward-only and idempotent.

-- is_table_scope is the single definition both write RPCs consult.
create or replace function is_table_scope(p_scope text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_scope in ('cs', 'aca', 'medicare', 'lead');
$$;

update table_column
set archived_at = now(), updated_at = now()
where scope in ('lead_pc', 'lead_health') and archived_at is null;

update user_table_layout
set scope = 'lead'
where scope in ('lead_pc', 'lead_health')
  and not exists (
    select 1 from user_table_layout as existing
    where existing.scope = 'lead'
      and existing.user_email = user_table_layout.user_email
  );
delete from user_table_layout where scope in ('lead_pc', 'lead_health');

-- The constraint keeps the retired values so the archived rows above stay
-- legal; only the application and is_table_scope stop offering them.
alter table table_column drop constraint if exists table_column_scope_check;
alter table table_column add constraint table_column_scope_check
  check (scope in ('cs','aca','medicare','lead_pc','lead_health','lead'));
alter table user_table_layout drop constraint if exists user_table_layout_scope_check;
alter table user_table_layout add constraint user_table_layout_scope_check
  check (scope in ('cs','aca','medicare','lead_pc','lead_health','lead'));
alter table import_request drop constraint if exists import_request_scope_check;
alter table import_request add constraint import_request_scope_check
  check (scope in ('cs','aca','medicare','lead_pc','lead_health','lead'));

-- Verification. Expect zero active columns on the retired scopes, and
-- is_table_scope true for 'lead' and false for the old pair.
select
  (select count(*) from table_column
     where scope in ('lead_pc','lead_health') and archived_at is null) as active_on_old_scopes,
  is_table_scope('lead')        as lead_ok,
  is_table_scope('lead_pc')     as lead_pc_retired,
  is_table_scope('lead_health') as lead_health_retired;
