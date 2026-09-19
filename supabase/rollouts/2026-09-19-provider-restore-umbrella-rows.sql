-- =====================================================================
-- Khôi phục 16 dòng "mục tổng hệ thống" đã archive ngày 18/09.
--
-- BỐI CẢNH: 16 bản ghi có `street` dạng "X's Locations" (Memorial Hermann,
-- HCA, CHRISTUS, Houston Methodist, Baylor, UT Physicians, Texas Children's,
-- St. Luke's, và vài phòng khám lẻ) bị archive lúc 2026-09-18 15:41. Chúng là
-- mục tổng của cả một hệ thống bệnh viện, không phải một cơ sở tra cứu được.
--
-- Nay cần lấy lại: dữ liệu vẫn có giá trị tra cứu (bảo hiểm nào nhận ở hệ thống
-- nào), chỉ là không dùng được trong Provider Finder vì thiếu địa chỉ cụ thể.
--
-- Archive là xoá MỀM nên không mất gì — chỉ cần bỏ dấu `archived_at`.
--
-- SAU KHI KHÔI PHỤC: đúng 16 dòng này sẽ hiện NỀN CẢNH BÁO trên Provider List,
-- vì `isProviderAddressUsable` thấy `street` không có chữ số nào. Đó là chủ ý:
-- chúng quay lại danh sách, đồng thời được đánh dấu rõ là còn thiếu địa chỉ.
--
-- Nhắm theo đúng mốc thời gian archive nên không đụng nhầm dòng nào khác.
-- Idempotent: chạy lại không đổi gì (`archived_at is not null`).
-- ⚠ Sau khi chạy: notify pgrst, 'reload schema';
-- =====================================================================

begin;

-- Xem trước khi ghi (chạy riêng nếu muốn kiểm):
-- select source_row_number, doctors, facility, street
-- from public.provider_directory
-- where archived_at >= timestamptz '2026-09-18 15:41:00+00'
--   and archived_at <  timestamptz '2026-09-18 15:42:00+00'
-- order by source_row_number;

update public.provider_directory
set archived_at = null,
    updated_at  = now()
where archived_at is not null
  and archived_at >= timestamptz '2026-09-18 15:41:00+00'
  and archived_at <  timestamptz '2026-09-18 15:42:00+00';

-- ---------------------------------------------------------------------
-- Kiểm chứng — cả ba cột phải ra 'ok'.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from public.provider_directory
    where archived_at >= timestamptz '2026-09-18 15:41:00+00'
      and archived_at <  timestamptz '2026-09-18 15:42:00+00'
  ) then
    raise exception 'Van con dong chua duoc khoi phuc';
  end if;
end $$;

select
  case when (select count(*) from public.provider_directory
             where archived_at is null) = 458
       then 'ok' else 'KIỂM LẠI: số dòng đang hiện không phải 458' end     as dang_hien,
  case when (select count(*) from public.provider_directory
             where archived_at is not null) = 0
       then 'ok' else 'KIỂM LẠI: vẫn còn dòng bị archive' end              as het_archive,
  case when (select count(*) from public.provider_directory
             where archived_at is null and street ~* 'location') = 16
       then 'ok' else 'KIỂM LẠI: số dòng mục tổng không phải 16' end       as du_16_dong;

-- Danh sách vừa khôi phục, để đối chiếu bằng mắt.
select source_row_number, doctors, facility, street, city, zip_code
from public.provider_directory
where archived_at is null and street ~* 'location'
order by source_row_number;

commit;

notify pgrst, 'reload schema';
