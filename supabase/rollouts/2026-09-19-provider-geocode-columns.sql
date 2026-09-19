-- =====================================================================
-- Toạ độ cho provider_directory, phục vụ lọc sơ bộ theo khoảng cách THẬT.
--
-- Vì sao cần: Provider Finder đang chọn 20 ứng viên gửi sang Maps bằng cách
-- so chuỗi (+50 trùng ZIP, +20 trùng thành phố, +10 trùng bang). Đo thật với
-- khách Houston 77036 + UHC: 75 nhà khớp hợp đồng thì 52 nhà chỉ được 10 điểm
-- — hệ thống không biết gì về vị trí của chúng và chúng không bao giờ được
-- tính khoảng cách. Có toạ độ thì 20 suất đó chọn theo khoảng cách thật.
--
-- Idempotent. Chạy một lần là đủ; chạy lại không hỏng gì.
-- ⚠ Sau khi chạy xong PHẢI reload schema cache của PostgREST (câu lệnh cuối).
-- =====================================================================

begin;

alter table public.provider_directory
  add column if not exists latitude       double precision,
  add column if not exists longitude      double precision,
  -- 'census'  = Census geocoder khớp tới số nhà (chính xác)
  -- 'zip_avg' = trung bình toạ độ các nhà cùng ZIP đã khớp (sai số ~1-3km)
  add column if not exists geocode_source text,
  add column if not exists geocoded_at    timestamptz,
  -- Băm của chuỗi địa chỉ lúc geocode. Địa chỉ đổi -> băm đổi -> lần chạy sau
  -- geocode lại. Không có cột này thì sửa địa chỉ xong toạ độ vẫn trỏ chỗ cũ
  -- mà không ai biết, và Finder im lặng chỉ sai đường.
  add column if not exists geocode_key    text;

alter table public.provider_directory
  drop constraint if exists provider_directory_geocode_source_check;
alter table public.provider_directory
  add constraint provider_directory_geocode_source_check
  check (geocode_source is null or geocode_source in ('census', 'zip_avg'));

-- Chỉ mục một phần: chỉ dòng CÓ toạ độ mới đáng quét khi lọc theo vùng.
create index if not exists provider_directory_latlng_idx
  on public.provider_directory (latitude, longitude)
  where latitude is not null and longitude is not null;

-- Kiểm chứng: thiếu cột thì dừng hẳn, không commit nửa vời.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'provider_directory'
      and column_name in ('latitude', 'longitude', 'geocode_source', 'geocode_key')
    having count(*) = 4
  ) then
    raise exception 'Thieu cot toa do tren provider_directory';
  end if;
end $$;

commit;

-- Số liệu trước khi backfill: co_toa_do phải bằng 0.
select
  count(*)                                     as tong,
  count(*) filter (where latitude is not null) as co_toa_do
from public.provider_directory
where archived_at is null;

-- PostgREST nhớ schema trong bộ nhớ. Không reload thì API vẫn báo
-- "column provider_directory.latitude does not exist" dù cột đã có thật.
notify pgrst, 'reload schema';
