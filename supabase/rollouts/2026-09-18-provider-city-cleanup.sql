-- =====================================================================
-- Dọn cột `city` của provider_directory: bỏ ký tự xuống dòng.
--
-- TRIỆU CHỨNG: trên màn hình hiện ra chuỗi dính liền như
--   "Corpus ChristiCypressGreater HeightsKatyLeague CityHouston..."
-- vì HTML nuốt ký tự xuống dòng. Trong database nó là nhiều thành phố
-- ngăn nhau bằng "\n".
--
-- NGUYÊN NHÂN: bước làm sạch ngày 2026-09-17 chỉ bỏ xuống dòng ở cột `street`,
-- quên `city`, `facility`, `doctors`.
--
-- CÓ HAI LOẠI, XỬ KHÁC NHAU:
--
--   A. Dòng ĐÃ TÁCH thành nhiều bản ghi nhưng quên chia `city` theo từng bản.
--      Mỗi bản ghi có ZIP riêng nên gán đúng MỘT thành phố được. Sửa triệt để.
--
--   B. Mục TỔNG của cả hệ thống: `street` ghi "X's Locations", ZIP bị che
--      ("78***"). Danh sách thành phố là TOÀN BỘ nơi hệ thống đó có mặt, không
--      có địa chỉ riêng cho từng nơi. Ép về một thành phố là BỊA DỮ LIỆU, nên
--      chỉ đổi dấu ngăn cho dễ đọc và giữ cờ `needs_review`.
--
-- Ánh xạ ZIP -> thành phố lấy từ CHÍNH dữ liệu trong bảng (các dòng khác cùng
-- ZIP), không phải đoán: 77459=Missouri City (3 dòng), 77407=Richmond (2),
-- 77379=Spring (2), 78258=San Antonio (8).
--
-- Idempotent: mọi mệnh đề đều có điều kiện "còn chứa xuống dòng" hoặc so sánh
-- khác giá trị đích, nên chạy lại không đổi gì thêm.
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- LOẠI A — gán đúng một thành phố cho từng bản ghi đã tách
-- ---------------------------------------------------------------------

-- #107 Sarah Ho — hai cơ sở, ô city đang là "Richmond\nMissouri City"
update public.provider_directory
set city = 'Missouri City', updated_at = now()
where source_row_number = 107 and zip_code = '77459' and city <> 'Missouri City';

update public.provider_directory
set city = 'Richmond', updated_at = now()
where source_row_number = 107 and zip_code = '77407' and city <> 'Richmond';

-- #331 Muriel Martinez — hai cơ sở, ô city đang là "The Woodlands\nSpring".
-- 77379 = Spring (xác nhận từ dữ liệu). 77375 không có dòng nào khác dùng, nên
-- suy ra bằng loại trừ: ô gốc có đúng 2 thành phố cho đúng 2 bản ghi.
update public.provider_directory
set city = 'Spring', updated_at = now()
where source_row_number = 331 and zip_code = '77379' and city <> 'Spring';

update public.provider_directory
set city = 'The Woodlands', updated_at = now()
where source_row_number = 331 and zip_code = '77375' and city <> 'The Woodlands';

-- #113 Lauren Ashley Thomas — có MỘT địa chỉ thật (ZIP 78258 = San Antonio);
-- "Boerne" trong ô city là cơ sở khác không kèm địa chỉ nào, `street` cũng chỉ
-- ghi "Other Locations". Giữ cờ needs_review để người xem bổ sung sau.
update public.provider_directory
set city = 'San Antonio', updated_at = now()
where source_row_number = 113 and zip_code = '78258' and city <> 'San Antonio';

-- ---------------------------------------------------------------------
-- LOẠI B — mục tổng hệ thống: chỉ đổi dấu ngăn, KHÔNG ép về một thành phố
-- ---------------------------------------------------------------------
-- #69 Baptist M&S Imaging · #84 Oncology Consultants · #88 Pediatric Cardiology
-- Care · #114 Covington County Hospital
update public.provider_directory
set city = regexp_replace(btrim(city), '\s*\n+\s*', ', ', 'g'),
    needs_review = true,
    updated_at = now()
where city like '%' || chr(10) || '%'
  and street ~* '(location|locations)';

-- ---------------------------------------------------------------------
-- Lưới an toàn — bất kỳ ô city nào còn sót xuống dòng mà hai mệnh đề trên
-- chưa phủ. Đổi dấu ngăn và gắn cờ để người thật xem lại, thay vì im lặng bỏ
-- qua một dòng hiển thị hỏng.
-- ---------------------------------------------------------------------
update public.provider_directory
set city = regexp_replace(btrim(city), '\s*\n+\s*', ', ', 'g'),
    needs_review = true,
    updated_at = now()
where city like '%' || chr(10) || '%';

-- ---------------------------------------------------------------------
-- Kiểm chứng — cả ba cột phải ra 'ok'.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.provider_directory where city like '%' || chr(10) || '%') then
    raise exception 'Van con o city chua ky tu xuong dong';
  end if;
end $$;

select
  case when (select count(*) from public.provider_directory
             where city like '%' || chr(10) || '%') = 0
       then 'ok' else 'FAIL: còn xuống dòng trong city' end            as city_sach,
  case when (select count(*) from public.provider_directory
             where source_row_number = 107 and city = 'Missouri City') = 1
       and  (select count(*) from public.provider_directory
             where source_row_number = 107 and city = 'Richmond') = 1
       then 'ok' else 'FAIL: #107 chưa chia đúng thành phố' end        as row_107,
  case when (select count(*) from public.provider_directory
             where source_row_number = 331 and city = 'Spring') = 1
       and  (select count(*) from public.provider_directory
             where source_row_number = 331 and city = 'The Woodlands') = 1
       then 'ok' else 'FAIL: #331 chưa chia đúng thành phố' end        as row_331;

-- Xem lại các dòng vừa đụng tới.
select source_row_number, doctors, city, zip_code, street, needs_review
from public.provider_directory
where source_row_number in (69, 84, 88, 107, 113, 114, 331)
order by source_row_number, zip_code;

commit;

notify pgrst, 'reload schema';
