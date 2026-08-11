-- Scratch-only failure-injection test for replace_health_payment_summary.
-- Run with ON_ERROR_STOP=1 against a disposable database after supabase/schema.sql.
begin;

delete from public.health_payment_summary;
insert into public.health_payment_summary (transaction_id, customer_name)
values ('old-fixture', 'Old row');

do $$
begin
  begin
    perform public.replace_health_payment_summary(
      jsonb_build_array(jsonb_build_object(
        'transaction_id', 'bad-fixture',
        'gross_compensation', 'not-a-number'
      ))
    );
    raise exception 'CASE 1 expected replacement cast failure';
  exception when others then
    null;
  end;

  if not exists (
    select 1 from public.health_payment_summary
    where transaction_id = 'old-fixture' and customer_name = 'Old row'
  ) then
    raise exception 'CASE 1 old fixture was not preserved';
  end if;
end;
$$;

select public.replace_health_payment_summary(
  jsonb_build_array(jsonb_build_object(
    'transaction_id', 'new-fixture',
    'customer_name', 'New row',
    'gross_compensation', 12.5
  ))
);

do $$
begin
  if (select count(*) from public.health_payment_summary) <> 1
    or not exists (
      select 1 from public.health_payment_summary
      where transaction_id = 'new-fixture' and customer_name = 'New row'
    ) then
    raise exception 'CASE 2 replacement did not fully replace the old dataset';
  end if;
end;
$$;

rollback;
