-- Restrict execution of internal Enrollment functions to service_role and their owner.
-- Apply only after checking the current function signatures and privileges.
begin;
revoke execute on function public.enrollment_close_open_cycle_internal(uuid, text, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.enrollment_close_open_cycle_internal(uuid, text, timestamptz, uuid, text) from public, anon, authenticated;
revoke execute on function public.enrollment_write_activity_internal(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.enrollment_close_open_cycle_internal(uuid, text, timestamptz, uuid) to service_role;
grant execute on function public.enrollment_close_open_cycle_internal(uuid, text, timestamptz, uuid, text) to service_role;
grant execute on function public.enrollment_write_activity_internal(uuid, text, jsonb, timestamptz) to service_role;
commit;
