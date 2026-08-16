-- ═══════════════════════════════════════════════════════════════════════
-- RESET DỮ LIỆU CUSTOMER SERVICE TRƯỚC KHI GO-LIVE  —  2026-08-17
--
--                    ⛔ XOÁ DỮ LIỆU. CHỈ CHẠY MỘT LẦN. ⛔
--
--        FILE NÀY *KHÔNG* IDEMPOTENT — khác với mọi file trong rollouts/.
--        Xem APPLIED.md. Chạy lần hai sẽ xoá dữ liệu thật sau go-live.
--        Đã cài chốt chặn ở PHẦN 0 để lần hai dừng lại thay vì phá.
--
-- ───────────────────────────────────────────────────────────────────────
-- LÀM TRƯỚC KHI CHẠY
--
--   1. TẮT cron nhắc việc. `.github/workflows/task-reminders.yml` chạy mỗi
--      15 phút và ghi vào tasks, task_notifications, task_overdue_events.
--      Nó nổ giữa chừng sẽ tranh khoá, hoặc chèn dòng mới ngay sau khi xoá
--      làm khối kiểm tra báo ❌ oan.
--      GitHub → Actions → Task reminders cron → ⋯ → Disable workflow
--      Bật lại sau khi xong.
--
--   2. Xác nhận đang ở ĐÚNG database. Câu này phải ra 431:
--        select count(*) from tasks;
--
-- ───────────────────────────────────────────────────────────────────────
-- PHẠM VI: chỉ module Customer Service (task board).
--   • KHÔNG đụng enrollment ACA/Medicare
--   • KHÔNG đụng health_mart / pc_mart
--   • KHÔNG đụng cấu hình, tài khoản, phân quyền
--
-- Toàn bộ 431 task hiện có là dữ liệu QA tạo để test, đã xác nhận bỏ được.
--
-- ───────────────────────────────────────────────────────────────────────
-- XOÁ GÌ — `delete from tasks` kéo theo 9 bảng qua `on delete cascade`,
-- cộng 1 bảng ở tầng hai. Đã đối chiếu từng khoá ngoại trong schema.sql:
--
--   task_notifications    12.382  (:2573)   task_stage_cycles       564  (:1595)
--   task_activity            926  (:2014)   task_assignment_cycles  548  (:2656)
--   task_assignees           431  (:2639)   task_overdue_events     174  (:1678)
--   task_comments             31  (:1945)   task_participants        13  (:2625)
--   task_attachments           1  (:1978)   task_comment_edits        1  (:1967, tầng 2)
--
-- task_assignment_rotation KHÔNG có khoá ngoại tới tasks nên phải xoá tay.
--
-- KHÔNG có khoá ngoại nào tới tasks dùng `on delete set null`, nên không
-- dòng nào ngoài phạm vi bị xoá trắng cột.
--
-- task_categories được tasks (`set null`, :1324) và task_sla_rules
-- (`cascade`, :1735) trỏ TỚI, nên xoá task không thể mất category hay luật SLA.
-- ═══════════════════════════════════════════════════════════════════════

-- ═══ PHẦN 0 — CHỐT CHẶN CHẠY LẦN HAI ══════════════════════════════════
-- `create table if not exists X as select ...` bỏ qua CẢ CÂU LỆNH khi X đã
-- tồn tại — kể cả phần select. Nếu dùng cách đó thì lần chạy thứ hai sẽ giữ
-- bản sao lưu cũ, xoá sạch dữ liệu thật mới phát sinh, và khối kiểm tra vẫn
-- báo ✅ vì nó chỉ khẳng định `tasks = 0` — đúng y kết quả của một lần chạy
-- nhầm. Nên phải dừng ngay từ đầu.
do $$
begin
  if to_regclass('public._bk_20260817_tasks') is not null then
    raise exception
      'ĐÃ CHẠY RỒI. Bảng _bk_20260817_* đang tồn tại. Chạy lại sẽ xoá dữ liệu '
      'thật phát sinh sau go-live. Muốn chạy lại thật thì xoá thủ công các '
      'bảng _bk_20260817_* trước, sau khi đã chắc chắn không cần chúng nữa.';
  end if;
