-- Rollback of 2026-10-21-other-service-enrollment.sql.
-- Refuses to run while any Other Service record exists: delete or move those
-- records first (their comments/attachments/activity cascade with them).
begin;

do $$
begin
  if exists (select 1 from enrollment_records where program = 'other_service') then
    raise exception 'Other Service still has records; remove them before rolling back';
  end if;
end $$;

delete from table_column_option
where column_id in (select id from table_column where scope = 'other_service');
delete from user_table_layout where scope = 'other_service';
delete from import_request where scope = 'other_service';
delete from table_column where scope = 'other_service';
delete from enrollment_queue_members where program = 'other_service';
delete from enrollment_stage_cycles where program = 'other_service';
delete from enrollment_options
where set_id in (select id from enrollment_option_sets where program = 'other_service');
delete from enrollment_option_sets where program = 'other_service';

alter table enrollment_records drop constraint if exists enrollment_records_other_service_fields_check;

alter table enrollment_records drop constraint if exists enrollment_records_program_check;
alter table enrollment_records add constraint enrollment_records_program_check
  check (program in ('aca', 'medicare', 'medicaid'));
alter table enrollment_option_sets drop constraint if exists enrollment_option_sets_program_check;
alter table enrollment_option_sets add constraint enrollment_option_sets_program_check
  check (program in ('aca', 'medicare', 'medicaid'));
alter table enrollment_stage_cycles drop constraint if exists enrollment_stage_cycles_program_check;
alter table enrollment_stage_cycles add constraint enrollment_stage_cycles_program_check
  check (program in ('aca', 'medicare', 'medicaid'));
alter table enrollment_queue_members drop constraint if exists enrollment_queue_members_program_check;
alter table enrollment_queue_members add constraint enrollment_queue_members_program_check
  check (program in ('aca', 'medicare', 'medicaid'));

alter table table_column drop constraint if exists table_column_scope_check;
alter table table_column add constraint table_column_scope_check
  check (scope in ('cs','aca','medicare','medicaid','lead_pc','lead_health','lead','provider'));
alter table user_table_layout drop constraint if exists user_table_layout_scope_check;
alter table user_table_layout add constraint user_table_layout_scope_check
  check (scope in ('cs','aca','medicare','medicaid','lead_pc','lead_health','lead','provider'));
alter table import_request drop constraint if exists import_request_scope_check;
alter table import_request add constraint import_request_scope_check
  check (scope in ('cs','aca','medicare','medicaid','lead_pc','lead_health','lead'));

create or replace function is_table_scope(p_scope text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_scope in ('cs', 'aca', 'medicare', 'medicaid', 'lead', 'provider');
$$;

create or replace function enrollment_records_assign_display_number()
returns trigger
language plpgsql
as $$
begin
  if new.display_number is null then
    new.display_number := case new.program
      when 'medicare' then nextval('enrollment_records_medicare_display_number_seq')
      when 'medicaid' then nextval('enrollment_records_medicaid_display_number_seq')
      else nextval('enrollment_records_aca_display_number_seq')
    end;
  end if;
  return new;
end;
$$;

drop sequence if exists enrollment_records_other_service_display_number_seq;

commit;
notify pgrst, 'reload schema';
