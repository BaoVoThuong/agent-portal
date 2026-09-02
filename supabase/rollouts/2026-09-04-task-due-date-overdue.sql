-- =====================================================================
-- Overdue theo DUE DATE — hạn cứng do admin đặt, tách hẳn khỏi overdue SLA.
--
-- Vì sao tách: SLA đo "task nằm In Progress bao lâu"; Due Date là ngày admin
-- cam kết với khách. Một task có thể vỡ cái này mà không vỡ cái kia, và người
-- dùng chốt Due Date quan trọng hơn — nên nó có cờ riêng, thông báo riêng, và
-- dòng activity riêng.
--
-- Idempotent. Chạy lại lần hai là no-op.
-- =====================================================================

-- ---------- 1. Hai dấu ----------
-- `flagged` = đã báo lần đầu. `reminded` = lần nhắc gần nhất (nhắc mỗi 24h).
-- Hai dấu riêng vì chúng trả lời hai câu khác nhau, và gộp lại thì không phân
-- biệt được "vừa quá hạn" với "quá hạn từ tuần trước".
alter table tasks add column if not exists due_overdue_flagged_at timestamptz;
alter table tasks add column if not exists due_overdue_reminded_at timestamptz;

-- ---------- 2. Index cho lượt quét của cron ----------
-- Cron hỏi "task nào có due_date và chưa xong". Không có index thì mỗi 15 phút
-- là một lượt quét toàn bảng.
create index if not exists tasks_due_date_idx
  on tasks ((custom_values ->> 'due_date'))
  where archived_at is null and (custom_values ->> 'due_date') is not null;

-- ---------- 3. Đổi Due Date thì xoá dấu đã-báo ----------
-- Người dùng chốt: dời hạn là một CAM KẾT MỚI, vỡ cam kết mới thì phải báo lại.
--
-- Làm bằng trigger chứ không làm ở route: due_date sửa được qua PATCH inline,
-- qua modal chi tiết, và qua patch_task_atomic. Ba đường thì sớm muộn cũng có
-- một đường quên xoá dấu, và lỗi đó im lặng — task vỡ hạn lần hai mà không ai
-- được báo. Trigger thì không đường nào lách được.
create or replace function task_reset_due_overdue_marks()
returns trigger
language plpgsql as $$
begin
  if (new.custom_values ->> 'due_date') is distinct from (old.custom_values ->> 'due_date') then
    new.due_overdue_flagged_at := null;
    new.due_overdue_reminded_at := null;
  end if;
  return new;
end $$;

drop trigger if exists task_reset_due_overdue_marks_trg on tasks;
create trigger task_reset_due_overdue_marks_trg
  before update of custom_values on tasks
  for each row execute function task_reset_due_overdue_marks();

-- ---------- 4. Hai loại thông báo mới ----------
-- `task_notifications.type` có CHECK constraint liệt kê từng giá trị, nên thêm
-- loại mới mà không sửa đây là insert nổ lúc chạy — và nổ trong cron, tức không
-- ai nhìn thấy cho tới khi có người hỏi vì sao không nhận được thông báo.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'task_notifications_type_check'
  ) then
    alter table task_notifications drop constraint task_notifications_type_check;
  end if;

  alter table task_notifications
  add constraint task_notifications_type_check
  check (
    type in (
      'assigned', 'mentioned', 'commented', 'reacted', 'overdue',
      'todo_reminder', 'overdue_reminder', 'waiting_reminder', 'unassigned',
      'reopened', 'qc_needed', 'due_soon', 'stale', 'overdue_unlocked',
      'qc_stale', 'sla_escalated', 'qc_reviewed', 'cancelled',
      'attachment_added', 'backlog_attention',
      -- Mới: hạn cứng theo Due Date.
      'due_date_overdue', 'due_date_overdue_reminder'
    )
  );
end $$;

-- ---------- 5. RPC đánh dấu quá hạn ----------
-- Cùng hình dạng với mark_task_overdue_atomic: cập nhật CÓ ĐIỀU KIỆN rồi đếm
-- số dòng đã đổi. Trả false nghĩa là "ai đó đã làm rồi" — đó là cổng duy nhất
-- ngăn hai lượt cron chồng nhau bắn hai lần cùng một thông báo.
--
-- Điều kiện `status not in ('done','cancel')`: task đã xong hoặc đã huỷ thì
-- không còn hạn nào để vỡ. Kiểm ở đây chứ không chỉ ở Node, vì giữa lúc cron
-- đọc và lúc nó ghi, người ta có thể vừa bấm Done.
create or replace function mark_task_due_date_overdue_atomic(
  p_task_id uuid,
  p_due_date text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_updated integer;
begin
  update tasks
  set due_overdue_flagged_at = v_now,
      due_overdue_reminded_at = v_now
  where id = p_task_id
    and archived_at is null
    and status not in ('done', 'cancel')
    and due_overdue_flagged_at is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id,
    'system',
    'due_date_overdue',
    jsonb_build_object('due_date', p_due_date, 'flagged_at', v_now)
  );
  return true;
end $$;

revoke all on function mark_task_due_date_overdue_atomic(uuid, text)
  from public, anon, authenticated;
grant execute on function mark_task_due_date_overdue_atomic(uuid, text)
  to service_role;

-- ---------- Kiểm chứng ----------
-- Một dòng, cả bốn cột phải đọc 'ok'.
select
  case when (select count(*) from information_schema.columns
             where table_name = 'tasks'
               and column_name in ('due_overdue_flagged_at', 'due_overdue_reminded_at')) = 2
       then 'ok' else 'FAIL: thiếu cột' end                                as cols,
  case when exists (select 1 from pg_indexes where indexname = 'tasks_due_date_idx')
       then 'ok' else 'FAIL: thiếu index' end                              as idx,
  case when exists (select 1 from pg_trigger where tgname = 'task_reset_due_overdue_marks_trg')
       then 'ok' else 'FAIL: thiếu trigger' end                            as trg,
  case when exists (select 1 from pg_proc where proname = 'mark_task_due_date_overdue_atomic')
       then 'ok' else 'FAIL: thiếu RPC' end                                as rpc;