end $$;

begin;

-- ═══ PHẦN 1 — SAO LƯU PHÁP CHỨNG ══════════════════════════════════════
-- Sao lưu ĐỦ 12 bảng bị xoá, không phải 4. Cố ý KHÔNG dùng `if not exists`:
-- bảng đã tồn tại thì để nó báo lỗi, thêm một lớp chặn nữa.
--
-- ĐÂY LÀ ẢNH CHỤP ĐỂ TRA CỨU, KHÔNG PHẢI ĐƯỜNG KHÔI PHỤC.
-- `create table as select` không sao chép ràng buộc, index, default hay khoá
-- ngoại. Đổ ngược _bk_20260817_tasks về sẽ chèn lại display_number 1..431
-- trong khi sequence vừa reset về 1 → đụng ngay tasks_display_number_key
-- (:1571). Muốn khôi phục thật thì phải xử lý sequence trước.
create table _bk_20260817_tasks                    as select * from tasks;
create table _bk_20260817_task_activity            as select * from task_activity;
create table _bk_20260817_task_notifications       as select * from task_notifications;
create table _bk_20260817_task_assignees           as select * from task_assignees;
create table _bk_20260817_task_stage_cycles        as select * from task_stage_cycles;
create table _bk_20260817_task_assignment_cycles   as select * from task_assignment_cycles;
create table _bk_20260817_task_overdue_events      as select * from task_overdue_events;
create table _bk_20260817_task_comments            as select * from task_comments;
create table _bk_20260817_task_comment_edits       as select * from task_comment_edits;
create table _bk_20260817_task_participants        as select * from task_participants;
create table _bk_20260817_task_attachments         as select * from task_attachments;
create table _bk_20260817_task_assignment_rotation as select * from task_assignment_rotation;

-- Bảng mới trong `public` mặc định TẮT row level security, và vòng lặp bật
-- RLS ở schema.sql:5489-5548 là một danh sách cứng — mấy bảng này không bao
-- giờ nằm trong đó. Chúng chứa PII khách hàng (tasks.description,
-- tasks.fub_link, toàn bộ nội dung bình luận), nên phải bật tay.
alter table _bk_20260817_tasks                    enable row level security;
alter table _bk_20260817_task_activity            enable row level security;
alter table _bk_20260817_task_notifications       enable row level security;
alter table _bk_20260817_task_assignees           enable row level security;
alter table _bk_20260817_task_stage_cycles        enable row level security;
alter table _bk_20260817_task_assignment_cycles   enable row level security;
alter table _bk_20260817_task_overdue_events      enable row level security;
alter table _bk_20260817_task_comments            enable row level security;
alter table _bk_20260817_task_comment_edits       enable row level security;
alter table _bk_20260817_task_participants        enable row level security;
alter table _bk_20260817_task_attachments         enable row level security;
alter table _bk_20260817_task_assignment_rotation enable row level security;

-- ═══ PHẦN 2 — XOÁ ═════════════════════════════════════════════════════
delete from tasks;                    -- 9 bảng con tự cascade
delete from task_assignment_rotation; -- không có FK nên phải xoá tay

commit;

-- ═══ PHẦN 3 — ĐÁNH SỐ LẠI TỪ 1 ════════════════════════════════════════
-- CỐ Ý nằm NGOÀI transaction. Postgres không bao giờ rollback setval; nếu
-- để bên trong mà transaction hỏng giữa chừng thì được trạng thái tệ nhất:
-- 431 task còn nguyên NHƯNG sequence phát số 1 → mọi lần tạo task mới đều
-- đụng tasks_display_number_key và không ai tạo được task nào.
-- Đặt sau commit thì chỉ chạy khi việc xoá đã chắc chắn thành công.
--
-- `false` = giá trị TIẾP THEO là 1, không phải 2.
select setval('tasks_display_number_seq', 1, false);

