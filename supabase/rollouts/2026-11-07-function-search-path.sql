-- 2026-11-07: Supabase Advisors "function_search_path_mutable" (11 WARN).
--
-- None of these functions is SECURITY DEFINER (checked 2026-11-07), so this
-- is hygiene: pin the search path to what the portal's roles already use
-- (public, then extensions), with pg_temp last so a temporary object can
-- never shadow a real one. Behaviour does not change. Re-runnable.
--
-- Not changed: "extension_in_public" (pg_trgm). Moving it can break trigram
-- indexes and unqualified similarity() calls; the warning is left as is.

begin;

alter function public.parse_health_date_token(text) set search_path = public, extensions, pg_temp;
alter function public.parse_health_date(text) set search_path = public, extensions, pg_temp;
alter function public.parse_health_money(text) set search_path = public, extensions, pg_temp;
alter function public.parse_health_int(text) set search_path = public, extensions, pg_temp;
alter function public.parse_pc_date(text) set search_path = public, extensions, pg_temp;
alter function public.lead_event_normalize_name() set search_path = public, extensions, pg_temp;
alter function public.tasks_updated_at_monotonic() set search_path = public, extensions, pg_temp;
alter function public.enrollment_records_assign_display_number() set search_path = public, extensions, pg_temp;
alter function public.task_reset_due_overdue_marks() set search_path = public, extensions, pg_temp;
alter function public.portal_account_manager_no_cycle() set search_path = public, extensions, pg_temp;
alter function public.create_lead_event_assignment_settings() set search_path = public, extensions, pg_temp;

commit;

-- Verify (expect 11 rows, each proconfig = {search_path=public, extensions, pg_temp}):
-- select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname in (
--   'parse_health_date_token','parse_health_date','parse_health_money','parse_health_int',
--   'parse_pc_date','lead_event_normalize_name','tasks_updated_at_monotonic',
--   'enrollment_records_assign_display_number','task_reset_due_overdue_marks',
--   'portal_account_manager_no_cycle','create_lead_event_assignment_settings');
