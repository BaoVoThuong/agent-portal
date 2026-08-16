-- ═══════════════════════════════════════════════════════════════════════
-- DỌN CẤU HÌNH TRƯỚC GO-LIVE CUSTOMER SERVICE  —  2026-08-17
--
-- Đi kèm 2026-08-17-reset-cs-for-golive.sql nhưng TÁCH RIÊNG vì khác bản
-- chất: file reset xoá dữ liệu và chỉ chạy MỘT lần; file này sửa cấu hình
-- và IDEMPOTENT — chạy lại bao nhiêu lần cũng ra một kết quả.
--
-- Chạy trước hay sau file reset đều được.
--
-- Sáu việc, tất cả đều từ kết quả rà soát chứ không phải suy đoán.
-- ═══════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Trả SLA về giá trị thiết kế ────────────────────────────────────
-- QA chỉnh xuống cho test nhanh rồi để nguyên. Giá trị seed ở
-- schema.sql:1849-1854 và src/lib/tasks/sla.ts:11-16.
--
--   urgent    5 → 60    ← nguy hiểm nhất
--   high     75 → 240
--   medium  465 → 480
--   low    1440 ✓ giữ nguyên
--
-- Để urgent = 5 phút thì task urgent đầu tiên quá hạn sau 5 phút; cron
-- 15 phút sau cộng vĩnh viễn vào overdue_count (không bao giờ reset) và
-- bắn sla_escalated cho chủ agent, toàn bộ assistant VÀ MỌI ADMIN.
-- Kéo theo: rotation.ts:41 lấy cooldown = effectiveSlaMinutes, nên giao
-- một task urgent chỉ khoá vòng xoay 5 phút thay vì 60.
update task_sla_rules set duration_minutes = 60,  updated_at = now()
  where priority = 'urgent' and category_id is null and duration_minutes <> 60;
update task_sla_rules set duration_minutes = 240, updated_at = now()
  where priority = 'high'   and category_id is null and duration_minutes <> 240;
update task_sla_rules set duration_minutes = 480, updated_at = now()
  where priority = 'medium' and category_id is null and duration_minutes <> 480;

-- ── 2. Bỏ trùng tên hiển thị ──────────────────────────────────────────
-- Giao diện luôn hiện TÊN, không hiện email (people.ts personLabel). Hai
-- tài khoản cùng tên "Ann Strambler" và cả hai đều nằm trong task_agents,
-- mà trường Agent là bắt buộc → ô chọn hiện hai dòng y hệt nhau, chọn nhầm
-- là task về tay agent test, sai luôn chủ sở hữu và phạm vi assistant.
update portal_account set name = 'Bao Vo Test'
  where lower(email) = 'baovothuong69@gmail.com' and name <> 'Bao Vo Test';
-- baovocs04@gmail.com đang mang tên "Kay Huynh", trùng với kayhuynh@epsins.co
-- — cùng kiểu lỗi, cùng hậu quả.
update portal_account set name = 'Bao Vo Test 04'
  where lower(email) = 'baovocs04@gmail.com' and name <> 'Bao Vo Test 04';

-- ── 3. Xoá toàn bộ cột cs đã archive ──────────────────────────────────
-- table_column có `unique (scope, key)` KHÔNG kèm `where archived_at is null`
-- (schema.sql:3664) nên key đã archive giữ chỗ vĩnh viễn, và
-- config/columns/route.ts:148-156 chặn cột mới trùng NHÃN với cột đã archive
-- bằng 409 rồi đẩy admin vào hộp thoại khôi phục.
--
-- Trong 9 cột này có một cái nhãn là "Note" (key `test_column`) — tên cột
-- tuỳ chỉnh dễ tạo nhất ngày đầu. Không xoá thì admin gõ "Note" sẽ nhận 409,
-- bấm khôi phục, và lãnh một cột mang key vĩnh viễn `test_column` — key đó
-- thành khoá JSON trong custom_values của mọi task về sau.
--
-- table_column_option cascade theo (schema.sql), nên 4 giá trị rác
-- Hihi/Haha/Test1/test2 cũng đi cùng vì chúng treo dưới các cột này.
delete from table_column where scope = 'cs' and archived_at is not null;

-- ── 4. Xoá nhóm việc "Test" đã tắt ────────────────────────────────────
-- Đã kiểm: cả 4 luật SLA đều có category_id = null nên không luật nào mất
-- theo. task_sla_rules.category_id là `on delete cascade` (schema.sql:1735)
-- nên nếu sau này có luật gắn riêng cho nhóm thì phải kiểm lại trước khi xoá.
delete from task_categories where name = 'Test' and is_active = false;