-- ═══ KIỂM TRA — mọi dòng phải ✅ ═══════════════════════════════════════
-- Dùng biểu thức boolean cho từng dòng thay vì so bằng một con số cứng: các
-- mục cấu hình chỉ cần "còn đủ, không bị xoá nhầm", nên phải là `>=`. Ràng
-- buộc bằng số chính xác sẽ báo ❌ oan ngay khi ai đó chạy khối dọn rác tuỳ
-- chọn ở cuối file.
select
  case when ok then '✅' else '❌ SAI' end as "Kết quả",
  name as "Kiểm tra", detail as "Giá trị"
from (
  select 1 as sort, 'tasks đã rỗng' as name,
    (select count(*) from tasks) = 0 as ok,
    (select count(*)::text from tasks) as detail
  union all select 2, 'task_activity đã cascade',
    (select count(*) from task_activity) = 0, (select count(*)::text from task_activity)
  union all select 3, 'task_notifications đã cascade',
    (select count(*) from task_notifications) = 0, (select count(*)::text from task_notifications)
  union all select 4, 'task_assignees đã cascade',
    (select count(*) from task_assignees) = 0, (select count(*)::text from task_assignees)
  union all select 5, 'task_overdue_events đã cascade',
    (select count(*) from task_overdue_events) = 0, (select count(*)::text from task_overdue_events)
  union all select 6, 'task_stage_cycles đã cascade',
    (select count(*) from task_stage_cycles) = 0, (select count(*)::text from task_stage_cycles)
  union all select 7, 'task_comments đã cascade',
    (select count(*) from task_comments) = 0, (select count(*)::text from task_comments)
  union all select 8, 'task_comment_edits đã cascade',
    (select count(*) from task_comment_edits) = 0, (select count(*)::text from task_comment_edits)
  union all select 9, 'task_assignment_cycles đã cascade',
    (select count(*) from task_assignment_cycles) = 0, (select count(*)::text from task_assignment_cycles)
  union all select 10, 'task_participants đã cascade',
    (select count(*) from task_participants) = 0, (select count(*)::text from task_participants)
  union all select 11, 'task_attachments đã cascade',
    (select count(*) from task_attachments) = 0, (select count(*)::text from task_attachments)
  union all select 12, 'task_assignment_rotation đã xoá',
    (select count(*) from task_assignment_rotation) = 0, (select count(*)::text from task_assignment_rotation)
  -- last_value = 1 đúng cho CẢ is_called true lẫn false, nên chỉ đọc
  -- last_value là không đủ: true sẽ cho ra TASK-2, false mới cho TASK-1.
  union all select 13, 'task đầu tiên sẽ là số 1',
    (select last_value = 1 and not is_called from tasks_display_number_seq),
    (select last_value::text || ' / is_called=' || is_called::text from tasks_display_number_seq)
  -- ── Cấu hình phải còn, dùng `>=` để không vướng khối dọn rác ──
  union all select 20, 'GIỮ task_categories (>=4 cái người thật tạo)',
    (select count(*) from task_categories) >= 4, (select count(*)::text from task_categories)
  union all select 21, 'GIỮ task_sla_rules',
    (select count(*) from task_sla_rules) >= 4, (select count(*)::text from task_sla_rules)
  union all select 22, 'GIỮ task_agents',
    (select count(*) from task_agents) >= 16, (select count(*)::text from task_agents)
  union all select 23, 'GIỮ agent_members',
    (select count(*) from agent_members) >= 12, (select count(*)::text from agent_members)
  union all select 24, 'GIỮ table_column (>=12 cột cs đang dùng)',
    (select count(*) from table_column) >= 54, (select count(*)::text from table_column)
  union all select 25, 'GIỮ portal_account',
    (select count(*) from portal_account) = 42, (select count(*)::text from portal_account)
  union all select 26, 'GIỮ task_assignment_queue_members',
    (select count(*) from task_assignment_queue_members) = 36,
    (select count(*)::text from task_assignment_queue_members)
  -- ── Enrollment KHÔNG được đụng tới ──
  union all select 30, 'ENROLLMENT còn nguyên',
    (select count(*) from enrollment_records) = 667, (select count(*)::text from enrollment_records)
) t
order by sort;

