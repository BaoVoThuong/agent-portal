-- ═══════════════════════════════════════════════════════════════════════
-- 18 — TẠO HÌNH LẠI DỮ LIỆU MẪU ĐỂ TEST ĐƯỢC MỌI BỘ LỌC
--
-- Vấn đề: dữ liệu mẫu hiện phẳng tuyệt đối nên mọi biểu đồ/bộ lọc vô dụng.
--   • 10 stage ACA mỗi stage đúng 10%  → phễu không có hình dạng
--   • 100% record tạo trong tháng 7    → lọc theo ngày = all-or-nothing
--   • 99.8% tuổi stage rơi vào 1 nhóm  → thanh trượt "stuck ≥ N ngày" vô nghĩa
--   • 32 người phụ trách mỗi người 20  → xếp hạng queue vô nghĩa
--   • task: 5 trạng thái mỗi cái 20%   → board thật luôn nặng todo
--   • Medicare chỉ dùng 3/11 stage
--
-- CHỈ đụng dòng có '[Sample QA]'. Dữ liệu thật (27 enrollment, 111 task)
-- không bị chạm — mọi câu lệnh đều lọc theo tên.
--
-- IDEMPOTENT: mọi lựa chọn bắt nguồn từ hashtext(id), không dùng random().
-- Chạy lại bao nhiêu lần cũng ra đúng một kết quả.
--
-- ───────────────────────────────────────────────────────────────────────
-- RÀNG BUỘC ĐÃ TÍNH TỚI
--
-- 1. enrollment_records_medicare_fields_check — record Medicare BẮT BUỘC để
--    trống caller_email, pcp_2026, platform_id, consent_id, payment_status_id,
--    aca_status_id. Mọi cột này đều bọc case ... when program='aca'.
--    (Medicare cũng chỉ có bộ carrier, không có platform/consent/payment/aca_status.)
--
-- 2. enrollment_records_stage_entry_required_check — (stage_id is null) =
--    (stage_entered_at is null). File này luôn gán cả hai.
--
-- 3. Cycle: check (ended_at >= started_at) và (ended_at, duration) phải cùng
--    null hoặc cùng có giá trị. Record đã đóng được dựng theo thứ tự
--        created_at < stage_entered_at < closed_at ≤ now()
--    nên không bao giờ vỡ. Chặng dwell trước đó nằm gọn trong ô 15 ngày với
--    độ dài tối đa 14 → không chồng lấn, luôn kết thúc trước stage hiện tại.
--
-- 4. Invariant của file 14: record active có stage ⇒ đúng 1 cycle MỞ;
--    record đã đóng ⇒ 0 cycle mở. Chỉ tạo kind='dwell' nên luật
--    entry_marker không đụng tới.
--
-- 5. tasks: backlog ⇒ assignee_email null; khác backlog ⇒ BẮT BUỘC not null.
--    category_id chỉ trỏ vào category đang active (có trigger chặn).
--
-- Chạy sau file 17. Xem phân bố mới bằng file 19.
-- ═══════════════════════════════════════════════════════════════════════

do $reshape$
declare
  n_rec integer; n_cur integer; n_prev integer; n_task integer;
  n_people integer; n_cats integer;
begin

-- ══ Bảng tra cứu dùng chung ═════════════════════════════════════════════

-- Người dùng đang hoạt động, đánh số ổn định để bốc theo phân bố lệch.
create temporary table _person (idx integer, email text) on commit drop;
insert into _person (idx, email)
select row_number() over (order by email) - 1, email
from (select distinct lower(btrim(email)) as email
      from portal_account
      where is_active and email is not null and btrim(email) <> '') p;
select count(*) into n_people from _person;

create temporary table _cat (idx integer, id uuid) on commit drop;
insert into _cat (idx, id)
select row_number() over (order by name) - 1, id from task_categories where is_active;
select count(*) into n_cats from _cat;

