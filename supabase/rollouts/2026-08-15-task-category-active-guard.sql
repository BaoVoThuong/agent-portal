-- Add the active-category invariant without changing existing historical refs.
-- Apply before deploying routes that map TASK_CATEGORY_INACTIVE to 409.
create or replace function public.enforce_active_task_category()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.category_id is not null then
    if tg_op = 'INSERT' or new.category_id is distinct from old.category_id then
      if not exists (
        select 1
        from public.task_categories c
        where c.id = new.category_id
          and c.is_active = true
      ) then
        raise exception 'TASK_CATEGORY_INACTIVE';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_active_category_guard on public.tasks;
create trigger tasks_active_category_guard
before insert or update of category_id on public.tasks
for each row execute function public.enforce_active_task_category();

revoke all on function public.enforce_active_task_category() from public, anon, authenticated;
