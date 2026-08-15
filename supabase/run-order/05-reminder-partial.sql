begin;
-- Apply after task_reminder_settings exists and before the partial PATCH UI.
create or replace function public.update_task_reminder_setting_atomic(p_key text, p_value integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare settings_row public.task_reminder_settings%rowtype;
begin
  if p_key not in ('dueSoonMinutes','todoHours','overdueReminderHours','waitingHours','staleHours','qcHours')
    or p_value is null or p_value <= 0
    or (p_key = 'dueSoonMinutes' and p_value > 10080)
    or (p_key <> 'dueSoonMinutes' and p_value > 8760) then raise exception 'REMINDER_SETTING_INVALID'; end if;
  select * into settings_row from public.task_reminder_settings where id = true for update;
  if not found then insert into public.task_reminder_settings (id) values (true); select * into settings_row from public.task_reminder_settings where id = true for update; end if;
  update public.task_reminder_settings set
    due_soon_minutes = case when p_key = 'dueSoonMinutes' then p_value else due_soon_minutes end,
    todo_hours = case when p_key = 'todoHours' then p_value else todo_hours end,
    overdue_reminder_hours = case when p_key = 'overdueReminderHours' then p_value else overdue_reminder_hours end,
    waiting_hours = case when p_key = 'waitingHours' then p_value else waiting_hours end,
    stale_hours = case when p_key = 'staleHours' then p_value else stale_hours end,
    qc_hours = case when p_key = 'qcHours' then p_value else qc_hours end,
    updated_at = clock_timestamp() where id = true returning * into settings_row;
  return jsonb_build_object('due_soon_minutes', settings_row.due_soon_minutes, 'todo_hours', settings_row.todo_hours, 'overdue_reminder_hours', settings_row.overdue_reminder_hours, 'waiting_hours', settings_row.waiting_hours, 'stale_hours', settings_row.stale_hours, 'qc_hours', settings_row.qc_hours, 'updated_at', settings_row.updated_at);
end; $$;
revoke all on function public.update_task_reminder_setting_atomic(text, integer) from public, anon, authenticated;
grant execute on function public.update_task_reminder_setting_atomic(text, integer) to service_role;
commit;