-- Mọi option đang active, đánh số theo (program, key) để bốc ngẫu nhiên.
create temporary table _opt (program text, key text, idx integer, id uuid, n integer) on commit drop;
insert into _opt (program, key, idx, id, n)
select s.program, s.key,
       row_number() over (partition by s.program, s.key order by o.position, o.label) - 1,
       o.id,
       count(*) over (partition by s.program, s.key)
from enrollment_option_sets s
join enrollment_options o on o.set_id = s.id and o.archived_at is null;

-- Tên bác sĩ cho PCP.
create temporary table _pcp (idx integer, name text) on commit drop;
insert into _pcp (idx, name) values
  (0,'Dr. Pham'),(1,'Dr. Park'),(2,'Dr. Nguyen'),(3,'Dr. Tran'),(4,'Dr. Le'),
  (5,'Dr. Vo'),(6,'Dr. Garcia'),(7,'Dr. Patel'),(8,'Dr. Kim'),(9,'Dr. Chen');

-- ══ PHẦN 1 — ENROLLMENT ════════════════════════════════════════════════

create temporary table _stage_weight (
  program text, bucket text, label text, lo integer, hi integer
) on commit drop;
insert into _stage_weight values
  -- ACA đang mở: phễu thóp dần
  ('aca','open','1-Need quote',                 0, 190),
  ('aca','open','2-Quoted',                   190, 345),
  ('aca','open','3-Waiting for Confirmation',  345, 470),
  ('aca','open','4-Need documents',            470, 580),
  ('aca','open','5-Ready to Enroll',           580, 675),
  ('aca','open','6-Enrolled',                  675, 760),
  ('aca','open','7-1st payment done',          760, 832),
  ('aca','open','8-Need assign PCP',           832, 895),
  ('aca','open','9-Need ID card',              895, 955),
  -- Hồ sơ kẹt ID card vẫn ĐANG MỞ trong lúc chờ xử lý — stage tuy là kết thúc
  -- về mặt quy trình nhưng record chưa đóng. Không cho nhánh mở thì card
  -- "ID card unavailable" chỉ đếm được 2-3 hồ sơ và nhìn như hỏng.
  ('aca','open','11-ID card unavailable',      955,1000),
  ('aca','closed','10-ID card done',             0, 700),
  ('aca','closed','12-Terminated',             700, 900),
  ('aca','closed','11-ID card unavailable',    900,1000),
  -- Medicare: 10-ID card unavailable KHÔNG phải stage kết thúc nên nằm nhánh mở
  ('medicare','open','1-Need quote',                 0, 220),
  ('medicare','open','2-Quoted',                   220, 390),
  ('medicare','open','3-Waiting for Confirmation',  390, 525),
  ('medicare','open','4-Need documents',           525, 640),
  ('medicare','open','5-Ready to Enroll',          640, 740),
  ('medicare','open','6-Enrolled-1stpayment done', 740, 830),
  ('medicare','open','7-Need assign PCP',          830, 905),
  ('medicare','open','8-Need ID card',             905, 965),
  ('medicare','open','10-ID card unavailable',     965,1000),
  ('medicare','closed','9-ID card done',             0, 780),
  ('medicare','closed','11-Terminated',            780,1000);

