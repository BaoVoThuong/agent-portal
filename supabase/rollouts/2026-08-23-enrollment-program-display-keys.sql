-- Split Enrollment display-number allocation by program.
-- Existing numeric values are intentionally preserved. Only the prefix changes
-- in the application, while future ACA and Medicare records use independent
-- counters (ACA-* and MED-*).

begin;

lock table enrollment_records in access exclusive mode;

create sequence if not exists enrollment_records_aca_display_number_seq;
create sequence if not exists enrollment_records_medicare_display_number_seq;

alter table enrollment_records add column if not exists display_number bigint;
alter table enrollment_records alter column display_number drop default;
drop index if exists enrollment_records_display_number_key;

do $$
declare
  aca_max bigint;
  medicare_max bigint;
begin
  select max(display_number) into aca_max
  from enrollment_records
  where program = 'aca';
  select max(display_number) into medicare_max
  from enrollment_records
  where program = 'medicare';

  if aca_max is null then
    perform setval('enrollment_records_aca_display_number_seq', 1, false);
  else
    perform setval('enrollment_records_aca_display_number_seq', aca_max, true);
  end if;
  if medicare_max is null then
    perform setval('enrollment_records_medicare_display_number_seq', 1, false);
  else
    perform setval('enrollment_records_medicare_display_number_seq', medicare_max, true);
  end if;
end $$;

create or replace function enrollment_records_assign_display_number()
returns trigger
language plpgsql
as $$
begin
  if new.display_number is null then
    new.display_number := case new.program
      when 'medicare' then nextval('enrollment_records_medicare_display_number_seq')
      else nextval('enrollment_records_aca_display_number_seq')
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists enrollment_records_assign_display_number_trigger
  on enrollment_records;
create trigger enrollment_records_assign_display_number_trigger
before insert on enrollment_records
for each row
execute function enrollment_records_assign_display_number();

alter table enrollment_records alter column display_number set not null;
create unique index if not exists enrollment_records_program_display_number_key
  on enrollment_records (program, display_number);

commit;