-- ── 4b. Trả quyền tác giả 7 nhóm việc về đúng người ───────────────────
-- 7 trong 11 nhóm việc đang dùng ghi created_by = 'sample-seed@local':
--     Call Insurance Company · Coordinate Team · Document Processing
--     Other · Resolve Billing Issue · Verify Insurance/Network
--     Update Payment Info
--
-- Đây KHÔNG phải rác máy sinh — người dùng xác nhận chính mình đã tạo, chỉ
-- bị bộ seed ghi nhầm tác giả. Nên giữ nguyên nhóm việc, chỉ sửa lại
-- created_by. Nếu để 'sample-seed@local' thì lần rà soát sau lại có người
-- tưởng là dữ liệu giả và xoá nhầm — đúng cái bẫy vừa suýt dính.
update task_categories
set created_by = 'bao.vo@excelplannings.com'
where created_by = 'sample-seed@local';

-- ── 5. Dọn agent_members rác ──────────────────────────────────────────
-- kay.huynh.sample@excelplannings.local là địa chỉ seed, không có trong
-- portal_account. Dòng tự làm assistant cho chính mình cũng vô nghĩa.
delete from agent_members where lower(cs_email) like '%@excelplannings.local';
delete from agent_members where lower(agent_email) = lower(cs_email);

-- ── 6. Xoá thông báo enrollment ───────────────────────────────────────
-- LƯU Ý QUAN TRỌNG: đây KHÔNG phải thông báo của task đã xoá.
-- task_notifications đã về 0 nhờ cascade từ `delete from tasks`.
-- Đây là thông báo của record enrollment — mà enrollment thì ĐANG GIỮ NGUYÊN.
-- Chúng lọt vào chuông CS vì huy hiệu gộp cả hai luồng
-- (tasks/notifications/route.ts:38-42).
--
-- Phân bố thật: 8.127 thuộc record MẪU (7.734 chưa đọc), 516 thuộc 27 record
-- THẬT (471 chưa đọc), 0 mồ côi.
--
-- Không bảng nào tham chiếu enrollment_notifications nên xoá an toàn về mặt
-- khoá ngoại. Xoá hết theo yêu cầu — kể cả 516 tin của record thật.
delete from enrollment_notifications;

commit;

-- ═══ KIỂM TRA — mọi dòng phải ✅ ═══════════════════════════════════════
select
  case when ok then '✅' else '❌ SAI' end as "Kết quả",
  name as "Kiểm tra", detail as "Giá trị"
from (
  select 1 as sort, 'SLA urgent = 60 phút' as name,
    (select duration_minutes from task_sla_rules where priority='urgent' and category_id is null) = 60 as ok,
    (select duration_minutes::text from task_sla_rules where priority='urgent' and category_id is null) as detail
  union all select 2, 'SLA high = 240',
    (select duration_minutes from task_sla_rules where priority='high' and category_id is null) = 240,
    (select duration_minutes::text from task_sla_rules where priority='high' and category_id is null)
  union all select 3, 'SLA medium = 480',
    (select duration_minutes from task_sla_rules where priority='medium' and category_id is null) = 480,
    (select duration_minutes::text from task_sla_rules where priority='medium' and category_id is null)
  union all select 4, 'Không còn hai người trùng tên hiển thị',
    (select count(*) from (
       select name from portal_account where is_active group by name having count(*) > 1
     ) d) = 0,
    coalesce((select string_agg(name, ', ') from (
       select name from portal_account where is_active group by name having count(*) > 1
     ) d2), '(không có)')
  union all select 5, 'Không còn cột cs đã archive',
    (select count(*) from table_column where scope='cs' and archived_at is not null) = 0,
    (select count(*)::text from table_column where scope='cs' and archived_at is not null)
  union all select 6, 'Không còn nhóm việc "Test"',
    (select count(*) from task_categories where name='Test') = 0,
    (select count(*)::text from task_categories where name='Test')
  union all select 7, 'enrollment_notifications đã rỗng',
    (select count(*) from enrollment_notifications) = 0,
    (select count(*)::text from enrollment_notifications)
  union all select 8, 'Nhóm việc còn dùng được (>=4 cái người thật tạo)',
    (select count(*) from task_categories where is_active) >= 4,
    (select count(*)::text from task_categories where is_active)
  union all select 9, 'Cột cs còn dùng được',
    (select count(*) from table_column where scope='cs' and archived_at is null) >= 12,
    (select count(*)::text from table_column where scope='cs' and archived_at is null)
  union all select 11, 'Không còn nhóm việc ghi tác giả sample-seed',
    (select count(*) from task_categories where created_by = 'sample-seed@local') = 0,
    (select count(*)::text from task_categories where created_by = 'sample-seed@local')
  union all select 12, 'Nhóm việc active vẫn đủ 11',
    (select count(*) from task_categories where is_active) = 11,
    (select count(*)::text from task_categories where is_active)
  union all select 10, 'ENROLLMENT record còn nguyên',
    (select count(*) from enrollment_records) = 667,
    (select count(*)::text from enrollment_records)
) t
order by sort;

