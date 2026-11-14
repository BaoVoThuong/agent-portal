-- =====================================================================
-- State Licensing: mỗi hãng một màu riêng (2026-11-14).
-- Màu gán lúc chuyển dữ liệu lấy từ bảng 7 màu chung nên nhiều hãng trùng
-- màu (user 14/11). Đặt 22 màu khác nhau theo tên hãng, cùng một màu ở mọi
-- sản phẩm. Chỉ đụng giá trị của bảng 'licensing'. Sửa lại được ở Table
-- Configuration → State Licensing Map → Dropdown Values.
-- =====================================================================

begin;

with palette (label, color) as (
  values
  ('HealthSpring', '#c12415'),
  ('UHC', '#19e666'),
  ('Devoted', '#8815c1'),
  ('Humana', '#e6dd19'),
  ('Ambetter', '#1596c1'),
  ('Oscar', '#e61977'),
  ('Molina', '#32c115'),
  ('HealthSpring (SHL)', '#3319e6'),
  ('Aetna', '#c15d15'),
  ('Anthem', '#19e6aa'),
  ('Wellcare', '#c115c1'),
  ('Wellpoint', '#aae619'),
  ('Imperial', '#8a5a00'),
  ('BCBS', '#0055cc'),
  ('CareSource', '#15c132'),
  ('Cigna', '#00838f'),
  ('Highmark', '#c19615'),
  ('SCAN', '#19dde6'),
  ('Antidote', '#c11587'),
  ('CHC', '#65e619'),
  ('Christus', '#1523c1'),
  ('HealthFirst', '#e64519')
)
update table_column_option o
set color = p.color, updated_at = now()
from palette p, table_column c
where c.id = o.column_id
  and c.scope = 'licensing'
  and o.archived_at is null
  and lower(btrim(o.label)) = lower(p.label)
  and o.color is distinct from p.color;

commit;

select o.label, o.color, count(*) as products
from table_column_option o join table_column c on c.id = o.column_id
where c.scope = 'licensing' and o.archived_at is null
group by o.label, o.color order by o.label;