create temporary table _rec_plan on commit drop as
with base as (
  select r.id, r.program, (r.closed_at is not null) as is_closed,
    (abs(hashtext(r.id::text||'stage'))  % 1000) as b_stage,
    (abs(hashtext(r.id::text||'age'))    % 1000) as b_age,
    (abs(hashtext(r.id::text||'spread')) % 1000) as b_spread,
    (abs(hashtext(r.id::text||'person')) % 1000) as b_person,
    (abs(hashtext(r.id::text||'close'))  % 1000) as b_close,
    (abs(hashtext(r.id::text||'agent'))  % 1000) as b_agent,
    (abs(hashtext(r.id::text||'caller')) % 1000) as b_caller,
    (abs(hashtext(r.id::text||'carrier'))% 1000) as b_carrier,
    (abs(hashtext(r.id::text||'plat'))   % 1000) as b_plat,
    (abs(hashtext(r.id::text||'consent'))% 1000) as b_consent,
    (abs(hashtext(r.id::text||'pay'))    % 1000) as b_pay,
    (abs(hashtext(r.id::text||'acast'))  % 1000) as b_acast,
    (abs(hashtext(r.id::text||'due'))    % 1000) as b_due,
    (abs(hashtext(r.id::text||'pcp'))    % 1000) as b_pcp,
    (abs(hashtext(r.id::text||'qc'))     % 1000) as b_qc,
    (abs(hashtext(r.id::text||'desc'))   % 1000) as b_desc,
    (abs(hashtext(r.id::text||'touch'))  % 1000) as b_touch
  from enrollment_records r
  where r.client_name like '%Sample QA%'
),
staged as (
  select b.*, w.label as stage_label,
    case
      when b.b_age < 400 then      (b.b_age % 4)    --  0-3   ngày : 40%
      when b.b_age < 650 then  4 + (b.b_age % 7)    --  4-10  ngày : 25%
      when b.b_age < 800 then 11 + (b.b_age % 10)   -- 11-20  ngày : 15%
      when b.b_age < 900 then 21 + (b.b_age % 25)   -- 21-45  ngày : 10%
      when b.b_age < 970 then 46 + (b.b_age % 45)   -- 46-90  ngày :  7%
      else                    91 + (b.b_age % 90)   -- 91-180 ngày :  3%
    end as age_days,
    1 + (b.b_close % 120) as closed_days_ago,
    1 + (b.b_age   %  45) as dwell_before_close
  from base b
  join _stage_weight w on w.program = b.program
   and w.bucket = case when b.is_closed then 'closed' else 'open' end
   and b.b_stage >= w.lo and b.b_stage < w.hi
),
timed as (
  select s.*,
    case when s.is_closed then now() - make_interval(days => s.closed_days_ago) end as new_closed_at,
    case when s.is_closed
         then now() - make_interval(days => s.closed_days_ago + s.dwell_before_close)
         else now() - make_interval(days => s.age_days) end as new_stage_entered_at
  from staged s
),
-- Gắn stage đã chọn để lấy RANK (position/10). Mọi cột nghiệp vụ bên dưới đều
-- suy ra từ rank này, chứ không bốc độc lập — đó là khác biệt giữa dữ liệu
-- giả và dữ liệu thật. Hồ sơ mới "1-Need quote" không thể đã có carrier,
-- platform và đã thanh toán xong.
resolved as (
  select t.*,
    o.id as stage_id,
    (o.position / 10) as stage_rank,
    t.new_stage_entered_at - make_interval(days => 5 + (t.b_spread % 90)) as new_created_at
  from timed t
  join enrollment_option_sets es on es.program = t.program and es.key = 'stage'
  join enrollment_options o on o.set_id = es.id and o.archived_at is null
   and lower(o.label) = lower(t.stage_label)
)
select
  t.id, t.program, t.is_closed, t.b_qc, t.b_agent, t.stage_rank,
  t.stage_id,
  -- Hoạt động gần nhất phải ĐỘC LẬP với lúc vào stage. Nếu cho bằng nhau thì
  -- "No activity ≥Nd" và "Stuck in stage ≥Nd" đo đúng cùng một mốc và luôn ra
  -- hai số gần bằng nhau (214 vs 212) — vô nghĩa để đánh giá.
  -- 25% thật sự im lặng (chạm lần cuối đúng lúc vào stage), 75% còn lại được
  -- chạm ở một thời điểm nào đó giữa lúc vào stage và bây giờ.
  case
    when t.is_closed then t.new_closed_at
    when t.b_touch < 250 then t.new_stage_entered_at
    else least(now(), t.new_stage_entered_at
         + make_interval(days => ((t.b_touch % 100) * t.age_days) / 100))
  end as last_work_at,
  t.new_closed_at   as closed_at,
  t.new_stage_entered_at as stage_entered_at,
  t.new_created_at  as created_at,
  -- 10% để trống → hàng chờ giao việc có việc. power(r,2.4) dồn về đầu danh
  -- sách nên vài người ôm nhiều, số đông ôm ít.
  case when t.b_person < 100 then null else
    (select p.email from _person p
     where p.idx = least(n_people-1, floor(power((t.b_person-100)/900.0, 2.4)*n_people)::integer)) end
    as responsible_email,
  (select p.email from _person p
   where p.idx = least(n_people-1, floor(power(t.b_agent/1000.0, 1.7)*n_people)::integer))
    as agent_email,
  -- Có người gọi tư vấn từ lúc báo giá trở đi. (Medicare buộc để trống.)
  case when t.program = 'aca' and t.stage_rank >= 2 and t.b_caller >= 150 then
    (select p.email from _person p
     where p.idx = least(n_people-1, floor(power(t.b_caller/1000.0, 1.5)*n_people)::integer)) end
    as caller_email,
  -- Chọn hãng bảo hiểm từ bước Quoted trở đi. Trước đó chưa báo giá thì chưa
  -- thể có carrier.
  case when t.stage_rank >= 2 then
    (select o2.id from _opt o2 where o2.program = t.program and o2.key = 'carrier'
      and o2.idx = least(o2.n-1, floor(power(t.b_carrier/1000.0, 1.6)*o2.n)::integer)) end as carrier_id,
  -- Nền tảng ghi danh chỉ có nghĩa khi đã chuẩn bị hồ sơ (rank ≥ 4).
  case when t.program = 'aca' and t.stage_rank >= 4 then
    (select o2.id from _opt o2 where o2.program='aca' and o2.key='platform'
      and o2.idx = least(o2.n-1, (t.b_plat % o2.n))) end as platform_id,
  -- Consent: idx 0 = 'Yes', idx 1 = 'Not Yet'. Chưa nộp hồ sơ thì còn 'Not Yet'.
  case when t.program = 'aca' and t.stage_rank >= 2 then
    (select o2.id from _opt o2 where o2.program='aca' and o2.key='consent'
      and o2.idx = case when t.stage_rank >= 4 then 0 else 1 end) end as consent_id,
  -- Thanh toán: idx 0-2 là đã chốt (Auto pay / $0 / Selfpay), idx 3-4 là còn
  -- phải xử lý (Need make manually / Need auto pay). Chỉ hồ sơ đã qua bước
  -- "7-1st payment done" mới được ở nhóm đã chốt.
  case when t.program = 'aca' and t.stage_rank >= 5 then
    (select o2.id from _opt o2 where o2.program='aca' and o2.key='payment_status'
      and o2.idx = case when t.stage_rank >= 7 then (t.b_pay % 3) else 3 + (t.b_pay % 2) end) end
    as payment_status_id,
  -- Tài khoản ACA tiến dần: cần tạo → chờ xác minh → thiếu thông tin → xong.
  case when t.program = 'aca' then
    (select o2.id from _opt o2 where o2.program='aca' and o2.key='aca_status'
      and o2.idx = case
        when t.stage_rank <= 2 then 0
        when t.stage_rank = 3  then 1
        when t.stage_rank = 4  then 1 + (t.b_acast % 2)
        else 3 end) end as aca_status_id,
  -- Hạn suy ra TỪ ngày lập hồ sơ (30-70 ngày), không bốc ngẫu nhiên. Nhờ vậy
  -- hồ sơ càng để lâu càng quá hạn — quá hạn tương quan với tồn đọng, đúng
  -- như ngoài đời, thay vì rải đều vô nghĩa.
  (t.new_created_at + make_interval(days => 30 + (t.b_due % 40)))::date as due_date,
  -- Rank 8 chính là "8-Need assign PCP" → chưa thể có PCP. Từ rank 9 mới có.
  case when t.stage_rank >= 9 then
    (select name from _pcp where idx = t.b_pcp % 10) end as pcp_2025,
  case when t.program = 'aca' and t.stage_rank >= 9 then
    (select name from _pcp where idx = (t.b_pcp / 7) % 10) end as pcp_2026,
  case when t.b_desc < 400
       then 'Client follow-up note — batch ' || (t.b_desc % 7)::text end as description
