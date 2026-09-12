-- =====================================================================
-- Org chart: ai là manager của ai.
--
-- Một cột tự trỏ trên portal_account. "Manager của tôi là ai" phải trả về ĐÚNG
-- MỘT người — đó là thứ mà thông báo Time Off cần để biết gửi cho ai — nên quan
-- hệ này là cây, và cây thì hợp với khoá ngoại tự trỏ chứ không phải bảng
-- nhiều-nhiều.
--
-- KHÔNG dùng lại `agent_members`: bảng đó trả lời "ai làm task của agent này",
-- một câu hỏi khác hẳn "ai duyệt đơn của tôi". Nhồi hai quan hệ khác nhau vào
-- một bảng là cách chắc chắn để sau này không ai đọc nổi nó nữa.
--
-- ⚠ Chạy TRƯỚC khi deploy code.
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cột quan hệ
--
-- `on delete set null`: manager nghỉ việc thì cấp dưới mất manager, KHÔNG bị
-- xoá theo. Dùng cascade ở đây là xoá nhầm cả một nhánh phòng ban.
-- ---------------------------------------------------------------------
alter table portal_account
  add column if not exists manager_id uuid references portal_account(id) on delete set null;

create index if not exists portal_account_manager_idx
  on portal_account (manager_id);

-- Tự làm manager của chính mình — vòng lặp ngắn nhất, và là cái duy nhất mà
-- CHECK bắt được (nó chỉ nhìn được một dòng).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'portal_account_manager_not_self'
  ) then
    alter table portal_account
      add constraint portal_account_manager_not_self
      check (manager_id is null or manager_id <> id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. ⚠ CHẶN VÒNG LẶP DÀI — phần quan trọng nhất của rollout này
--
-- CHECK ở trên chỉ chặn được A → A. Nó KHÔNG thấy được A → B → A, hay một vòng
-- dài hơn. Mà chỉ cần một vòng tồn tại là mọi truy vấn đệ quy trên cây này
-- (dựng sơ đồ, tìm cấp trên, đếm cấp dưới) chạy vô tận.
--
-- Giao diện có chặn sẵn: kéo thả không cho thả người vào chính nhánh con của
-- họ. Nhưng giao diện không phải ràng buộc — gọi thẳng API là qua mặt được.
-- Trigger này là lớp cuối, và là lớp duy nhất không thể đi vòng.
--
-- Chỉ chạy khi manager_id thực sự đổi, nên mọi UPDATE khác trên bảng không phải
-- trả giá gì.
-- ---------------------------------------------------------------------
create or replace function portal_account_manager_no_cycle()
returns trigger language plpgsql as $$
declare
  walker uuid;
  hops integer := 0;
begin
  if new.manager_id is null then return new; end if;

  -- Đi ngược lên từ manager mới. Nếu gặp lại chính mình thì phép gán này đóng
  -- một vòng.
  walker := new.manager_id;
  while walker is not null loop
    if walker = new.id then
      raise exception 'PORTAL_ACCOUNT_MANAGER_CYCLE'
        using hint = 'Không thể đặt người này làm manager: sẽ tạo thành vòng lặp trong sơ đồ tổ chức.';
    end if;

    -- Chốt chặn cuối: nếu dữ liệu ĐANG có sẵn một vòng từ trước (do lỗi nào đó
    -- lọt qua), vòng while này sẽ không bao giờ dừng. 100 cấp là quá thừa cho
    -- một tổ chức vài chục người, nên chạm tới ngưỡng nghĩa là dữ liệu đã hỏng.
    hops := hops + 1;
    if hops > 100 then
      raise exception 'PORTAL_ACCOUNT_MANAGER_CHAIN_TOO_DEEP'
        using hint = 'Chuỗi manager quá sâu hoặc đã có vòng lặp sẵn trong dữ liệu.';
    end if;

    select manager_id into walker from portal_account where id = walker;
  end loop;

  return new;
end $$;

drop trigger if exists portal_account_manager_no_cycle on portal_account;
create trigger portal_account_manager_no_cycle
  before insert or update of manager_id on portal_account
  for each row
  when (new.manager_id is not null)
  execute function portal_account_manager_no_cycle();

-- ---------------------------------------------------------------------
-- Kiểm chứng
-- ---------------------------------------------------------------------

-- (a) Cột và trigger đã có mặt. Cả hai phải ra 1.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'portal_account'
      and column_name = 'manager_id') as co_cot_manager_id,
  (select count(*) from pg_trigger
    where tgname = 'portal_account_manager_no_cycle') as co_trigger_chan_vong;

-- (b) Thử thật: tự trỏ chính mình PHẢI bị từ chối.
--     Khối này tự huỷ sau khi thử, không để lại dấu vết.
do $$
declare probe uuid;
begin
  select id into probe from portal_account where is_active limit 1;
  if probe is null then raise notice 'Không có tài khoản nào để thử.'; return; end if;
  begin
    update portal_account set manager_id = probe where id = probe;
    raise exception 'HỎNG: database đã nhận một người tự làm manager của chính mình';
  exception when check_violation then
    raise notice 'OK — tự trỏ chính mình đã bị chặn.';
  end;
  rollback;
exception when others then
  if sqlerrm like 'HỎNG:%' then raise; end if;
  raise notice 'OK — tự trỏ chính mình đã bị chặn (%).', sqlerrm;
end $$;

-- (c) Chưa ai có manager ngay sau rollout — đúng như kỳ vọng, org chart bắt đầu
--     từ trang trắng và được dựng bằng thao tác kéo thả.
select count(*) as nguoi_da_co_manager
from portal_account
where manager_id is not null;

-- (d) Không có vòng lặp nào (phải trả về 0 dòng). Chạy lại được bất cứ lúc nào
--     để soát sức khoẻ của cây.
with recursive chain(id, manager_id, depth, root) as (
  select id, manager_id, 0, id from portal_account where manager_id is not null
  union all
  select p.id, p.manager_id, c.depth + 1, c.root
  from chain c
  join portal_account p on p.id = c.manager_id
  where c.depth < 100
)
select distinct root as tai_khoan_nam_trong_vong_lap
from chain
where id = root and depth > 0;
