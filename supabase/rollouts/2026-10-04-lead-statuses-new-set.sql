-- =====================================================================
-- Lead: bộ status mới (2026-10-04)
--
-- Thứ tự hiện trên màn hình (user chốt; "New" giữ làm mặc định cho lead mới
-- tạo / mới import — lib/leads/queries.ts lấy status `open` có position nhỏ
-- nhất):
--
--   New                      open       (giữ nguyên)
--   Need to call back        scheduled  (đổi tên từ "Call back")
--   Can't contact            lost       (đổi tên từ "Wrong number")
--   Called but no response   open       (đổi tên từ "No answer")
--   Do not contact           lost       (đổi tên từ "Not interested")
--   Quoted                   open       (đổi tên từ "Working")
--   Closed/Purchased         won        (đổi tên từ "Won")
--
-- Kind quyết định hành vi, nhãn thì không:
--   open       còn đang làm — có cảnh báo (chưa gọi, để lâu, quá số lần gọi)
--   scheduled  hẹn gọi lại — BẮT BUỘC có ngày follow-up
--   won/lost   đã đóng — hết cảnh báo
-- Muốn đổi kind (vd. "Can't contact" vẫn tiếp tục gọi → open) thì sửa ở
-- Table Configuration → Dropdown values → Lead Status, không cần SQL.
--
-- ĐỔI TÊN thay vì tạo mới: giữ nguyên id nên lead đang mang status cũ chuyển
-- sang nhãn mới tương ứng, màu admin đã chọn cũng giữ. Status nào không thuộc
-- bộ mới thì ARCHIVE (không xoá: lead cũ còn trỏ tới nó).
--
-- Idempotent: chạy lần hai tìm thấy đúng nhãn mới và không đổi gì thêm.
-- =====================================================================

begin;

do $$
declare
  target record;
  found_id uuid;
begin
  for target in
    select * from (values
      ('New',                    array['new'],                                  'open',      10),
      ('Need to call back',      array['need to call back', 'call back'],       'scheduled', 20),
      ('Can''t contact',         array['can''t contact', 'wrong number'],       'lost',      30),
      ('Called but no response', array['called but no response', 'no answer'],  'open',      40),
      ('Do not contact',         array['do not contact', 'not interested'],     'lost',      50),
      ('Quoted',                 array['quoted', 'working'],                    'open',      60),
      ('Closed/Purchased',       array['closed/purchased', 'won'],              'won',       70)
    ) as t(label, candidates, kind, position)
  loop
    -- Ưu tiên dòng đã mang nhãn mới (lần chạy thứ hai), rồi tới nhãn cũ.
    select s.id into found_id
    from public.lead_statuses s
    where s.archived_at is null
      and lower(btrim(s.label)) = any (target.candidates)
    order by array_position(target.candidates, lower(btrim(s.label))), s.position
    limit 1;

    if found_id is not null then
      update public.lead_statuses
      set label = target.label,
          kind = target.kind,
          position = target.position,
          updated_at = now()
      where id = found_id;
    else
      insert into public.lead_statuses (label, kind, position)
      values (target.label, target.kind, target.position);
    end if;
  end loop;
end $$;

-- Status không thuộc bộ mới: archive (ẩn khỏi lựa chọn, lead cũ vẫn đọc được).
update public.lead_statuses
set archived_at = now(),
    updated_at = now()
where archived_at is null
  and label not in ('New', 'Need to call back', 'Called but no response',
                    'Can''t contact', 'Quoted', 'Do not contact', 'Closed/Purchased');

commit;

-- Kiểm tra: đúng 7 dòng, đúng thứ tự, đúng kind; cột cuối = số lead đang mang.
select s.position, s.label, s.kind,
       (select count(*) from public.leads l
        where l.status_id = s.id and l.archived_at is null) as so_lead
from public.lead_statuses s
where s.archived_at is null
order by s.position;