-- ═══════════════════════════════════════════════════════════════════════
-- CHƯA LÀM — cần anh chốt
--
-- ── A. Ba tài khoản test: nên TẮT chứ đừng xoá ────────────────────────
--     admin.qa@epsins.co · admin_task@gmail.com · cs_task@gmail.com
--
-- Mục tiêu là chúng biến khỏi ô chọn người nhận. `is_active = false` đạt
-- đúng điều đó: fetchTaskAssignees (assignees.ts:56-85) và
-- fetchEnrollmentPeople đều lọc `is_active = true`.
--
-- Xoá cứng thì thêm rủi ro mà không thêm lợi ích: 265 record enrollment
-- đang trỏ vào ba email này (admin.qa 63, admin_task 169, cs_task 33), và
-- trong đó **3 record THẬT** trỏ vào cs_task@gmail.com. Xoá xong ba record
-- đó mất tên người, chỉ còn email trần hoặc trống. Enrollment lại đang nằm
-- ngoài phạm vi reset. Xoá cứng cũng cascade mất user_roles và không lùi được.
--
-- Nên chạy:
-- update portal_account set is_active = false
--   where lower(email) in ('admin.qa@epsins.co','admin_task@gmail.com','cs_task@gmail.com');
--
-- Vẫn muốn xoá hẳn thì:
-- delete from portal_account
--   where lower(email) in ('admin.qa@epsins.co','admin_task@gmail.com','cs_task@gmail.com');
--
-- Đã chốt và làm ở trên: đổi tên hai tài khoản trùng (mục 2), và giữ
-- nguyên 11 nhóm việc chỉ sửa lại tác giả (mục 4b).
--
-- ═══════════════════════════════════════════════════════════════════════
-- XOÁ HAI TÀI KHOẢN TEST — chạy RIÊNG, đọc kỹ trước
--
-- Quyết định: xoá hẳn admin_task@gmail.com và cs_task@gmail.com.
-- admin.qa@epsins.co GIỮ LẠI (chưa có quyết định).
--
-- Đã đo tham chiếu sau khi dữ liệu CS đã rỗng:
--
--   admin_task@gmail.com
--     user_roles  1  → cascade theo portal_account, tự mất
--     enrollment  169 record — TẤT CẢ là [Sample QA], 0 record thật
--     → xoá sạch, không ảnh hưởng gì
--
--   cs_task@gmail.com
--     user_roles  1  → cascade
--     queue_members 1 → KHÔNG có khoá ngoại, phải xoá tay nếu không muốn
--                       để lại một email ma trong hàng chờ tự giao việc
--     enrollment  33 record, trong đó **3 RECORD THẬT** đang để nó làm
--                 responsible_enroll_email:
--                   #2  Bich Dang - UHC + Humana Part D   (medicare)
--                   #26 Mai Vo - done pending QC          (aca)
--                   #18 Huynh Ngoc Tuyet Nguyen - comple… (aca)
--
-- Ba record đó phải xử TRƯỚC khi xoá tài khoản, nếu không chúng trỏ vào
-- người không tồn tại và ô "người phụ trách" hiện email trần hoặc trống.
-- Enrollment đang nằm ngoài phạm vi reset nên đây là dữ liệu đang dùng thật.
--
-- Chọn MỘT trong hai cách cho 3 record đó:
--
--   (a) Trả về chưa giao — chúng nổi lên hàng chờ để người thật nhận:
--       update enrollment_records
--       set responsible_enroll_email = null, responsible_assigned_at = null
--       where lower(responsible_enroll_email) = 'cs_task@gmail.com'
--         and client_name not like '%Sample QA%';
--
--   (b) Giao thẳng cho một người cụ thể:
--       update enrollment_records
--       set responsible_enroll_email = '<email người nhận>'
--       where lower(responsible_enroll_email) = 'cs_task@gmail.com'
--         and client_name not like '%Sample QA%';
--
-- Xong bước trên rồi mới chạy:
--
-- begin;
-- delete from task_assignment_queue_members
--   where lower(email) in ('admin_task@gmail.com','cs_task@gmail.com');
-- delete from portal_account
--   where lower(email) in ('admin_task@gmail.com','cs_task@gmail.com');
-- commit;
--
-- Kiểm tra sau khi xoá — cả ba phải bằng 0:
--   select count(*) from portal_account
--     where lower(email) in ('admin_task@gmail.com','cs_task@gmail.com');
--   select count(*) from task_assignment_queue_members
--     where lower(email) in ('admin_task@gmail.com','cs_task@gmail.com');
--   select count(*) from enrollment_records
--     where lower(responsible_enroll_email) = 'cs_task@gmail.com'
--       and client_name not like '%Sample QA%';
-- ═══════════════════════════════════════════════════════════════════════