from resolved t;

-- Chốt an toàn: _rec_plan join theo NHÃN stage. Nếu bảng trọng số ở trên ghi
-- sai một nhãn (hoặc catalog đổi), join sẽ âm thầm bỏ rơi record và chỉ một
-- phần dữ liệu được tạo hình lại — im lặng nhưng sai. Dừng ngay thay vì thế.
if (select count(*) from _rec_plan)
   <> (select count(*) from enrollment_records where client_name like '%Sample QA%') then
  raise exception 'Kế hoạch chỉ phủ % / % record mẫu — nhãn stage trong _stage_weight không khớp catalog',
    (select count(*) from _rec_plan),
    (select count(*) from enrollment_records where client_name like '%Sample QA%');
end if;

update enrollment_records r
set stage_id                 = p.stage_id,
    stage_entered_at         = p.stage_entered_at,
    stage_entered_source     = 'history_backfill',
    created_at               = p.created_at,
    closed_at                = p.closed_at,
    responsible_enroll_email = p.responsible_email,
    responsible_assigned_at  = case when p.responsible_email is null then null else p.created_at end,
    agent_email              = p.agent_email,
    caller_email             = p.caller_email,
    carrier_id               = p.carrier_id,
    platform_id              = p.platform_id,
    consent_id               = p.consent_id,
    payment_status_id        = p.payment_status_id,
    aca_status_id            = p.aca_status_id,
    due_date                 = p.due_date,
    pcp_2025                 = p.pcp_2025,
    pcp_2026                 = p.pcp_2026,
    description              = p.description,
    -- QC chỉ có nghĩa với hồ sơ đã đóng; ~65% trong số đó đã được kiểm.
    qc_checked_at      = case when p.is_closed and p.b_qc < 650
                              then least(now(), p.closed_at + make_interval(hours => 2 + (p.b_qc % 40))) end,
    qc_checked_by_email= case when p.is_closed and p.b_qc < 650
                              then (select e.email from _person e
                                    where e.idx = least(n_people-1, p.b_qc % n_people)) end,
    -- Trigger enrollment_records_overview_timestamps (schema.sql:4467-4476)
    -- chạy BEFORE UPDATE và can thiệp hai chỗ:
    --   • responsible_enroll_email đổi ⇒ responsible_assigned_at := new.updated_at
    --   • updated_at đổi VÀ updated_by_email <> 'system'
    --       ⇒ last_work_activity_at := new.updated_at
    -- Nên đặt updated_by_email = 'system' để nhánh thứ hai KHÔNG chạy — nếu để
    -- nó chạy thì last_work_activity_at bị kéo về bằng updated_at và lại trùng
    -- với stage_entered_at, đúng cái lỗi làm "No activity" ≈ "Stuck in stage".
    -- updated_at = created_at để nhánh thứ nhất ghi responsible_assigned_at
    -- đúng nghĩa "được giao lúc lập hồ sơ".
    updated_by_email       = 'system',
    updated_at             = p.created_at,
    last_activity_at       = p.last_work_at,
    last_work_activity_at  = p.last_work_at,
    last_activity_by_email = p.agent_email