-- ═══════════════════════════════════════════════════════════════════════
-- SAU KHI CHẠY
--
--   1. Bật lại workflow "Task reminders cron".
--   2. Tệp đính kèm trong Supabase Storage KHÔNG bị xoá bởi file này.
--      task_attachments có 1 dòng; dòng đã mất, file trong Storage thành mồ
--      côi. Dọn tay nếu cần.
--   3. Xoá 12 bảng _bk_20260817_* khi đã chắc chắn không cần tra cứu nữa.
--      Để lâu là để PII nằm ngoài mọi chính sách RLS thông thường.
--
-- ═══════════════════════════════════════════════════════════════════════
-- ⛔ PHẢI QUYẾT TRƯỚC GO-LIVE — script này KHÔNG tự sửa
--
-- Bốn thứ dưới đây nằm trong CẤU HÌNH nên reset không đụng tới, nhưng để
-- nguyên thì hỏng ngay ngày đầu. Cần người quyết, không phải máy.
--
-- ── 1. SLA urgent đang là 5 PHÚT (mặc định thiết kế: 60) ───────────────
-- Giá trị hiện tại, đối chiếu seed ở schema.sql:1849-1854:
--     urgent    5  (seed  60)   ← QA chỉnh để test cho nhanh
--     high     75  (seed 240)
--     medium  465  (seed 480)
--     low    1440  (seed 1440) ✓
--
-- Hệ quả ngày đầu: task urgent đầu tiên quá hạn sau 5 phút. Cron 15 phút
-- sau đó gọi mark_task_overdue_atomic → cộng vĩnh viễn vào overdue_count
-- (không bao giờ reset) → bắn notification `overdue` cho người nhận và
-- `sla_escalated` cho chủ agent, toàn bộ assistant VÀ MỌI ADMIN.
-- KPI ngày đầu hỏng vì một con số QA để lại.
--
-- Kéo theo: rotation.ts:41 lấy cooldown = effectiveSlaMinutes, nên giao
-- một task urgent chỉ khoá 5 phút thay vì 60 — vòng xoay vừa reset lại lệch.
--
-- update task_sla_rules set duration_minutes = 60,  updated_at = now() where priority='urgent' and category_id is null;
-- update task_sla_rules set duration_minutes = 240, updated_at = now() where priority='high'   and category_id is null;
-- update task_sla_rules set duration_minutes = 480, updated_at = now() where priority='medium' and category_id is null;
--
-- ── 2. Hai tài khoản trùng TÊN HIỂN THỊ trong ô chọn bắt buộc ──────────
-- Giao diện luôn hiện tên, không hiện email (people.ts personLabel). Nên:
--     "Ann Strambler" → ann.strambler@excelplannings.com  (thật)
--                     → baovothuong69@gmail.com           (test)
--     "Kay Huynh"     → kayhuynh@epsins.co                (thật)
--                     → baovocs04@gmail.com               (test)
--
-- task_agents chứa CẢ HAI "Ann Strambler". Trường Agent là bắt buộc, nên
-- ngày đầu ô chọn hiện hai dòng y hệt nhau — chọn nhầm là task về tay agent
-- test, kéo theo sai chủ sở hữu, sai phạm vi assistant, sai quyền xem.
-- Đây là lỗi định tuyến thầm lặng, không báo lỗi gì cả.
--
-- Cách xử: đổi tên hoặc tắt tài khoản test, và bỏ khỏi task_agents.
-- delete from task_agents where email = 'baovothuong69@gmail.com';
--
-- ── 3. Ba tài khoản test đang ACTIVE, nằm trong ô chọn người nhận ──────
--     admin.qa@epsins.co   (Admin QA)
--     admin_task@gmail.com (Admin Task)
--     cs_task@gmail.com    (CS Task)
--
-- ── 4. 7/11 nhóm việc đang dùng là do máy sinh ─────────────────────────
-- task_categories.created_by = 'sample-seed@local':
--     Call Insurance Company · Coordinate Team · Document Processing
--     Other · Resolve Billing Issue · Verify Insurance/Network
--     Update Payment Info
-- Do người thật tạo (bao.vo@excelplannings.com), giữ chắc chắn:
--     Change PCP · Scheduling Appointment · Submit/Follow-up Referral
--     Update Client Info
--
-- Chúng đọc rất hợp lý nên sẽ không ai để ý là máy sinh. Trường Category là
-- BẮT BUỘC ở mọi task, nên đây là danh sách cả đội nhìn hằng ngày. Cần CS
-- lead xác nhận giữ / đổi tên / tắt — không nên để mặc định.
--
-- ═══════════════════════════════════════════════════════════════════════
-- TUỲ CHỌN — dọn rác cấu hình
--
-- ĐÍNH CHÍNH: bản trước của file này ghi rằng 5 nhóm "Test" và 4 dropdown
-- option rác "vẫn hiện trong màn hình quản trị". SAI. Mọi câu đọc category
-- đều lọc `is_active = true`, mọi câu đọc cột/option đều lọc
-- `archived_at is null` (queries.ts:154 và :245). Chúng KHÔNG hiện ở đâu cả.
-- Vẫn nên dọn cho sạch, nhưng không phải vì lý do đó.
--
-- ── 4a. Cột cs đã archive — cái này MỚI là bẫy thật ────────────────────
-- table_column có `unique (scope, key)` KHÔNG kèm `where archived_at is null`
-- (schema.sql:3664), nên key đã archive bị giữ chỗ vĩnh viễn. Và
-- config/columns/route.ts:148-156 chặn cột mới nếu TRÙNG NHÃN (không phân
-- biệt hoa thường) với một cột đã archive → trả 409 và đẩy admin vào hộp
-- thoại "khôi phục".
--
-- Trong 9 cột cs đã archive có một cái tên **"Note"** (key `test_column`).
-- Đây là cái tên cột tuỳ chỉnh dễ được tạo nhất ngày đầu. Admin gõ "Note" →
-- 409 → bấm khôi phục → nhận về một cột mang key vĩnh viễn là `test_column`,
-- và key đó trở thành khoá JSON trong custom_values của MỌI task về sau.
--
-- delete from table_column where scope = 'cs' and archived_at is not null;  -- 9 dòng, option cascade theo
--
-- ── 4b. Rác còn lại ───────────────────────────────────────────────────
-- Đã kiểm: cả 4 luật SLA đều có category_id = null nên xoá nhóm "Test"
-- hiện KHÔNG mất luật nào. Nhưng đó là sự thật hôm nay, không phải bảo
-- đảm — task_sla_rules.category_id là `on delete cascade` (:1735).
--
-- begin;
-- delete from task_categories where name = 'Test' and is_active = false;   -- 5
-- delete from table_column_option where label in ('Hihi','Haha','Test1','test2');
-- delete from agent_members where cs_email = 'kay.huynh.sample@excelplannings.local';
-- delete from agent_members where agent_email = cs_email;                  -- tự làm assistant cho chính mình
-- commit;
--
-- ── 4c. Chuông thông báo KHÔNG rỗng ngày đầu ──────────────────────────
-- Huy hiệu chưa đọc của CS = task_notifications + enrollment_notifications
-- (tasks/notifications/route.ts:38-42). task_notifications về 0, nhưng
-- enrollment_notifications còn **8.205 dòng chưa đọc** trên 39 người —
-- người nhiều nhất 388. Agent CS mở bảng task mới tinh mà thấy huy hiệu ba
-- chữ số toàn tin enrollment.
-- Đây là va chạm phạm vi, không phải lỗi script. Đánh dấu đã đọc thì phải
-- hỏi bên enrollment trước, vì đó là dữ liệu của họ.
--
-- ── 4d. File đính kèm mồ côi trong Storage ────────────────────────────
-- bucket `task-attachments`, 176.066 byte, tải lên 2026-08-03:
--   tasks/1d255aa7-.../a9456ee5-...-health-tasks.xlsx
-- Là bảng tính chứa dữ liệu khách hàng thật. Dòng task_attachments bị xoá
-- nhưng file vẫn nằm đó, không còn đường nào truy cập qua ứng dụng.
-- Dọn qua Storage dashboard, hoặc:
--   delete from storage.objects where bucket_id = 'task-attachments';
-- ═══════════════════════════════════════════════════════════════════════
