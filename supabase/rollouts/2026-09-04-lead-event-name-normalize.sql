-- =====================================================================
-- Tên sự kiện: gộp khoảng trắng trong tên về một dấu cách.
--
-- `lead_events_name_unique_idx` key theo `lower(btrim(name))` — `btrim` chỉ cắt
-- hai đầu. "Health Fair" và "Health  Fair" lọt qua thành hai dòng, và báo cáo
-- theo sự kiện tách đôi con số của cùng một sự kiện.
--
-- 1. Trigger chuẩn hoá khi ghi (nguồn sự thật ở DB, không chỉ ở route).
-- 2. Backfill các dòng đang có khoảng trắng thừa. Nếu việc gộp làm hai dòng
--    trùng nhau, chuyển lead của dòng mới hơn về dòng cũ hơn rồi archive dòng
--    mới.
--
-- Idempotent. Chạy lại lần hai là no-op.
-- =====================================================================

create or replace function lead_event_normalize_name()
returns trigger
language plpgsql as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  return new;
end $$;

drop trigger if exists lead_event_normalize_name_trg on lead_events;
create trigger lead_event_normalize_name_trg
  before insert or update of name on lead_events
  for each row execute function lead_event_normalize_name();

do $$
declare
  dup record;
  keep_id uuid;
begin
  -- Gộp trùng do khoảng trắng: giữ dòng tạo trước, chuyển lead + archive dòng sau.
  for dup in
    select lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))) as norm,
           array_agg(id order by created_at) as ids
    from lead_events
    where archived_at is null
    group by 1
    having count(*) > 1
  loop
    keep_id := dup.ids[1];
    update leads set event_id = keep_id
      where event_id = any (dup.ids[2:array_length(dup.ids, 1)]);
    update lead_events set archived_at = now()
      where id = any (dup.ids[2:array_length(dup.ids, 1)]);
  end loop;

  -- Chuẩn hoá phần còn lại (trigger lo các lần ghi sau).
  update lead_events
  set name = btrim(regexp_replace(name, '\s+', ' ', 'g'))
  where name <> btrim(regexp_replace(name, '\s+', ' ', 'g'));
end $$;

-- Kiểm chứng: không còn tên có khoảng trắng thừa, không còn norm-trùng active.
select
  (select count(*) from lead_events
     where name <> btrim(regexp_replace(name, '\s+', ' ', 'g'))) as unnormalized_rows,
  (select count(*) from (
     select 1 from lead_events where archived_at is null
     group by lower(btrim(regexp_replace(name, '\s+', ' ', 'g')))
     having count(*) > 1
   ) d) as active_norm_duplicates;