from _rec_plan p
where p.id = r.id;
get diagnostics n_rec = row_count;

-- Dựng lại cycle: cycle cũ đang trỏ vào stage mà record không còn ở đó.
delete from enrollment_stage_cycles c using _rec_plan p where c.record_id = p.id;

-- Cycle của stage HIỆN TẠI. Mở → ended_at/duration null. Đóng → cả hai có giá trị.
insert into enrollment_stage_cycles (
  record_id, stage_id, agent_email, program, kind,
  started_at, ended_at, duration_seconds, started_by_email, source)
select p.id, p.stage_id, p.agent_email, p.program, 'dwell',
  p.stage_entered_at, p.closed_at,
  case when p.closed_at is null then null
       else greatest(0, round(extract(epoch from (p.closed_at - p.stage_entered_at)))::integer) end,
  enrollment_norm_email(p.agent_email), 'backfill'
from _rec_plan p;
get diagnostics n_cur = row_count;

-- Vài chặng dwell TRƯỚC ĐÓ để biểu đồ "thời gian mỗi stage" có dữ liệu.
-- Chặng k chiếm ô 15 ngày bắt đầu tại stage_entered_at - 15k, dài tối đa 14
-- → không chồng lấn nhau, luôn kết thúc trước stage hiện tại.
--
-- BA ĐIỀU KIỆN BẮT BUỘC để dashboard đọc được (aca-overview-data.ts:76 và :92):
--   • source = 'live'  — truy vấn lọc đúng giá trị này. Cycle 'backfill' bị
--     loại hoàn toàn, đó là lý do "Slowest stage" báo Not enough samples.
--   • ended_at nằm trong 90 ngày gần nhất — cutoff của cả hai truy vấn.
--   • responsible_start_email = responsible_end_email và khác null — dòng nào
--     lệch hai cột này bị bỏ qua ở data.ts:100, per-person timing sẽ trống.
insert into enrollment_stage_cycles (
  record_id, stage_id, agent_email, program, kind,
  started_at, ended_at, duration_seconds, started_by_email, source,
  responsible_start_email, responsible_end_email)
