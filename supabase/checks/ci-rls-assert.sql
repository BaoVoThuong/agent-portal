-- Cổng persistence: fail nếu còn bảng public mở cho anon/authenticated mà chưa
-- bật RLS, hoặc hàm SECURITY DEFINER còn EXECUTE cho anon/authenticated.
--
-- Chạy trong CI sau schema.sql + các rollout (.github/workflows/db-persistence-gate.yml).
-- Trên production dùng truy vấn read-only ở Task A0 của
-- docs/superpowers/plans/2026-09-26-authorization-final-plan.md.
do $$
declare
  leaked text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into leaked
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and not c.relrowsecurity
    and (has_table_privilege('anon', c.oid, 'SELECT')
      or has_table_privilege('anon', c.oid, 'INSERT')
      or has_table_privilege('anon', c.oid, 'UPDATE')
      or has_table_privilege('anon', c.oid, 'DELETE')
      or has_table_privilege('authenticated', c.oid, 'SELECT')
      or has_table_privilege('authenticated', c.oid, 'INSERT')
      or has_table_privilege('authenticated', c.oid, 'UPDATE')
      or has_table_privilege('authenticated', c.oid, 'DELETE'));
  if leaked is not null then
    raise exception 'Bảng public mở cho anon/authenticated mà chưa bật RLS: %', leaked;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text) into leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute'));
  if leaked is not null then
    raise exception 'SECURITY DEFINER còn mở cho anon/authenticated: %', leaked;
  end if;
end $$;

select 'persistence gate: ok' as result;
