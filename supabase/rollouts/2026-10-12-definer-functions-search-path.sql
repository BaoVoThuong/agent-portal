-- Pin search_path on the three SECURITY DEFINER functions the Supabase advisor
-- flags (function_search_path_mutable). A definer function runs with its
-- owner's rights, so it must not resolve table or function names through the
-- caller's search_path. pg_temp goes last explicitly; left implicit it is
-- searched first for tables.
--
-- All three are callable only by service_role and use only public tables and
-- public parse_* helpers, so behaviour is unchanged.
--
-- Deliberately not applied to the other 11 flagged functions: they are not
-- SECURITY DEFINER (they run with the caller's rights), and a SET clause stops
-- Postgres inlining SQL functions — parse_health_int / parse_health_money run
-- ~85k times per refresh_health_mart().
--
-- Roll back: alter function public.<name>() reset search_path;

alter function public.refresh_health_mart() set search_path = public, pg_temp;
alter function public.refresh_pc_mart() set search_path = public, pg_temp;
alter function public.clear_health_payment_summary() set search_path = public, pg_temp;
