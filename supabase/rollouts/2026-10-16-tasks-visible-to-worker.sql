-- 2026-10-16 — Phạm vi task của Agent/Assistant tính trong database.
--
-- Trước đây `fetchTasksForActor` gom MỌI task_id một Agent/Assistant từng được giao
-- (task_assignees) hoặc @mention (task_participants), kể cả task đã xong hay archive, rồi
-- nhét vào URL dưới dạng `.or(id.in.(...))`. Danh sách chỉ tăng; tới ~150 id thì vượt trần
-- 6 KB và Task Board sập (TaskScopeTooLargeError, 2026-10-16: 155 id, 6.246 byte).
--
-- Hàm này áp đúng điều kiện cũ ngay trong database, nên request chỉ mang email và các
-- Agent mà người đó làm Assistant. Điều kiện y hệt `buildWorkerTaskOrs` cũ, so khớp email
-- chính xác như các lệnh `.eq` cũ. App vẫn thêm `archived_at is null`, sắp theo `id`,
-- phân trang keyset và đếm ở trang đầu trên kết quả của hàm.
--
-- Chạy file này TRƯỚC khi deploy code gọi `tasks_visible_to_worker`. Code cũ không gọi hàm
-- này, nên chạy sớm không ảnh hưởng gì. Rollback: 2026-10-16-tasks-visible-to-worker.rollback.sql
-- (chỉ chạy sau khi đã revert code).

create or replace function public.tasks_visible_to_worker(p_email text, p_agent_emails text[])
returns setof public.tasks
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.*
  from public.tasks t
  where nullif(btrim(p_email), '') is not null
    and t.archived_at is null
    and (
      t.assignee_email = p_email
      or t.agent_email = p_email
      or t.reporter_email = p_email
      or t.agent_email = any(coalesce(p_agent_emails, '{}'::text[]))
      or exists (
        select 1 from public.task_assignees a
        where a.task_id = t.id and a.email = p_email
      )
      or exists (
        select 1 from public.task_participants p
        where p.task_id = t.id and p.email = p_email
      )
    );
$$;

-- Server-only RPC: Next.js đã kiểm quyền rồi mới gọi bằng service role.
revoke all on function public.tasks_visible_to_worker(text, text[]) from public, anon, authenticated;
grant execute on function public.tasks_visible_to_worker(text, text[]) to service_role;

notify pgrst, 'reload schema';
