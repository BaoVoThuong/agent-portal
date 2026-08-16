-- ═══════════════════════════════════════════════════════════════════════
-- 20 — VÁ GẤP: cron nhắc việc chết vì sự kiện quá hạn mồ côi
--
-- TRIỆU CHỨNG: GitHub Action "Task reminders cron" fail liên tục, HTTP 500
-- với body RỖNG. Runtime log của Vercel cho thấy:
--     duplicate key value violates unique constraint "task_overdue_events_open_idx"
--
-- CƠ CHẾ:
--   • task_overdue_events_open_idx là unique trên (task_id) khi resolved_at
--     is null → mỗi task chỉ được có MỘT sự kiện quá hạn đang mở.
--   • mark_task_overdue_atomic chặn bằng "tasks.overdue_flagged_at is null",
--     tức nó ngầm coi hai thứ này luôn đi cùng nhau:
--         overdue_flagged_at is null  ⟺  không có sự kiện nào đang mở
--   • Cặp bất biến đó đã bị phá: có task overdue_flagged_at = null nhưng vẫn
--     còn sự kiện mở. RPC qua được cửa guard (UPDATE khớp 0 dòng thì thoát,
--     nhưng ở đây khớp 1 dòng) rồi chết ngay ở INSERT.
--   • Route cron không có try/catch nên exception thoát ra ngoài → Next trả
--     500 trần, không body. Đó là lý do 5 tiếng không ai đọc được nguyên nhân.
--
-- SỐ LIỆU ĐO ĐƯỢC TRƯỚC KHI VÁ: 60 task vi phạm (59 mẫu + 1 thật), trong đó
-- 10 task đang in_progress — chính 10 cái này làm cron nổ mỗi 15 phút.
--
-- FILE NÀY LÀM HAI VIỆC:
--   Phần 1 — dọn dữ liệu: đóng các sự kiện mồ côi.
--   Phần 2 — vá RPC để lỗi này không tái diễn dù dữ liệu có lệch lần nữa.
--
-- An toàn: chỉ đụng task_overdue_events (đóng sự kiện đã hết hiệu lực) và
-- thay thân một function. KHÔNG đụng bảng tasks.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ═══════════════════════════════════════════════════════════════════════
-- BẤT BIẾN ĐẦY ĐỦ (ba chiều, không phải một)
--
--   Kỳ quá hạn ĐANG MỞ  ⟺  task đang in_progress VÀ mang cờ overdue_flagged_at
--
-- Suy ra ba điều kiện phải cùng đúng:
--   1. Task không mang cờ            ⇒ không được còn sự kiện mở
--   2. Task không còn in_progress    ⇒ không được còn sự kiện mở
--   3. Task in_progress VÀ mang cờ   ⇒ PHẢI có đúng một sự kiện mở
--
-- Bản đầu của file này chỉ vá chiều 1. Đo lại sau đó phát hiện chiều 2 còn
-- 7 dòng và chiều 3 còn 18 dòng — cùng một nguyên nhân: bước tạo hình dữ
-- liệu mẫu ghi lại overdue_flagged_at mà không đụng task_overdue_events.
-- Idempotent, chạy lại bao nhiêu lần cũng được.
-- ═══════════════════════════════════════════════════════════════════════

-- ── CHIỀU 1: task không còn mang cờ → đóng sự kiện ─────────────────────
-- Ràng buộc phải giữ:
--   check (resolved_at is null or resolved_at >= overdue_at)
--   check (overdue_seconds is null or overdue_seconds >= 0)
update task_overdue_events e
set resolved_at = greatest(now(), e.overdue_at),
    overdue_seconds = greatest(
      0,
      round(extract(epoch from (greatest(now(), e.overdue_at) - e.overdue_at)))::integer
    ),
    reason = coalesce(
      e.reason,
      'Tự động đóng 2026-08-16: task không còn cờ overdue_flagged_at, '
      || 'sự kiện mở này chặn mark_task_overdue_atomic.'
    )
from tasks t
where t.id = e.task_id
  and e.resolved_at is null
  and t.overdue_flagged_at is null;

