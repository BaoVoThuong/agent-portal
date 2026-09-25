-- Giả lập các role mà Supabase tạo sẵn, để schema.sql (có revoke/grant tới
-- chúng) chạy được trên Postgres trơn. Default privileges mô phỏng hành vi của
-- Supabase: bảng mới trong public tự cấp ALL cho anon/authenticated — chính vì
-- vậy mà bảng quên bật RLS là bảng lộ.
--
-- CHỈ dùng cho DB dùng một lần trong CI (.github/workflows/db-persistence-gate.yml).
-- Không chạy trên production.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