select p.id, prev.id, p.agent_email, p.program, 'dwell',
  p.stage_entered_at - make_interval(days => 15 * prev.back_idx),
  p.stage_entered_at - make_interval(days => 15 * prev.back_idx - prev.dur_days),
  prev.dur_days * 86400,
  enrollment_norm_email(p.agent_email), 'live',
  enrollment_norm_email(p.responsible_email),
  enrollment_norm_email(p.responsible_email)
from _rec_plan p
join enrollment_options cur on cur.id = p.stage_id
join enrollment_option_sets es on es.program = p.program and es.key = 'stage'
join lateral (
  select o.id,
         -- Ép về int ngay tại đây. row_number() trả bigint, mà make_interval
         -- chỉ nhận int — không cast thì cả ba chỗ dùng back_idx bên dưới đều
         -- lỗi 42883 "function make_interval(days => bigint) does not exist".
         (row_number() over (order by o.position desc))::int as back_idx,
         1 + (abs(hashtext(p.id::text || o.id::text)) % 14) as dur_days
  from enrollment_options o
  where o.set_id = es.id and o.archived_at is null and o.position < cur.position
) prev on prev.back_idx <= 3
where p.stage_entered_at - make_interval(days => 15 * prev.back_idx) > p.created_at
  -- Chỉ tạo chặng kết thúc trong 90 ngày gần nhất, đúng cửa sổ mà dashboard
  -- đọc. Hồ sơ quá cũ không sinh chặng nào — cũng là hành vi đúng.
  and p.stage_entered_at - make_interval(days => 15 * prev.back_idx - prev.dur_days)
      >= now() - interval '85 days';
get diagnostics n_prev = row_count;

-- ══ PHẦN 2 — TASK ══════════════════════════════════════════════════════

