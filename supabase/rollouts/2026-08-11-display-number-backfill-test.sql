-- Scratch-only sequence/uniqueness test. Run with ON_ERROR_STOP=1 after
-- supabase/schema.sql against a disposable database.
begin;

insert into public.tasks (title, status, reporter_email)
select 'display-key-fixture-' || n, 'backlog', 'fixture@example.com'
from generate_series(1, 20001) as values(n);

do $$
begin
  if (select count(*) from public.tasks where title like 'display-key-fixture-%')
      <> (select count(distinct display_number) from public.tasks where title like 'display-key-fixture-%')
    or exists (
      select 1 from public.tasks
      where title like 'display-key-fixture-%' and display_number is null
    ) then
    raise exception 'task display numbers are not unique and non-null';
  end if;
end;
$$;

insert into public.enrollment_records (program, client_name, created_by_email)
select 'aca', 'display-key-fixture-' || n, 'fixture@example.com'
from generate_series(1, 20001) as values(n);

do $$
begin
  if (select count(*) from public.enrollment_records where client_name like 'display-key-fixture-%')
      <> (select count(distinct display_number) from public.enrollment_records where client_name like 'display-key-fixture-%')
    or exists (
      select 1 from public.enrollment_records
      where client_name like 'display-key-fixture-%' and display_number is null
    ) then
    raise exception 'enrollment display numbers are not unique and non-null';
  end if;
end;
$$;

rollback;