-- ── CHIỀU 2: task đã rời in_progress → đóng sự kiện ────────────────────
-- Kỳ quá hạn kết thúc khi task thôi chạy. Mốc đóng lấy theo closed_at nếu
-- có, để thời lượng phản ánh đúng lúc việc thật sự dừng.
update task_overdue_events e
set resolved_at = greatest(coalesce(t.closed_at, now()), e.overdue_at),
    overdue_seconds = greatest(
      0,
      round(extract(epoch from (
        greatest(coalesce(t.closed_at, now()), e.overdue_at) - e.overdue_at
      )))::integer
    ),
    reason = coalesce(
      e.reason,
      'Tự động đóng 2026-08-16: task không còn ở trạng thái in_progress.'
    )
from tasks t
where t.id = e.task_id
  and e.resolved_at is null
  and (t.status <> 'in_progress' or t.archived_at is not null);

-- ── CHIỀU 3: task in_progress + mang cờ nhưng thiếu sự kiện → tạo ──────
-- Không có sự kiện thì thời lượng quá hạn của những task này biến mất khỏi
-- mọi báo cáo, dù trên bảng chúng vẫn hiện là đang trễ.
insert into task_overdue_events (
  task_id, stage_cycle_id, due_at, overdue_at, sla_minutes
)
select
  t.id,
  (
    select c.id from task_stage_cycles c
    where c.task_id = t.id and c.stage = 'in_progress' and c.ended_at is null
    order by c.started_at desc limit 1
  ),
  t.overdue_flagged_at,
  t.overdue_flagged_at,
  t.sla_minutes
from tasks t
where t.archived_at is null
  and t.status = 'in_progress'
  and t.overdue_flagged_at is not null
  and not exists (
    select 1 from task_overdue_events e
    where e.task_id = t.id and e.resolved_at is null
  )
on conflict (task_id) where resolved_at is null do nothing;

-- ── PHẦN 2: làm RPC miễn nhiễm ─────────────────────────────────────────
-- Hàm này tự nhận là idempotent (xem tên commit gốc) nhưng chỉ idempotent ở
-- bước UPDATE. Nếu dữ liệu lệch như trên thì INSERT vẫn nổ. Thêm ON CONFLICT
-- bám đúng index bộ phận để nó thật sự idempotent: đã có sự kiện mở rồi thì
-- không tạo thêm, thay vì làm sập cả lượt quét.
create or replace function mark_task_overdue_atomic(
  p_task_id uuid,
  p_due_at timestamptz,
  p_sla_minutes integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_updated integer;
begin
  update tasks
  set overdue_flagged_at = v_now,
      overdue_reminded_at = v_now,
      overdue_count = coalesce(overdue_count, 0) + 1
  where id = p_task_id
    and status = 'in_progress'
    and overdue_flagged_at is null;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return false;
  end if;

  insert into task_overdue_events (
    task_id, stage_cycle_id, due_at, overdue_at, sla_minutes
  ) values (
    p_task_id,
    (
      select c.id
      from task_stage_cycles c
      where c.task_id = p_task_id
        and c.stage = 'in_progress'
        and c.ended_at is null
      order by c.started_at desc
      limit 1
    ),
    p_due_at,
    v_now,
    p_sla_minutes
  )
  -- Bám đúng task_overdue_events_open_idx (unique trên task_id khi
  -- resolved_at is null). Còn sự kiện mở thì giữ nguyên sự kiện đó — lượt
  -- quét vẫn chạy tiếp thay vì ném lỗi và giết cả cron.
  on conflict (task_id) where resolved_at is null do nothing;

  insert into task_activity (task_id, actor_email, type, meta)
  values (
    p_task_id,
    'system',
    'went_overdue',
    jsonb_build_object('due_at', p_due_at, 'flagged_at', v_now)
  );
  return true;
end;
$$;

revoke all on function mark_task_overdue_atomic(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function mark_task_overdue_atomic(uuid, timestamptz, integer)
  to service_role;

commit;

-- ── Kiểm tra sau khi chạy (chạy riêng, chỉ đọc) ────────────────────────
-- Phải trả về 0 dòng:
--   select count(*) from task_overdue_events e
--   join tasks t on t.id = e.task_id
--   where e.resolved_at is null and t.overdue_flagged_at is null;