create temporary table _task_plan on commit drop as
with base as (
  select t.id,
    (abs(hashtext(t.id::text||'status')) % 1000) as b_status,
    (abs(hashtext(t.id::text||'prio'))   % 1000) as b_prio,
    (abs(hashtext(t.id::text||'cat'))    % 1000) as b_cat,
    (abs(hashtext(t.id::text||'who'))    % 1000) as b_who,
    (abs(hashtext(t.id::text||'agent'))  % 1000) as b_agent,
    (abs(hashtext(t.id::text||'when'))   % 1000) as b_when,
    (abs(hashtext(t.id::text||'qc'))     % 1000) as b_qc,
    (abs(hashtext(t.id::text||'late'))   % 1000) as b_late,
    (abs(hashtext(t.id::text||'secs'))   % 1000) as b_secs,
    (abs(hashtext(t.id::text||'fub'))    % 1000) as b_fub
  from tasks t where t.title like '%Sample QA%'
)
shaped as (
  select b.*,
    -- Board thật nặng đầu: nhiều việc chờ, ít việc đã xong.
    case
      when b.b_status < 120 then 'backlog'      -- 12%
      when b.b_status < 430 then 'todo'         -- 31%
      when b.b_status < 640 then 'in_progress'  -- 21%
      when b.b_status < 780 then 'waiting'      -- 14%
      when b.b_status < 950 then 'done'         -- 17%
      else                       'cancel'       --  5%
    end as status,
    case
      when b.b_prio < 300 then 'low'
      when b.b_prio < 720 then 'medium'
      when b.b_prio < 920 then 'high'
      else                     'urgent'
    end as priority,
    now() - make_interval(days => (b.b_when % 150)) as created_at
  from base b
)
select s.*,
  case s.priority when 'urgent' then 60 when 'high' then 240
                  when 'medium' then 480 else 1440 end as sla_min,
  -- Tỉ lệ thời gian đã làm so với SLA. power() dồn về giá trị nhỏ nên phần lớn
  -- việc xong trong hạn, khoảng 30% vượt. Trễ hạn là HỆ QUẢ của việc làm lâu
  -- hơn SLA — không phải một cờ bật ngẫu nhiên rồi gán số giờ không liên quan.
  (0.10 + 2.0 * power(s.b_secs / 1000.0, 1.8)) as sla_factor
from shaped s;

update tasks t
set status     = p.status,
    priority   = p.priority,
    created_at = p.created_at,
    -- backlog ⇒ KHÔNG người nhận; khác backlog ⇒ BẮT BUỘC có. Nhánh này phải
    -- bám đúng status vừa chọn ở trên, nếu không sẽ vỡ check constraint.
    assignee_email = case when p.status = 'backlog' then null else
      (select e.email from _person e
       where e.idx = least(n_people-1, floor(power(p.b_who/1000.0, 2.0)*n_people)::integer)) end,
    agent_email = (select e.email from _person e
       where e.idx = least(n_people-1, floor(power(p.b_agent/1000.0, 1.6)*n_people)::integer)),
    -- Dồn về vài nhóm dẫn đầu thay vì chia đều 10% cho 10 nhóm.
    category_id = (select c.id from _cat c
       where c.idx = least(n_cats-1, floor(power(p.b_cat/1000.0, 1.8)*n_cats)::integer)),
    sla_minutes = p.sla_min,
    fub_link = case when p.b_fub < 550
      then 'https://sample.qa/fub/' || substr(md5(p.id::text), 1, 10) end,
    closed_at = case when p.status in ('done','cancel')
      then least(now(), p.created_at + make_interval(days => 1 + (p.b_who % 12))) end,
    in_progress_at = case when p.status = 'in_progress'
      then least(now(), p.created_at + make_interval(hours => 2 + (p.b_who % 40))) end,
    todo_started_at = case when p.status = 'todo'
      then least(now(), p.created_at + make_interval(hours => 1 + (p.b_secs % 20))) end,
    waiting_started_at = case when p.status = 'waiting'
      then least(now(), p.created_at + make_interval(hours => 4 + (p.b_secs % 60))) end,
    -- Đã từng chạy thì mới có giây tích luỹ. Việc còn ở backlog/todo thì chưa.
    todo_seconds = case when p.status in ('backlog','todo') then 0
                        else 600 + (p.b_secs % 40000) end,
    -- Thời gian làm thật = SLA × tỉ lệ ở trên. Nhờ vậy in_progress_seconds,
    -- sla_minutes và cờ trễ hạn luôn kể cùng một câu chuyện.
    in_progress_seconds = case when p.status in ('backlog','todo') then 0
                        else greatest(60, round(p.sla_min * 60 * p.sla_factor)::integer) end,
    waiting_seconds = case when p.status in ('waiting','done','cancel')
                        then (p.b_secs % 30000) else 0 end,
    -- QC chỉ áp cho việc đã kết thúc; ~45% trong số đó đã kiểm.
    done_reviewed_at = case when p.status in ('done','cancel') and p.b_qc < 450
      then least(now(), p.created_at + make_interval(days => 2 + (p.b_qc % 14))) end,
    done_reviewed_by_email = case when p.status in ('done','cancel') and p.b_qc < 450
      then (select e.email from _person e
            where e.idx = least(n_people-1, p.b_qc % n_people)) end,
    -- Trễ hạn KHI VÀ CHỈ KHI thời gian làm vượt SLA. Mốc đánh dấu đúng bằng
    -- lúc hết hạn, không phải một ngày bất kỳ sau khi tạo.
    overdue_flagged_at = case when p.status not in ('backlog','todo') and p.sla_factor > 1.0
      then least(now(), p.created_at + make_interval(mins => p.sla_min)) end,
    overdue_count = case when p.status not in ('backlog','todo') and p.sla_factor > 1.0
      then 1 + (p.b_late % 3) else 0 end,
    last_activity_at = least(now(), p.created_at + make_interval(days => (p.b_secs % 20)))
from _task_plan p
where p.id = t.id;
get diagnostics n_task = row_count;

-- BẮT BUỘC sau khi ghi lại overdue_flagged_at ở trên.
-- task_overdue_events_open_idx là unique trên (task_id) khi resolved_at is
-- null, và mark_task_overdue_atomic ngầm giả định:
--     overdue_flagged_at is null  ⟺  không còn sự kiện quá hạn nào đang mở
-- Câu update trên đưa overdue_flagged_at về null cho phần lớn task mẫu nhưng
-- KHÔNG đụng task_overdue_events, làm cặp bất biến đó vỡ. Hệ quả thực tế:
-- cron nhắc việc chết mỗi 15 phút vì trùng khoá khi insert sự kiện mới.
-- Đóng các sự kiện mồ côi ngay tại đây để file này tự nhất quán.
-- Chiều 1 + 2: đóng sự kiện của task không còn mang cờ, hoặc đã rời in_progress.
update task_overdue_events e
set resolved_at = greatest(coalesce(t.closed_at, now()), e.overdue_at),
    overdue_seconds = greatest(
      0,
      round(extract(epoch from (
        greatest(coalesce(t.closed_at, now()), e.overdue_at) - e.overdue_at
      )))::integer
    ),
    reason = coalesce(e.reason, 'Đóng bởi bước tạo hình dữ liệu mẫu.')
from tasks t
where t.id = e.task_id
  and e.resolved_at is null
  and t.title like '%Sample QA%'
  and (t.overdue_flagged_at is null or t.status <> 'in_progress' or t.archived_at is not null);

-- Chiều 3: task vừa được gắn cờ trễ hạn thì PHẢI có sự kiện mở tương ứng.
-- Thiếu bước này thì thời lượng quá hạn biến mất khỏi mọi báo cáo, dù trên
-- bảng task vẫn hiện là đang trễ.
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
where t.title like '%Sample QA%'
  and t.archived_at is null
  and t.status = 'in_progress'
  and t.overdue_flagged_at is not null
  and not exists (
    select 1 from task_overdue_events e
    where e.task_id = t.id and e.resolved_at is null
  )
on conflict (task_id) where resolved_at is null do nothing;

raise notice 'record % | cycle hiện tại % | chặng trước % | task %',
  n_rec, n_cur, n_prev, n_task;

end
$reshape$;
